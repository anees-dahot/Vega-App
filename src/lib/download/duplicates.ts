import type {DownloadItem} from '../zustand/downloadsStore';
import {CURRENT_DOWNLOAD_STATUSES} from '../zustand/downloadsStore';

/**
 * Finding the same episode downloaded already, even from another provider.
 * Providers name seasons and number episodes differently, so episodes are
 * compared by show name plus the season and episode numbers found in titles.
 */

export interface EpisodeIdentity {
  show: string;
  imdbId?: string;
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
}

type IdentitySource = Pick<
  DownloadItem,
  | 'showName'
  | 'title'
  | 'imdbId'
  | 'type'
  | 'seasonTitle'
  | 'episodeName'
  | 'episodeIndex'
>;

const normalizeName = (value: string | undefined): string =>
  (value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const firstNumber = (patterns: RegExp[], text: string): number | undefined => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
};

export const parseSeasonNumber = (
  seasonTitle: string | undefined,
): number | undefined =>
  seasonTitle
    ? firstNumber(
        [/season\s*0*(\d+)/i, /\bs\s*0*(\d{1,2})\b/i, /\bs0*(\d{1,2})e/i],
        seasonTitle,
      )
    : undefined;

export const parseEpisodeNumber = (
  episodeName: string | undefined,
): number | undefined =>
  episodeName
    ? firstNumber(
        [
          /\be\s*0*(\d{1,4})\b/i,
          /\bs\d{1,2}\s*e0*(\d{1,4})/i,
          /episode\s*0*(\d{1,4})/i,
          /\bep\.?\s*0*(\d{1,4})\b/i,
          /^\s*0*(\d{1,4})\s*[-.:)]/,
        ],
        episodeName,
      )
    : undefined;

export const getEpisodeIdentity = (item: IdentitySource): EpisodeIdentity => ({
  show: normalizeName(item.showName || item.title),
  imdbId: item.imdbId || undefined,
  type: item.type,
  season: parseSeasonNumber(item.seasonTitle),
  episode:
    parseEpisodeNumber(item.episodeName) ??
    (typeof item.episodeIndex === 'number' ? item.episodeIndex + 1 : undefined),
});

export const isSameEpisode = (
  left: EpisodeIdentity,
  right: EpisodeIdentity,
): boolean => {
  const sameShow =
    (left.imdbId && right.imdbId && left.imdbId === right.imdbId) ||
    (left.show !== '' && left.show === right.show);
  if (!sameShow || left.type !== right.type) {
    return false;
  }
  if (left.type === 'movie') {
    return true;
  }
  if (left.episode === undefined || left.episode !== right.episode) {
    return false;
  }
  // A season that one side doesn't state can't rule the match out.
  return (
    left.season === undefined ||
    right.season === undefined ||
    left.season === right.season
  );
};

export type DuplicateKind = 'completed' | 'queued';

export interface DuplicateMatch {
  item: DownloadItem;
  kind: DuplicateKind;
}

/**
 * The download of the same episode already on the device, or on its way. A
 * download with the candidate's own id is not a duplicate of itself.
 */
export const findDuplicateDownload = (
  candidate: IdentitySource & Pick<DownloadItem, 'id'>,
  downloads: Record<string, DownloadItem>,
): DuplicateMatch | undefined => {
  const identity = getEpisodeIdentity(candidate);
  let queued: DuplicateMatch | undefined;
  for (const item of Object.values(downloads)) {
    if (
      item.id === candidate.id ||
      item.isSubtitle ||
      item.audioFor ||
      item.id.includes('_subtitle_') ||
      !isSameEpisode(identity, getEpisodeIdentity(item))
    ) {
      continue;
    }
    if (item.status === 'completed') {
      return {item, kind: 'completed'};
    }
    if (
      CURRENT_DOWNLOAD_STATUSES.has(item.status) &&
      item.status !== 'error' &&
      item.status !== 'interrupted' &&
      item.status !== 'canceling'
    ) {
      queued = queued || {item, kind: 'queued'};
    }
  }
  return queued;
};
