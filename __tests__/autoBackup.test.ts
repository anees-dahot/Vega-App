const mockStore: Record<string, unknown> = {};
const mockCreateFile = jest.fn(async (_folder: string, name: string) => `content://folder/${name}.json`);
const mockWrite = jest.fn(async () => undefined);
const mockDelete = jest.fn(async () => undefined);
const mockRead = jest.fn(async () => '{}');
let mockListing: string[] = [];

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    createFileAsync: (...args: unknown[]) => mockCreateFile(...(args as [string, string])),
    writeAsStringAsync: (...args: unknown[]) => mockWrite(...(args as [])),
    deleteAsync: (...args: unknown[]) => mockDelete(...(args as [])),
    readAsStringAsync: (...args: unknown[]) => mockRead(...(args as [])),
    readDirectoryAsync: async () => mockListing,
  },
}));
jest.mock('../src/lib/downloadLocation', () => ({
  getSafEntryName: (uri: string) => uri.split('/').pop() as string,
}));
jest.mock('../src/lib/storage', () => ({
  settingsStorage: {
    getAutoBackupFolder: () => (mockStore.folder as string) || '',
    isAutoBackupEnabled: () => Boolean(mockStore.enabled),
    getAutoBackupIntervalDays: () => (mockStore.days as number) || 7,
    getAutoBackupLastAt: () => (mockStore.last as number) || 0,
    setAutoBackupLastAt: (value: number) => {
      mockStore.last = value;
    },
  },
}));
const mockRestore = jest.fn();
jest.mock('../src/lib/backup', () => ({
  createBackup: () => ({app: 'vega', version: 1}),
  parseBackup: (text: string) => JSON.parse(text),
  restoreBackup: (...args: unknown[]) => mockRestore(...args),
}));

import {
  getAutoBackupFileName,
  isAutoBackupDue,
  restoreLatestAutoBackup,
  runAutoBackup,
  selectBackupsToDelete,
} from '../src/lib/autoBackup';

const DAY = 24 * 60 * 60 * 1000;

describe('backup schedule', () => {
  it('is due when never made, or when the interval has passed', () => {
    const now = 1_700_000_000_000;
    expect(isAutoBackupDue(now, 0, 7)).toBe(true);
    expect(isAutoBackupDue(now, (now - 3 * DAY) / 1000, 7)).toBe(false);
    expect(isAutoBackupDue(now, (now - 7 * DAY) / 1000, 7)).toBe(true);
    // A daily backup is not pushed a day later by being a few minutes early.
    expect(isAutoBackupDue(now, (now - DAY + 10 * 60 * 1000) / 1000, 1)).toBe(true);
    expect(isAutoBackupDue(now, (now - DAY / 2) / 1000, 1)).toBe(false);
  });

  it('names a file by date and time', () => {
    expect(getAutoBackupFileName(new Date(2026, 9, 5, 7, 4))).toBe('vega-auto-backup-2026-10-05-0704');
  });

  it('keeps the newest few and ignores files that are not automatic backups', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter, index) => ({
      name: `vega-auto-backup-2026-10-0${index + 1}-0000`,
      letter,
    }));
    const other = {name: 'holiday-photo.jpg'};
    const old = selectBackupsToDelete([...files, other], 5);
    expect(old.map(file => file.name)).toEqual([
      'vega-auto-backup-2026-10-02-0000',
      'vega-auto-backup-2026-10-01-0000',
    ]);
  });
});

describe('runAutoBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStore).forEach(key => delete mockStore[key]);
    mockListing = [];
  });

  it('does nothing when it is off, has no folder, or is not due', async () => {
    await expect(runAutoBackup()).resolves.toBe('skipped');
    mockStore.folder = 'content://folder';
    await expect(runAutoBackup()).resolves.toBe('skipped');
    mockStore.enabled = true;
    mockStore.last = Date.now() / 1000;
    await expect(runAutoBackup()).resolves.toBe('skipped');
    expect(mockCreateFile).not.toHaveBeenCalled();
  });

  it('writes a backup, records the time and removes the oldest ones', async () => {
    mockStore.folder = 'content://folder';
    mockStore.enabled = true;
    mockListing = [1, 2, 3, 4, 5, 6, 7].map(
      day => `content://folder/vega-auto-backup-2026-09-0${day}-0000.json`,
    );
    const now = new Date(2026, 9, 5, 12, 0);

    await expect(runAutoBackup({now})).resolves.toBe('done');

    expect(mockCreateFile).toHaveBeenCalledWith(
      'content://folder',
      'vega-auto-backup-2026-10-05-1200',
      'application/json',
    );
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('.json'), expect.stringContaining('"app": "vega"'));
    expect(mockStore.last).toBe(now.getTime() / 1000);
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it('can be forced even when off, and reports a failure without throwing', async () => {
    mockStore.folder = 'content://folder';
    await expect(runAutoBackup({force: true})).resolves.toBe('done');

    mockCreateFile.mockRejectedValueOnce(new Error('no space'));
    await expect(runAutoBackup({force: true})).resolves.toBe('failed');
  });
});

describe('restoreLatestAutoBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockStore).forEach(key => delete mockStore[key]);
  });

  it('restores the newest backup in the folder', async () => {
    mockStore.folder = 'content://folder';
    mockListing = [
      'content://folder/vega-auto-backup-2026-10-01-0000.json',
      'content://folder/vega-auto-backup-2026-10-04-0000.json',
      'content://folder/other.json',
    ];
    mockRead.mockResolvedValueOnce('{"app":"vega","version":1}');

    await expect(restoreLatestAutoBackup()).resolves.toBe('vega-auto-backup-2026-10-04-0000.json');
    expect(mockRead).toHaveBeenCalledWith('content://folder/vega-auto-backup-2026-10-04-0000.json');
    expect(mockRestore).toHaveBeenCalledWith({app: 'vega', version: 1});
  });

  it('says there is nothing to restore with no folder or no backups', async () => {
    await expect(restoreLatestAutoBackup()).resolves.toBeUndefined();
    mockStore.folder = 'content://folder';
    mockListing = ['content://folder/other.json'];
    await expect(restoreLatestAutoBackup()).resolves.toBeUndefined();
    expect(mockRestore).not.toHaveBeenCalled();
  });
});
