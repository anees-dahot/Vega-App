import {
  buildSnapshot,
  collectEpisodeRefs,
  describeNewEpisodeRefs,
  diffEpisodes,
  hashLink,
  pickLatestLinkedGroup,
  type EpisodeRef,
} from '../src/lib/library/episodeDiff';
import {
  MAX_AUTO_EPISODES_PER_TITLE,
  isSeasonGroup,
  planAutoDownload,
} from '../src/lib/library/autoDownload';
import type {Link} from '../src/lib/providers/types';

const ref = (group: string, n: number, direct = true): EpisodeRef => ({
  group,
  title: `Episode ${n}`,
  link: `https://p/${group}/${n}`,
  index: n - 1,
  direct,
});

describe('diffEpisodes', () => {
  const s1 = [ref('Season 1', 1), ref('Season 1', 2)];

  it('treats the first look as a baseline', () => {
    expect(diffEpisodes(undefined, ['Season 1'], s1)).toEqual({baseline: true, newEpisodes: [], newGroups: []});
  });

  it('finds an episode added inside an existing season', () => {
    const snapshot = buildSnapshot(['Season 1'], s1);
    const diff = diffEpisodes(snapshot, ['Season 1'], [...s1, ref('Season 1', 3)]);
    expect(diff.newEpisodes.map(r => r.title)).toEqual(['Episode 3']);
    expect(diff.newGroups).toEqual([]);
    expect(describeNewEpisodeRefs(diff)).toBe('Episode 3 is available');
  });

  it('finds a new season and counts all its episodes as new', () => {
    const snapshot = buildSnapshot(['Season 1'], s1);
    const s2 = [ref('Season 2', 1), ref('Season 2', 2)];
    const diff = diffEpisodes(snapshot, ['Season 1', 'Season 2'], [...s1, ...s2]);
    expect(diff.newGroups).toEqual(['Season 2']);
    expect(diff.newEpisodes).toHaveLength(2);
    expect(describeNewEpisodeRefs(diff)).toBe('Episodes 1–2 are available');
  });

  it('does not call a season looked into for the first time new', () => {
    // Season 2 was listed before but its episodes were not fetched then.
    const snapshot = buildSnapshot(['Season 1', 'Season 2'], s1, ['Season 1']);
    const diff = diffEpisodes(snapshot, ['Season 1', 'Season 2'], [...s1, ref('Season 2', 1, false)]);
    expect(diff.newEpisodes).toEqual([]);
    expect(describeNewEpisodeRefs(diff)).toBeUndefined();
  });

  it('reports a season with no listed episodes', () => {
    const snapshot = buildSnapshot(['Season 1'], s1);
    const diff = diffEpisodes(snapshot, ['Season 1', 'Season 2'], s1);
    expect(describeNewEpisodeRefs(diff)).toBe('A new season is available');
  });

  it('describes episodes without numbers by count', () => {
    const odd: EpisodeRef[] = [
      {group: 'S', title: 'Pilot', link: 'a', index: 0, direct: true},
      {group: 'S', title: 'Finale', link: 'b', index: 1, direct: true},
    ];
    const diff = diffEpisodes(buildSnapshot(['S'], [], ['S']), ['S'], odd);
    expect(diff.baseline).toBe(false);
    expect(describeNewEpisodeRefs(diff)).toBe('2 new episodes available');
  });

  it('hashes links stably and apart', () => {
    expect(hashLink('a')).toBe(hashLink('a'));
    expect(hashLink('a')).not.toBe(hashLink('b'));
  });
});

describe('collectEpisodeRefs', () => {
  const groups = [
    {title: 'Season 1', directLinks: [{title: 'Episode 1', link: 'x1'}, {title: 'Episode 2', link: 'x2'}]},
    {title: 'Season 2', episodesLink: 'https://p/s2'},
    {title: 'Season 3', episodesLink: 'https://p/s3'},
  ] as Link[];

  it('lists direct episodes and fetches only the latest linked season', async () => {
    const getEpisodes = jest.fn(async () => [{title: 'Episode 1', link: 'y1'}]);
    const {refs, groupTitles, fetchedGroups} = await collectEpisodeRefs({type: 'series', linkList: groups}, getEpisodes);
    expect(getEpisodes).toHaveBeenCalledTimes(1);
    expect(getEpisodes).toHaveBeenCalledWith('https://p/s3');
    expect(groupTitles).toEqual(['Season 1', 'Season 2', 'Season 3']);
    expect(fetchedGroups).toEqual(['Season 1', 'Season 3']);
    expect(refs.map(r => `${r.group}:${r.index}:${r.direct}`)).toEqual([
      'Season 1:0:true',
      'Season 1:1:true',
      'Season 3:0:false',
    ]);
  });

  it('skips movies and picks the highest season', async () => {
    const getEpisodes = jest.fn(async () => []);
    expect((await collectEpisodeRefs({type: 'movie', linkList: groups}, getEpisodes)).refs).toEqual([]);
    expect(getEpisodes).not.toHaveBeenCalled();
    expect(pickLatestLinkedGroup(groups)?.title).toBe('Season 3');
    expect(pickLatestLinkedGroup([{title: 'A', directLinks: []}] as Link[])).toBeUndefined();
  });
});

describe('planAutoDownload', () => {
  const item = {provider: 'vega', link: 'https://p/show', status: 'watching' as const, poster: 'poster.jpg'};
  const base = {item, showName: 'My Show', type: 'series', newEpisodes: [] as EpisodeRef[], groupCount: 2};

  it('queues new episodes of seasons, oldest first, with the same ids the buttons use', () => {
    const plans = planAutoDownload({
      ...base,
      newEpisodes: [ref('Season 2', 4, false), ref('Season 2', 3, false)],
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].context).toMatchObject({providerValue: 'vega', seasonTitle: 'Season 2', poster: 'poster.jpg'});
    expect(plans[0].episodes.map(e => e.episodeIndex)).toEqual([2, 3]);
    expect(plans[0].episodes[0].id).toContain('Season 2');
  });

  it('only acts for titles being watched, series, and seasonal groups', () => {
    expect(planAutoDownload({...base, item: {...item, status: 'planned'}, newEpisodes: [ref('Season 2', 1)]})).toEqual([]);
    expect(planAutoDownload({...base, type: 'movie', newEpisodes: [ref('Season 2', 1)]})).toEqual([]);
    expect(planAutoDownload({...base, newEpisodes: [ref('1080p', 1)]})).toEqual([]);
    expect(planAutoDownload({...base, groupCount: 1, newEpisodes: [ref('1080p', 1)]})).toHaveLength(1);
    expect(isSeasonGroup('720p', 3)).toBe(false);
  });

  it('caps how many are queued at once across seasons', () => {
    const many = Array.from({length: 9}, (_, i) => ref('Season 1', i + 1));
    const plans = planAutoDownload({...base, newEpisodes: many});
    expect(plans.flatMap(p => p.episodes)).toHaveLength(MAX_AUTO_EPISODES_PER_TITLE);
    expect(plans[0].episodes[0].episodeIndex).toBe(0);
  });
});
