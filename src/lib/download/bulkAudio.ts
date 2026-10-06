import type {DownloadItem} from '../zustand/downloadsStore';
import {findAudioTargets} from './audioMerge';
import {parseSeasonNumber} from './duplicates';
import type {BulkContext, BulkEpisode} from './bulkPlan';
import {getEpisodeDownloadState} from './bulkPlan';

/**
 * Adding another language to a whole series at once. Each chosen episode of
 * the page being looked at (the other language's version) is matched to the
 * finished video of the same episode, and only its audio is downloaded.
 */

export type AudioSkipReason = 'no-video' | 'ambiguous' | 'has-audio' | 'queued';

export interface AudioPlanEntry {
  episode: BulkEpisode;
  target: DownloadItem;
  /** Id of the audio-only download. */
  id: string;
}

export interface AudioPlan {
  toQueue: AudioPlanEntry[];
  skipped: Array<{episode: BulkEpisode; reason: AudioSkipReason}>;
}

export const audioRecordId = (episodeId: string, label: string): string =>
  `${episodeId}_audio_${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

const hasAudio = (target: DownloadItem, label: string, language: string): boolean =>
  (target.audioTracks || []).some(
    track =>
      track.label.trim().toLowerCase() === label.trim().toLowerCase() ||
      (language !== 'und' && track.language === language),
  );

/**
 * Narrows several candidate videos down to one when they can only be copies of
 * one episode: all in the same known season. Otherwise returns them unchanged.
 */
const pickAmongSameEpisode = (
  targets: DownloadItem[],
  wantedSeason: number | undefined,
  label: string,
  language: string,
): DownloadItem[] => {
  const seasons = new Set(targets.map(item => parseSeasonNumber(item.seasonTitle)));
  const sameSeason =
    seasons.size === 1 && (wantedSeason === undefined || seasons.has(wantedSeason));
  if (!sameSeason) {
    return targets;
  }
  const lacking = targets.filter(item => !hasAudio(item, label, language));
  const pool = lacking.length > 0 ? lacking : targets;
  // `findAudioTargets` sorts the newest first.
  return [pool[0]];
};

export const planBulkAudio = (
  context: BulkContext,
  episodes: BulkEpisode[],
  label: string,
  language: string,
  downloads: Record<string, DownloadItem>,
): AudioPlan => {
  const plan: AudioPlan = {toQueue: [], skipped: []};
  const wantedSeason = parseSeasonNumber(context.seasonTitle);
  const claimed = new Set<string>();
  for (const episode of episodes) {
    const id = audioRecordId(episode.id, label);
    if (getEpisodeDownloadState(id, downloads) === 'queued') {
      plan.skipped.push({episode, reason: 'queued'});
      continue;
    }
    const candidates = findAudioTargets(downloads, {
      id,
      title: episode.title,
      showName: context.showName,
      imdbId: context.imdbId,
      type: episode.mediaType,
      seasonTitle: context.seasonTitle,
      episodeName: episode.episodeName,
      episodeIndex: episode.episodeIndex,
    });
    let targets = candidates;
    if (targets.length > 1 && wantedSeason !== undefined) {
      targets = targets.filter(item => parseSeasonNumber(item.seasonTitle) === wantedSeason);
    }
    if (targets.length === 0) {
      plan.skipped.push({episode, reason: 'no-video'});
      continue;
    }
    // The same episode downloaded twice (another quality or provider) is the
    // same video: take one that still lacks this audio, then the newest.
    if (targets.length > 1) {
      targets = pickAmongSameEpisode(targets, wantedSeason, label, language);
    }
    // Two seasons with an "Episode 1" each: guessing could add the audio to the wrong one.
    if (targets.length !== 1) {
      plan.skipped.push({episode, reason: 'ambiguous'});
      continue;
    }
    const target = targets[0];
    if (hasAudio(target, label, language)) {
      plan.skipped.push({episode, reason: 'has-audio'});
      continue;
    }
    // One audio track per video per language, even if two chosen episodes map to it.
    if (claimed.has(target.id)) {
      plan.skipped.push({episode, reason: 'ambiguous'});
      continue;
    }
    claimed.add(target.id);
    plan.toQueue.push({episode, target, id});
  }
  return plan;
};

export const describeAudioSkipped = (plan: AudioPlan): string => {
  const count = (reason: AudioSkipReason) =>
    plan.skipped.filter(entry => entry.reason === reason).length;
  return [
    count('no-video') ? `${count('no-video')} not downloaded yet` : '',
    count('has-audio') ? `${count('has-audio')} already have it` : '',
    count('queued') ? `${count('queued')} already queued` : '',
    count('ambiguous') ? `${count('ambiguous')} could match more than one video` : '',
  ]
    .filter(Boolean)
    .join(', ');
};
