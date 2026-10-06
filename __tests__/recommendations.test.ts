import {
  loadRecommendations,
  pickSeedTitles,
  rankRecommendations,
  RECOMMENDATION_TTL_MS,
} from '../src/lib/library/recommendations';
import type {WatchListItem} from '../src/lib/storage/WatchListStorage';

const item = (title: string, extra: Partial<WatchListItem> = {}): WatchListItem => ({
  title,
  poster: '',
  link: `https://x/${title}`,
  provider: 'vega',
  ...extra,
});

describe('pickSeedTitles', () => {
  it('prefers high ratings, then finished, then watching, and skips the rest', () => {
    const items = [
      item('planned', {status: 'planned'}),
      item('watching', {status: 'watching'}),
      item('finished', {status: 'finished'}),
      item('loved', {rating: 9}),
      item('liked', {rating: 8, status: 'finished'}),
      item('meh', {rating: 5}),
      item('none'),
    ];
    expect(pickSeedTitles(items, 10).map(i => i.title)).toEqual([
      'loved',
      'liked',
      'finished',
      'watching',
    ]);
    expect(pickSeedTitles(items, 2).map(i => i.title)).toEqual(['loved', 'liked']);
  });

  it('puts the newer title first when two score the same', () => {
    const items = [item('older', {status: 'finished'}), item('newer', {status: 'finished'})];
    expect(pickSeedTitles(items).map(i => i.title)).toEqual(['newer', 'older']);
  });
});

describe('rankRecommendations', () => {
  const list = (...titles: string[]) =>
    titles.map((title, index) => ({id: index + 1, mediaType: 'tv' as const, title}));

  it('ranks titles pointed to by several seeds higher, and leaves out what is in the library', () => {
    const ranked = rankRecommendations(
      [
        {title: 'Seed A', weight: 100, list: [{id: 1, mediaType: 'tv', title: 'Shared'}, {id: 2, mediaType: 'tv', title: 'Only A'}]},
        {title: 'Seed B', weight: 100, list: [{id: 3, mediaType: 'tv', title: 'Only B'}, {id: 1, mediaType: 'tv', title: 'Shared'}, {id: 4, mediaType: 'tv', title: 'Owned'}]},
      ],
      ['Owned!'],
    );
    // "Only B" is first in its list, so it edges out "Only A", which is second in its.
    expect(ranked.map(r => r.title)).toEqual(['Shared', 'Only B', 'Only A']);
    expect(ranked[0].because).toBe('Because you liked Seed A');
  });

  it('counts a loved seed for more than a merely finished one', () => {
    const ranked = rankRecommendations(
      [
        {title: 'Finished', weight: 60, list: list('From finished')},
        {title: 'Loved', weight: 109, list: [{id: 9, mediaType: 'tv', title: 'From loved'}]},
      ],
      [],
    );
    expect(ranked.map(r => r.title)).toEqual(['From loved', 'From finished']);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({length: 40}, (_, i) => ({id: i, mediaType: 'tv' as const, title: `T${i}`}));
    expect(rankRecommendations([{title: 'S', weight: 100, list: many}], [], 10)).toHaveLength(10);
  });
});

describe('loadRecommendations', () => {
  const NOW = 2_000_000_000_000;
  const respond = () =>
    jest.fn(async (url: string) => {
      if (url.includes('/search/multi')) {
        return {results: [{media_type: 'person', id: 1}, {media_type: 'tv', id: 42}]};
      }
      return {
        results: [
          {id: 7, name: 'Similar One', first_air_date: '2020-05-01', poster_path: '/a.jpg', popularity: 5},
          {id: 8, name: 'Library Show', first_air_date: '2019-01-01'},
        ],
      };
    });

  it('finds similar titles for the best-loved library titles, then reuses the answer', async () => {
    const fetchJson = respond();
    const library = [item('Loved', {rating: 9}), item('Library Show')];

    const first = await loadRecommendations(library, {apiKey: 'k', now: NOW, fetchJson});

    expect(first).toEqual([
      expect.objectContaining({
        id: 7,
        mediaType: 'tv',
        title: 'Similar One',
        year: '2020',
        poster: 'https://image.tmdb.org/t/p/w185/a.jpg',
        because: 'Because you liked Loved',
      }),
    ]);
    expect(fetchJson).toHaveBeenCalledTimes(2);

    await loadRecommendations(library, {apiKey: 'k', now: NOW + 1000, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await loadRecommendations(library, {apiKey: 'k', now: NOW + RECOMMENDATION_TTL_MS + 1, fetchJson});
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('gives nothing when no title is loved or finished, and survives a failed request', async () => {
    const fetchJson = jest.fn();
    expect(await loadRecommendations([item('Planned', {status: 'planned'})], {apiKey: 'k', now: NOW, fetchJson})).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();

    const failing = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadRecommendations([item('Another', {rating: 10})], {apiKey: 'k', now: NOW, fetchJson: failing})).toEqual([]);
  });
});
