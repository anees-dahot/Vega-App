import {
  findTitleOnProviders,
  getCachedAvailability,
  isSameTitle,
  pickEpisode,
  pickSameTitle,
  pickSeasonGroup,
  resolveEpisodeOnProvider,
  setCachedAvailability,
  AVAILABILITY_TTL_MS,
} from '../src/lib/providers/crossProvider';
import type {EpisodeLink, Info, Link, Post} from '../src/lib/providers/types';

const post = (title: string, link = `https://x/${title}`): Post => ({title, link, image: ''});

describe('isSameTitle', () => {
  it('accepts the same title with different case, punctuation or a year', () => {
    expect(isSameTitle('Spider-Man: No Way Home', 'spider man no way home')).toBe(true);
    expect(isSameTitle('Dune', 'Dune (2021)')).toBe(true);
    expect(isSameTitle('Dune 2021', 'Dune')).toBe(true);
  });

  it('rejects sequels, other seasons and other entries of a franchise', () => {
    expect(isSameTitle('Titanic', 'Titanic II')).toBe(false);
    expect(isSameTitle('Attack on Titan', 'Attack on Titan Season 2')).toBe(false);
    expect(isSameTitle('Attack on Titan Season 2', 'Attack on Titan Season 2')).toBe(true);
    expect(isSameTitle('Frozen', 'Frozen 2')).toBe(false);
    expect(isSameTitle('Naruto', 'Naruto Shippuden')).toBe(false);
  });

  it('rejects unrelated titles', () => {
    expect(isSameTitle('Breaking Bad', 'Better Call Saul')).toBe(false);
  });
});

describe('pickSameTitle', () => {
  it('chooses the closest of the matching posts and ignores the rest', () => {
    const picked = pickSameTitle('Dune', [post('Dune 2'), post('Dune: Part Two'), post('Dune (2021)'), post('Dune')]);
    expect(picked?.title).toBe('Dune');
    expect(pickSameTitle('Dune', [post('Other')])).toBeNull();
  });
});

describe('findTitleOnProviders', () => {
  const providers = [
    {value: 'a', display_name: 'A'},
    {value: 'b', display_name: 'B'},
    {value: 'c', display_name: 'C'},
    {value: 'd', display_name: 'D'},
  ];

  it('keeps providers that have it, skips failures and the excluded one', async () => {
    const search = jest.fn(async (value: string) => {
      if (value === 'a') return [post('Dune')];
      if (value === 'b') throw new Error('down');
      if (value === 'c') return [post('Dune: Part Two')];
      return [post('Dune (2021)')];
    });
    const matches = await findTitleOnProviders({title: 'Dune', providers, search, excludeValue: 'a'});
    expect(matches.map(m => m.providerValue)).toEqual(['d']);
    expect(matches[0].exact).toBe(true);
    expect(search).not.toHaveBeenCalledWith('a', expect.anything(), undefined);
  });

  it('gives up on a provider that is too slow', async () => {
    const search = (value: string) =>
      value === 'a' ? new Promise<Post[]>(() => undefined) : Promise.resolve([post('Dune')]);
    const matches = await findTitleOnProviders({
      title: 'Dune',
      providers: providers.slice(0, 2),
      search,
      timeoutMs: 20,
    });
    expect(matches.map(m => m.providerValue)).toEqual(['b']);
  });

  it('returns nothing for an empty title', async () => {
    expect(await findTitleOnProviders({title: '  ', providers, search: async () => []})).toEqual([]);
  });
});

describe('availability cache', () => {
  it('remembers a result for a while', () => {
    const matches = [{providerValue: 'a', providerName: 'A', post: post('Dune'), exact: true}];
    setCachedAvailability('Dune (2021)', matches, 1000);
    expect(getCachedAvailability('dune', 1000 + 5)).toEqual(matches);
    expect(getCachedAvailability('dune', 1000 + AVAILABILITY_TTL_MS + 1)).toBeUndefined();
    expect(getCachedAvailability('other', 1000)).toBeUndefined();
  });
});

describe('pickSeasonGroup and pickEpisode', () => {
  const links = (titles: string[]): Link[] => titles.map(title => ({title, directLinks: []})) as Link[];
  const eps = (titles: string[]): EpisodeLink[] => titles.map((title, i) => ({title, link: `l${i}`}));

  it('finds the wanted season and refuses to guess among several', () => {
    const groups = links(['Season 1', 'Season 2']);
    expect(pickSeasonGroup(groups, 2)?.title).toBe('Season 2');
    expect(pickSeasonGroup(groups, 3)).toBeUndefined();
    expect(pickSeasonGroup(links(['1080p']), 1)?.title).toBe('1080p');
    expect(pickSeasonGroup(links(['1080p']), 2)).toBeUndefined();
    expect(pickSeasonGroup([], 1)).toBeUndefined();
  });

  it('finds an episode by number, and marks a place-based guess as not exact', () => {
    expect(pickEpisode(eps(['Episode 1', 'Episode 2', 'Episode 3']), {number: 2})).toEqual({index: 1, exact: true});
    expect(pickEpisode(eps(['Pilot', 'Cat', 'Dog']), {number: 2})).toEqual({index: 1, exact: false});
    expect(pickEpisode(eps(['Episode 1', 'Episode 2']), {number: 9})).toBeUndefined();
    expect(pickEpisode(eps(['Pilot']), {})).toEqual({index: 0, exact: true});
    expect(pickEpisode(eps(['A', 'B']), {})).toBeUndefined();
  });
});

describe('resolveEpisodeOnProvider', () => {
  const match = {providerValue: 'b', providerName: 'B', post: post('Show', 'https://b/show'), exact: true};
  const info = (linkList: Link[]): Info =>
    ({title: 'Show', image: '', synopsis: '', type: 'series', linkList}) as Info;

  it('finds the episode in a listed season', async () => {
    const result = await resolveEpisodeOnProvider({
      match,
      type: 'series',
      season: 2,
      episodeNumber: 3,
      getInfo: async () =>
        info([
          {title: 'Season 1', directLinks: [{title: 'Episode 1', link: 'x'}]},
          {title: 'Season 2', directLinks: [{title: 'Episode 3', link: 'y'}, {title: 'Episode 4', link: 'z'}]},
        ] as Link[]),
      getEpisodes: async () => [],
    });
    expect(result).toMatchObject({providerValue: 'b', seasonTitle: 'Season 2', linkIndex: 0, certain: true});
    expect(result?.episodeList[0].link).toBe('y');
  });

  it('loads episodes from a link when the season does not list them', async () => {
    const getEpisodes = jest.fn(async () => [
      {title: 'Episode 1', link: 'e1'},
      {title: 'Episode 2', link: 'e2'},
    ]);
    const result = await resolveEpisodeOnProvider({
      match,
      type: 'series',
      season: 1,
      episodeNumber: 2,
      getInfo: async () => info([{title: 'Season 1', episodesLink: 'https://b/eps'} as Link]),
      getEpisodes,
    });
    expect(getEpisodes).toHaveBeenCalledWith('https://b/eps', 'b');
    expect(result?.linkIndex).toBe(1);
  });

  it('is not certain when the season was a guess or the title is not identical', async () => {
    const list = info([{title: 'Season 1', directLinks: [{title: 'Episode 1', link: 'x'}]}, {title: 'Season 2', directLinks: []}] as Link[]);
    const guessed = await resolveEpisodeOnProvider({
      match,
      type: 'series',
      episodeNumber: 1,
      getInfo: async () => list,
      getEpisodes: async () => [],
    });
    expect(guessed?.certain).toBe(false);
    const loose = await resolveEpisodeOnProvider({
      match: {...match, exact: false},
      type: 'series',
      season: 1,
      episodeNumber: 1,
      getInfo: async () => list,
      getEpisodes: async () => [],
    });
    expect(loose?.certain).toBe(false);
  });

  it('returns null when the episode is not there', async () => {
    const result = await resolveEpisodeOnProvider({
      match,
      type: 'series',
      season: 1,
      episodeNumber: 9,
      getInfo: async () => info([{title: 'Season 1', directLinks: [{title: 'Episode 1', link: 'x'}]}] as Link[]),
      getEpisodes: async () => [],
    });
    expect(result).toBeNull();
  });

  it('takes the first link of a movie', async () => {
    const result = await resolveEpisodeOnProvider({
      match,
      type: 'movie',
      getInfo: async () => info([{title: '1080p', directLinks: [{title: 'Play', link: 'm'}]}] as Link[]),
      getEpisodes: async () => [],
    });
    expect(result?.episodeList[0].link).toBe('m');
    expect(result?.certain).toBe(true);
  });
});
