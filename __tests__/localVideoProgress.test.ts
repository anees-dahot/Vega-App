import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockStore = new Map<string, unknown>();
jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    getObject: (key: string) => mockStore.get(key),
    setObject: (key: string, value: unknown) => mockStore.set(key, value),
  },
}));
const mockGetUriSize = jest.fn<(uri: string) => Promise<number>>();
jest.mock('react-native', () => ({
  NativeModules: {HttpDownloadModule: {getUriSize: (uri: string) => mockGetUriSize(uri)}},
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(async () => ({exists: false})),
}));

import {
  getLocalVideoIdentity,
  getLocalVideoProgress,
  saveLocalVideoProgress,
} from '../src/lib/localVideoProgress';

describe('local video progress', () => {
  beforeEach(() => {
    mockStore.clear();
    mockGetUriSize.mockReset();
  });

  it('identifies a file by size, whatever its link is', async () => {
    mockGetUriSize.mockResolvedValue(734003200);
    expect(await getLocalVideoIdentity('content://media/picker/0/1')).toBe('local:734003200');
    expect(await getLocalVideoIdentity('content://media/picker/0/2')).toBe('local:734003200');
  });

  it('has no identity when the size cannot be read', async () => {
    mockGetUriSize.mockRejectedValue(new Error('denied'));
    expect(await getLocalVideoIdentity('content://x')).toBeUndefined();
  });

  it('saves and returns where you stopped', () => {
    saveLocalVideoProgress('local:1', 120, 3000, 10);
    expect(getLocalVideoProgress('local:1')).toEqual({position: 120, duration: 3000, updatedAt: 10});
  });

  it('ignores bad values and keeps only the 200 newest files', () => {
    saveLocalVideoProgress('local:bad', NaN, 100);
    saveLocalVideoProgress('local:zero', 5, 0);
    expect(getLocalVideoProgress('local:bad')).toBeUndefined();
    expect(getLocalVideoProgress('local:zero')).toBeUndefined();
    for (let i = 0; i < 205; i++) {
      saveLocalVideoProgress(`local:${i}`, 10, 100, i + 1);
    }
    expect(getLocalVideoProgress('local:0')).toBeUndefined();
    expect(getLocalVideoProgress('local:204')).toBeDefined();
  });
});
