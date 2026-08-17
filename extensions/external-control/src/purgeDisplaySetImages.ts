/**
 * Free the decoded pixels of display sets that are being dropped.
 *
 * A viewer that never closes accumulates every study the radiologist opened
 * during the shift, and Cornerstone's cache is bounded by bytes, not by
 * relevance: without this, removing a study frees its metadata and leaves its
 * images resident until something unrelated evicts them.
 *
 * Cornerstone is loaded lazily so this extension keeps working (minus the
 * purge) in a build that does not include it.
 */
export default async function purgeDisplaySetImages(displaySets: unknown[]): Promise<number> {
  const imageIds = new Set<string>();
  for (const displaySet of displaySets as Array<Record<string, unknown>>) {
    const fromDisplaySet = (displaySet?.imageIds as string[]) ?? [];
    const fromImages = ((displaySet?.images as Array<{ imageId?: string }>) ?? [])
      .map(image => image?.imageId)
      .filter(Boolean) as string[];
    for (const imageId of [...fromDisplaySet, ...fromImages]) {
      imageIds.add(imageId);
    }
  }

  if (!imageIds.size) {
    return 0;
  }

  let cache;
  try {
    const cornerstone = await import('@cornerstonejs/core');
    cache = cornerstone.cache;
  } catch (error) {
    return 0;
  }
  if (!cache) {
    return 0;
  }

  let purged = 0;
  for (const imageId of imageIds) {
    try {
      cache.removeImageLoadObject(imageId, { force: true });
      purged++;
    } catch {
      // An image still referenced by a volume refuses to go; that is the
      // cache doing its job, not a failure of the removal.
    }
  }
  return purged;
}
