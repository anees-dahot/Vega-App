import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockAxiosGet = jest.fn<(url: string) => Promise<{data: unknown}>>();
const mockDownloadFile = jest.fn((_options: {fromUrl: string}) => ({
  jobId: 1,
  promise: Promise.reject(new Error('segment request')),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {get: (url: string) => mockAxiosGet(url)},
}));
jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  exists: jest.fn(async () => true),
  mkdir: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  copyFile: jest.fn(async () => undefined),
  readFile: jest.fn(async () => ''),
  appendFile: jest.fn(async () => undefined),
  stat: jest.fn(async () => ({size: 0})),
  downloadFile: (options: {fromUrl: string}) => mockDownloadFile(options),
}));

import {
  hlsDownloader2,
  pauseHlsDownload,
  resumeHlsDownload,
} from '../src/lib/hlsDownloader2';

const download = () =>
  hlsDownloader2({
    videoUrl: 'https://example.com/video.m3u8',
    downloadId: 'movie',
    path: '/cache/movie.mp4',
    title: 'Movie',
  });

const playlist = (...tags: string[]) =>
  ['#EXTM3U', ...tags, '#EXTINF:10.0,', 'segment0.ts', '#EXT-X-ENDLIST'].join(
    '\n',
  );

describe('hlsDownloader2 playlist checks', () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  it('accepts AES-128 playlists and goes on to fetch segments', async () => {
    mockAxiosGet.mockResolvedValue({
      data: playlist('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'),
    });

    await expect(download()).rejects.toThrow('segment request');
  });

  it('refuses SAMPLE-AES playlists', async () => {
    mockAxiosGet.mockResolvedValue({
      data: playlist('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"'),
    });

    await expect(download()).rejects.toThrow('Encrypted HLS (SAMPLE-AES)');
  });

  it('refuses byte range playlists', async () => {
    mockAxiosGet.mockResolvedValue({
      data: playlist('#EXT-X-BYTERANGE:1000@0'),
    });

    await expect(download()).rejects.toThrow('byte range');
  });

  it('does not refuse a key tag with METHOD=NONE', async () => {
    mockAxiosGet.mockResolvedValue({
      data: playlist('#EXT-X-KEY:METHOD=NONE'),
    });

    await expect(download()).rejects.toThrow('segment request');
    expect(mockDownloadFile.mock.calls[0][0].fromUrl).toBe(
      'https://example.com/segment0.ts',
    );
  });
});

describe('hlsDownloader2 progress', () => {
  it('reports real bytes, an estimated total and the stream bitrate guess', async () => {
    mockAxiosGet.mockImplementation(async (url: string) => ({
      data: url.endsWith('master.m3u8')
        ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmedia.m3u8'
        : [
            '#EXTM3U',
            '#EXTINF:10.0,',
            'a.ts',
            '#EXTINF:10.0,',
            'b.ts',
            '#EXT-X-ENDLIST',
          ].join('\n'),
    }));
    mockDownloadFile.mockImplementation(() => ({
      jobId: 1,
      promise: Promise.resolve({statusCode: 200, bytesWritten: 1_000_000}),
    }) as never);
    const updates: Array<{done: number; bytes: number; total: number}> = [];

    await hlsDownloader2({
      videoUrl: 'https://example.com/master.m3u8',
      downloadId: 'progress',
      path: '/cache/progress.mp4',
      title: 'Show',
      onProgress: (done, _count, stats) =>
        updates.push({done, bytes: stats.bytes, total: stats.estimatedTotal}),
    });

    // Before any segment: 800 kbit/s for 20 s is about 2 MB.
    expect(updates[0]).toEqual({done: 0, bytes: 0, total: 2_000_000});
    const last = updates[updates.length - 1];
    expect(last.bytes).toBe(2_000_000);
    expect(last.total).toBeGreaterThanOrEqual(last.bytes);
  });
});

describe('hlsDownloader2 pause', () => {
  it('starts no new segments while paused and finishes after resume', async () => {
    mockAxiosGet.mockImplementation(async () => ({
      data: ['#EXTM3U', '#EXTINF:10.0,', 'a.ts', '#EXTINF:10.0,', 'b.ts', '#EXT-X-ENDLIST'].join('\n'),
    }));
    mockDownloadFile.mockClear();
    mockDownloadFile.mockImplementation(() => ({
      jobId: 1,
      promise: Promise.resolve({statusCode: 200, bytesWritten: 10}),
    }) as never);

    const finished = hlsDownloader2({
      videoUrl: 'https://example.com/pause.m3u8',
      downloadId: 'pause-me',
      path: '/cache/pause.mp4',
      title: 'Show',
    });
    pauseHlsDownload('pause-me');
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(mockDownloadFile).not.toHaveBeenCalled();

    resumeHlsDownload('pause-me');
    await finished;
    expect(mockDownloadFile).toHaveBeenCalledTimes(2);
  });
});
