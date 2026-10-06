export const formatDownloadBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

export const formatDownloadSpeed = (bytesPerSecond: number): string =>
  `${formatDownloadBytes(bytesPerSecond)}/s`;

/** "3 min left", from the bytes still to come and the current speed. Empty when it can't be known. */
export const formatDownloadEta = (item: {
  downloadedBytes: number;
  totalBytes: number;
  speed: number;
}): string => {
  const remaining = item.totalBytes - item.downloadedBytes;
  if (!(item.speed > 0) || !(item.totalBytes > 0) || remaining <= 0) {
    return '';
  }
  const seconds = Math.ceil(remaining / item.speed);
  if (seconds < 60) {
    return `${seconds} s left`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min left`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
};

export const formatDownloadProgressLabel = (item: {
  sourceType?: string | null;
  videoType?: string | null;
  downloadedBytes: number;
  totalBytes: number;
}): string => {
  const isHls = item.sourceType === 'hls' || item.videoType === 'm3u8';
  if (item.totalBytes > 0) {
    const percent = Math.min(
      100,
      Math.max(0, Math.round((item.downloadedBytes / item.totalBytes) * 100)),
    );
    const downloadedMB = Math.round(item.downloadedBytes / 1024 / 1024);
    const totalMB = Math.round(item.totalBytes / 1024 / 1024);
    if (downloadedMB === 0 && totalMB === 0) {
      return `${percent}%`;
    }
    // HLS sizes are estimated from the segments so far.
    return isHls
      ? `${downloadedMB} / ~${totalMB} MB`
      : `${downloadedMB} / ${totalMB} MB`;
  }
  return 'Downloading';
};

