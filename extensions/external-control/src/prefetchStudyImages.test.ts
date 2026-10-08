/**
 * The prefetch runs while the radiologist works on another study, so what
 * matters is what it must not do: queue ahead of the screen, fill the cache,
 * keep going for a study that was removed, or queue the same study twice.
 */

const mockPool: Array<{ fn: () => Promise<void>; type: string; priority: number }> = [];
let mockCacheSize = 0;
const mockCached = new Set<string>();

jest.mock(
  '@cornerstonejs/core',
  () => ({
    cache: {
      getImageLoadObject: (id: string) => (mockCached.has(id) ? {} : undefined),
      getCacheSize: () => mockCacheSize,
      getMaxCacheSize: () => 100,
    },
    imageLoader: {
      loadAndCacheImage: jest.fn(async (id: string) => {
        if (id.includes('roto')) {
          throw new Error('404');
        }
        mockCached.add(id);
      }),
    },
    imageLoadPoolManager: {
      addRequest: (fn, type, _details, priority) => mockPool.push({ fn, type, priority }),
    },
    Enums: { RequestType: { Prefetch: 'prefetch' } },
  }),
  { virtual: true }
);

import { imageLoader } from '@cornerstonejs/core';
import { cancelStudyPrefetch, prefetchStudy, studyPrefetchProgress } from './prefetchStudyImages';

const runPool = async () => {
  while (mockPool.length) {
    await mockPool.shift().fn();
  }
};

describe('prefetchStudy', () => {
  beforeEach(() => {
    mockPool.length = 0;
    mockCached.clear();
    mockCacheSize = 0;
    jest.clearAllMocks();
  });

  it('encola en el carril de precarga, detrás del precargador de OHIF (-5)', () => {
    prefetchStudy('estudio-1', ['a', 'b']);

    expect(mockPool).toHaveLength(2);
    expect(mockPool.every(r => r.type === 'prefetch' && r.priority > -5)).toBe(true);
    cancelStudyPrefetch('estudio-1');
  });

  it('cuenta lo que ya estaba en caché sin volver a pedirlo', async () => {
    mockCached.add('a');
    prefetchStudy('estudio-2', ['a', 'b']);
    await runPool();

    expect(mockPool).toHaveLength(0);
    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(1);
    expect(studyPrefetchProgress('estudio-2')).toEqual({ total: 2, loaded: 2, failed: 0, skipped: 0 });
    cancelStudyPrefetch('estudio-2');
  });

  it('una imagen que falla se cuenta y no corta el resto', async () => {
    prefetchStudy('estudio-3', ['roto', 'b']);
    await runPool();

    expect(studyPrefetchProgress('estudio-3')).toMatchObject({ loaded: 1, failed: 1 });
    cancelStudyPrefetch('estudio-3');
  });

  it('se detiene cerca del tope de la caché en vez de desalojar lo que está en pantalla', async () => {
    mockCacheSize = 85;
    prefetchStudy('estudio-4', ['a', 'b']);
    await runPool();

    expect(imageLoader.loadAndCacheImage).not.toHaveBeenCalled();
    expect(studyPrefetchProgress('estudio-4')).toMatchObject({ loaded: 0, skipped: 2 });
    cancelStudyPrefetch('estudio-4');
  });

  it('al cancelar, lo pendiente ya no se descarga', async () => {
    prefetchStudy('estudio-5', ['a', 'b']);
    cancelStudyPrefetch('estudio-5');
    await runPool();

    expect(imageLoader.loadAndCacheImage).not.toHaveBeenCalled();
    expect(studyPrefetchProgress('estudio-5')).toBeNull();
  });

  it('pedirlo dos veces no encola el estudio dos veces', () => {
    prefetchStudy('estudio-6', ['a', 'b']);
    prefetchStudy('estudio-6', ['a', 'b']);

    expect(mockPool).toHaveLength(2);
    cancelStudyPrefetch('estudio-6');
  });
});
