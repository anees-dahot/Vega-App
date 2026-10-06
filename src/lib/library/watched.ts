import {cacheStorage} from '../storage';
import {parseEpisodeNumber} from '../download/duplicates';

/**
 * Marking several episodes as watched at once, for someone who starts a show
 * in the middle. A watched episode is one whose saved progress is complete.
 */

const WATCHED = JSON.stringify({position: 1, duration: 1});

/** Links of the episodes listed before `link`, in list order. Empty when `link` is not listed. */
export const linksBefore = (list: Array<{link: string}>, link: string): string[] => {
  const index = list.findIndex(item => item.link === link);
  return index <= 0 ? [] : list.slice(0, index).map(item => item.link);
};

/** Saves the given episodes as watched. Returns how many were not watched before. */
export const markLinksWatched = (links: string[]): number => {
  let changed = 0;
  for (const link of links) {
    let saved: {position?: number; duration?: number} = {};
    try {
      saved = JSON.parse(cacheStorage.getString(link) || '{}');
    } catch {
      saved = {};
    }
    const done =
      (saved.duration || 0) > 0 && (saved.position || 0) / (saved.duration || 1) > 0.85;
    if (!done) {
      cacheStorage.setString(link, WATCHED);
      changed += 1;
    }
  }
  return changed;
};

/** The number of the episode at `link`: from its title, otherwise its place in the list. */
export const episodeNumberAt = (
  list: Array<{link: string; title?: string}>,
  link: string,
): number | undefined => {
  const index = list.findIndex(item => item.link === link);
  if (index < 0) {
    return undefined;
  }
  return parseEpisodeNumber(list[index].title) ?? index + 1;
};
