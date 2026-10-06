import type {Info} from '../providers/types';
import {
  buildSnapshot,
  collectEpisodeRefs,
  describeNewEpisodeRefs,
  diffEpisodes,
  type EpisodeSnapshot,
} from '../library/episodeDiff';
import {planAutoDownload} from '../library/autoDownload';
import {settingsStorage} from '../storage';
import {mainStorage} from '../storage/StorageService';
import {watchListStorage} from '../storage/WatchListStorage';

/**
 * Looks for new episodes of the titles in the library, once in a while when
 * the app opens. It compares a count taken from each title's page with the
 * count seen last time, so a provider that adds episodes as separate links,
 * or a new season, is noticed; one that only extends an existing season's
 * episode list is not.
 */

export interface EpisodeSignature {
  /** Seasons or quality groups the page lists. */
  groups: number;
  /** Directly listed episodes or files. */
  files: number;
}

const SNAPSHOTS_KEY = 'newEpisodeSnapshots';
const LAST_CHECK_KEY = 'newEpisodeLastCheckAt';
const CURSOR_KEY = 'newEpisodeCheckCursor';
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_TITLES_PER_CHECK = 10;
const TITLE_TIMEOUT_MS = 25_000;

export const getEpisodeSignature = (
  info: Pick<Info, 'linkList'>,
): EpisodeSignature => {
  const groups = Array.isArray(info.linkList) ? info.linkList : [];
  return {
    groups: groups.length,
    files: groups.reduce(
      (total, group) => total + (group?.directLinks?.length || 0),
      0,
    ),
  };
};

/** A sentence about what is new, or undefined when nothing is. */
export const describeNewEpisodes = (
  previous: EpisodeSignature | undefined,
  next: EpisodeSignature,
): string | undefined => {
  if (!previous) {
    return undefined;
  }
  const newFiles = next.files - previous.files;
  const newGroups = next.groups - previous.groups;
  if (newFiles > 0) {
    return `${newFiles} new episode${newFiles === 1 ? '' : 's'} available`;
  }
  if (newGroups > 0) {
    return newGroups === 1 ? 'A new season is available' : `${newGroups} new seasons are available`;
  }
  return undefined;
};

/** Titles to look at this time: the next few after where the last check stopped. */
export const pickTitlesToCheck = <T>(
  items: T[],
  cursor: number,
  limit = MAX_TITLES_PER_CHECK,
): {titles: T[]; nextCursor: number} => {
  if (items.length === 0) {
    return {titles: [], nextCursor: 0};
  }
  const count = Math.min(limit, items.length);
  const start = cursor % items.length;
  const titles = Array.from({length: count}, (_, i) => items[(start + i) % items.length]);
  return {titles, nextCursor: (start + count) % items.length};
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const MAX_AUTO_PER_CHECK = 10;

/** Puts a title's new episodes in the download queue. Returns how many were queued. */
const queueNewEpisodes = async (
  item: ReturnType<typeof watchListStorage.getWatchList>[number],
  info: Info,
  newEpisodes: Parameters<typeof planAutoDownload>[0]['newEpisodes'],
  groupCount: number,
): Promise<number> => {
  const plans = planAutoDownload({
    item,
    showName: info.title || item.title,
    type: info.type,
    imdbId: info.imdbId,
    poster: info.poster || info.image,
    background: info.image,
    synopsis: info.synopsis,
    newEpisodes,
    groupCount,
  });
  if (plans.length === 0) {
    return 0;
  }
  // Loaded here: the download code is heavy and only needed when something queues.
  const {planBulkDownload, enqueueBulkDownload} =
    require('../download/bulkDownload') as typeof import('../download/bulkDownload');
  const {default: useDownloadsStore} =
    require('../zustand/downloadsStore') as typeof import('../zustand/downloadsStore');
  let queued = 0;
  for (const {context, episodes} of plans) {
    const plan = planBulkDownload(context, episodes, {}, useDownloadsStore.getState().downloads);
    if (plan.toQueue.length === 0) {
      continue;
    }
    const result = await enqueueBulkDownload(context, plan.toQueue);
    queued += result.queued;
  }
  return queued;
};

export const runNewEpisodeCheck = async (force = false): Promise<number> => {
  if (!settingsStorage.isNewEpisodeCheckEnabled()) {
    return 0;
  }
  const now = Date.now();
  const lastCheck = mainStorage.getNumber(LAST_CHECK_KEY) || 0;
  if (!force && now - lastCheck < CHECK_INTERVAL_MS) {
    return 0;
  }
  mainStorage.setNumber(LAST_CHECK_KEY, Math.floor(now / 1000));

  // Loaded here so the check costs nothing until it runs.
  const {providerManager} =
    require('./ProviderManager') as typeof import('./ProviderManager');
  const {notificationService} =
    require('./Notification') as typeof import('./Notification');

  const {titles, nextCursor} = pickTitlesToCheck(
    watchListStorage.getWatchList(),
    mainStorage.getNumber(CURSOR_KEY) || 0,
  );
  mainStorage.setNumber(CURSOR_KEY, nextCursor);

  const snapshots =
    mainStorage.getObject<Record<string, EpisodeSnapshot>>(SNAPSHOTS_KEY) || {};
  let notified = 0;
  let autoQueued = 0;
  for (const item of titles) {
    if (!item.provider || !item.link) {
      continue;
    }
    const key = `${item.provider}::${item.link}`;
    try {
      const info = await withTimeout(
        providerManager.getMetaData({link: item.link, provider: item.provider}),
        TITLE_TIMEOUT_MS,
      );
      const {groupTitles, refs, fetchedGroups} = await withTimeout(
        collectEpisodeRefs(info, url =>
          providerManager.getEpisodes({url, providerValue: item.provider}),
        ),
        TITLE_TIMEOUT_MS,
      );
      const diff = diffEpisodes(snapshots[key], groupTitles, refs);
      snapshots[key] = buildSnapshot(groupTitles, refs, fetchedGroups);

      let queued = 0;
      if (settingsStorage.isAutoDownloadNewEpisodes() && autoQueued < MAX_AUTO_PER_CHECK) {
        queued = await queueNewEpisodes(item, info, diff.newEpisodes, groupTitles.length);
        autoQueued += queued;
      }
      const message = describeNewEpisodeRefs(diff);
      if (message) {
        notified += 1;
        await notificationService
          .displayNotification({
            id: `newEpisodes:${key}`,
            title: item.title,
            body: queued > 0 ? `${message} · ${queued} added to downloads` : message,
          })
          .catch(() => undefined);
      }
    } catch (error) {
      // A provider that is off or slow only skips this title.
      console.log('New episode check skipped', item.title, error);
    }
  }
  mainStorage.setObject(SNAPSHOTS_KEY, snapshots);
  return notified;
};
