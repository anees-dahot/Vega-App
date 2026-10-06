import {
  getNextEpisode,
  isFinished,
  isNextUp,
  pickNextUp,
} from '../src/lib/library/nextUp';
import {
  episodeNumberAt,
  linksBefore,
  markLinksWatched,
} from '../src/lib/library/watched';
import {cacheStorage} from '../src/lib/storage';
import type {ContinueWatchingItem} from '../src/lib/zustand/continueWatchingStore';

const item = (extra: Partial<ContinueWatchingItem>): ContinueWatchingItem => ({
  id: 'a',
  title: 'Show',
  episode: {title: 'Episode 1', link: 'l1'},
  type: 'series',
  providerValue: 'vega',
  infoUrl: 'info',
  position: 0,
  duration: 0,
  updatedAt: 1,
  ...extra,
});

describe('next up', () => {
  it('counts an episode as finished past 85%', () => {
    expect(isFinished(86, 100)).toBe(true);
    expect(isFinished(85, 100)).toBe(false);
    expect(isFinished(5, 0)).toBe(false);
  });

  it('finds the following episode by id, link or source link', () => {
    const list = [
      {id: '1', link: 'a'},
      {id: '2', link: 'b'},
      {id: '3', link: 'c'},
    ];
    expect(getNextEpisode(list, {link: 'a'})?.link).toBe('b');
    expect(getNextEpisode(list, {id: '2'})?.link).toBe('c');
    expect(getNextEpisode(list, {link: 'c'})).toBeUndefined();
    expect(getNextEpisode(list, {link: 'zzz'})).toBeUndefined();
    expect(getNextEpisode(undefined, {link: 'a'})).toBeUndefined();
  });

  it('lists only finished titles that have a next episode, newest first', () => {
    const items = [
      item({id: 'done-old', nextTitle: 'E2', position: 90, duration: 100, updatedAt: 1}),
      item({id: 'half', nextTitle: 'E2', position: 40, duration: 100, updatedAt: 5}),
      item({id: 'last', position: 95, duration: 100, updatedAt: 6}),
      item({id: 'done-new', nextTitle: 'E9', position: 99, duration: 100, updatedAt: 7}),
    ];
    expect(pickNextUp(items).map(i => i.id)).toEqual(['done-new', 'done-old']);
    expect(isNextUp(items[1])).toBe(false);
  });
});

describe('marking earlier episodes as watched', () => {
  const list = [
    {link: 'w1', title: 'Episode 1'},
    {link: 'w2', title: 'Episode 2'},
    {link: 'w3', title: 'Episode 3'},
  ];

  it('takes the episodes listed before a link', () => {
    expect(linksBefore(list, 'w3')).toEqual(['w1', 'w2']);
    expect(linksBefore(list, 'w1')).toEqual([]);
    expect(linksBefore(list, 'nope')).toEqual([]);
  });

  it('saves them as watched and counts only the ones that changed', () => {
    cacheStorage.setString('w1', JSON.stringify({position: 95, duration: 100}));
    expect(markLinksWatched(['w1', 'w2'])).toBe(1);
    expect(JSON.parse(cacheStorage.getString('w2') as string)).toEqual({
      position: 1,
      duration: 1,
    });
    expect(markLinksWatched(['w1', 'w2'])).toBe(0);
  });

  it('numbers an episode from its title or its place', () => {
    expect(episodeNumberAt(list, 'w3')).toBe(3);
    expect(episodeNumberAt([{link: 'x', title: 'Special'}, {link: 'y', title: 'Other'}], 'y')).toBe(2);
    expect(episodeNumberAt(list, 'missing')).toBeUndefined();
  });
});
