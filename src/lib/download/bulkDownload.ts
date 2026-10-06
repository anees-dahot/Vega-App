import type {Stream} from '../providers/types';
import {providerManager} from '../services/ProviderManager';
import {ensureDownloadLocationAccess, getDownloadFileName} from '../downloadLocation';
import {
  cancelDownload,
  pauseDownload,
  resumeDownload,
  retryDownload,
  scheduleQueuedDownloads,
  setDownloadsHeld,
} from '../downloadManager';
import {settingsStorage} from '../storage';
import useDownloadsStore, {
  CURRENT_DOWNLOAD_STATUSES,
  type DownloadItem,
} from '../zustand/downloadsStore';
import {getBatchItems} from './batchDownloads';
import type {AudioPlanEntry} from './bulkAudio';
import {
  evaluateStorage,
  type BulkContext,
  type BulkEpisode,
  type StorageCheck,
} from './bulkPlan';
import {getFreeStorageBytes} from './downloadPolicy';
import {pickServerWithHealth} from './pickWithHealth';
import {serverRulesStorage, type ServerRule} from './serverRules';

/**
 * Bulk download: queue many episodes at once. Each episode only gets its link
 * when it is its turn to download, using the saved server rule, so links do
 * not expire while the episodes wait in the queue.
 */

export * from './bulkPlan';
export * from './bulkAudio';

/** Whether `count` files of about `perFileBytes` fit, leaving the free space to keep. */
export const checkStorageForBatch = (
  count: number,
  perFileBytes: number | undefined,
  freeBytes: number | undefined = getFreeStorageBytes(),
): StorageCheck =>
  evaluateStorage(
    count,
    perFileBytes,
    freeBytes,
    settingsStorage.getDownloadMinFreeMb() * 1024 * 1024,
  );

/** Streams of the first chosen episode, to pick servers from. */
export const loadBulkSample = async (
  context: BulkContext,
  episode: BulkEpisode,
): Promise<Stream[]> => {
  const servers = await providerManager.getStream({
    link: episode.link,
    type: context.resolveType,
    signal: new AbortController().signal,
    providerValue: context.providerValue,
    isDownload: true,
  });
  const list = servers || [];
  serverRulesStorage.recordKnownServers(context.providerValue, list);
  return list;
};

/** File size the rule would download, read from the first server that answers. */
export const probeBulkFileSize = async (
  context: BulkContext,
  servers: Stream[],
  rule: ServerRule,
): Promise<number | undefined> => {
  const result = await pickServerWithHealth({
    provider: context.providerValue,
    servers,
    rule,
  });
  return result.status === 'picked' ? result.size : undefined;
};

const createBatchId = (): string =>
  `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export interface BulkEnqueueResult {
  batchId?: string;
  queued: number;
  /** The download folder was not chosen or not accessible. */
  locationMissing?: boolean;
}

export const enqueueBulkDownload = async (
  context: BulkContext,
  episodes: BulkEpisode[],
): Promise<BulkEnqueueResult> => {
  if (episodes.length === 0) {
    return {queued: 0};
  }
  const location = await ensureDownloadLocationAccess(
    settingsStorage.getDownloadLocationConfig(),
  );
  if (!location) {
    return {queued: 0, locationMissing: true};
  }
  settingsStorage.setDownloadLocation(location);

  const store = useDownloadsStore.getState();
  const batchId = createBatchId();
  const batchTitle = [context.showName, context.seasonTitle]
    .filter(Boolean)
    .join(' · ');
  const now = Date.now();

  episodes.forEach((episode, index) => {
    const batchFields = {
      batchId,
      batchTitle,
      needsResolve: true,
      resolveType: context.resolveType,
      held: undefined,
      queuedReason: undefined,
      priority: 0,
      linkRecoveries: 0,
    };
    const existing = store.downloads[episode.id];
    if (existing) {
      // A failed episode keeps what it has; its new link is checked against it.
      store.updateDownload(episode.id, {
        ...batchFields,
        status: 'queued',
        downloadLocation: location,
        errorCode: undefined,
        errorMessage: undefined,
        retryable: undefined,
        createdAt: now + index,
      });
      return;
    }
    store.enqueueDownload({
      ...batchFields,
      id: episode.id,
      title: episode.title,
      showName: context.showName,
      episodeName: episode.episodeName,
      seasonTitle: context.seasonTitle,
      episodeIndex: episode.episodeIndex,
      type: episode.mediaType,
      imdbId: context.imdbId,
      poster: context.poster,
      background: context.background,
      synopsis: context.synopsis,
      provider: context.providerValue,
      infoUrl: context.infoUrl,
      sourceLink: episode.link,
      skip: episode.skip,
      url: '',
      fileBaseName: episode.fileBaseName,
      // The real extension is known once a stream is chosen.
      displayFileName: getDownloadFileName(episode.fileBaseName, 'mkv'),
      sourceType: 'http',
      downloadLocation: location,
      filePath: '',
      status: 'queued',
      createdAt: now + index,
    });
  });

  await scheduleQueuedDownloads();
  return {batchId, queued: episodes.length};
};

/**
 * Queue audio-only downloads, one per planned entry. Each is merged into the
 * video it belongs to when it finishes, and gets its link when its turn comes.
 */
export const enqueueBulkAudio = async (
  context: BulkContext,
  entries: AudioPlanEntry[],
  audio: {label: string; language: string},
): Promise<BulkEnqueueResult> => {
  if (entries.length === 0) {
    return {queued: 0};
  }
  const location = await ensureDownloadLocationAccess(
    settingsStorage.getDownloadLocationConfig(),
  );
  if (!location) {
    return {queued: 0, locationMissing: true};
  }
  settingsStorage.setDownloadLocation(location);

  const store = useDownloadsStore.getState();
  const batchId = createBatchId();
  const batchTitle = [context.showName, context.seasonTitle, `${audio.label} audio`]
    .filter(Boolean)
    .join(' · ');
  const now = Date.now();

  entries.forEach(({episode, target, id}, index) => {
    const fields = {
      batchId,
      batchTitle,
      needsResolve: true,
      resolveType: context.resolveType,
      held: undefined,
      queuedReason: undefined,
      priority: 0,
      linkRecoveries: 0,
      audioFor: target.id,
      audioLabel: audio.label,
      audioLanguage: audio.language,
    };
    if (store.downloads[id]) {
      store.updateDownload(id, {
        ...fields,
        status: 'queued',
        downloadLocation: location,
        errorCode: undefined,
        errorMessage: undefined,
        retryable: undefined,
        createdAt: now + index,
      });
      return;
    }
    store.enqueueDownload({
      ...fields,
      id,
      title: `${context.showName} - ${audio.label} audio`,
      showName: context.showName,
      episodeName: episode.episodeName,
      seasonTitle: context.seasonTitle,
      episodeIndex: episode.episodeIndex,
      type: episode.mediaType,
      imdbId: context.imdbId,
      poster: context.poster,
      background: context.background,
      synopsis: context.synopsis,
      provider: context.providerValue,
      infoUrl: context.infoUrl,
      sourceLink: episode.link,
      url: '',
      fileBaseName: `${episode.fileBaseName} [${audio.label} audio]`,
      displayFileName: getDownloadFileName(
        `${episode.fileBaseName} [${audio.label} audio]`,
        'mkv',
      ),
      sourceType: 'http',
      downloadLocation: location,
      filePath: '',
      status: 'queued',
      createdAt: now + index,
    });
  });

  await scheduleQueuedDownloads();
  return {batchId, queued: entries.length};
};

const batchEntries = (batchId: string): DownloadItem[] =>
  getBatchItems(useDownloadsStore.getState().downloads, batchId);

/** Hold what is queued and pause what is running. */
export const pauseBatch = async (batchId: string): Promise<void> => {
  const items = batchEntries(batchId);
  await setDownloadsHeld(
    items.filter(item => item.status === 'queued').map(item => item.id),
    true,
  );
  await Promise.all(
    items
      .filter(
        item => item.status === 'downloading' || item.status === 'starting',
      )
      .map(item => pauseDownload(item.id).catch(() => undefined)),
  );
};

export const resumeBatch = async (batchId: string): Promise<void> => {
  const items = batchEntries(batchId);
  await Promise.all(
    items
      .filter(item => item.status === 'paused' && item.canResume)
      .map(item => resumeDownload(item.id).catch(() => undefined)),
  );
  await setDownloadsHeld(
    items.filter(item => item.status === 'queued').map(item => item.id),
    false,
  );
};

export const retryFailedInBatch = async (batchId: string): Promise<void> => {
  const failed = batchEntries(batchId).filter(
    item =>
      (item.status === 'error' || item.status === 'interrupted') &&
      item.retryable,
  );
  for (const item of failed) {
    await retryDownload(item.id).catch(() => undefined);
  }
};

/** Cancel everything in the batch that has not finished. */
export const cancelBatch = async (batchId: string): Promise<void> => {
  const pending = batchEntries(batchId).filter(item =>
    CURRENT_DOWNLOAD_STATUSES.has(item.status),
  );
  for (const item of pending) {
    await cancelDownload(item.id).catch(() => undefined);
  }
};
