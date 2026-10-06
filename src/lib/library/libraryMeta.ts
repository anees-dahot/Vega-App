import type {LibraryStatus, WatchListItem} from '../storage/WatchListStorage';

export const LIBRARY_STATUSES: Array<{value: LibraryStatus; label: string; icon: string}> = [
  {value: 'planned', label: 'Planned', icon: 'bookmark-outline'},
  {value: 'watching', label: 'Watching', icon: 'play-circle-outline'},
  {value: 'finished', label: 'Finished', icon: 'check-circle-outline'},
  {value: 'dropped', label: 'Dropped', icon: 'close-circle-outline'},
];

export const getStatusLabel = (status: LibraryStatus | undefined): string | undefined =>
  LIBRARY_STATUSES.find(item => item.value === status)?.label;

export type StatusFilter = 'all' | 'none' | LibraryStatus;

export const filterByStatus = (items: WatchListItem[], filter: StatusFilter): WatchListItem[] => {
  if (filter === 'all') {
    return items;
  }
  if (filter === 'none') {
    return items.filter(item => !item.status);
  }
  return items.filter(item => item.status === filter);
};

export type LibrarySort = 'recent' | 'oldest' | 'title' | 'rating' | 'status';

export const LIBRARY_SORTS: Array<{value: LibrarySort; label: string}> = [
  {value: 'recent', label: 'Recently added'},
  {value: 'oldest', label: 'Oldest first'},
  {value: 'title', label: 'Title A to Z'},
  {value: 'rating', label: 'Highest rated'},
  {value: 'status', label: 'Status'},
];

const STATUS_ORDER: Record<string, number> = {watching: 0, planned: 1, finished: 2, dropped: 3};

/**
 * Library order. The stored list is oldest first, so "recent" reverses it;
 * every other order keeps that as the tie-break.
 */
export const sortLibraryItems = (items: WatchListItem[], sort: LibrarySort): WatchListItem[] => {
  const newestFirst = [...items].reverse();
  switch (sort) {
    case 'recent':
      return newestFirst;
    case 'oldest':
      return [...items];
    case 'title':
      return [...newestFirst].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}),
      );
    case 'rating':
      // Rated titles first, best first; unrated ones follow.
      return [...newestFirst].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case 'status':
      return [...newestFirst].sort(
        (a, b) => (STATUS_ORDER[a.status ?? ''] ?? 4) - (STATUS_ORDER[b.status ?? ''] ?? 4),
      );
  }
};

export interface LibraryStats {
  total: number;
  byStatus: Record<LibraryStatus | 'none', number>;
  rated: number;
  /** Mean of the ratings, one decimal, or undefined when nothing is rated. */
  averageRating?: number;
  withNotes: number;
  /** Provider with the most titles, if any. */
  topProvider?: {name: string; count: number};
}

export const computeLibraryStats = (items: WatchListItem[]): LibraryStats => {
  const byStatus: LibraryStats['byStatus'] = {
    planned: 0,
    watching: 0,
    finished: 0,
    dropped: 0,
    none: 0,
  };
  const providers = new Map<string, number>();
  let ratingSum = 0;
  let rated = 0;
  let withNotes = 0;
  for (const item of items) {
    byStatus[item.status ?? 'none'] += 1;
    if (typeof item.rating === 'number' && item.rating > 0) {
      ratingSum += item.rating;
      rated += 1;
    }
    if (item.note?.trim()) {
      withNotes += 1;
    }
    if (item.provider) {
      providers.set(item.provider, (providers.get(item.provider) || 0) + 1);
    }
  }
  const top = [...providers.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total: items.length,
    byStatus,
    rated,
    averageRating: rated > 0 ? Math.round((ratingSum / rated) * 10) / 10 : undefined,
    withNotes,
    topProvider: top ? {name: top[0], count: top[1]} : undefined,
  };
};

export const clampRating = (value: number): number => Math.min(Math.max(Math.round(value), 1), 10);
