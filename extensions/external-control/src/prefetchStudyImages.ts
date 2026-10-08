/**
 * Downloads a study's images in the background, before anyone looks at it.
 *
 * ADD_STUDIES on its own only brings the metadata: OHIF fetches pixels when a
 * series lands in a viewport, and its StudyPrefetcher only works around the
 * study already on screen. On a reading workstation the worklist pushes the
 * next studies while the current one is being reported, so by the time the
 * radiologist switches the images can already be here.
 *
 * Two rules keep this from getting in the way:
 *
 * - It queues behind everything else. Viewports load as Interaction requests,
 *   which have their own lane; within the Prefetch lane, StudyPrefetcher runs
 *   at priority -5 and this at PRIORITY, which the pool serves last.
 * - It stops short of filling the cache. Past CACHE_HEADROOM the remaining
 *   images are skipped rather than evicting the ones of the study on screen;
 *   they load on demand later, as they would have anyway.
 */

import { cache, imageLoader, imageLoadPoolManager, Enums } from '@cornerstonejs/core';

const PRIORITY = 10;
const CACHE_HEADROOM = 0.8;

export type PrefetchProgress = {
  total: number;
  loaded: number;
  failed: number;
  /** Not fetched because the cache was near its limit. */
  skipped: number;
};

type Job = PrefetchProgress & { cancelled: boolean };

const jobs = new Map<string, Job>();

/** As OHIF's own prefetcher checks it (extensions/cornerstone/initStudyPrefetcherService). */
function isCached(imageId: string) {
  return Boolean(cache.getImageLoadObject(imageId));
}

function cacheIsNearlyFull() {
  const max = cache.getMaxCacheSize();
  return max > 0 && cache.getCacheSize() >= max * CACHE_HEADROOM;
}

/**
 * Queue every image of a study. Calling it again for a study already queued
 * returns that job's progress instead of queuing twice.
 */
export function prefetchStudy(StudyInstanceUID: string, imageIds: string[]): PrefetchProgress {
  const running = jobs.get(StudyInstanceUID);
  if (running) {
    return progressOf(running);
  }

  const job: Job = { total: imageIds.length, loaded: 0, failed: 0, skipped: 0, cancelled: false };
  jobs.set(StudyInstanceUID, job);

  for (const imageId of imageIds) {
    if (isCached(imageId)) {
      job.loaded++;
      continue;
    }
    imageLoadPoolManager.addRequest(
      async () => {
        if (job.cancelled) {
          return;
        }
        if (cacheIsNearlyFull()) {
          job.skipped++;
          return;
        }
        try {
          await imageLoader.loadAndCacheImage(imageId, {
            priority: PRIORITY,
            requestType: Enums.RequestType.Prefetch,
            additionalDetails: { imageId },
            preScale: { enabled: true },
          });
          job.loaded++;
        } catch (error) {
          job.failed++;
        }
      },
      Enums.RequestType.Prefetch,
      { imageId },
      PRIORITY
    );
  }

  return progressOf(job);
}

/** Drop whatever is still pending for a study; what already arrived stays. */
export function cancelStudyPrefetch(StudyInstanceUID: string) {
  const job = jobs.get(StudyInstanceUID);
  if (job) {
    job.cancelled = true;
    jobs.delete(StudyInstanceUID);
  }
}

export function studyPrefetchProgress(StudyInstanceUID: string): PrefetchProgress | null {
  const job = jobs.get(StudyInstanceUID);
  return job ? progressOf(job) : null;
}

function progressOf({ total, loaded, failed, skipped }: Job): PrefetchProgress {
  return { total, loaded, failed, skipped };
}
