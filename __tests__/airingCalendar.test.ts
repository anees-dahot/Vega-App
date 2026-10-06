import {
  AIRING_CACHE_TTL_MS,
  buildCalendar,
  daysUntil,
  describeAirDay,
  formatEpisodeCode,
  loadAiringEntries,
  normalizeTitle,
  pickTmdbMatch,
} from '../src/lib/library/airingCalendar';

describe('titles and matches', () => {
  it('compares titles ignoring case, years and punctuation', () => {
    expect(normalizeTitle('The Show: Reloaded (2021) [HD]')).toBe('the show reloaded');
  });

  it('prefers the exact name, else the first result', () => {
    const results = [{name: 'Other Show'}, {name: 'The Show!'}];
    expect(pickTmdbMatch(results, 'the show')).toBe(results[1]);
    expect(pickTmdbMatch(results, 'nothing like it')).toBe(results[0]);
    expect(pickTmdbMatch([], 'x')).toBeUndefined();
    expect(pickTmdbMatch([{original_name: 'Shingeki'}], 'Shingeki')).toBeDefined();
  });
});

describe('days', () => {
  it('counts days between dates, across month ends', () => {
    expect(daysUntil('2026-03-01', '2026-02-28')).toBe(1);
    expect(daysUntil('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysUntil('2026-10-01', '2026-10-05')).toBe(-4);
  });

  it('describes a day for people', () => {
    expect(describeAirDay('2026-10-05', '2026-10-05')).toBe('Today');
    expect(describeAirDay('2026-10-06', '2026-10-05')).toBe('Tomorrow');
    expect(describeAirDay('2026-10-04', '2026-10-05')).toBe('Yesterday');
    expect(describeAirDay('2026-10-09', '2026-10-05')).toBe('In 4 days');
    expect(describeAirDay('2026-10-02', '2026-10-05')).toBe('3 days ago');
    expect(describeAirDay('2026-12-25', '2026-10-05')).toBe('2026-12-25');
  });

  it('writes an episode code', () => {
    expect(formatEpisodeCode({date: 'x', season: 2, episode: 5})).toBe('S02E05');
  });
});

describe('buildCalendar', () => {
  const ep = (date: string, season = 1, episode = 1) => ({date, season, episode});
  const entries = [
    {link: 'a', title: 'Alpha', next: ep('2026-10-05'), last: ep('2026-10-01')},
    {link: 'b', title: 'Beta', next: ep('2026-10-08')},
    {link: 'c', title: 'Gamma', next: ep('2026-12-01')},
    {link: 'd', title: 'Delta', last: ep('2026-10-03')},
    {link: 'e', title: 'Epsilon', next: ep('2026-09-01'), last: ep('2026-08-01')},
  ];

  it('groups upcoming episodes by when they air, and lists the recent ones', () => {
    const sections = buildCalendar(entries, '2026-10-05');
    expect(sections.map(s => s.title)).toEqual(['Today', 'This week', 'Later', 'Aired this week']);
    expect(sections[0].entries.map(e => e.title)).toEqual(['Alpha']);
    expect(sections[1].entries.map(e => e.title)).toEqual(['Beta']);
    expect(sections[2].entries.map(e => e.title)).toEqual(['Gamma']);
    // Newest first; Epsilon aired too long ago, and its next date is in the past.
    expect(sections[3].entries.map(e => e.title)).toEqual(['Delta', 'Alpha']);
  });

  it('is empty when nothing is coming or recent', () => {
    expect(buildCalendar([{link: 'x', title: 'X'}], '2026-10-05')).toEqual([]);
  });
});

describe('loadAiringEntries', () => {
  const NOW = 1_000_000_000_000;
  const respond = () =>
    jest.fn(async (url: string) => {
      if (url.includes('/search/tv')) {
        return {results: [{id: 7, name: 'Alpha'}]};
      }
      return {
        status: 'Returning Series',
        poster_path: '/p.jpg',
        next_episode_to_air: {air_date: '2026-10-08', season_number: 2, episode_number: 3, name: 'Next'},
        last_episode_to_air: {air_date: '2026-10-01', season_number: 2, episode_number: 2, name: 'Last'},
      };
    });

  it('finds the show and its next episode, then reuses the answer', async () => {
    const fetchJson = respond();
    const items = [{link: 'https://x/alpha', title: 'Alpha'}];
    const first = await loadAiringEntries(items, {apiKey: 'k', now: NOW, fetchJson});
    expect(first).toEqual([
      {
        link: 'https://x/alpha',
        title: 'Alpha',
        poster: 'https://image.tmdb.org/t/p/w185/p.jpg',
        status: 'Returning Series',
        next: {date: '2026-10-08', season: 2, episode: 3, name: 'Next'},
        last: {date: '2026-10-01', season: 2, episode: 2, name: 'Last'},
      },
    ]);
    expect(fetchJson).toHaveBeenCalledTimes(2);

    await loadAiringEntries(items, {apiKey: 'k', now: NOW + 1000, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(2);

    // After the time limit it asks again.
    await loadAiringEntries(items, {apiKey: 'k', now: NOW + AIRING_CACHE_TTL_MS + 1, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('skips titles TMDB does not know, and keeps going when a request fails', async () => {
    const fetchJson = jest.fn(async (url: string) => {
      if (url.includes('Broken')) {
        throw new Error('network');
      }
      return url.includes('/search/tv') ? {results: []} : {};
    });
    const entries = await loadAiringEntries(
      [
        {link: 'u1', title: 'Unknown'},
        {link: 'u2', title: 'Broken'},
      ],
      {apiKey: 'k', now: NOW + 5, fetchJson},
    );
    expect(entries).toEqual([]);
  });
});
