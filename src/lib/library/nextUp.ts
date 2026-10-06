import type {ContinueWatchingItem} from '../zustand/continueWatchingStore';

/**
 * "Next up": titles whose current episode is finished and that have a
 * following episode, so they can sit in their own row instead of among the
 * half-watched ones.
 */

/** Above this share of the episode, it counts as watched. */
export const FINISHED_FRACTION = 0.85;

export const isFinished = (position: number, duration: number): boolean =>
  duration > 0 && position / duration > FINISHED_FRACTION;

interface EpisodeLike {
  id?: string;
  link?: string;
  sourceLink?: string;
}

const sameEpisode = (a: EpisodeLike, b: EpisodeLike): boolean =>
  Boolean(
    (a.id && b.id && a.id === b.id) ||
      (a.link && b.link && a.link === b.link) ||
      (a.sourceLink && b.sourceLink && a.sourceLink === b.sourceLink),
  );

/** The episode after `current` in `list`, or undefined at the end or when it is not listed. */
export const getNextEpisode = <T extends EpisodeLike>(
  list: T[] | undefined,
  current: EpisodeLike | undefined,
): T | undefined => {
  if (!list?.length || !current) {
    return undefined;
  }
  const index = list.findIndex(item => item === current || sameEpisode(item, current));
  return index >= 0 ? list[index + 1] : undefined;
};

export const isNextUp = (
  item: Pick<ContinueWatchingItem, 'position' | 'duration' | 'nextTitle'>,
): boolean => Boolean(item.nextTitle) && isFinished(item.position, item.duration);

/** Next-up titles, the most recently watched first. */
export const pickNextUp = (items: ContinueWatchingItem[]): ContinueWatchingItem[] =>
  items
    .filter(item => Boolean(item.providerValue) && isNextUp(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
