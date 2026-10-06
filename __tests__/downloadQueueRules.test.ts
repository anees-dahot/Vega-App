const mockBackendStart = jest.fn(async (_context: unknown) => undefined);
const mockBackendCancel = jest.fn(async () => undefined);
const mockBackendCleanup = jest.fn(async () => undefined);
const mockGetStream = jest.fn(async (_options: unknown) => [] as unknown[]);
const mockGetStartGate = jest.fn(async () => ({allowed: true}) as unknown);
let mockDownloadConcurrency = 1;
const mockLocation = {
  type: 'saf' as const,
  uri: 'content://downloads/tree',
  label: 'Downloads',
};

jest.mock('../src/lib/downloadBackends/registry', () => ({
  getDownloadBackend: () => ({
    start: mockBackendStart,
    cancel: mockBackendCancel,
    cleanup: mockBackendCleanup,
  }),
}));

let mockFinishedSize = 5_000_000;
const mockDeleteOutput = jest.fn(async () => true);

jest.mock('../src/lib/downloadDestination', () => ({
  deleteDownloadOutput: (...args: unknown[]) => mockDeleteOutput(...(args as [])),
  prepareDownloadDestination: async () => ({
    stagingDirectory: '/cache/downloads/x',
    stagingPath: '/cache/downloads/x/file.part',
  }),
  finalizeDownloadOutput: async () => ({
    filePath: 'content://downloads/file.mkv',
    finalDocumentUri: 'content://downloads/file.mkv',
    size: mockFinishedSize,
  }),
  cleanupDownloadStaging: async () => undefined,
}));

jest.mock('../src/lib/downloadLocation', () => ({
  ensureDownloadLocationAccess: async (location: unknown) => location,
  isSafDownloadLocation: () => true,
  getDownloadFileName: (name: string, type: string) => `${name}.${type}`,
}));

jest.mock('../src/lib/services/Notification', () => ({
  QUEUE_KEEPALIVE_ID: '__download_queue__',
  notificationService: {
    ensureDownloadPermission: jest.fn(async () => true),
    startForegroundTask: jest.fn(),
    hasForegroundTask: jest.fn(() => false),
    stopForegroundTask: jest.fn(async () => undefined),
    showDownloadStarting: jest.fn(async () => undefined),
    showDownloadQueued: jest.fn(async () => undefined),
    showDownloadProgress: jest.fn(async () => undefined),
    showDownloadComplete: jest.fn(async () => undefined),
    showDownloadFailed: jest.fn(async () => undefined),
    showBatchProgress: jest.fn(async () => undefined),
    cancelNotification: jest.fn(async () => undefined),
  },
}));

jest.mock('../src/lib/imageAccent', () => ({
  getImageAccent: jest.fn(async () => '#ffffff'),
}));

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getDownloadLocationConfig: () => mockLocation,
    getDownloadConcurrency: () => mockDownloadConcurrency,
    getPrimaryColor: () => '#ffffff',
    setDownloadLocation: jest.fn(),
    isDownloadSubtitlesEnabled: () => true,
    getDownloadSubtitleLanguage: () => 'en',
  },
  cacheStorage: {getString: () => undefined},
}));

jest.mock('../src/lib/services/ProviderManager', () => ({
  providerManager: {getStream: (options: unknown) => mockGetStream(options)},
}));

jest.mock('../src/lib/download/downloadPolicy', () => ({
  getStartGate: () => mockGetStartGate(),
  applyNativeDownloadPolicy: jest.fn(),
}));

jest.mock('react-native-mmkv-storage', () => ({
  MMKVLoader: class {
    withInstanceID() {
      return this;
    }
    initialize() {
      const store = new Map<string, string>();
      return {
        getString: (key: string) => store.get(key),
        setString: (key: string, value: string) => store.set(key, value),
        getBool: () => undefined,
        setBool: () => undefined,
        getInt: () => undefined,
        setInt: () => undefined,
        removeItem: (key: string) => store.delete(key),
        clearStore: () => store.clear(),
      };
    }
  },
}));

import {
  cancelBatch,
  enqueueBulkDownload,
  pauseBatch,
  resumeBatch,
  retryFailedInBatch,
  type BulkContext,
  type BulkEpisode,
} from '../src/lib/download/bulkDownload';
import {isExpiredLinkError} from '../src/lib/download/resolveDownload';
import {serverRulesStorage, toRuleEntry} from '../src/lib/download/serverRules';
import {
  moveQueuedDownload,
  orderQueuedDownloads,
  prioritizeDownload,
  scheduleQueuedDownloads,
  startQueuedDownloadNow,
} from '../src/lib/downloadManager';
import {notificationService} from '../src/lib/services/Notification';
import useDownloadsStore, {
  type DownloadItem,
  type DownloadInput,
} from '../src/lib/zustand/downloadsStore';

const location = mockLocation;

class FakeXhr {
  static responses: Record<string, {status: number; headers?: Record<string, string>}> = {};
  readyState = 0;
  status = 0;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = '';
  private headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return this.headers[name.toLowerCase()] ?? null;
  }
  abort() {}
  send() {
    const response = FakeXhr.responses[this.url] ?? {
      status: 206,
      headers: {'content-range': 'bytes 0-0/1000', 'content-type': 'video/x-matroska'},
    };
    setTimeout(() => {
      this.status = response.status;
      this.headers = response.headers ?? {};
      this.readyState = 2;
      this.onreadystatechange?.();
    }, 0);
  }
}
(global as unknown as {XMLHttpRequest: unknown}).XMLHttpRequest = FakeXhr;

// Waits on timers, since the fake network check answers from a timer.
const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
};

const queued = (id: string, extra: Partial<DownloadInput> = {}) =>
  useDownloadsStore.getState().enqueueDownload({
    id,
    title: id,
    type: 'series',
    url: `https://old/${id}`,
    sourceType: 'http',
    videoType: 'mkv',
    downloadLocation: location,
    status: 'queued',
    ...extra,
  });

const get = (id: string): DownloadItem =>
  useDownloadsStore.getState().downloads[id];

const startedIds = () =>
  mockBackendStart.mock.calls.map(
    call => (call[0] as {record: DownloadItem}).record.id,
  );

const stream = (server: string, extra: Record<string, unknown> = {}) => ({
  server,
  link: `https://new/${server}`,
  type: 'mkv',
  ...extra,
});

describe('download queue rules', () => {
  afterEach(async () => {
    // Clear waiting retries so their timers don't outlive the test.
    useDownloadsStore.setState({downloads: {}});
    await scheduleQueuedDownloads();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadsStore.setState({downloads: {}});
    FakeXhr.responses = {};
    mockDownloadConcurrency = 1;
    mockFinishedSize = 5_000_000;
    mockBackendStart.mockResolvedValue(undefined);
    mockGetStartGate.mockResolvedValue({allowed: true});
    mockGetStream.mockResolvedValue([]);
  });

  it('starts by priority, then queue order, and leaves held downloads', async () => {
    queued('a', {createdAt: 1});
    queued('b', {createdAt: 2, priority: 5});
    queued('c', {createdAt: 3, held: true});

    await scheduleQueuedDownloads();
    await flush();

    expect(startedIds()).toEqual(['b', 'a']);
    expect(get('c').status).toBe('queued');
  });

  it('moves a download to the front of the queue', async () => {
    mockGetStartGate.mockResolvedValue({allowed: false, reason: 'wifi'});
    queued('a', {createdAt: 1});
    queued('b', {createdAt: 2});
    await prioritizeDownload('b');
    expect(get('b').priority).toBeGreaterThan(get('a').priority ?? 0);

    mockGetStartGate.mockResolvedValue({allowed: true});
    await scheduleQueuedDownloads();
    await flush();
    expect(startedIds()[0]).toBe('b');
  });

  it('moves a queued download one place at a time and keeps that order', async () => {
    mockGetStartGate.mockResolvedValue({allowed: false, reason: 'wifi'});
    queued('a', {createdAt: 1});
    queued('b', {createdAt: 2});
    queued('c', {createdAt: 3});
    const order = () =>
      orderQueuedDownloads(Object.values(useDownloadsStore.getState().downloads)).map(
        item => item.id,
      );

    await moveQueuedDownload('c', 'up');
    expect(order()).toEqual(['a', 'c', 'b']);
    await moveQueuedDownload('a', 'down');
    expect(order()).toEqual(['c', 'a', 'b']);
    // The ends cannot move further.
    await moveQueuedDownload('c', 'up');
    await moveQueuedDownload('b', 'down');
    expect(order()).toEqual(['c', 'a', 'b']);

    mockGetStartGate.mockResolvedValue({allowed: true});
    await scheduleQueuedDownloads();
    await flush();
    expect(startedIds()).toEqual(['c', 'a', 'b']);
  });

  it('holds queued downloads while the start gate is closed, but not "start now"', async () => {
    mockGetStartGate.mockResolvedValue({allowed: false, reason: 'wifi'});
    queued('a', {createdAt: 1});
    queued('b', {createdAt: 2});

    await scheduleQueuedDownloads();
    await flush();
    expect(mockBackendStart).not.toHaveBeenCalled();
    expect(get('a').queuedReason).toBe('wifi');

    await startQueuedDownloadNow('b');
    expect(startedIds()).toContain('b');

    mockGetStartGate.mockResolvedValue({allowed: true});
    await scheduleQueuedDownloads();
    await flush();
    expect(get('a').status).toBe('completed');
    expect(get('a').queuedReason).toBeUndefined();
  });

  it('looks up the link with the saved rule when its turn comes', async () => {
    serverRulesStorage.setSeriesRule('vega', 'https://site/show', {
      order: [toRuleEntry('GDrive')],
      onNoMatch: 'auto',
      updatedAt: 0,
    });
    mockGetStream.mockResolvedValue([
      stream('CF Worker'),
      stream('GDrive', {
        subtitles: [{title: 'English', language: 'en', type: 'text/vtt', uri: 'https://sub/en.vtt'}],
      }),
    ]);
    queued('ep1', {
      url: '',
      needsResolve: true,
      provider: 'vega',
      infoUrl: 'https://site/show',
      sourceLink: 'https://site/ep1',
      resolveType: 'series',
      fileBaseName: 'Show Ep 1',
      videoType: null,
    });

    await scheduleQueuedDownloads();
    await flush(20);

    const started = mockBackendStart.mock.calls[0][0] as {record: DownloadItem};
    expect(mockGetStream).toHaveBeenCalledWith(
      expect.objectContaining({link: 'https://site/ep1', isDownload: true}),
    );
    expect(started.record).toMatchObject({
      url: 'https://new/GDrive',
      server: 'GDrive',
      needsResolve: false,
      displayFileName: 'Show Ep 1.mkv',
    });
    expect(get('ep1').status).toBe('completed');
    expect(get('ep1_subtitle_English')).toBeDefined();
  });

  it('retries an episode later when no saved server works', async () => {
    serverRulesStorage.setSeriesRule('vega', 'https://site/show', {
      order: [toRuleEntry('GDrive')],
      onNoMatch: 'skip',
      updatedAt: 0,
    });
    mockGetStream.mockResolvedValue([stream('CF Worker')]);
    queued('ep1', {
      url: '',
      needsResolve: true,
      provider: 'vega',
      infoUrl: 'https://site/show',
      sourceLink: 'https://site/ep1',
    });

    await scheduleQueuedDownloads();
    await flush(20);

    expect(mockBackendStart).not.toHaveBeenCalled();
    // No server now: waits and tries again later instead of failing.
    expect(get('ep1')).toMatchObject({status: 'queued', autoRetries: 1});
    expect(get('ep1').retryAt).toBeGreaterThan(Date.now());
  });

  it('treats "ask" as "skip" in a bulk download', async () => {
    serverRulesStorage.setSeriesRule('vega', 'https://site/show', {
      order: [toRuleEntry('GDrive')],
      onNoMatch: 'ask',
      updatedAt: 0,
    });
    mockGetStream.mockResolvedValue([stream('CF Worker')]);
    queued('ep1', {
      url: '',
      needsResolve: true,
      provider: 'vega',
      infoUrl: 'https://site/show',
      sourceLink: 'https://site/ep1',
    });

    await scheduleQueuedDownloads();
    await flush(20);
    expect(get('ep1')).toMatchObject({status: 'queued', autoRetries: 1});
  });

  it('gets a new link when the old one expires, and carries on', async () => {
    mockBackendStart
      .mockRejectedValueOnce(new Error('HTTP 403'))
      .mockResolvedValue(undefined);
    mockGetStream.mockResolvedValue([stream('GDrive')]);
    queued('ep1', {
      server: 'GDrive',
      provider: 'vega',
      infoUrl: 'https://site/show',
      sourceLink: 'https://site/ep1',
    });

    await scheduleQueuedDownloads();
    await flush(20);

    expect(mockGetStream).toHaveBeenCalledTimes(1);
    expect(mockBackendStart).toHaveBeenCalledTimes(2);
    const second = mockBackendStart.mock.calls[1][0] as {record: DownloadItem};
    expect(second.record.url).toBe('https://new/GDrive');
    expect(get('ep1')).toMatchObject({status: 'completed', linkRecoveries: 1});
    expect(mockBackendCleanup).not.toHaveBeenCalledWith('ep1', expect.anything());
  });

  it('keeps a partial file only when the new link is the same server and size', async () => {
    mockBackendStart
      .mockRejectedValueOnce(new Error('HTTP 410'))
      .mockResolvedValue(undefined);
    mockGetStream.mockResolvedValue([stream('GDrive')]);
    FakeXhr.responses['https://new/GDrive'] = {
      status: 206,
      headers: {'content-range': 'bytes 0-0/1000', 'content-type': 'video/mp4'},
    };
    queued('same', {
      server: 'GDrive',
      provider: 'vega',
      infoUrl: 'u',
      sourceLink: 'l',
      downloadedBytes: 400,
      totalBytes: 1000,
    });

    await scheduleQueuedDownloads();
    await flush(20);
    expect(mockBackendCleanup).not.toHaveBeenCalledWith('same', expect.anything());
  });

  it('throws a partial file away when the new link is another server', async () => {
    mockBackendStart
      .mockRejectedValueOnce(new Error('HTTP 403'))
      .mockResolvedValue(undefined);
    mockGetStream.mockResolvedValue([stream('Pixeldrain')]);
    queued('moved', {
      server: 'GDrive',
      provider: 'vega',
      infoUrl: 'u',
      sourceLink: 'l',
      downloadedBytes: 400,
      totalBytes: 1000,
      finalDocumentUri: 'content://partial',
    });

    await scheduleQueuedDownloads();
    await flush(20);

    expect(mockBackendCleanup).toHaveBeenCalledWith('moved', expect.anything());
    expect(get('moved').status).toBe('completed');
    const second = mockBackendStart.mock.calls[1][0] as {record: DownloadItem};
    expect(second.record.server).toBe('Pixeldrain');
    expect(second.record.downloadedBytes).toBe(0);
  });

  it('waits and retries when no other server is left after a replacement link also fails', async () => {
    mockBackendStart.mockRejectedValue(new Error('HTTP 403'));
    mockGetStream.mockResolvedValue([stream('GDrive')]);
    queued('only', {provider: 'vega', infoUrl: 'u', sourceLink: 'l', server: 'GDrive'});
    await scheduleQueuedDownloads();
    await flush(30);
    expect(mockBackendStart).toHaveBeenCalledTimes(2);
    expect(get('only')).toMatchObject({status: 'queued', autoRetries: 1});
  });

  it('stops replacing links past the limit, then retries the download later', async () => {
    mockBackendStart.mockRejectedValue(new Error('Disk full'));
    queued('ep1', {provider: 'vega', infoUrl: 'u', sourceLink: 'l'});
    await scheduleQueuedDownloads();
    await flush(20);
    expect(mockGetStream).not.toHaveBeenCalled();
    expect(get('ep1')).toMatchObject({status: 'queued', autoRetries: 1});
    expect(get('ep1').errorMessage).toMatch(/Disk full/);

    mockBackendStart.mockReset();
    mockBackendStart.mockRejectedValue(new Error('HTTP 403'));
    // After the first replacement, the server that just failed is avoided.
    mockGetStream.mockResolvedValue([stream('GDrive'), stream('Pixeldrain')]);
    queued('ep2', {provider: 'vega', infoUrl: 'u', sourceLink: 'l'});
    await scheduleQueuedDownloads();
    await flush(40);
    // The first try plus three replacements.
    expect(mockBackendStart).toHaveBeenCalledTimes(4);
    expect(get('ep2')).toMatchObject({status: 'queued', autoRetries: 1});
  });

  it('starts a waiting retry only once its time comes, with a fresh link', async () => {
    mockBackendStart.mockRejectedValueOnce(new Error('Disk full'));
    mockGetStream.mockResolvedValue([stream('GDrive')]);
    queued('r1', {provider: 'vega', infoUrl: 'u', sourceLink: 'l'});
    await scheduleQueuedDownloads();
    await flush(20);
    expect(get('r1')).toMatchObject({status: 'queued', autoRetries: 1, needsResolve: true});

    // Not due yet: nothing starts.
    await scheduleQueuedDownloads();
    await flush(20);
    expect(mockBackendStart).toHaveBeenCalledTimes(1);

    useDownloadsStore.getState().updateDownload('r1', {retryAt: Date.now() - 1});
    await scheduleQueuedDownloads();
    await flush(30);
    expect(mockBackendStart).toHaveBeenCalledTimes(2);
    expect(mockGetStream).toHaveBeenCalled();
    expect(get('r1').status).toBe('completed');
    expect(get('r1').autoRetries).toBeUndefined();
  });

  it('waits longer after each failed retry', async () => {
    mockBackendStart.mockRejectedValue(new Error('Disk full'));
    queued('r2', {provider: 'vega', infoUrl: 'u', sourceLink: 'l'});
    await scheduleQueuedDownloads();
    await flush(20);
    const firstWait = get('r2').retryAt! - Date.now();
    useDownloadsStore.getState().updateDownload('r2', {retryAt: Date.now() - 1});
    mockGetStream.mockResolvedValue([stream('GDrive')]);
    await scheduleQueuedDownloads();
    await flush(30);
    const secondWait = get('r2').retryAt! - Date.now();
    expect(get('r2').autoRetries).toBe(2);
    expect(secondWait).toBeGreaterThan(firstWait);
  });

  it('removes a file that is clearly not a video and retries later', async () => {
    mockFinishedSize = 2_000; // an error page saved as a file
    queued('page', {provider: 'vega', infoUrl: 'u', sourceLink: 'l'});

    await scheduleQueuedDownloads();
    await flush(20);

    expect(get('page')).toMatchObject({status: 'queued', autoRetries: 1});
    expect(get('page').errorMessage).toMatch(/too small/);
    expect(mockDeleteOutput).toHaveBeenCalledWith(
      'content://downloads/file.mkv',
      expect.anything(),
    );
  });

  it('sends one batch notification instead of one per episode', async () => {
    queued('ep1', {batchId: 'b1', batchTitle: 'Show · S1'});

    await scheduleQueuedDownloads();
    await flush(20);

    expect(notificationService.showDownloadComplete).not.toHaveBeenCalled();
    expect(notificationService.showBatchProgress).toHaveBeenCalledWith(
      'b1',
      'Show · S1',
      expect.objectContaining({done: 1, total: 1, finished: true}),
    );
  });
});

describe('bulk download', () => {
  const context: BulkContext = {
    providerValue: 'vega',
    infoUrl: 'https://site/show',
    showName: 'My Show',
    seasonTitle: 'Season 1',
    resolveType: 'series',
    poster: 'https://img/p.jpg',
  };
  const episodes: BulkEpisode[] = [1, 2, 3].map(n => ({
    id: `My Show_SSeason 1_E${n}`,
    link: `https://site/ep${n}`,
    title: `My Show Episode ${n}`,
    fileBaseName: `My Show Episode ${n}`,
    episodeName: `Episode ${n}`,
    episodeIndex: n - 1,
    mediaType: 'series',
    watched: false,
  }));
  const batchItems = () =>
    Object.values(useDownloadsStore.getState().downloads).filter(
      item => item.batchId,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadsStore.setState({downloads: {}});
    FakeXhr.responses = {};
    mockDownloadConcurrency = 1;
    mockBackendStart.mockResolvedValue(undefined);
    mockGetStream.mockResolvedValue([]);
    mockGetStartGate.mockResolvedValue({allowed: false, reason: 'schedule'});
  });

  afterEach(async () => {
    // Open the gate so the queue timer stops.
    mockGetStartGate.mockResolvedValue({allowed: true});
    await cancelBatch(batchItems()[0]?.batchId || 'none');
    await scheduleQueuedDownloads();
    await flush(10);
  });

  it('queues every episode without looking anything up yet', async () => {
    const result = await enqueueBulkDownload(context, episodes);

    expect(result.queued).toBe(3);
    expect(mockGetStream).not.toHaveBeenCalled();
    const items = batchItems();
    expect(items).toHaveLength(3);
    expect(new Set(items.map(item => item.batchId)).size).toBe(1);
    expect(items[0]).toMatchObject({
      status: 'queued',
      needsResolve: true,
      url: '',
      provider: 'vega',
      infoUrl: 'https://site/show',
      sourceLink: 'https://site/ep1',
      resolveType: 'series',
      batchTitle: 'My Show · Season 1',
    });
    // Queued in the order given.
    expect(items.map(item => item.episodeName)).toEqual([
      'Episode 1',
      'Episode 2',
      'Episode 3',
    ]);
  });

  it('holds and releases the whole batch', async () => {
    const {batchId} = await enqueueBulkDownload(context, episodes);
    await pauseBatch(batchId!);
    expect(batchItems().every(item => item.held)).toBe(true);

    mockGetStartGate.mockResolvedValue({allowed: true});
    await scheduleQueuedDownloads();
    await flush(10);
    expect(mockBackendStart).not.toHaveBeenCalled();

    await resumeBatch(batchId!);
    await flush(60);
    expect(mockGetStream).toHaveBeenCalled();
    expect(batchItems().every(item => !item.held)).toBe(true);
  });

  it('re-queues failed episodes with a fresh link lookup', async () => {
    const {batchId} = await enqueueBulkDownload(context, episodes);
    const failedId = episodes[1].id;
    useDownloadsStore.getState().markError(failedId, {
      code: 'NO_SERVER',
      message: 'None of the saved servers are available',
    });

    await retryFailedInBatch(batchId!);

    expect(useDownloadsStore.getState().downloads[failedId]).toMatchObject({
      status: 'queued',
      needsResolve: true,
      errorCode: undefined,
    });
  });

  it('cancels what has not finished and keeps finished episodes', async () => {
    const {batchId} = await enqueueBulkDownload(context, episodes);
    useDownloadsStore.getState().markCompleted(episodes[0].id, {
      filePath: 'content://done.mkv',
    });

    await cancelBatch(batchId!);

    const remaining = batchItems();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('completed');
  });

  it('re-queues a failed episode instead of starting a second copy', async () => {
    await enqueueBulkDownload(context, [episodes[0]]);
    useDownloadsStore.getState().markError(episodes[0].id, {message: 'boom'});
    useDownloadsStore.getState().updateDownload(episodes[0].id, {
      downloadedBytes: 300,
      finalDocumentUri: 'content://partial',
    });

    await enqueueBulkDownload(context, [episodes[0]]);

    const [item] = batchItems();
    expect(batchItems()).toHaveLength(1);
    expect(item).toMatchObject({
      status: 'queued',
      needsResolve: true,
      downloadedBytes: 300,
      finalDocumentUri: 'content://partial',
    });
  });
});

describe('isExpiredLinkError', () => {
  it('recognizes dead links but not other failures', () => {
    expect(isExpiredLinkError(new Error('HTTP 403'))).toBe(true);
    expect(isExpiredLinkError(new Error('Request failed with status code 410'))).toBe(true);
    expect(isExpiredLinkError(new Error('Link expired'))).toBe(true);
    expect(isExpiredLinkError(new Error('Unable to write to the SAF destination'))).toBe(false);
    expect(isExpiredLinkError(new Error('HTTP 500'))).toBe(false);
  });
});
