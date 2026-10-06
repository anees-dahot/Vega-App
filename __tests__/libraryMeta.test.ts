import {
  clampRating,
  computeLibraryStats,
  filterByStatus,
  getStatusLabel,
  sortLibraryItems,
} from '../src/lib/library/libraryMeta';
import {WatchListStorage} from '../src/lib/storage/WatchListStorage';
import type {WatchListItem} from '../src/lib/storage/WatchListStorage';

const item = (title: string, extra: Partial<WatchListItem> = {}): WatchListItem => ({
  title,
  poster: '',
  link: `https://x/${title}`,
  provider: 'vega',
  ...extra,
});

// Stored oldest first, as the library keeps them.
const items = [
  item('Banana', {status: 'finished', rating: 6}),
  item('apple', {status: 'watching', rating: 9, note: 'great'}),
  item('Cherry', {status: 'planned'}),
  item('Date', {rating: 9, provider: 'drive'}),
  item('Elder', {status: 'dropped', rating: 2}),
];

const titles = (list: WatchListItem[]) => list.map(i => i.title);

describe('library status', () => {
  it('filters by status, including titles with none', () => {
    expect(titles(filterByStatus(items, 'all'))).toHaveLength(5);
    expect(titles(filterByStatus(items, 'watching'))).toEqual(['apple']);
    expect(titles(filterByStatus(items, 'none'))).toEqual(['Date']);
  });

  it('names a status', () => {
    expect(getStatusLabel('finished')).toBe('Finished');
    expect(getStatusLabel(undefined)).toBeUndefined();
  });
});

describe('library sort', () => {
  it('shows the newest added first, or the oldest first', () => {
    expect(titles(sortLibraryItems(items, 'recent'))).toEqual(['Elder', 'Date', 'Cherry', 'apple', 'Banana']);
    expect(titles(sortLibraryItems(items, 'oldest'))).toEqual(['Banana', 'apple', 'Cherry', 'Date', 'Elder']);
  });

  it('sorts by title ignoring case', () => {
    expect(titles(sortLibraryItems(items, 'title'))).toEqual(['apple', 'Banana', 'Cherry', 'Date', 'Elder']);
  });

  it('puts the best rated first, ties by newest, unrated last', () => {
    expect(titles(sortLibraryItems(items, 'rating'))).toEqual(['Date', 'apple', 'Banana', 'Elder', 'Cherry']);
  });

  it('groups by status: watching, planned, finished, dropped, then none', () => {
    expect(titles(sortLibraryItems(items, 'status'))).toEqual(['apple', 'Cherry', 'Banana', 'Elder', 'Date']);
  });

  it('does not change the list it was given', () => {
    const copy = [...items];
    sortLibraryItems(items, 'rating');
    expect(items).toEqual(copy);
  });
});

describe('library stats', () => {
  it('counts statuses, ratings and notes', () => {
    expect(computeLibraryStats(items)).toEqual({
      total: 5,
      byStatus: {planned: 1, watching: 1, finished: 1, dropped: 1, none: 1},
      rated: 4,
      averageRating: 6.5,
      withNotes: 1,
      topProvider: {name: 'vega', count: 4},
    });
  });

  it('handles an empty library', () => {
    expect(computeLibraryStats([])).toMatchObject({total: 0, rated: 0, averageRating: undefined, topProvider: undefined});
  });

  it('keeps ratings between 1 and 10', () => {
    expect(clampRating(0)).toBe(1);
    expect(clampRating(11)).toBe(10);
    expect(clampRating(7.4)).toBe(7);
  });
});

describe('saving a title again', () => {
  it('keeps its status, rating and note', () => {
    const storage = new WatchListStorage();
    storage.clearWatchList();
    storage.addToWatchList(item('Keep'));
    storage.updateItemMeta(['https://x/Keep'], {status: 'finished', rating: 7, note: 'good'});

    storage.addToWatchList(item('Keep', {poster: 'new.jpg'}));

    expect(storage.getWatchList()[0]).toMatchObject({
      poster: 'new.jpg',
      status: 'finished',
      rating: 7,
      note: 'good',
    });
  });
});

describe('updating library details', () => {
  it('changes only the chosen titles, and clears a detail with undefined', () => {
    const storage = new WatchListStorage();
    storage.clearWatchList();
    storage.addToWatchList(item('A'));
    storage.addToWatchList(item('B'));

    storage.updateItemMeta(['https://x/A'], {status: 'watching', rating: 8, note: 'hi'});
    let list = storage.getWatchList();
    expect(list.find(i => i.title === 'A')).toMatchObject({status: 'watching', rating: 8, note: 'hi'});
    expect(list.find(i => i.title === 'B')?.status).toBeUndefined();

    storage.updateItemMeta(['https://x/A', 'https://x/missing'], {rating: undefined, note: undefined});
    list = storage.getWatchList();
    const a = list.find(i => i.title === 'A')!;
    expect(a.status).toBe('watching');
    expect('rating' in a).toBe(false);
    expect('note' in a).toBe(false);
    expect(list).toHaveLength(2);
  });
});
