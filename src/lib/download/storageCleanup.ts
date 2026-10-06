import {cacheStorage} from '../storage';
import useDownloadsStore, {
  isSubtitleDownloadItem,
  type DownloadItem,
} from '../zustand/downloadsStore';

/** Past this share of an episode, it counts as watched. */
const WATCHED_THRESHOLD = 0.85;

export const isLinkWatched = (link: string | undefined): boolean => {
  if (!link) {
    return false;
  }
  try {
    const progress = JSON.parse(cacheStorage.getString(link) || '{}');
    return (
      typeof progress?.position === 'number' &&
      typeof progress?.duration === 'number' &&
      progress.duration > 0 &&
      progress.position / progress.duration > WATCHED_THRESHOLD
    );
  } catch {
    return false;
  }
};

/** Finished downloads of episodes that have been watched to the end. */
export const findWatchedDownloads = (): DownloadItem[] =>
  Object.values(useDownloadsStore.getState().downloads).filter(
    item =>
      item.status === 'completed' &&
      !isSubtitleDownloadItem(item) &&
      isLinkWatched(item.sourceLink),
  );

export const summarizeWatchedDownloads = (): {count: number; bytes: number} => {
  const watched = findWatchedDownloads();
  return {
    count: watched.length,
    bytes: watched.reduce((sum, item) => sum + (item.totalBytes || 0), 0),
  };
};

export const deleteWatchedDownloads = async (): Promise<{
  count: number;
  bytes: number;
}> => {
  const {deleteDownloadedItemAndSubtitles} =
    require('../../screens/downloads/utils/deleteDownloadedItem') as typeof import('../../screens/downloads/utils/deleteDownloadedItem');
  let count = 0;
  let bytes = 0;
  for (const item of findWatchedDownloads()) {
    try {
      await deleteDownloadedItemAndSubtitles(item);
      count += 1;
      bytes += item.totalBytes || 0;
    } catch (error) {
      console.warn(`Could not delete watched download ${item.id}:`, error);
    }
  }
  return {count, bytes};
};
