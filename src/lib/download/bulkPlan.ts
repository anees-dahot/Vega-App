import type {SkipInterval} from '../providers/types';
import {
  CURRENT_DOWNLOAD_STATUSES,
  type DownloadItem,
} from '../zustand/downloadsStore';
import {findDuplicateDownload} from './duplicates';

/** Choosing which episodes a bulk download queues. No side effects. */

export interface BulkEpisode {
  /** Download id, the same as the episode's own download button uses. */
  id: string;
  link: string;
  /** Title shown for the download. */
  title: string;
  /** File name without extension. */
  fileBaseName: string;
  episodeName: string;
  episodeIndex: number;
  mediaType: 'movie' | 'series';
  watched: boolean;
  skip?: SkipInterval[];
}

export interface BulkContext {
  providerValue: string;
  infoUrl: string;
  showName: string;
  seasonTitle?: string;
  /** `type` argument for the provider's getStream. */
  resolveType: string;
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
}

export type EpisodeDownloadState = 'completed' | 'queued' | 'failed' | 'none';

export const getEpisodeDownloadState = (
  id: string,
  downloads: Record<string, DownloadItem>,
): EpisodeDownloadState => {
  const item = downloads[id];
  if (!item) {
    return 'none';
  }
  if (item.status === 'completed') {
    return 'completed';
  }
  if (item.status === 'error' || item.status === 'interrupted') {
    return 'failed';
  }
  return CURRENT_DOWNLOAD_STATUSES.has(item.status) &&
    item.status !== 'canceling'
    ? 'queued'
    : 'none';
};

/**
 * The next `count` episodes to watch that are not downloaded: those after the
 * last one watched, or from the start when nothing was watched.
 */
export const selectNextUnwatched = (
  episodes: Array<Pick<BulkEpisode, 'id' | 'watched'>>,
  count: number,
  getState: (id: string) => EpisodeDownloadState,
): string[] => {
  let lastWatched = -1;
  episodes.forEach((episode, index) => {
    if (episode.watched) {
      lastWatched = index;
    }
  });
  return episodes
    .slice(lastWatched + 1)
    .filter(episode => getState(episode.id) === 'none')
    .slice(0, Math.max(count, 0))
    .map(episode => episode.id);
};

export type SkipReason = 'downloaded' | 'queued' | 'duplicate';

export interface BulkPlan {
  toQueue: BulkEpisode[];
  skipped: Array<{
    episode: BulkEpisode;
    reason: SkipReason;
    /** Provider the existing copy came from, for a duplicate. */
    via?: string;
  }>;
}

/** Split the chosen episodes into those to queue and those already covered. */
export const planBulkDownload = (
  context: BulkContext,
  episodes: BulkEpisode[],
  options: {allowDuplicates?: boolean},
  downloads: Record<string, DownloadItem>,
): BulkPlan => {
  const plan: BulkPlan = {toQueue: [], skipped: []};
  for (const episode of episodes) {
    const state = getEpisodeDownloadState(episode.id, downloads);
    if (state === 'completed') {
      plan.skipped.push({episode, reason: 'downloaded'});
      continue;
    }
    if (state === 'queued') {
      plan.skipped.push({episode, reason: 'queued'});
      continue;
    }
    if (!options.allowDuplicates) {
      const duplicate = findDuplicateDownload(
        {
          id: episode.id,
          title: episode.title,
          showName: context.showName,
          imdbId: context.imdbId,
          type: episode.mediaType,
          seasonTitle: context.seasonTitle,
          episodeName: episode.episodeName,
          episodeIndex: episode.episodeIndex,
        },
        downloads,
      );
      if (duplicate) {
        plan.skipped.push({
          episode,
          reason: duplicate.kind === 'completed' ? 'duplicate' : 'queued',
          via: duplicate.item.provider,
        });
        continue;
      }
    }
    plan.toQueue.push(episode);
  }
  return plan;
};

export const describeSkipped = (plan: BulkPlan): string => {
  const count = (reason: SkipReason) =>
    plan.skipped.filter(entry => entry.reason === reason).length;
  const parts = [
    count('downloaded') ? `${count('downloaded')} already downloaded` : '',
    count('duplicate')
      ? `${count('duplicate')} downloaded from another source`
      : '',
    count('queued') ? `${count('queued')} already queued` : '',
  ].filter(Boolean);
  return parts.join(', ');
};

export interface StorageCheck {
  enough: boolean;
  neededBytes?: number;
  freeBytes?: number;
  minFreeBytes: number;
}

/** Whether `count` files of about `perFileBytes` fit, leaving the free space to keep. */
export const evaluateStorage = (
  count: number,
  perFileBytes: number | undefined,
  freeBytes: number | undefined,
  minFreeBytes: number,
): StorageCheck => {
  const neededBytes = perFileBytes ? perFileBytes * count : undefined;
  if (freeBytes === undefined) {
    return {enough: true, neededBytes, minFreeBytes};
  }
  return {
    enough: freeBytes - (neededBytes ?? 0) >= minFreeBytes,
    neededBytes,
    freeBytes,
    minFreeBytes,
  };
};

