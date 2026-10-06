import {
  createDesktopCompatibleFileName,
  createDirectDownloadId,
  createSeriesDownloadId,
} from '../downloadId';
import {parseSeasonNumber} from '../download/duplicates';
import type {BulkContext, BulkEpisode} from '../download/bulkPlan';
import type {WatchListItem} from '../storage/WatchListStorage';
import type {EpisodeRef} from './episodeDiff';

/**
 * Downloading new episodes by themselves. Kept narrow on purpose: only
 * titles the user marked as "Watching", only a few episodes at a time, and
 * only from seasons (a page that lists qualities instead of seasons would
 * queue every quality of an episode).
 */

export const MAX_AUTO_EPISODES_PER_TITLE = 5;

export const isAutoDownloadCandidate = (item: Pick<WatchListItem, 'status'>): boolean =>
  item.status === 'watching';

/** Whether a group title looks like a season, or is the only group. */
export const isSeasonGroup = (groupTitle: string, groupCount: number): boolean =>
  groupCount === 1 || parseSeasonNumber(groupTitle) !== undefined;

const titleFor = (showName: string, episodeTitle: string): string =>
  showName.length > 30 ? `${showName.slice(0, 30)}... ${episodeTitle}` : `${showName} ${episodeTitle}`;

/** The episodes to queue for each season that has new ones, oldest first, at most `limit` in all. */
export const planAutoDownload = ({
  item,
  showName,
  type,
  imdbId,
  poster,
  background,
  synopsis,
  newEpisodes,
  groupCount,
  limit = MAX_AUTO_EPISODES_PER_TITLE,
}: {
  item: Pick<WatchListItem, 'provider' | 'link' | 'status' | 'poster'>;
  showName: string;
  type: string;
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  newEpisodes: EpisodeRef[];
  groupCount: number;
  limit?: number;
}): Array<{context: BulkContext; episodes: BulkEpisode[]}> => {
  if (!isAutoDownloadCandidate(item) || type !== 'series') {
    return [];
  }
  const byGroup = new Map<string, EpisodeRef[]>();
  for (const ref of newEpisodes) {
    if (!isSeasonGroup(ref.group, groupCount)) {
      continue;
    }
    byGroup.set(ref.group, [...(byGroup.get(ref.group) || []), ref]);
  }
  const plans: Array<{context: BulkContext; episodes: BulkEpisode[]}> = [];
  let remaining = limit;
  for (const [group, refs] of byGroup) {
    if (remaining <= 0) {
      break;
    }
    const chosen = [...refs].sort((a, b) => a.index - b.index).slice(0, remaining);
    remaining -= chosen.length;
    plans.push({
      context: {
        providerValue: item.provider,
        infoUrl: item.link,
        showName,
        seasonTitle: group,
        resolveType: type,
        imdbId,
        poster: poster || item.poster,
        background,
        synopsis,
      },
      episodes: chosen.map(ref => ({
        id: ref.direct
          ? createDirectDownloadId(showName, group, ref.index)
          : createSeriesDownloadId(showName, group, ref.index),
        link: ref.link,
        title: titleFor(showName, ref.title),
        fileBaseName: createDesktopCompatibleFileName(`${showName} ${ref.title}`, 'series'),
        episodeName: ref.title,
        episodeIndex: ref.index,
        mediaType: 'series' as const,
        watched: false,
      })),
    });
  }
  return plans;
};
