import React from 'react';
import {Text, View} from 'react-native';
import {
  cancelDownload,
  moveQueuedDownload,
  orderQueuedDownloads,
  pauseDownload,
  prioritizeDownload,
  resumeDownload,
  retryDownload,
  startQueuedDownloadNow,
} from '../../../lib/downloadManager';
import {
  getBatchItems,
  summarizeBatch,
} from '../../../lib/download/batchDownloads';
import {
  cancelBatch,
  pauseBatch,
  resumeBatch,
  retryFailedInBatch,
} from '../../../lib/download/bulkDownload';
import useDownloadsStore, {
  selectCurrentDownloads,
  type DownloadItem,
} from '../../../lib/zustand/downloadsStore';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import BatchDownloadGroup from './BatchDownloadGroup';
import CurrentDownloadRow from './CurrentDownloadRow';

const batchProgress = (items: DownloadItem[]): number => {
  if (items.length === 0) {
    return 0;
  }
  const sum = items.reduce((total, item) => {
    if (item.status === 'completed') {
      return total + 1;
    }
    return (
      total +
      (item.totalBytes > 0
        ? Math.min(item.downloadedBytes / item.totalBytes, 1)
        : 0)
    );
  }, 0);
  return sum / items.length;
};

const CurrentDownloadsSection = ({
  primary,
  firstActionRef,
  onFirstActionLayout,
}: {
  primary: string;
  firstActionRef?: React.RefObject<View | null>;
  onFirstActionLayout?: () => void;
}) => {
  const colors = useM3Colors();
  const downloads = useDownloadsStore(selectCurrentDownloads);
  const allDownloads = useDownloadsStore(state => state.downloads);

  // A bulk download's small subtitle files stay out of the list.
  const visible = downloads.filter(
    item => !(item.batchId && (item.isSubtitle || item.id.includes('_subtitle_'))),
  );
  if (visible.length === 0) {
    return null;
  }

  // Where each queued download stands, for the move up and down buttons.
  const queueOrder = orderQueuedDownloads(
    visible.filter(item => item.status === 'queued'),
  ).map(item => item.id);

  const renderRow = (item: DownloadItem, index: number) => {
    const queuePosition = queueOrder.indexOf(item.id);
    const canMoveUp = queuePosition > 0;
    const canMoveDown = queuePosition >= 0 && queuePosition < queueOrder.length - 1;
    return (
    <CurrentDownloadRow
      key={item.id}
      item={item}
      primary={primary}
      firstActionRef={index === 0 ? firstActionRef : undefined}
      onFirstActionLayout={index === 0 ? onFirstActionLayout : undefined}
      onCancel={() => cancelDownload(item.id).catch(console.error)}
      onPause={() => pauseDownload(item.id).catch(console.error)}
      onResume={() => resumeDownload(item.id).catch(console.error)}
      onRetry={() => retryDownload(item.id).catch(console.error)}
      onStartNow={() => startQueuedDownloadNow(item.id).catch(console.error)}
      onPrioritize={() => prioritizeDownload(item.id).catch(console.error)}
      onMoveUp={
        queueOrder.length > 1
          ? canMoveUp
            ? () => moveQueuedDownload(item.id, 'up').catch(console.error)
            : undefined
          : undefined
      }
      onMoveDown={
        queueOrder.length > 1
          ? canMoveDown
            ? () => moveQueuedDownload(item.id, 'down').catch(console.error)
            : undefined
          : undefined
      }
    />
    );
  };

  const renderedBatches = new Set<string>();
  const entries: React.ReactNode[] = [];
  visible.forEach((item, index) => {
    if (!item.batchId) {
      entries.push(renderRow(item, index));
      return;
    }
    if (renderedBatches.has(item.batchId)) {
      return;
    }
    renderedBatches.add(item.batchId);
    const batchId = item.batchId;
    const batchItems = getBatchItems(allDownloads, batchId);
    const summary = summarizeBatch(batchItems, batchId);
    entries.push(
      <BatchDownloadGroup
        key={batchId}
        summary={summary}
        progress={batchProgress(batchItems)}
        primary={primary}
        firstActionRef={index === 0 ? firstActionRef : undefined}
        onFirstActionLayout={index === 0 ? onFirstActionLayout : undefined}
        onPauseAll={() => pauseBatch(batchId).catch(console.error)}
        onResumeAll={() => resumeBatch(batchId).catch(console.error)}
        onRetryFailed={() => retryFailedInBatch(batchId).catch(console.error)}
        onCancelAll={() =>
          showAppDialog({
            title: 'Cancel all?',
            message: `Everything in "${summary.title}" that has not finished will stop, and partial files will be removed. Finished episodes stay.`,
            variant: 'warning',
            actions: [
              {label: 'Keep downloading'},
              {
                label: 'Cancel all',
                variant: 'destructive',
                onPress: () => {
                  cancelBatch(batchId).catch(console.error);
                },
              },
            ],
          })
        }>
        {batchItems
          .filter(
            batchItem =>
              batchItem.status !== 'completed' &&
              visible.some(entry => entry.id === batchItem.id),
          )
          .map((batchItem, batchIndex) => renderRow(batchItem, batchIndex + 1000))}
      </BatchDownloadGroup>,
    );
  });

  return (
    <View className="mb-5">
      <View className="mb-3 flex-row items-center justify-between">
        <Text
          className="text-xl font-bold"
          style={{color: colors.onBackground}}>
          Current Downloads
        </Text>
        <View
          className="min-w-8 items-center px-2 py-1"
          style={{
            backgroundColor: colors.secondaryContainer,
            borderRadius: 12,
          }}>
          <Text
            className="text-xs font-bold"
            style={{color: colors.onSecondaryContainer}}>
            {visible.length}
          </Text>
        </View>
      </View>
      {entries}
    </View>
  );
};

export default CurrentDownloadsSection;
