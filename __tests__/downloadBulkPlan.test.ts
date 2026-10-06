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

import type {Stream} from '../src/lib/providers/types';
import {
  describeSkipped,
  evaluateStorage,
  getEpisodeDownloadState,
  planBulkDownload,
  selectNextUnwatched,
  type BulkContext,
  type BulkEpisode,
} from '../src/lib/download/bulkPlan';
import {
  findDuplicateDownload,
  getEpisodeIdentity,
  isSameEpisode,
  parseEpisodeNumber,
  parseSeasonNumber,
} from '../src/lib/download/duplicates';
import {isMinuteInWindow} from '../src/lib/download/downloadPolicy';
import {
  describeServerHealth,
  getServerHealth,
  recordServerOutcome,
  scoreServerHealth,
  sortByHealth,
} from '../src/lib/download/serverHealth';
import {
  applyQualityPreference,
  describeRule,
  parseStreamQuality,
} from '../src/lib/download/serverRules';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

jest.mock('../src/lib/storage', () => ({
  settingsStorage: {},
  cacheStorage: {getString: () => undefined},
}));

const context: BulkContext = {
  providerValue: 'vega',
  infoUrl: 'https://site/show',
  showName: 'My Show',
  seasonTitle: 'Season 1',
  resolveType: 'series',
};

const episode = (n: number, watched = false): BulkEpisode => ({
  id: `My Show_SSeason 1_E${n}`,
  link: `https://site/ep${n}`,
  title: `My Show Episode ${n}`,
  fileBaseName: `My Show Episode ${n}`,
  episodeName: `Episode ${n}`,
  episodeIndex: n - 1,
  mediaType: 'series',
  watched,
});

const download = (overrides: Partial<DownloadItem>): DownloadItem =>
  ({
    schemaVersion: 1,
    id: 'x',
    title: 'My Show Episode 1',
    type: 'series',
    url: 'https://f',
    sourceType: 'http',
    isTorrent: false,
    filePath: '',
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
    status: 'completed',
    canPause: false,
    canResume: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }) as DownloadItem;

const stream = (server: string, quality?: string): Stream => ({
  server,
  link: `https://x/${server}`,
  type: 'mkv',
  quality,
});

describe('bulk plan', () => {
  const episodes = [1, 2, 3, 4, 5].map(n => episode(n));

  it('skips what is downloaded or queued under the same id', () => {
    const downloads = {
      [episodes[0].id]: download({id: episodes[0].id, status: 'completed'}),
      [episodes[1].id]: download({id: episodes[1].id, status: 'downloading'}),
      [episodes[2].id]: download({id: episodes[2].id, status: 'error'}),
    };
    const plan = planBulkDownload(context, episodes, {}, downloads);
    expect(plan.toQueue.map(e => e.episodeName)).toEqual([
      'Episode 3',
      'Episode 4',
      'Episode 5',
    ]);
    expect(plan.skipped.map(s => s.reason)).toEqual(['downloaded', 'queued']);
    expect(describeSkipped(plan)).toBe('1 already downloaded, 1 already queued');
  });

  it('skips an episode downloaded from another provider unless allowed', () => {
    const downloads = {
      other: download({
        id: 'other',
        provider: 'drive',
        showName: 'my show',
        seasonTitle: 'S01 720p',
        episodeName: 'Ep 2',
        episodeIndex: 7,
      }),
    };
    const skipped = planBulkDownload(context, episodes, {}, downloads);
    expect(skipped.toQueue.map(e => e.episodeName)).not.toContain('Episode 2');
    expect(skipped.skipped[0]).toMatchObject({reason: 'duplicate', via: 'drive'});

    const allowed = planBulkDownload(
      context,
      episodes,
      {allowDuplicates: true},
      downloads,
    );
    expect(allowed.toQueue).toHaveLength(5);
  });

  it('reports an episode state from its download', () => {
    const downloads = {a: download({id: 'a', status: 'interrupted'})};
    expect(getEpisodeDownloadState('a', downloads)).toBe('failed');
    expect(getEpisodeDownloadState('missing', downloads)).toBe('none');
  });
});

describe('selectNextUnwatched', () => {
  const eps = [
    {id: '1', watched: true},
    {id: '2', watched: true},
    {id: '3', watched: false},
    {id: '4', watched: false},
    {id: '5', watched: false},
  ];

  it('takes the episodes after the last watched one', () => {
    expect(selectNextUnwatched(eps, 2, () => 'none')).toEqual(['3', '4']);
  });

  it('leaves out episodes that are already downloaded', () => {
    expect(
      selectNextUnwatched(eps, 3, id => (id === '4' ? 'completed' : 'none')),
    ).toEqual(['3', '5']);
  });

  it('starts from the first episode when nothing was watched', () => {
    const fresh = eps.map(e => ({...e, watched: false}));
    expect(selectNextUnwatched(fresh, 2, () => 'none')).toEqual(['1', '2']);
  });
});

describe('evaluateStorage', () => {
  const GB = 1024 ** 3;

  it('allows a batch that leaves the free space to keep', () => {
    expect(evaluateStorage(4, GB, 10 * GB, GB).enough).toBe(true);
  });

  it('blocks a batch that eats into the free space to keep', () => {
    const result = evaluateStorage(4, 2 * GB, 8.5 * GB, GB);
    expect(result).toMatchObject({enough: false, neededBytes: 8 * GB});
  });

  it('allows when free space or size is unknown', () => {
    expect(evaluateStorage(4, GB, undefined, GB).enough).toBe(true);
    expect(evaluateStorage(4, undefined, 2 * GB, GB).enough).toBe(true);
  });
});

describe('episode identity', () => {
  it('reads season and episode numbers from provider titles', () => {
    expect(parseSeasonNumber('Season 2')).toBe(2);
    expect(parseSeasonNumber('S03 1080p')).toBe(3);
    expect(parseEpisodeNumber('Episode 12')).toBe(12);
    expect(parseEpisodeNumber('E05 - Pilot')).toBe(5);
    expect(parseEpisodeNumber('Ep 7')).toBe(7);
    expect(parseEpisodeNumber('Pilot')).toBeUndefined();
  });

  it('matches the same episode across providers but not different ones', () => {
    const a = getEpisodeIdentity({
      title: 't',
      type: 'series',
      showName: 'My Show!',
      seasonTitle: 'Season 1',
      episodeName: 'Episode 3',
    });
    const b = getEpisodeIdentity({
      title: 't',
      type: 'series',
      showName: 'my show',
      seasonTitle: 'S01 480p',
      episodeName: 'E03',
    });
    const c = getEpisodeIdentity({...a, showName: 'my show', episodeName: 'E04'} as never);
    expect(isSameEpisode(a, b)).toBe(true);
    expect(isSameEpisode(a, c)).toBe(false);
  });

  it('does not call an episode a duplicate of itself', () => {
    const item = download({
      id: 'same',
      showName: 'My Show',
      episodeName: 'Episode 1',
      seasonTitle: 'Season 1',
    });
    expect(findDuplicateDownload(item, {same: item})).toBeUndefined();
    expect(
      findDuplicateDownload({...item, id: 'new'}, {same: item})?.kind,
    ).toBe('completed');
  });
});

describe('quality preference', () => {
  const streams = [
    stream('A', '2160'),
    stream('B', '1080p'),
    stream('C', '720'),
    stream('D'),
  ];

  it('reads quality labels', () => {
    expect(parseStreamQuality('1080p')).toBe(1080);
    expect(parseStreamQuality('4K')).toBe(2160);
    expect(parseStreamQuality(undefined)).toBeUndefined();
  });

  it('keeps the best quality at or below the preference, and unlabelled streams', () => {
    expect(applyQualityPreference(streams, '1080').map(s => s.server)).toEqual([
      'B',
      'D',
    ]);
    expect(applyQualityPreference(streams, '480').map(s => s.server)).toEqual([
      'C',
      'D',
    ]);
  });

  it('leaves everything for "any" or when no stream has a quality', () => {
    expect(applyQualityPreference(streams, 'any')).toHaveLength(4);
    const unlabelled = [stream('A'), stream('B')];
    expect(applyQualityPreference(unlabelled, '720')).toHaveLength(2);
  });

  it('shows the quality in a rule summary', () => {
    expect(describeRule({order: [], quality: '720'})).toBe('Best available · 720p');
  });
});

describe('download schedule window', () => {
  it('handles a window inside one day', () => {
    const window = {start: 60, end: 420};
    expect(isMinuteInWindow(120, window)).toBe(true);
    expect(isMinuteInWindow(420, window)).toBe(false);
    expect(isMinuteInWindow(30, window)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    const window = {start: 22 * 60, end: 6 * 60};
    expect(isMinuteInWindow(23 * 60, window)).toBe(true);
    expect(isMinuteInWindow(2 * 60, window)).toBe(true);
    expect(isMinuteInWindow(12 * 60, window)).toBe(false);
  });
});

describe('server health', () => {
  it('scores reliable, fast servers above failing ones', () => {
    const good = {ok: 8, fail: 0, speed: 4 * 1024 * 1024, updatedAt: 0};
    const bad = {ok: 1, fail: 6, speed: 8 * 1024 * 1024, updatedAt: 0};
    expect(scoreServerHealth(good)).toBeGreaterThan(scoreServerHealth(bad));
    expect(scoreServerHealth(undefined)).toBeGreaterThan(scoreServerHealth(bad));
  });

  it('records outcomes per provider and server name', () => {
    recordServerOutcome('vega', 'GDrive [1GB]', {
      success: true,
      speed: 2 * 1024 * 1024,
    });
    recordServerOutcome('vega', 'GDrive [2GB]', {success: false});
    const entry = getServerHealth('vega', 'gdrive');
    expect(entry).toMatchObject({ok: 1, fail: 1});
    expect(describeServerHealth(entry)).toBe('50% worked · 2.0 MB/s');
    expect(getServerHealth('drive', 'gdrive')).toBeUndefined();
  });

  it('sorts servers by health and keeps the order of equals', () => {
    recordServerOutcome('p', 'Slow', {success: false});
    recordServerOutcome('p', 'Fast', {success: true, speed: 9 * 1024 * 1024});
    const sorted = sortByHealth('p', ['Slow', 'New1', 'Fast', 'New2'], n => n);
    expect(sorted).toEqual(['Fast', 'New1', 'New2', 'Slow']);
  });
});

describe('subtitle choice for downloads', () => {
  const sub = (language: string, title: string, uri = `https://s/${title}.vtt`) => ({
    language: language as never,
    title,
    type: 'text/vtt' as never,
    uri,
  });
  const {pickDownloadSubtitle} = require('../src/lib/download/subtitlePick');

  it('takes the one in the preferred language', () => {
    const subs = [sub('fr', 'French'), sub('en', 'English'), sub('es', 'Spanish')];
    expect(pickDownloadSubtitle(subs, 'en').title).toBe('English');
    expect(pickDownloadSubtitle(subs, 'es').title).toBe('Spanish');
  });

  it('recognizes a language by its name or a regional code', () => {
    expect(pickDownloadSubtitle([sub('xx', 'Hindi forced'), sub('de', 'German')], 'hi').title).toBe('Hindi forced');
    expect(pickDownloadSubtitle([sub('pt-BR', 'Português'), sub('en', 'English')], 'pt').title).toBe('Português');
  });

  it('falls back to the first subtitle, and ignores ones without an address', () => {
    expect(pickDownloadSubtitle([sub('fr', 'French'), sub('de', 'German')], 'en').title).toBe('French');
    expect(pickDownloadSubtitle([sub('en', 'English', '')], 'en')).toBeUndefined();
    expect(pickDownloadSubtitle(undefined, 'en')).toBeUndefined();
  });
});

describe('verifyFinishedDownload', () => {
  const {verifyFinishedDownload} = require('../src/lib/download/verify');
  const video = {id: 'v', sourceType: 'http', isSubtitle: false};
  const MB = 1024 * 1024;

  it('accepts a complete file', () => {
    expect(verifyFinishedDownload(video, 700 * MB, 700 * MB)).toBeUndefined();
    expect(verifyFinishedDownload(video, 700 * MB, 0)).toBeUndefined();
    // A little over is fine; only a clear shortfall is an error.
    expect(verifyFinishedDownload(video, 700 * MB + 10, 700 * MB)).toBeUndefined();
    expect(verifyFinishedDownload(video, 700 * MB - 500, 700 * MB)).toBeUndefined();
  });

  it('rejects empty, cut-off and error-page files', () => {
    expect(verifyFinishedDownload(video, 0, 700 * MB)).toMatch(/empty/);
    expect(verifyFinishedDownload(video, 300 * MB, 700 * MB)).toMatch(/incomplete/);
    expect(verifyFinishedDownload(video, 2000, 0)).toMatch(/too small/);
  });

  it('leaves subtitles, streams and torrents alone', () => {
    expect(verifyFinishedDownload({...video, isSubtitle: true}, 500, 0)).toBeUndefined();
    expect(verifyFinishedDownload({...video, id: 'x_subtitle_en'}, 500, 0)).toBeUndefined();
    expect(verifyFinishedDownload({...video, sourceType: 'hls'}, 500, 0)).toBeUndefined();
    expect(verifyFinishedDownload({...video, sourceType: 'torrent'}, 500, 0)).toBeUndefined();
  });

  it('does not judge small expected sizes', () => {
    expect(verifyFinishedDownload(video, 100, 500)).toBeUndefined();
  });
});
