import type {EpisodeLink, Info, Link} from '../providers/types';
import {parseEpisodeNumber, parseSeasonNumber} from '../download/duplicates';

/**
 * Telling which episodes of a title are new since the last look. Each
 * episode is remembered by a short hash of its link, per season, so an
 * episode added inside an existing season is noticed, not only a new season.
 */

export interface EpisodeRef {
  /** Season (or quality group) title. */
  group: string;
  title: string;
  link: string;
  /** Place in the group's list, as the download buttons number it. */
  index: number;
  /** The group lists episodes directly, rather than through a link. */
  direct: boolean;
}

export interface EpisodeSnapshot {
  version: 2;
  /** Every group the page listed, fetched or not. */
  groupTitles: string[];
  /** Hashed episode links of each group that was looked into. */
  groups: Record<string, string[]>;
}

/** A short stable hash, enough to tell links of one title apart. */
export const hashLink = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) % 4294967296;
  }
  return hash.toString(36);
};

export const buildSnapshot = (
  groupTitles: string[],
  refs: EpisodeRef[],
  fetchedGroups: string[] = [],
): EpisodeSnapshot => {
  // A group that was looked into but had no episodes is remembered as empty.
  const groups: Record<string, string[]> = {};
  fetchedGroups.forEach(title => {
    groups[title] = [];
  });
  for (const ref of refs) {
    (groups[ref.group] = groups[ref.group] || []).push(hashLink(ref.link));
  }
  return {version: 2, groupTitles, groups};
};

export interface EpisodeDiff {
  /** Nothing was known before, so nothing counts as new. */
  baseline: boolean;
  newEpisodes: EpisodeRef[];
  newGroups: string[];
}

export const diffEpisodes = (
  previous: EpisodeSnapshot | undefined,
  groupTitles: string[],
  refs: EpisodeRef[],
): EpisodeDiff => {
  if (!previous || previous.version !== 2) {
    return {baseline: true, newEpisodes: [], newGroups: []};
  }
  const known = new Set(previous.groupTitles);
  const newGroups = groupTitles.filter(title => !known.has(title));
  const newEpisodes = refs.filter(ref => {
    const before = previous.groups[ref.group];
    // A group looked into for the first time is a baseline, unless the group itself is new.
    if (!before) {
      return newGroups.includes(ref.group);
    }
    return !before.includes(hashLink(ref.link));
  });
  return {baseline: false, newEpisodes, newGroups};
};

/**
 * The group whose episodes are fetched through a link: the latest season,
 * since that is where new episodes appear.
 */
export const pickLatestLinkedGroup = (groups: Link[]): Link | undefined => {
  const linked = groups.filter(group => group.episodesLink && !group.directLinks?.length);
  if (linked.length === 0) {
    return undefined;
  }
  return linked.reduce((best, group) => {
    const a = parseSeasonNumber(best.title) ?? -1;
    const b = parseSeasonNumber(group.title) ?? -1;
    return b > a || (b === a && b === -1) ? group : best;
  });
};

/** Episodes of a title's page. Only series are looked at; a link-fetched season costs one request. */
export const collectEpisodeRefs = async (
  info: Pick<Info, 'type' | 'linkList'>,
  getEpisodes: (url: string) => Promise<EpisodeLink[]>,
): Promise<{groupTitles: string[]; refs: EpisodeRef[]; fetchedGroups: string[]}> => {
  const groups = Array.isArray(info.linkList) ? info.linkList.filter(Boolean) : [];
  const groupTitles = groups.map(group => group.title);
  if (info.type !== 'series') {
    return {groupTitles, refs: [], fetchedGroups: []};
  }
  const refs: EpisodeRef[] = [];
  const fetchedGroups: string[] = [];
  for (const group of groups) {
    if (Array.isArray(group.directLinks)) {
      fetchedGroups.push(group.title);
    }
    (group.directLinks || []).forEach((item, index) => {
      if (item?.link) {
        refs.push({group: group.title, title: item.title, link: item.link, index, direct: true});
      }
    });
  }
  const latest = pickLatestLinkedGroup(groups);
  if (latest?.episodesLink) {
    const episodes = await getEpisodes(latest.episodesLink);
    fetchedGroups.push(latest.title);
    episodes.forEach((item, index) => {
      if (item?.link) {
        refs.push({group: latest.title, title: item.title, link: item.link, index, direct: false});
      }
    });
  }
  return {groupTitles, refs, fetchedGroups};
};

/** "Episode 7", "Episodes 7–9" or "3 new episodes", for a notification. */
export const describeNewEpisodeRefs = (diff: EpisodeDiff): string | undefined => {
  const count = diff.newEpisodes.length;
  if (count === 0) {
    return diff.newGroups.length > 0
      ? diff.newGroups.length === 1
        ? 'A new season is available'
        : `${diff.newGroups.length} new seasons are available`
      : undefined;
  }
  const numbers = diff.newEpisodes
    .map(ref => parseEpisodeNumber(ref.title))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (numbers.length === count) {
    return count === 1
      ? `Episode ${numbers[0]} is available`
      : `Episodes ${numbers[0]}–${numbers[numbers.length - 1]} are available`;
  }
  return `${count} new episode${count === 1 ? '' : 's'} available`;
};
