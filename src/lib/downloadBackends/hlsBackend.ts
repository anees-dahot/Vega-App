import {cleanupDownloadStaging} from '../downloadDestination';
import {
  cancelHlsDownload,
  hlsDownloader2,
  pauseHlsDownload,
  resumeHlsDownload,
} from '../hlsDownloader2';
import useDownloadsStore from '../zustand/downloadsStore';
import type {DownloadBackend, DownloadBackendContext} from './types';

export const hlsDownloadBackend: DownloadBackend = {
  async start({record, destination}: DownloadBackendContext): Promise<void> {
    await hlsDownloader2({
      downloadId: record.id,
      videoUrl: record.url,
      path: destination.stagingPath,
      title: record.title,
      tempDirectory: `${destination.stagingDirectory}/segments`,
      headers: record.headers,
      audioOnly: record.audioFor
        ? {label: record.audioLabel, language: record.audioLanguage}
        : undefined,
      onJobStarted: backendJobId =>
        useDownloadsStore.getState().updateDownload(record.id, {
          backendJobId,
          status: 'downloading',
          // Segments already running finish, then nothing new starts.
          canPause: true,
        }),
      onProgress: (completedSegments, totalSegments, stats) =>
        // Real bytes and speed. Without a size estimate, fall back to segment counts.
        stats.estimatedTotal > 0
          ? useDownloadsStore
              .getState()
              .updateProgress(
                record.id,
                stats.bytes,
                stats.estimatedTotal,
                stats.speed,
              )
          : useDownloadsStore
              .getState()
              .updateProgress(record.id, completedSegments, totalSegments, 0),
      onCompleted: () => undefined,
    });
  },

  async pause(downloadId: string): Promise<void> {
    pauseHlsDownload(downloadId);
  },

  async resume(downloadId: string): Promise<void> {
    resumeHlsDownload(downloadId);
  },

  async cancel(downloadId: string): Promise<void> {
    cancelHlsDownload(downloadId);
  },

  async cleanup(downloadId: string): Promise<void> {
    await cleanupDownloadStaging(downloadId);
  },
};
