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
jest.mock('expo-document-picker', () => ({getDocumentAsync: jest.fn()}));
jest.mock('../src/lib/uriPermission', () => ({
  takePersistableUriPermission: jest.fn(async () => true),
}));
jest.mock('../src/lib/storage', () => ({settingsStorage: {}}));
jest.mock('react-native', () => ({
  ToastAndroid: {show: jest.fn(), SHORT: 0},
  NativeModules: {},
  Platform: {OS: 'android'},
}));

import * as DocumentPicker from 'expo-document-picker';
import {
  buildLocalPlayerParams,
  getLocalVideoTitle,
  isLocalVideoUrl,
  pickLocalVideo,
} from '../src/lib/localVideo';
import {
  formatSleepRemaining,
  getShowTrackPrefs,
  isSameSleepChoice,
  setShowTrackPref,
  SLEEP_TIMER_OPTIONS,
} from '../src/lib/playerPrefs';
import {
  CHECK_INTERVAL_MS,
  describeNewEpisodes,
  getEpisodeSignature,
  pickTitlesToCheck,
} from '../src/lib/services/newEpisodeCheck';
import {takePersistableUriPermission} from '../src/lib/uriPermission';

describe('local video', () => {
  it('recognizes device file addresses', () => {
    expect(isLocalVideoUrl('content://media/external/video/12')).toBe(true);
    expect(isLocalVideoUrl('file:///sdcard/Movies/a.mkv')).toBe(true);
    expect(isLocalVideoUrl('https://site/a.mkv')).toBe(false);
    expect(isLocalVideoUrl(undefined)).toBe(false);
  });

  it('makes a readable title from a name or a content address', () => {
    expect(getLocalVideoTitle('My.Movie.2024.1080p.mkv')).toBe('My Movie 2024 1080p');
    expect(getLocalVideoTitle('Holiday_clip.mp4')).toBe('Holiday clip');
    expect(
      getLocalVideoTitle(
        'content://com.android.externalstorage.documents/document/primary%3AMovies%2FFilm%20Night.mkv',
      ),
    ).toBe('Film Night');
    expect(getLocalVideoTitle(undefined)).toBe('Local video');
  });

  it('builds player params that play one file with resume by its address', () => {
    const params = buildLocalPlayerParams('content://x/1', 'Film.mkv');
    expect(params).toMatchObject({
      linkIndex: 0,
      directUrl: 'content://x/1',
      type: 'movie',
      primaryTitle: 'Film',
      episodeList: [{title: 'Film', link: 'content://x/1'}],
    });
  });

  it('keeps access to a picked file, and returns null when cancelled', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{uri: 'content://x/2', name: 'Clip.mp4'}],
    });
    await expect(pickLocalVideo()).resolves.toEqual({
      uri: 'content://x/2',
      name: 'Clip.mp4',
    });
    expect(takePersistableUriPermission).toHaveBeenCalledWith('content://x/2');

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: true,
      assets: null,
    });
    await expect(pickLocalVideo()).resolves.toBeNull();
  });
});

describe('player preferences', () => {
  it('remembers audio and subtitle choices per show', () => {
    setShowTrackPref('show-a', 'audio', 'hin');
    setShowTrackPref('show-a', 'text', 'en');
    setShowTrackPref('show-b', 'text', '');

    expect(getShowTrackPrefs('show-a')).toMatchObject({audio: 'hin', text: 'en'});
    // An empty subtitle choice means "off" and must stay different from "unset".
    expect(getShowTrackPrefs('show-b')?.text).toBe('');
    expect(getShowTrackPrefs('show-b')?.audio).toBeUndefined();
    expect(getShowTrackPrefs('other')).toBeUndefined();
    expect(getShowTrackPrefs(undefined)).toBeUndefined();
  });

  it('knows which sleep timer choice is selected', () => {
    const [off, fifteen, , , , episode] = SLEEP_TIMER_OPTIONS;
    expect(isSameSleepChoice(fifteen.value, {kind: 'minutes', minutes: 15})).toBe(true);
    expect(isSameSleepChoice(fifteen.value, {kind: 'minutes', minutes: 30})).toBe(false);
    expect(isSameSleepChoice(off.value, episode.value)).toBe(false);
    expect(isSameSleepChoice(episode.value, {kind: 'episode'})).toBe(true);
  });

  it('shows the time left', () => {
    expect(formatSleepRemaining(1_000_000 + 10 * 60_000, 1_000_000)).toBe('10 min');
    expect(formatSleepRemaining(1_000_000 + 20_000, 1_000_000)).toBe('less than a minute');
    expect(formatSleepRemaining(500, 1_000_000)).toBe('less than a minute');
  });
});

describe('new episode check', () => {
  it('counts what a title page lists', () => {
    expect(
      getEpisodeSignature({
        linkList: [
          {title: 'S1', directLinks: [{title: 'E1', link: 'a'}, {title: 'E2', link: 'b'}]},
          {title: 'S2', episodesLink: 'x'},
        ],
      }),
    ).toEqual({groups: 2, files: 2});
    expect(getEpisodeSignature({linkList: undefined as never})).toEqual({groups: 0, files: 0});
  });

  it('describes what is new, and stays quiet the first time', () => {
    const before = {groups: 1, files: 4};
    expect(describeNewEpisodes(undefined, before)).toBeUndefined();
    expect(describeNewEpisodes(before, before)).toBeUndefined();
    expect(describeNewEpisodes(before, {groups: 1, files: 5})).toBe('1 new episode available');
    expect(describeNewEpisodes(before, {groups: 1, files: 7})).toBe('3 new episodes available');
    expect(describeNewEpisodes(before, {groups: 2, files: 4})).toBe('A new season is available');
    expect(describeNewEpisodes(before, {groups: 1, files: 2})).toBeUndefined();
  });

  it('goes through a long library a few titles at a time', () => {
    const items = Array.from({length: 25}, (_, i) => i);
    const first = pickTitlesToCheck(items, 0, 10);
    expect(first.titles).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const third = pickTitlesToCheck(items, 20, 10);
    expect(third.titles).toEqual([20, 21, 22, 23, 24, 0, 1, 2, 3, 4]);
    expect(third.nextCursor).toBe(5);
    expect(pickTitlesToCheck([], 3).titles).toEqual([]);
    expect(CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('repeat section helpers', () => {
  const {formatClock, isRepeatSectionReady} = require('../src/lib/playerPrefs');

  it('writes a time as minutes or hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(83.9)).toBe('1:23');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('is ready only when the end is after the start', () => {
    expect(isRepeatSectionReady({start: 10, end: 20})).toBe(true);
    expect(isRepeatSectionReady({start: 10, end: 10})).toBe(false);
    expect(isRepeatSectionReady({start: 10, end: null})).toBe(false);
    expect(isRepeatSectionReady({start: null, end: null})).toBe(false);
    expect(isRepeatSectionReady({start: 0, end: 5})).toBe(true);
  });
});
