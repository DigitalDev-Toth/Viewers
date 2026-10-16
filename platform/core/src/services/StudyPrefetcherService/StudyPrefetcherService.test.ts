import StudyPrefetcherService from './StudyPrefetcherService';
import ViewportGridService from '../ViewportGridService';

/**
 * Two display sets: `active` (on the viewport, loaded by it) and `next`,
 * which the prefetcher loads. The image loader answers each attempt by hand.
 */
function setup({
  retryDelays = [1000, 5000],
  activeImageIds = ['a1'],
  nextImageIds = ['n1', 'n2'],
} = {}) {
  const handlers = {};
  const subscribe = (event, handler) => {
    handlers[event] = handler;
    return { unsubscribe: () => {} };
  };
  const displaySets = [
    { displaySetInstanceUID: 'active', imageIds: activeImageIds },
    { displaySetInstanceUID: 'next', imageIds: nextImageIds },
  ];
  const servicesManager = {
    services: {
      displaySetService: {
        EVENTS: { DISPLAY_SETS_CHANGED: 'displaySetsChanged' },
        subscribe,
        getActiveDisplaySets: () => displaySets,
      },
      viewportGridService: {
        subscribe,
        getState: () => ({
          activeViewportId: 'vp',
          viewports: new Map([['vp', { displaySetInstanceUIDs: ['active'] }]]),
        }),
      },
    },
  };
  const extensionManager = {
    getActiveDataSource: () => [{ getImageIdsForDisplaySet: ds => ds.imageIds }],
  };

  const service = new StudyPrefetcherService({
    servicesManager,
    extensionManager,
    configuration: {
      enabled: true,
      displaySetsCount: Infinity,
      maxNumPrefetchRequests: 10,
      order: 'closest',
      retryDelays,
    },
  } as any);

  const cached = new Set<string>();
  const attempts: Record<string, Array<{ resolve: () => void; reject: () => void }>> = {};
  const imageEvents: { loaded?: (evt) => void; failed?: (evt) => void } = {};

  service.cache = { isImageCached: imageId => cached.has(imageId) };
  service.imageLoadPoolManager = {
    addRequest: requestFn => requestFn(),
    clearRequestStack: () => {},
  };
  service.imageLoader = {
    loadAndCacheImage: imageId =>
      new Promise<void>((resolve, reject) => {
        (attempts[imageId] ??= []).push({
          resolve: () => {
            cached.add(imageId);
            imageEvents.loaded({ detail: { image: { imageId } } });
            resolve();
          },
          reject: () => {
            imageEvents.failed({ detail: { imageId } });
            reject(new Error('404'));
          },
        });
      }),
  };
  service.imageLoadEventsManager = {
    addEventListeners: (onLoaded, onFailed) => {
      imageEvents.loaded = onLoaded;
      imageEvents.failed = onFailed;
      return [];
    },
  };

  const progress: Record<string, { loadingProgress: number; numFailedImages: number }> = {};
  service.subscribe(service.EVENTS.DISPLAYSET_LOAD_PROGRESS, evt => {
    progress[evt.displaySetInstanceUID] = evt;
  });

  service.onModeEnter();
  handlers[ViewportGridService.EVENTS.VIEWPORTS_READY]();

  // What the viewport does with the active display set
  const viewportLoads = (imageId, ok = true) =>
    ok
      ? (cached.add(imageId), imageEvents.loaded({ detail: { image: { imageId } } }))
      : imageEvents.failed({ detail: { imageId } });

  return { service, attempts, progress, viewportLoads };
}

const settle = () => new Promise(resolve => jest.requireActual('timers').setImmediate(resolve));

describe('StudyPrefetcherService retries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries a failed image after each delay and counts it as failed only at the end', async () => {
    const { attempts, progress, viewportLoads } = setup();
    viewportLoads('a1');

    expect(attempts.n1).toHaveLength(1);
    attempts.n1[0].reject();
    attempts.n2[0].resolve();
    await settle();

    // Waiting for the retry: not done, nothing failed yet
    expect(progress.next.loadingProgress).toBe(0.5);
    expect(progress.next.numFailedImages).toBe(0);

    jest.advanceTimersByTime(1000);
    expect(attempts.n1).toHaveLength(2);
    attempts.n1[1].reject();
    await settle();

    jest.advanceTimersByTime(5000);
    expect(attempts.n1).toHaveLength(3);
    attempts.n1[2].reject();
    await settle();

    // Out of retries
    jest.advanceTimersByTime(60000);
    expect(attempts.n1).toHaveLength(3);
    expect(progress.next).toMatchObject({ loadingProgress: 1, numFailedImages: 1 });
  });

  it('is done without failures when a retry succeeds', async () => {
    const { attempts, progress, viewportLoads } = setup();
    viewportLoads('a1');

    attempts.n1[0].reject();
    attempts.n2[0].resolve();
    await settle();
    jest.advanceTimersByTime(1000);
    attempts.n1[1].resolve();
    await settle();

    expect(progress.next).toMatchObject({ loadingProgress: 1, numFailedImages: 0 });
  });

  it('retries an image the viewport failed to load, without holding back the rest', async () => {
    const { attempts, progress, viewportLoads } = setup({ activeImageIds: ['a1', 'a2'] });
    viewportLoads('a1');
    viewportLoads('a2', false);

    // The other series start loading while a2 waits for its retry
    expect(attempts.n1).toHaveLength(1);
    expect(progress.active.numFailedImages).toBe(0);

    jest.advanceTimersByTime(1000);
    expect(attempts.a2).toHaveLength(1);
    attempts.a2[0].resolve();
    await settle();

    expect(progress.active).toMatchObject({ loadingProgress: 1, numFailedImages: 0 });
  });

  it('retries by hand the failed images of a display set, with all the delays again', async () => {
    const { service, attempts, progress, viewportLoads } = setup({ retryDelays: [] });
    viewportLoads('a1');

    attempts.n1[0].reject();
    attempts.n2[0].resolve();
    await settle();
    expect(progress.next).toMatchObject({ loadingProgress: 1, numFailedImages: 1 });

    service.retryFailedImages('next');
    expect(progress.next).toMatchObject({ loadingProgress: 0.5, numFailedImages: 0 });
    expect(attempts.n1).toHaveLength(2);

    attempts.n1[1].resolve();
    await settle();
    expect(progress.next).toMatchObject({ loadingProgress: 1, numFailedImages: 0 });
  });

  it('without retryDelays counts a failure right away, as before', async () => {
    const { attempts, progress, viewportLoads } = setup({ retryDelays: [] });
    viewportLoads('a1');

    attempts.n1[0].reject();
    await settle();

    expect(progress.next.numFailedImages).toBe(1);
    jest.advanceTimersByTime(60000);
    expect(attempts.n1).toHaveLength(1);
  });
});
