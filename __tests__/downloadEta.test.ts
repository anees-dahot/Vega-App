import {describe, expect, it} from '@jest/globals';
import {
  formatDownloadEta,
  formatDownloadProgressLabel,
} from '../src/lib/downloadFormatting';

const MB = 1024 * 1024;

describe('formatDownloadEta', () => {
  it('shows seconds, minutes, and hours', () => {
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 100 * MB, speed: 10 * MB})).toBe('10 s left');
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 600 * MB, speed: 5 * MB})).toBe('2 min left');
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 3600 * MB, speed: 0.5 * MB})).toBe('2 h left');
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 4000 * MB, speed: 0.5 * MB})).toBe('2 h 14 min left');
  });

  it('is empty when speed or size is unknown, or nothing remains', () => {
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 0, speed: 5})).toBe('');
    expect(formatDownloadEta({downloadedBytes: 0, totalBytes: 100, speed: 0})).toBe('');
    expect(formatDownloadEta({downloadedBytes: 100, totalBytes: 100, speed: 5})).toBe('');
  });
});

describe('formatDownloadProgressLabel', () => {
  it('marks an HLS size as an estimate', () => {
    expect(
      formatDownloadProgressLabel({sourceType: 'hls', downloadedBytes: 45 * MB, totalBytes: 310 * MB}),
    ).toBe('45 / ~310 MB');
    expect(
      formatDownloadProgressLabel({sourceType: 'http', downloadedBytes: 45 * MB, totalBytes: 310 * MB}),
    ).toBe('45 / 310 MB');
  });
});
