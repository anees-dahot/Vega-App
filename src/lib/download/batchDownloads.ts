import {notificationService} from '../services/Notification';
import useDownloadsStore, {
  isSubtitleDownloadItem,
  type DownloadItem,
} from '../zustand/downloadsStore';

/**
 * Downloads queued together (bulk download) share a batch id. These helpers
 * summarize a batch for the downloads screen and its notification.
 */

export interface BatchSummary {
  batchId: string;
  title: string;
  total: number;
  done: number;
  failed: number;
  active: number;
  /** Waiting for a slot, or kept back by "pause all". */
  waiting: number;
  paused: number;
  /** Everything finished: downloaded or failed, none still to run. */
  finished: boolean;
  bytesDone: number;
  bytesTotal: number;
}

const isBatchVideo = (item: DownloadItem): boolean =>
  Boolean(item.batchId) && !isSubtitleDownloadItem(item);

export const getBatchItems = (
  downloads: Record<string, DownloadItem>,
  batchId: string,
): DownloadItem[] =>
  Object.values(downloads)
    .filter(item => item.batchId === batchId && isBatchVideo(item))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

export const summarizeBatch = (
  items: DownloadItem[],
  batchId: string,
): BatchSummary => {
  const summary: BatchSummary = {
    batchId,
    title: items[0]?.batchTitle || items[0]?.showName || 'Bulk download',
    total: items.length,
    done: 0,
    failed: 0,
    active: 0,
    waiting: 0,
    paused: 0,
    finished: false,
    bytesDone: 0,
    bytesTotal: 0,
  };
  for (const item of items) {
    summary.bytesDone += item.downloadedBytes || 0;
    summary.bytesTotal += item.totalBytes || 0;
    switch (item.status) {
      case 'completed':
        summary.done += 1;
        break;
      case 'error':
      case 'interrupted':
      case 'missing':
        summary.failed += 1;
        break;
      case 'queued':
        summary.waiting += 1;
        break;
      case 'paused':
      case 'pausing':
        summary.paused += 1;
        break;
      default:
        summary.active += 1;
    }
  }
  summary.finished =
    summary.active + summary.waiting + summary.paused === 0 &&
    summary.total > 0;
  return summary;
};

export const getBatchIds = (
  downloads: Record<string, DownloadItem>,
): string[] => {
  const seen = new Set<string>();
  for (const item of Object.values(downloads)) {
    if (isBatchVideo(item) && item.batchId) {
      seen.add(item.batchId);
    }
  }
  return [...seen];
};

const lastNotifiedAt = new Map<string, number>();
const NOTIFY_INTERVAL_MS = 1500;

/** Refresh the one notification for a batch. Calls close together are merged. */
export const notifyBatchProgress = async (
  batchId: string | undefined,
  options: {force?: boolean} = {},
): Promise<void> => {
  if (!batchId) {
    return;
  }
  const now = Date.now();
  const previous = lastNotifiedAt.get(batchId) || 0;
  if (!options.force && now - previous < NOTIFY_INTERVAL_MS) {
    return;
  }
  const items = getBatchItems(useDownloadsStore.getState().downloads, batchId);
  if (items.length === 0) {
    return;
  }
  lastNotifiedAt.set(batchId, now);
  const summary = summarizeBatch(items, batchId);
  await notificationService
    .showBatchProgress(batchId, summary.title, {
      done: summary.done,
      total: summary.total,
      failed: summary.failed,
      finished: summary.finished,
    })
    .catch(() => undefined);
};
