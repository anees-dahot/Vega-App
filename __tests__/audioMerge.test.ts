import {describe, expect, it} from '@jest/globals';
import {findAudioTargets, getAudioLanguageCode} from '../src/lib/download/audioMerge';
import type {DownloadItem} from '../src/lib/zustand/downloadsStore';

const item = (over: Partial<DownloadItem>): DownloadItem =>
  ({
    schemaVersion: 1,
    type: 'series',
    url: '',
    sourceType: 'http',
    isTorrent: false,
    filePath: '/x',
    totalBytes: 1,
    downloadedBytes: 1,
    speed: 0,
    canPause: false,
    canResume: false,
    createdAt: 1,
    updatedAt: 1,
    status: 'completed',
    ...over,
  }) as DownloadItem;

describe('getAudioLanguageCode', () => {
  it('maps names and short codes', () => {
    expect(getAudioLanguageCode('Hindi')).toBe('hin');
    expect(getAudioLanguageCode('Japanese (original)')).toBe('jpn');
    expect(getAudioLanguageCode('en')).toBe('eng');
    expect(getAudioLanguageCode('Klingon')).toBe('und');
    expect(getAudioLanguageCode(undefined)).toBe('und');
  });
});

describe('findAudioTargets', () => {
  const downloads = {
    a: item({id: 'a', title: 'Show E1', showName: 'Show', episodeName: 'Episode 1', completedAt: 5}),
    b: item({id: 'b', title: 'Show E2', showName: 'Show', episodeName: 'Episode 2'}),
    c: item({id: 'c', title: 'Show E1 Hindi', showName: 'Show', episodeName: 'Episode 1', status: 'downloading'}),
    d: item({id: 'd', title: 'x', showName: 'Show', episodeName: 'Episode 1', audioFor: 'a'}),
  };

  it('finds the finished video of the same episode only', () => {
    const found = findAudioTargets(downloads, {id: 'new', title: 'Show E1 Hindi', showName: 'Show', episodeName: 'Episode 1', type: 'series'});
    expect(found.map(entry => entry.id)).toEqual(['a']);
  });

  it('finds nothing for an episode that is not downloaded', () => {
    const found = findAudioTargets(downloads, {id: 'new', title: 'Show E3', showName: 'Show', episodeName: 'Episode 3', type: 'series'});
    expect(found).toEqual([]);
  });
});
