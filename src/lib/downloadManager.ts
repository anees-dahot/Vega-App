import {
  deleteDownloadOutput,
  finalizeDownloadOutput,
  prepareDownloadDestination,
  type PreparedDownloadDestination,
} from './downloadDestination';
import {
  AUDIO_MERGE_ROOT,
  cleanupAudioMerge,
  getAudioLanguageCode,
  mergeAudioTrackFiles,
} from './download/audioMerge';
import {
  DownloadLocationConfig,
  ensureDownloadLocationAccess,
  isSafDownloadLocation,
} from './downloadLocation';
import {
  notificationService,
  QUEUE_KEEPALIVE_ID,
} from './services/Notification';
import useDownloadsStore, {
  CURRENT_DOWNLOAD_STATUSES,
  DownloadItem,
} from './zustand/downloadsStore';
import {getDownloadBackend} from './downloadBackends/registry';
import {
  DownloadBackend,
  DownloadBackendContext,
  DownloadPauseSupportError,
} from './downloadBackends/types';
import {settingsStorage} from './storage';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
  sanitizeDownloadFileName,
} from './downloadId';
import {getImageAccent} from './imageAccent';
import {
  formatDownloadEta,
  formatDownloadProgressLabel,
  formatDownloadSpeed,
} from './downloadFormatting';
import {
  applyNativeDownloadPolicy,
  getStartGate,
  type StartBlockReason,
} from './download/downloadPolicy';
import {
  applyResolvedStream,
  canResolveDownload,
  isExpiredLinkError,
  queueSubtitleForStream,
  resolveStreamForRecord,
  sameServer,
  type ResolveOutcome,
} from './download/resolveDownload';
import {recordServerOutcome} from './download/serverHealth';
import {verifyFinishedDownload} from './download/verify';
import {normalizeServerName} from './download/serverRules';
import {notifyBatchProgress} from './download/batchDownloads';

const activeDownloads = new Set<string>();
const occupiedDownloadSlots = new Set<string>();
const cancelledDownloads = new Set<string>();
const pauseFailedDownloads = new Set<string>();
const lastNotificationAt = new Map<string, number>();
const downloadNotificationColors = new Map<string, Promise<string>>();
let schedulerRunning = false;
let schedulerRerun = false;
let gateTimer: ReturnType<typeof setInterval> | null = null;
const GATE_RECHECK_MS = 30_000;
// Failed downloads are retried forever, waiting longer each time so a
// refusing server isn't hammered (that gets the network blocked).
const AUTO_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const AUTO_RETRY_MAX_DELAY_MS = 600_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimerAt = 0;

const getAutoRetryDelay = (attempt: number): number =>
  attempt <= AUTO_RETRY_DELAYS_MS.length
    ? AUTO_RETRY_DELAYS_MS[attempt - 1]
    : AUTO_RETRY_MAX_DELAY_MS;
/** Times an expired link is replaced during one download before giving up. */
const MAX_LINK_RECOVERIES = 3;
const HTTP_START_RETRY_DELAYS_MS = [750, 1500];

/** The stream lookup found nothing to download from. */
class StreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamUnavailableError';
  }
}
const HTTP_DNS_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

const wait = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const getDownloadNotificationColor = (
  record: DownloadItem,
): Promise<string> => {
  const cached = downloadNotificationColors.get(record.id);
  if (cached) {
    return cached;
  }
  const color = getImageAccent(
    record.background || record.poster,
    settingsStorage.getPrimaryColor(),
  );
  downloadNotificationColors.set(record.id, color);
  return color;
};

const isTransientHttpStartError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('software caused connection abort') ||
    normalized.includes('connection aborted') ||
    normalized.includes('connection reset') ||
    normalized.includes('network connection was lost') ||
    normalized.includes('unable to resolve host') ||
    normalized.includes('no address associated with hostname') ||
    normalized.includes('unknown host') ||
    normalized.includes('name or service not known') ||
    normalized.includes('temporary failure in name resolution') ||
    normalized.includes('network is unreachable') ||
    normalized.includes('connection timed out') ||
    normalized.includes('connect timeout')
  );
};

const isDnsResolutionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('unable to resolve host') ||
    normalized.includes('no address associated with hostname') ||
    normalized.includes('unknown host') ||
    normalized.includes('name or service not known') ||
    normalized.includes('temporary failure in name resolution')
  );
};

const startBackendWithRetry = async (
  backend: DownloadBackend,
  context: DownloadBackendContext,
): Promise<void> => {
  let attempt = 0;
  while (true) {
    try {
      await backend.start(context);
      return;
    } catch (error) {
      const retryDelays = isDnsResolutionError(error)
        ? HTTP_DNS_RETRY_DELAYS_MS
        : HTTP_START_RETRY_DELAYS_MS;
      const canRetry =
        attempt < retryDelays.length &&
        context.record.sourceType === 'http' &&
        !cancelledDownloads.has(context.record.id) &&
        isTransientHttpStartError(error);
      if (!canRetry) {
        throw error;
      }
      useDownloadsStore.getState().updateDownload(context.record.id, {
        status: 'starting',
        ...(backend.preservePartialOnFailure
          ? {}
          : {downloadedBytes: 0, totalBytes: 0}),
        speed: 0,
        canPause: false,
        canResume: false,
      });
      await wait(retryDelays[attempt]);
      attempt += 1;
      if (cancelledDownloads.has(context.record.id)) {
        throw new Error('Download cancelled');
      }
    }
  }
};

export const waitForDownloadsHydration = async (): Promise<void> => {
  if (useDownloadsStore.persist.hasHydrated()) {
    return;
  }
  await new Promise<void>(resolve => {
    let unsubscribe: () => void = () => undefined;
    unsubscribe = useDownloadsStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
    useDownloadsStore.persist.rehydrate();
  });
};

const withSpeed = (label: string, record: DownloadItem): string =>
  [label, record.speed > 0 ? formatDownloadSpeed(record.speed) : '', formatDownloadEta(record)]
    .filter(Boolean)
    .join(' · ');

const showProgressNotification = async (
  record: DownloadItem,
): Promise<void> => {
  const now = Date.now();
  const previous = lastNotificationAt.get(record.id) || 0;
  if (now - previous < 1000) {
    return;
  }
  lastNotificationAt.set(record.id, now);
  const progress = record.totalBytes
    ? record.downloadedBytes / record.totalBytes
    : 0;
  const color = await getDownloadNotificationColor(record);
  await notificationService.showDownloadProgress(
    record.title,
    record.id,
    progress,
    withSpeed(formatDownloadProgressLabel(record), record),
    record.sourceType,
    record.canPause ? 'pause' : record.canResume ? 'resume' : 'none',
    color,
    !record.totalBytes,
  );
};

const showCurrentDownloadNotification = async (
  record: DownloadItem,
): Promise<void> => {
  const progress = record.totalBytes
    ? record.downloadedBytes / record.totalBytes
    : 0;
  const color = await getDownloadNotificationColor(record);
  const isPaused = record.status === 'paused';
  const progressLabel = formatDownloadProgressLabel(record);
  const body = isPaused
    ? record.errorCode === 'NETWORK_INTERRUPTED'
      ? record.totalBytes
        ? `Waiting for network - ${progressLabel}`
        : 'Waiting for network'
      : record.totalBytes
        ? `Paused - ${progressLabel}`
        : 'Paused'
    : withSpeed(progressLabel, record);

  await notificationService.showDownloadProgress(
    record.title,
    record.id,
    progress,
    body,
    record.sourceType,
    isPaused ? 'resume' : record.canPause ? 'pause' : 'none',
    color,
    !record.totalBytes && !isPaused,
  );
};

const getRecord = (downloadId: string): DownloadItem => {
  const record = useDownloadsStore.getState().getDownload(downloadId);
  if (!record) {
    throw new Error(`Download ${downloadId} is not registered`);
  }
  return record;
};

const getOutputName = (record: DownloadItem): string =>
  record.displayFileName?.replace(/\.[^.]+$/, '') || record.title;

const getOutputDirectoryNames = (record: DownloadItem): string[] => [
  createDownloadDirectoryName(record.showName || record.title),
  ...[createDownloadSeasonDirectoryName(record.seasonTitle)].filter(
    (name): name is string => Boolean(name),
  ),
];

/**
 * A finished download that only brings another language: add its audio to the
 * video it belongs to, then remove it. The video file is replaced by a
 * Matroska file with all its old tracks and the new one.
 */
const runAudioDownload = async (
  record: DownloadItem,
  destination: PreparedDownloadDestination,
  location: DownloadLocationConfig,
): Promise<void> => {
  const store = useDownloadsStore.getState();
  const target = record.audioFor ? store.getDownload(record.audioFor) : undefined;
  if (!target || target.status !== 'completed') {
    throw new Error('The video to add this audio to is no longer downloaded');
  }
  const audioSource = destination.directFinalDocumentUri || destination.stagingPath;
  const videoSource = target.finalDocumentUri || target.filePath;
  const workDir = `${AUDIO_MERGE_ROOT}/${sanitizeDownloadFileName(record.id)}`;
  const label = record.audioLabel || 'Audio';
  try {
    const merged = await mergeAudioTrackFiles({
      videoSource,
      audioSource,
      workDir,
      language: record.audioLanguage || getAudioLanguageCode(label),
      label,
    });
    const baseName = getOutputName(target);
    const output = await finalizeDownloadOutput({
      downloadId: record.id,
      location: target.downloadLocation || location,
      stagingPath: merged,
      fileName: baseName,
      fileType: 'mkv',
      outputDirectoryNames: getOutputDirectoryNames(target),
    });
    // The new file is in place; now the old one can go.
    if (output.filePath !== videoSource) {
      await deleteDownloadOutput(videoSource).catch(() => undefined);
    }
    store.updateDownload(target.id, {
      filePath: output.filePath,
      finalDocumentUri: output.finalDocumentUri,
      displayFileName: `${baseName}.mkv`,
      videoType: 'mkv',
      mimeType: 'video/x-matroska',
      totalBytes: output.size,
      downloadedBytes: output.size,
      audioTracks: [
        ...(target.audioTracks || []),
        {label, language: record.audioLanguage || getAudioLanguageCode(label)},
      ],
    });
  } finally {
    await cleanupAudioMerge(workDir);
  }
  // The language's own file was only a means to get its audio.
  await deleteDownloadOutput(audioSource, {
    downloadLocation: location,
    outputDirectoryNames: getOutputDirectoryNames(record),
  }).catch(() => undefined);
  store.removeDownload(record.id);
  await notificationService.cancelNotification(record.id).catch(() => undefined);
  await notificationService.showDownloadComplete(
    `${target.showName || target.title}: ${label} audio added`,
    record.id,
    record.sourceType,
    await getDownloadNotificationColor(record),
  );
};

// Merges rewrite the video they belong to. Two at once on the same video
// (several languages of one episode finishing together) would overwrite each
// other, so they go one after another.
let audioMergeChain: Promise<unknown> = Promise.resolve();
const completeAudioDownload = (
  record: DownloadItem,
  destination: PreparedDownloadDestination,
  location: DownloadLocationConfig,
): Promise<void> => {
  const run = audioMergeChain.then(() =>
    runAudioDownload(record, destination, location),
  );
  audioMergeChain = run.catch(() => undefined);
  return run;
};

const compareQueued = (left: DownloadItem, right: DownloadItem): number => {
  const priority = (right.priority ?? 0) - (left.priority ?? 0);
  if (priority !== 0) {
    return priority;
  }
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : left.createdAt - right.createdAt;
};

/** Queued downloads in the order they will start, held ones included. */
export const orderQueuedDownloads = (items: DownloadItem[]): DownloadItem[] =>
  items.filter(item => item.status === 'queued').sort(compareQueued);

const getQueuedDownloads = (): DownloadItem[] => {
  const now = Date.now();
  return Object.values(useDownloadsStore.getState().downloads)
    .filter(
      item =>
        item.status === 'queued' &&
        item.downloadLocation &&
        !item.held &&
        !(item.retryAt && item.retryAt > now),
    )
    .sort(compareQueued);
};

/** Wake the scheduler when the earliest waiting retry is due. */
const setRetryTimer = (): void => {
  const next = Object.values(useDownloadsStore.getState().downloads).reduce(
    (earliest, item) =>
      item.status === 'queued' &&
      !item.held &&
      item.retryAt &&
      item.retryAt > Date.now()
        ? Math.min(earliest, item.retryAt)
        : earliest,
    Infinity,
  );
  if (next === Infinity) {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
      retryTimerAt = 0;
    }
    return;
  }
  if (retryTimer && retryTimerAt <= next) {
    return;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
  }
  retryTimerAt = next;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryTimerAt = 0;
    scheduleQueuedDownloads().catch(() => undefined);
  }, Math.max(next - Date.now(), 0) + 50);
};

/** True while any download is running, queued, or waiting to retry. */
const hasPendingDownloads = (): boolean =>
  activeDownloads.size > 0 ||
  Object.values(useDownloadsStore.getState().downloads).some(
    item => item.status === 'queued' && !item.held && item.downloadLocation,
  );

/**
 * Keep the foreground service up while anything is pending. If it stopped
 * between downloads, Android wouldn't let it start again from the background
 * and would freeze the app, so the next download (or a retry) would only run
 * once the app is opened.
 */
const syncQueueKeepAlive = async (): Promise<void> => {
  const holding = notificationService.hasForegroundTask(QUEUE_KEEPALIVE_ID);
  try {
    if (hasPendingDownloads()) {
      if (!holding) {
        await notificationService.startForegroundTask(QUEUE_KEEPALIVE_ID);
      }
    } else if (holding) {
      await notificationService.stopForegroundTask(QUEUE_KEEPALIVE_ID);
    }
  } catch {
    // Android may refuse the service from the background; downloads still run.
  }
};

const setQueuedReason = (
  queued: DownloadItem[],
  reason: StartBlockReason | undefined,
): void => {
  const store = useDownloadsStore.getState();
  queued.forEach(item => {
    if (item.queuedReason !== reason) {
      store.updateDownload(item.id, {queuedReason: reason});
    }
  });
};

const setGateTimer = (needed: boolean): void => {
  if (needed && !gateTimer) {
    gateTimer = setInterval(() => {
      scheduleQueuedDownloads().catch(() => undefined);
    }, GATE_RECHECK_MS);
  } else if (!needed && gateTimer) {
    clearInterval(gateTimer);
    gateTimer = null;
  }
};

const notifyQueued = (queued: DownloadItem[]): void => {
  queued.forEach(record => {
    // A bulk download has one notification for the whole batch.
    if (record.batchId) {
      return;
    }
    getDownloadNotificationColor(record)
      .then(color =>
        notificationService.showDownloadQueued(
          record.title,
          record.id,
          record.sourceType,
          color,
        ),
      )
      .catch(() => undefined);
  });
};

const runScheduler = async (): Promise<void> => {
  setRetryTimer();
  const queued = getQueuedDownloads();
  if (queued.length === 0) {
    setGateTimer(false);
    return;
  }
  if (
    Math.max(
      settingsStorage.getDownloadConcurrency() - occupiedDownloadSlots.size,
      0,
    ) === 0
  ) {
    notifyQueued(queued);
    return;
  }

  const gate = await getStartGate();
  if (!gate.allowed) {
    setQueuedReason(queued, gate.reason);
    setGateTimer(true);
    return;
  }
  setQueuedReason(queued, undefined);
  setGateTimer(false);

  // Slots can change while the gate is checked.
  const availableSlots = Math.max(
    settingsStorage.getDownloadConcurrency() - occupiedDownloadSlots.size,
    0,
  );
  queued.slice(0, availableSlots).forEach(record => {
    startDownload(record.id, record.downloadLocation!).catch(() => undefined);
  });
  notifyQueued(queued.slice(availableSlots));
};

export const scheduleQueuedDownloads = async (): Promise<void> => {
  if (schedulerRunning) {
    // The running pass may already be past the point that would see this.
    schedulerRerun = true;
    return;
  }
  schedulerRunning = true;
  try {
    do {
      schedulerRerun = false;
      await runScheduler();
    } while (schedulerRerun);
  } finally {
    schedulerRunning = false;
    await syncQueueKeepAlive();
  }
};

export const startQueuedDownloadNow = async (
  downloadId: string,
): Promise<void> => {
  const record = getRecord(downloadId);
  if (record.status !== 'queued' || !record.downloadLocation) {
    return;
  }
  await startDownload(downloadId, record.downloadLocation);
};

/**
 * Make a new link usable for a download that already has some data. The data
 * is kept only when the new link is the same server and the same file size;
 * otherwise it is thrown away, since another server's copy of the file can
 * differ and joining the two would corrupt the video.
 */
const adoptResolvedStream = async (
  downloadId: string,
  outcome: Extract<ResolveOutcome, {status: 'resolved'}>,
): Promise<{record: DownloadItem; discardedPartial: boolean}> => {
  const store = useDownloadsStore.getState();
  const before = getRecord(downloadId);
  const hasPartial =
    before.downloadedBytes > 0 || Boolean(before.finalDocumentUri);
  const keepPartial =
    hasPartial &&
    sameServer(before.server, outcome.server.server) &&
    before.totalBytes > 0 &&
    outcome.size === before.totalBytes;
  if (hasPartial && !keepPartial) {
    await getDownloadBackend(before.sourceType)
      .cleanup(downloadId, before)
      .catch(() => undefined);
    store.updateDownload(downloadId, {
      downloadedBytes: 0,
      totalBytes: 0,
      finalDocumentUri: undefined,
      stagingPath: undefined,
    });
  }
  const record = applyResolvedStream(
    useDownloadsStore.getState().getDownload(downloadId) || before,
    outcome.server,
  );
  // A download that only brings audio has no use for subtitles of its own.
  if (!record.audioFor) {
    queueSubtitleForStream(record, outcome.server);
  }
  return {record, discardedPartial: hasPartial && !keepPartial};
};

const resolveBeforeStart = async (
  downloadId: string,
): Promise<DownloadItem> => {
  const record = getRecord(downloadId);
  if (!canResolveDownload(record)) {
    throw new StreamUnavailableError(
      'This download has no source to look up a link from',
    );
  }
  const outcome = await resolveStreamForRecord(record);
  if (outcome.status === 'unavailable') {
    throw new StreamUnavailableError(outcome.message);
  }
  return (await adoptResolvedStream(downloadId, outcome)).record;
};

export const startDownload = async (
  downloadId: string,
  location: DownloadLocationConfig,
): Promise<void> => {
  if (activeDownloads.has(downloadId)) {
    return;
  }

  let record = getRecord(downloadId);
  let backend = getDownloadBackend(record.sourceType);
  const store = useDownloadsStore.getState();
  activeDownloads.add(downloadId);
  occupiedDownloadSlots.add(downloadId);
  cancelledDownloads.delete(downloadId);
  store.markStarting(downloadId);
  store.updateDownload(downloadId, {held: undefined, queuedReason: undefined});
  const subscriptions: Array<() => void> = [];
  let transferStartedAt = 0;
  let transferStartBytes = 0;

  try {
    try {
      await notificationService.startForegroundTask(downloadId);
    } catch (error) {
      console.warn(
        `Foreground service unavailable for download ${downloadId}:`,
        error,
      );
    }
    await notificationService
      .cancelNotification(downloadId)
      .catch(() => undefined);
    await notificationService.ensureDownloadPermission().catch(() => false);
    await notificationService.showDownloadStarting(
      record.title,
      downloadId,
      record.sourceType,
      await getDownloadNotificationColor(record),
    );
    subscriptions.push(
      useDownloadsStore.subscribe(state => {
        const updatedRecord = state.downloads[downloadId];
        if (updatedRecord?.status === 'downloading') {
          showProgressNotification(updatedRecord).catch(() => undefined);
        } else if (
          updatedRecord?.status === 'paused' &&
          updatedRecord.errorCode === 'NETWORK_INTERRUPTED'
        ) {
          showCurrentDownloadNotification(updatedRecord).catch(() => undefined);
        }
      }),
    );

    if (record.needsResolve) {
      record = await resolveBeforeStart(downloadId);
      if (cancelledDownloads.has(downloadId)) {
        throw new Error('Download cancelled');
      }
      backend = getDownloadBackend(record.sourceType);
    }
    applyNativeDownloadPolicy();

    const prepare = () =>
      prepareDownloadDestination({
        downloadId,
        location,
        fileName: getOutputName(record),
        fileType: record.videoType || 'mp4',
        directToSaf: backend.directToSaf && isSafDownloadLocation(location),
        existingFinalDocumentUri: record.finalDocumentUri,
        outputDirectoryNames: getOutputDirectoryNames(record),
      });
    let destination = await prepare();
    store.updateDownload(downloadId, {
      stagingPath: destination.stagingPath,
      finalDocumentUri: destination.directFinalDocumentUri,
      downloadLocation: location,
    });

    transferStartedAt = Date.now();
    transferStartBytes = getRecord(downloadId).downloadedBytes;
    let recoveries = 0;
    while (true) {
      try {
        await startBackendWithRetry(backend, {
          record: getRecord(downloadId),
          destination,
        });
        break;
      } catch (error) {
        const current = getRecord(downloadId);
        if (
          cancelledDownloads.has(downloadId) ||
          pauseFailedDownloads.has(downloadId) ||
          !isExpiredLinkError(error) ||
          recoveries >= MAX_LINK_RECOVERIES ||
          current.sourceType === 'torrent' ||
          !canResolveDownload(current)
        ) {
          throw error;
        }
        // The link stopped working. Get a new one from the saved server rule;
        // after the first try, avoid the server that just failed.
        recoveries += 1;
        recordServerOutcome(current.provider, current.server, {success: false});
        store.updateDownload(downloadId, {
          status: 'starting',
          speed: 0,
          canPause: false,
          canResume: false,
          linkRecoveries: recoveries,
          errorMessage: 'Link expired. Getting a new one',
        });
        const outcome = await resolveStreamForRecord(current, {
          excludeServerKeys:
            recoveries > 1 ? [normalizeServerName(current.server)] : undefined,
        });
        if (outcome.status === 'unavailable') {
          throw new StreamUnavailableError(outcome.message);
        }
        if (cancelledDownloads.has(downloadId)) {
          throw new Error('Download cancelled');
        }
        const adopted = await adoptResolvedStream(downloadId, outcome);
        record = adopted.record;
        backend = getDownloadBackend(record.sourceType);
        if (adopted.discardedPartial) {
          destination = await prepare();
          store.updateDownload(downloadId, {
            stagingPath: destination.stagingPath,
            finalDocumentUri: destination.directFinalDocumentUri,
          });
        }
        transferStartedAt = Date.now();
        transferStartBytes = getRecord(downloadId).downloadedBytes;
      }
    }

    if (cancelledDownloads.has(downloadId)) {
      throw new Error('Download cancelled');
    }

    store.markFinalizing(downloadId);
    if (record.audioFor) {
      await completeAudioDownload(record, destination, location);
      return;
    }
    const output = await finalizeDownloadOutput({
      downloadId,
      location,
      stagingPath: destination.stagingPath,
      fileName: getOutputName(record),
      fileType: record.videoType || 'mp4',
      outputDirectoryNames: getOutputDirectoryNames(record),
      directFinalDocumentUri: destination.directFinalDocumentUri,
    });
    // A clearly broken file is removed, not kept as a finished download.
    const problem = verifyFinishedDownload(
      record,
      output.size,
      getRecord(downloadId).totalBytes,
    );
    if (problem) {
      await deleteDownloadOutput(output.filePath, {
        downloadLocation: location,
        outputDirectoryNames: getOutputDirectoryNames(record),
      }).catch(() => undefined);
      throw new Error(problem);
    }
    store.markCompleted(downloadId, {
      filePath: output.filePath,
      finalDocumentUri: output.finalDocumentUri,
      totalBytes: output.size,
    });
    store.updateDownload(downloadId, {retryAt: undefined, autoRetries: undefined});
    const elapsedSeconds = (Date.now() - transferStartedAt) / 1000;
    const transferredBytes = Math.max(output.size - transferStartBytes, 0);
    recordServerOutcome(record.provider, record.server, {
      success: true,
      speed:
        record.sourceType === 'http' && elapsedSeconds > 5
          ? transferredBytes / elapsedSeconds
          : undefined,
    });
    if (record.batchId) {
      notifyBatchProgress(record.batchId, {force: true}).catch(() => undefined);
    } else {
      await notificationService.showDownloadComplete(
        record.title,
        downloadId,
        record.sourceType,
        await getDownloadNotificationColor(record),
      );
    }
  } catch (error) {
    const cancelled = cancelledDownloads.has(downloadId);
    const pauseFailed = pauseFailedDownloads.has(downloadId);
    if (!backend.preservePartialOnFailure || !isSafDownloadLocation(location)) {
      await backend.cleanup(downloadId, record).catch(() => undefined);
    }
    if (cancelled) {
      store.removeDownload(downloadId);
      await notificationService.cancelNotification(downloadId);
      return;
    }
    if (pauseFailed) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const pauseUnsupported = error instanceof DownloadPauseSupportError;
    const noStream = error instanceof StreamUnavailableError;

    const failed = store.getDownload(downloadId);
    if (!pauseUnsupported && failed) {
      // Never give up: queue it again after a growing wait, with a fresh
      // link from the provider when it has one.
      const attempt = (failed.autoRetries ?? 0) + 1;
      const delay = getAutoRetryDelay(attempt);
      if (!noStream && !isTransientHttpStartError(error)) {
        recordServerOutcome(record.provider, record.server, {success: false});
      }
      store.updateDownload(downloadId, {
        status: 'queued',
        retryAt: Date.now() + delay,
        autoRetries: attempt,
        errorMessage: `Retry ${attempt} in ${Math.round(delay / 1000)}s: ${message}`,
        speed: 0,
        canPause: false,
        canResume: false,
        linkRecoveries: 0,
        // Failing before the destination was saved must not drop the
        // download out of the queue for good.
        downloadLocation: failed.downloadLocation || location,
        ...(canResolveDownload(failed) ? {needsResolve: true} : {}),
      });
      if (record.batchId) {
        notifyBatchProgress(record.batchId, {force: true}).catch(() => undefined);
      }
      await notificationService
        .cancelNotification(downloadId)
        .catch(() => undefined);
      return;
    }

    store.markError(downloadId, {
      code: pauseUnsupported
        ? 'PAUSE_UNSUPPORTED'
        : noStream
          ? 'NO_SERVER'
          : undefined,
      message,
      retryable: !pauseUnsupported,
    });
    // A dropped connection says nothing about the server.
    if (!noStream && !isTransientHttpStartError(error)) {
      recordServerOutcome(record.provider, record.server, {success: false});
    }
    if (record.batchId) {
      notifyBatchProgress(record.batchId, {force: true}).catch(() => undefined);
      await notificationService
        .cancelNotification(downloadId)
        .catch(() => undefined);
    } else {
      await notificationService.showDownloadFailed(
        record.title,
        downloadId,
        record.sourceType,
        await getDownloadNotificationColor(record),
      );
    }
    throw error;
  } finally {
    subscriptions.forEach(unsubscribe => unsubscribe());
    activeDownloads.delete(downloadId);
    occupiedDownloadSlots.delete(downloadId);
    cancelledDownloads.delete(downloadId);
    pauseFailedDownloads.delete(downloadId);
    lastNotificationAt.delete(downloadId);
    downloadNotificationColors.delete(downloadId);
    await scheduleQueuedDownloads();
    // Take over the service before this download lets go of it.
    await syncQueueKeepAlive();
    await notificationService
      .stopForegroundTask(downloadId)
      .catch(() => undefined);
  }
};

const failPausedDownload = async (
  downloadId: string,
  operation: 'pause' | 'resume',
  error: unknown,
): Promise<void> => {
  const record = getRecord(downloadId);
  const backend = getDownloadBackend(record.sourceType);
  const detail = error instanceof Error ? error.message : String(error);
  const message = `Unable to ${operation} this download. Partial download data was deleted. ${detail}`;
  pauseFailedDownloads.add(downloadId);
  await backend.cancel(downloadId).catch(() => undefined);
  await backend.cleanup(downloadId, record).catch(() => undefined);
  useDownloadsStore.getState().markError(downloadId, {
    code: 'PAUSE_UNSUPPORTED',
    message,
    retryable: false,
  });
  await notificationService.showDownloadFailed(
    record.title,
    downloadId,
    record.sourceType,
    await getDownloadNotificationColor(record),
  );
};

// Downloads asked to pause before they could: still getting a link or
// connecting. They pause as soon as the transfer can be paused.
const pendingPauses = new Set<string>();
let pendingPauseUnsubscribe: (() => void) | undefined;

const watchPendingPauses = (): void => {
  if (pendingPauseUnsubscribe) {
    return;
  }
  pendingPauseUnsubscribe = useDownloadsStore.subscribe(state => {
    pendingPauses.forEach(id => {
      const item = state.downloads[id];
      if (
        !item ||
        (item.status !== 'starting' && item.status !== 'downloading')
      ) {
        pendingPauses.delete(id);
      } else if (item.status === 'downloading' && item.canPause) {
        pendingPauses.delete(id);
        pauseDownload(id).catch(() => undefined);
      }
    });
    if (pendingPauses.size === 0) {
      pendingPauseUnsubscribe?.();
      pendingPauseUnsubscribe = undefined;
    }
  });
};

export const pauseDownload = async (downloadId: string): Promise<void> => {
  const record = getRecord(downloadId);
  const backend = getDownloadBackend(record.sourceType);
  if (record.status === 'starting' && !record.canPause && backend.pause) {
    pendingPauses.add(downloadId);
    watchPendingPauses();
    return;
  }
  if (
    !backend.pause ||
    !record.canPause ||
    (record.status !== 'downloading' && record.status !== 'starting')
  ) {
    return;
  }
  useDownloadsStore.getState().updateDownload(downloadId, {
    status: 'pausing',
    speed: 0,
    canPause: false,
  });
  try {
    await backend.pause(downloadId);
    useDownloadsStore.getState().updateDownload(downloadId, {
      status: 'paused',
      speed: 0,
      canPause: false,
      canResume: true,
    });
    occupiedDownloadSlots.delete(downloadId);
    await showCurrentDownloadNotification(getRecord(downloadId));
    scheduleQueuedDownloads().catch(() => undefined);
  } catch (error) {
    await failPausedDownload(downloadId, 'pause', error);
  }
};

export const resumeDownload = async (downloadId: string): Promise<void> => {
  const record = getRecord(downloadId);
  const backend = getDownloadBackend(record.sourceType);
  if (!backend.resume || !record.canResume || record.status !== 'paused') {
    return;
  }
  if (
    !activeDownloads.has(downloadId) &&
    backend.directToSaf &&
    Boolean(record.finalDocumentUri)
  ) {
    useDownloadsStore.getState().updateDownload(downloadId, {
      status: 'queued',
      canPause: false,
      canResume: false,
    });
    await scheduleQueuedDownloads();
    return;
  }
  if (record.errorCode !== 'NETWORK_INTERRUPTED') {
    useDownloadsStore.getState().updateDownload(downloadId, {
      status: 'starting',
      canPause: false,
      canResume: false,
    });
  }
  if (activeDownloads.has(downloadId)) {
    occupiedDownloadSlots.add(downloadId);
  }
  try {
    await backend.resume(downloadId);
    if (record.errorCode !== 'NETWORK_INTERRUPTED') {
      useDownloadsStore.getState().updateDownload(downloadId, {
        status: 'downloading',
        canPause: true,
        canResume: false,
      });
    }
    await showCurrentDownloadNotification(getRecord(downloadId));
  } catch (error) {
    occupiedDownloadSlots.delete(downloadId);
    scheduleQueuedDownloads().catch(() => undefined);
    await failPausedDownload(downloadId, 'resume', error);
  }
};

export const cancelDownload = async (downloadId: string): Promise<void> => {
  const record = useDownloadsStore.getState().getDownload(downloadId);
  // A finished download can still get a cancel from a dialog or notification
  // opened before it completed. Cleanup would delete the saved file.
  if (!record || !CURRENT_DOWNLOAD_STATUSES.has(record.status)) {
    return;
  }

  cancelledDownloads.add(downloadId);
  useDownloadsStore.getState().markCanceling(downloadId);
  const backend = getDownloadBackend(record.sourceType);
  try {
    await backend.cancel(downloadId);
  } finally {
    occupiedDownloadSlots.delete(downloadId);
    await backend.cleanup(downloadId, record).catch(() => undefined);
    useDownloadsStore.getState().removeDownload(downloadId);
    if (!activeDownloads.has(downloadId)) {
      cancelledDownloads.delete(downloadId);
    }
    await notificationService.cancelNotification(downloadId);
    scheduleQueuedDownloads().catch(() => undefined);
  }
};

export const retryDownload = async (downloadId: string): Promise<void> => {
  const record = useDownloadsStore.getState().getDownload(downloadId);
  if (!record || !record.retryable) {
    return;
  }
  const location = await ensureDownloadLocationAccess(
    record.downloadLocation || settingsStorage.getDownloadLocationConfig(),
  );
  if (!location) {
    return;
  }
  settingsStorage.setDownloadLocation(location);
  // A bulk episode, or one whose link died, gets a fresh link from the saved
  // server rule instead of trying the old one again.
  const needsFreshLink =
    canResolveDownload(record) &&
    (Boolean(record.batchId) ||
      record.errorCode === 'NO_SERVER' ||
      isExpiredLinkError(record.errorMessage || ''));
  useDownloadsStore.getState().updateDownload(downloadId, {
    downloadLocation: location,
    errorCode: undefined,
    errorMessage: undefined,
    retryable: undefined,
    status: 'queued',
    held: undefined,
    ...(needsFreshLink ? {needsResolve: true} : {}),
  });
  await scheduleQueuedDownloads();
};

/** Move a queued download ahead of every other queued download. */
export const prioritizeDownload = async (downloadId: string): Promise<void> => {
  const store = useDownloadsStore.getState();
  const record = store.getDownload(downloadId);
  if (!record || record.status !== 'queued') {
    return;
  }
  const highest = Object.values(store.downloads).reduce(
    (max, item) => Math.max(max, item.priority ?? 0),
    0,
  );
  store.updateDownload(downloadId, {priority: highest + 1, held: undefined});
  await scheduleQueuedDownloads();
};

/**
 * Move a queued download one place earlier or later in the queue. The order is
 * written out for every queued download, so it stays as shown.
 */
export const moveQueuedDownload = async (
  downloadId: string,
  direction: 'up' | 'down',
): Promise<void> => {
  const store = useDownloadsStore.getState();
  // Small subtitle files are not shown in the queue, so they do not count.
  const ordered = orderQueuedDownloads(
    Object.values(store.downloads).filter(
      item => !item.isSubtitle && !item.id.includes('_subtitle_'),
    ),
  );
  const index = ordered.findIndex(item => item.id === downloadId);
  const target = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || target < 0 || target >= ordered.length) {
    return;
  }
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  ordered.forEach((item, position) =>
    store.updateDownload(item.id, {priority: ordered.length - position}),
  );
  await scheduleQueuedDownloads();
};

/** Keep queued downloads from starting, or let them start again. */
export const setDownloadsHeld = async (
  downloadIds: string[],
  held: boolean,
): Promise<void> => {
  const store = useDownloadsStore.getState();
  downloadIds.forEach(id => {
    const record = store.getDownload(id);
    if (record?.status === 'queued') {
      store.updateDownload(id, {held: held || undefined});
    }
  });
  if (!held) {
    await scheduleQueuedDownloads();
  }
};

export const updateDownloadConcurrency = (concurrency: number): void => {
  settingsStorage.setDownloadConcurrency(concurrency);
  scheduleQueuedDownloads().catch(() => undefined);
};

export const isDownloadActive = (downloadId: string): boolean =>
  activeDownloads.has(downloadId);
