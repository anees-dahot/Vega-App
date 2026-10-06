import {describe, expect, it} from '@jest/globals';
import {
  audioRecordId,
  describeAudioSkipped,
  planBulkAudio,
} from '../src/lib/download/bulkAudio';
import {checkDurations} from '../src/lib/download/audioMerge';
import type {BulkContext, BulkEpisode} from '../src/lib/download/bulkPlan';
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

const context: BulkContext = {
  providerValue: 'dub',
  infoUrl: 'https://dub/show',
  showName: 'Show',
  seasonTitle: 'Season 1',
  resolveType: 'series',
};

const episode = (n: number): BulkEpisode => ({
  id: `Show_Season 1_${n - 1}`,
  link: `https://dub/ep${n}`,
  title: `Show Episode ${n}`,
  fileBaseName: `Show Episode ${n}`,
  episodeName: `Episode ${n}`,
  episodeIndex: n - 1,
  mediaType: 'series',
  watched: false,
});

const video = (n: number, extra: Partial<DownloadItem> = {}) =>
  item({
    id: `orig-${n}`,
    showName: 'Show',
    title: `Show Episode ${n}`,
    seasonTitle: 'Season 1',
    episodeName: `Episode ${n}`,
    episodeIndex: n - 1,
    ...extra,
  });

describe('planBulkAudio', () => {
  it('matches each episode to its finished video', () => {
    const downloads = {a: video(1), b: video(2)};
    const plan = planBulkAudio(context, [episode(1), episode(2), episode(3)], 'Hindi', 'hin', downloads);
    expect(plan.toQueue.map(e => [e.episode.episodeName, e.target.id])).toEqual([
      ['Episode 1', 'orig-1'],
      ['Episode 2', 'orig-2'],
    ]);
    expect(plan.toQueue[0].id).toBe(audioRecordId(episode(1).id, 'Hindi'));
    expect(plan.skipped.map(s => [s.episode.episodeName, s.reason])).toEqual([['Episode 3', 'no-video']]);
    expect(describeAudioSkipped(plan)).toBe('1 not downloaded yet');
  });

  it('skips videos that already have the language and audio already queued', () => {
    const downloads = {
      a: video(1, {audioTracks: [{label: 'Hindi', language: 'hin'}]}),
      b: video(2),
      [audioRecordId(episode(2).id, 'Hindi')]: item({
        id: audioRecordId(episode(2).id, 'Hindi'),
        status: 'queued',
        audioFor: 'orig-2',
        showName: 'Show',
        episodeName: 'Episode 2',
      }),
    };
    const plan = planBulkAudio(context, [episode(1), episode(2)], 'Hindi', 'hin', downloads);
    expect(plan.toQueue).toEqual([]);
    expect(plan.skipped.map(s => s.reason)).toEqual(['has-audio', 'queued']);
  });

  it('does not guess between seasons that both have the episode', () => {
    const noSeason = {...context, seasonTitle: undefined};
    const downloads = {
      a: video(1, {id: 'one', seasonTitle: 'Season 1'}),
      b: video(1, {id: 'two', seasonTitle: 'Season 2'}),
    };
    const ambiguous = planBulkAudio(noSeason, [episode(1)], 'Hindi', 'hin', downloads);
    expect(ambiguous.skipped[0].reason).toBe('ambiguous');
    // With the season known, the right one is chosen.
    const known = planBulkAudio(context, [episode(1)], 'Hindi', 'hin', downloads);
    expect(known.toQueue[0].target.id).toBe('one');
  });

  it('takes one copy when the same episode is downloaded twice in the same season', () => {
    const downloads = {
      a: video(1, {id: 'old', seasonTitle: 'Season 1', completedAt: 1}),
      b: video(1, {id: 'new', seasonTitle: 'Season 1', completedAt: 2}),
    };
    const plan = planBulkAudio(context, [episode(1)], 'Hindi', 'hin', downloads);
    expect(plan.toQueue[0].target.id).toBe('new');
    expect(plan.skipped).toEqual([]);
  });

  it('never adds audio to a download that is itself audio, or not finished', () => {
    const downloads = {
      a: video(1, {status: 'downloading'}),
      b: video(1, {id: 'x', audioFor: 'other'}),
    };
    const plan = planBulkAudio(context, [episode(1)], 'Hindi', 'hin', downloads);
    expect(plan.toQueue).toEqual([]);
  });
});

describe('checkDurations', () => {
  it('accepts close lengths and unknown ones', () => {
    expect(checkDurations(1440, 1443)).toBeNull();
    expect(checkDurations(0, 1443)).toBeNull();
    expect(checkDurations(1440, 0)).toBeNull();
  });

  it('refuses audio that would drift, saying which way', () => {
    expect(checkDurations(1440, 1500)).toBe('The audio is 60s longer than the video, so it would not stay in sync');
    expect(checkDurations(1440, 1400)).toContain('40s shorter');
  });
});
