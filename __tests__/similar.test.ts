import {loadSimilarTitles, MAX_SIMILAR, SIMILAR_TTL_MS} from '../src/lib/library/similar';

const entry = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: title,
  first_air_date: '2020-05-01',
  poster_path: `/p${id}.jpg`,
  ...extra,
});

describe('loadSimilarTitles', () => {
  it('uses the TMDB id, drops the title itself and shapes the entries', async () => {
    const fetchJson = jest.fn(async (url: string) => {
      expect(url).toContain('/tv/100/recommendations');
      return {results: [entry(100, 'Self'), entry(2, 'Other'), entry(3, 'Same name'), {id: 4}]};
    });
    const items = await loadSimilarTitles(
      {tmdbId: 100, type: 'series', title: 'Same Name'},
      {apiKey: 'k', fetchJson, now: 1},
    );
    expect(items).toEqual([
      {id: 2, mediaType: 'tv', title: 'Other', year: '2020', poster: 'https://image.tmdb.org/t/p/w342/p2.jpg'},
    ]);
  });

  it('finds the id from an IMDb id, preferring the wanted type', async () => {
    const fetchJson = jest.fn(async (url: string) => {
      if (url.includes('/find/')) {
        return {tv_results: [{id: 7}], movie_results: [{id: 8}]};
      }
      return {results: [entry(9, 'Nine', {name: undefined, title: 'Nine'})]};
    });
    const items = await loadSimilarTitles({imdbId: 'tt1', type: 'movie'}, {apiKey: 'k', fetchJson, now: 2});
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining('/movie/8/recommendations'));
    expect(items[0].mediaType).toBe('movie');
  });

  it('falls back to "similar" when there are no recommendations, and caches the answer', async () => {
    const fetchJson = jest.fn(async (url: string) =>
      url.includes('/recommendations')
        ? {results: []}
        : {results: Array.from({length: 40}, (_, i) => entry(i + 1000, `T${i}`))},
    );
    const first = await loadSimilarTitles({tmdbId: 55, type: 'series'}, {apiKey: 'k', fetchJson, now: 10});
    expect(first).toHaveLength(MAX_SIMILAR);
    const calls = fetchJson.mock.calls.length;
    await loadSimilarTitles({tmdbId: 55, type: 'series'}, {apiKey: 'k', fetchJson, now: 11});
    expect(fetchJson.mock.calls.length).toBe(calls);
    await loadSimilarTitles({tmdbId: 55, type: 'series'}, {apiKey: 'k', fetchJson, now: 10 + SIMILAR_TTL_MS + 1});
    expect(fetchJson.mock.calls.length).toBeGreaterThan(calls);
  });

  it('returns nothing without any id', async () => {
    const fetchJson = jest.fn();
    expect(await loadSimilarTitles({title: 'x'}, {apiKey: 'k', fetchJson})).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
