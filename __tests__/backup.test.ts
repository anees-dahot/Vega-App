import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockValues = new Map<string, unknown>();
const mockContentState = {
  provider: {value: ''} as any,
  setProvider: jest.fn((provider: any) => {
    mockContentState.provider = provider;
  }),
  setInstalledProviders: jest.fn(),
};
const mockSetThemeState = jest.fn();

jest.mock('../src/lib/storage/StorageService', () => ({
  mainStorage: {
    hasKey: (key: string) => mockValues.has(key),
    getBool: (key: string, defaultValue = false) =>
      mockValues.has(key) ? mockValues.get(key) : defaultValue,
    setBool: (key: string, value: boolean) => mockValues.set(key, value),
    getString: (key: string) => mockValues.get(key),
    setString: (key: string, value: string) => mockValues.set(key, value),
    getNumber: (key: string) => mockValues.get(key),
    setNumber: (key: string, value: number) => mockValues.set(key, value),
    getArray: (key: string) => mockValues.get(key),
    setArray: (key: string, value: unknown[]) => mockValues.set(key, value),
    getObject: (key: string) => mockValues.get(key),
    setObject: (key: string, value: unknown) => mockValues.set(key, value),
    delete: (key: string) => mockValues.delete(key),
  },
}));

jest.mock('../src/lib/downloadLocation', () => ({
  getDownloadLocationDisplayValue: () => 'Not selected',
  parseDownloadLocation: () => null,
  serializeDownloadLocation: () => '',
}));

jest.mock('../src/lib/zustand/contentStore', () => ({
  __esModule: true,
  default: {getState: () => mockContentState},
}));

jest.mock('../src/lib/zustand/themeStore', () => ({
  __esModule: true,
  default: {setState: (state: unknown) => mockSetThemeState(state)},
}));

jest.mock('expo-document-picker', () => ({getDocumentAsync: jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {},
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

import {
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  restoreBackup,
} from '../src/lib/backup';

const provider = {
  value: 'vega',
  display_name: 'Vega',
  type: 'global',
  installed: true,
  disabled: false,
  version: '1.0.0',
  icon: '',
  source: {author: 'vega', url: 'https://example.com'},
};

describe('backup', () => {
  beforeEach(() => {
    mockValues.clear();
    mockContentState.provider = {value: ''};
    jest.clearAllMocks();
  });

  it('includes only saved settings and skips device specific ones', () => {
    mockValues.set('hapticFeedback', false);
    mockValues.set('useExternalPlayer', true);
    mockValues.set('subtitleFontSize', 20);
    mockValues.set('excludedQualities', ['480p']);
    mockValues.set('downloadLocation', 'content://tree/primary');
    mockValues.set('launcherIcon', 'dark');

    const backup = createBackup();

    expect(backup.app).toBe('vega');
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.settings).toEqual({
      hapticFeedback: false,
      useExternalPlayer: true,
      subtitleFontSize: 20,
      excludedQualities: ['480p'],
    });
  });

  it('restores settings, providers and the selected provider', () => {
    mockValues.set('hapticFeedback', false);
    mockValues.set('installedProviders', [provider]);
    mockValues.set('providerSources', [
      {author: 'vega', url: 'https://example.com'},
    ]);
    mockValues.set('providerModules', [
      {value: 'vega', version: '1.0.0', modules: {posts: 'code'}, cachedAt: 1},
    ]);
    mockValues.set('disabledProviders', ['other']);
    mockContentState.provider = provider;

    const backup = parseBackup(JSON.stringify(createBackup()));
    mockValues.clear();
    mockContentState.provider = {value: ''};

    restoreBackup(backup);

    expect(mockValues.get('hapticFeedback')).toBe(false);
    expect(mockValues.get('installedProviders')).toEqual([provider]);
    expect(mockValues.get('providerSources')).toHaveLength(1);
    expect(mockValues.get('providerModules')).toHaveLength(1);
    expect(mockValues.get('disabledProviders')).toEqual(['other']);
    expect(mockContentState.setInstalledProviders).toHaveBeenCalledWith([
      provider,
    ]);
    expect(mockContentState.provider).toEqual(provider);
    expect(mockSetThemeState.mock.invocationCallOrder[0]).toBeLessThan(
      mockContentState.setProvider.mock.invocationCallOrder[0],
    );
  });

  it('ignores settings with the wrong type and unknown keys', () => {
    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      settings: {
        hapticFeedback: 'yes',
        subtitleFontSize: 18,
        downloadLocation: 'content://tree/primary',
        somethingElse: true,
      },
      providers: {installed: [], sources: [], modules: []},
    });

    expect(mockValues.has('hapticFeedback')).toBe(false);
    expect(mockValues.get('subtitleFontSize')).toBe(18);
    expect(mockValues.has('downloadLocation')).toBe(false);
    expect(mockValues.has('somethingElse')).toBe(false);
  });

  it('skips providers missing fields the UI needs', () => {
    const withoutType = {...provider, type: undefined};

    restoreBackup({
      app: 'vega',
      version: BACKUP_VERSION,
      createdAt: '',
      settings: {},
      providers: {
        installed: [provider, withoutType as any],
        sources: [],
        modules: [],
      },
    });

    expect(mockValues.get('installedProviders')).toEqual([provider]);
  });

  it('rejects files that are not a Vega backup', () => {
    expect(() => parseBackup('not json')).toThrow('not a Vega backup');
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow(
      'not a Vega backup',
    );
    expect(() =>
      parseBackup(JSON.stringify({app: 'vega', version: BACKUP_VERSION + 1})),
    ).toThrow('newer version');
    expect(() =>
      parseBackup(JSON.stringify({app: 'vega', version: BACKUP_VERSION})),
    ).toThrow('incomplete');
  });

  describe('library and newer settings', () => {
    const saved = {
      title: 'Show',
      poster: 'p.jpg',
      link: 'https://x/show',
      provider: 'vega',
      status: 'watching',
      rating: 8,
      note: 'good',
      collections: ['watchlist', 'c1'],
    };
    const collection = {id: 'c1', name: 'Anime', icon: 'star', createdAt: 1, updatedAt: 1};
    const empty = (extra: object) => ({
      app: 'vega' as const,
      version: BACKUP_VERSION,
      createdAt: '',
      settings: {},
      providers: {installed: [], sources: [], modules: []},
      ...extra,
    });

    it('includes the library with each title\'s status, rating and note', () => {
      mockValues.set('watchlist', [saved]);
      mockValues.set('library-collections', [collection]);

      const backup = createBackup();

      expect(backup.library).toEqual({items: [saved], collections: [collection]});
    });

    it('restores the library, skipping entries that are not valid', () => {
      restoreBackup(
        empty({
          library: {
            items: [saved, {title: 'No link'}],
            collections: [collection, {name: 'No id'}],
          },
        }) as never,
      );

      expect(mockValues.get('watchlist')).toEqual([saved]);
      expect(mockValues.get('library-collections')).toEqual([collection]);
    });

    it('leaves the current library alone when the backup has none', () => {
      mockValues.set('watchlist', [saved]);

      restoreBackup(empty({}) as never);

      expect(mockValues.get('watchlist')).toEqual([saved]);
    });

    it('keeps download rules, server rules and player choices', () => {
      const rules = {vega: {order: [{key: 'gdrive', label: 'GDrive'}], onNoMatch: 'auto', updatedAt: 1}};
      mockValues.set('downloadServerRules.provider', rules);
      mockValues.set('playerShowTrackPrefs', {show: {audio: 'hin', updatedAt: 1}});
      mockValues.set('downloadWifiOnly', true);
      mockValues.set('downloadConnections', 8);

      const backup = createBackup();
      mockValues.clear();
      restoreBackup(backup);

      expect(mockValues.get('downloadServerRules.provider')).toEqual(rules);
      expect(mockValues.get('playerShowTrackPrefs')).toEqual({show: {audio: 'hin', updatedAt: 1}});
      expect(mockValues.get('downloadWifiOnly')).toBe(true);
      expect(mockValues.get('downloadConnections')).toBe(8);
    });

    it('ignores a rule setting that is not an object', () => {
      restoreBackup(
        empty({settings: {'downloadServerRules.provider': 'oops', 'downloadServerRules.series': ['x']}}) as never,
      );
      expect(mockValues.has('downloadServerRules.provider')).toBe(false);
      expect(mockValues.has('downloadServerRules.series')).toBe(false);
    });
  });
});
