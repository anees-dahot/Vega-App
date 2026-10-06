const mockShareFile = jest.fn(async () => true);
const mockOpenFolder = jest.fn(async () => true);
const mockToast = jest.fn();

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
  ToastAndroid: {show: (...args: unknown[]) => mockToast(...args), SHORT: 0},
  NativeModules: {
    HttpDownloadModule: {
      shareFile: (...args: unknown[]) => mockShareFile(...(args as [])),
      openFolder: (...args: unknown[]) => mockOpenFolder(...(args as [])),
    },
  },
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadMimeType: (type: string) =>
    type === 'mkv' ? 'video/x-matroska' : 'video/mp4',
}));

import {
  getShareableUri,
  openDownloadFolder,
  shareDownloadedFile,
} from '../src/lib/download/shareFile';

describe('sharing a downloaded file', () => {
  beforeEach(() => jest.clearAllMocks());

  it('finds an address other apps can read', () => {
    expect(getShareableUri({filePath: 'content://doc/1'})).toBe('content://doc/1');
    expect(getShareableUri({filePath: '/storage/a.mp4'})).toBe('file:///storage/a.mp4');
    expect(
      getShareableUri({filePath: '', finalDocumentUri: 'content://doc/2'}),
    ).toBe('content://doc/2');
    expect(getShareableUri({filePath: ''})).toBeUndefined();
    expect(getShareableUri({filePath: 'relative/a.mp4'})).toBeUndefined();
  });

  it('shares with the right file type and name', async () => {
    const shared = await shareDownloadedFile({
      filePath: 'content://doc/1',
      videoType: 'mkv',
      episodeName: 'Episode 1',
      title: 'Show Episode 1',
    });
    expect(shared).toBe(true);
    expect(mockShareFile).toHaveBeenCalledWith(
      'content://doc/1',
      'video/x-matroska',
      'Episode 1',
    );
  });

  it('says so when there is nothing to share, or sharing fails', async () => {
    await expect(
      shareDownloadedFile({filePath: '', videoType: 'mp4', title: 't'}),
    ).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith('This file cannot be shared', 0);

    mockShareFile.mockRejectedValueOnce(new Error('no activity'));
    await expect(
      shareDownloadedFile({filePath: 'content://doc/1', videoType: 'mp4', title: 't'}),
    ).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith('Could not share this file', 0);
  });

  it('opens only a folder the user picked', async () => {
    await expect(
      openDownloadFolder({type: 'saf', uri: 'content://tree/x', label: 'x'}),
    ).resolves.toBe(true);
    expect(mockOpenFolder).toHaveBeenCalledWith('content://tree/x');

    await expect(
      openDownloadFolder({type: 'path', path: '/app/storage', label: 'App'}),
    ).resolves.toBe(false);
    await expect(openDownloadFolder(null)).resolves.toBe(false);
    expect(mockOpenFolder).toHaveBeenCalledTimes(1);
  });
});
