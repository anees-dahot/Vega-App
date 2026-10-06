import * as RNFS from '@dr.pogodin/react-native-fs';
import {NativeModules} from 'react-native';
import type {DownloadItem} from '../zustand/downloadsStore';
import {getEpisodeIdentity, isSameEpisode} from './duplicates';

/**
 * Adding another language to a downloaded video. The other language's file is
 * downloaded like any download; its audio is then copied into the first file
 * as one more track, without re-encoding, and the extra file is deleted.
 */

export const AUDIO_MERGE_ROOT = `${RNFS.CachesDirectoryPath}/audio_merge`;

const LANGUAGE_CODES: Record<string, string> = {
  english: 'eng',
  hindi: 'hin',
  japanese: 'jpn',
  original: 'und',
  tamil: 'tam',
  telugu: 'tel',
  malayalam: 'mal',
  kannada: 'kan',
  bengali: 'ben',
  marathi: 'mar',
  punjabi: 'pan',
  urdu: 'urd',
  korean: 'kor',
  chinese: 'chi',
  mandarin: 'chi',
  cantonese: 'chi',
  spanish: 'spa',
  french: 'fre',
  german: 'ger',
  italian: 'ita',
  portuguese: 'por',
  russian: 'rus',
  arabic: 'ara',
  turkish: 'tur',
  thai: 'tha',
  indonesian: 'ind',
};

/** ISO 639-2 code for a language name or a code like "hi"; "und" when unknown. */
export const getAudioLanguageCode = (label: string | undefined): string => {
  const text = (label || '').toLowerCase();
  for (const [name, code] of Object.entries(LANGUAGE_CODES)) {
    if (text.includes(name)) {
      return code;
    }
  }
  const short: Record<string, string> = {
    en: 'eng', hi: 'hin', ja: 'jpn', jp: 'jpn', ta: 'tam', te: 'tel', ko: 'kor',
    es: 'spa', fr: 'fre', de: 'ger', it: 'ita', pt: 'por', ru: 'rus', ar: 'ara',
  };
  const word = text.trim().split(/[^a-z]+/)[0];
  return short[word] || 'und';
};

/**
 * Finished videos this download could add its audio to: the same episode of
 * the same title, even from another provider or in another language version.
 */
export const findAudioTargets = (
  downloads: Record<string, DownloadItem>,
  candidate: Parameters<typeof getEpisodeIdentity>[0] & {id: string},
): DownloadItem[] => {
  const identity = getEpisodeIdentity(candidate);
  return Object.values(downloads)
    .filter(
      item =>
        item.status === 'completed' &&
        !item.isSubtitle &&
        !item.id.includes('_subtitle_') &&
        !item.audioFor &&
        item.id !== candidate.id &&
        isSameEpisode(identity, getEpisodeIdentity(item)),
    )
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
};

/**
 * Two releases of an episode can be cut differently (another intro or
 * recap). The audio of one would then drift against the picture of the
 * other, so a difference above this is refused.
 */
export const MAX_DURATION_DIFF_SECONDS = 5;

/** Null when the lengths are close enough, otherwise what to tell the user. Unknown lengths pass. */
export const checkDurations = (
  videoSeconds: number,
  audioSeconds: number,
  tolerance: number = MAX_DURATION_DIFF_SECONDS,
): string | null => {
  if (!(videoSeconds > 0) || !(audioSeconds > 0)) {
    return null;
  }
  const difference = audioSeconds - videoSeconds;
  if (Math.abs(difference) <= tolerance) {
    return null;
  }
  const seconds = Math.round(Math.abs(difference));
  return `The audio is ${seconds}s ${difference > 0 ? 'longer' : 'shorter'} than the video, so it would not stay in sync`;
};

type MergeModule = {
  probeDuration?: (path: string) => Promise<number>;
  mergeAudioTrack?: (
    videoPath: string,
    audioPath: string,
    language: string,
    title: string,
    offsetSeconds: number,
    outputPath: string,
  ) => Promise<string>;
};

const toLocalPath = async (source: string, to: string): Promise<string> => {
  if (!source.startsWith('content://')) {
    return source.replace(/^file:\/\//, '');
  }
  await RNFS.copyFile(source, to);
  return to;
};

/**
 * Writes `<workDir>/merged.mkv`: the video with the audio of `audioSource` added.
 * Both sources can be local paths or content links. Resolves to the merged path.
 */
export const mergeAudioTrackFiles = async ({
  videoSource,
  audioSource,
  workDir,
  language,
  label,
  offsetSeconds = 0,
}: {
  videoSource: string;
  audioSource: string;
  workDir: string;
  language: string;
  label: string;
  offsetSeconds?: number;
}): Promise<string> => {
  const native = NativeModules.HttpDownloadModule as MergeModule | undefined;
  if (!native?.mergeAudioTrack) {
    throw new Error('Adding audio is not available in this build');
  }
  if (await RNFS.exists(workDir)) {
    await RNFS.unlink(workDir);
  }
  await RNFS.mkdir(workDir);
  const video = await toLocalPath(videoSource, `${workDir}/video.src`);
  const audio = await toLocalPath(audioSource, `${workDir}/audio.src`);
  const merged = `${workDir}/merged.mkv`;
  if (native.probeDuration && offsetSeconds === 0) {
    const [videoSeconds, audioSeconds] = await Promise.all([
      native.probeDuration(video).catch(() => 0),
      native.probeDuration(audio).catch(() => 0),
    ]);
    const problem = checkDurations(videoSeconds, audioSeconds);
    if (problem) {
      throw new Error(problem);
    }
  }
  await native.mergeAudioTrack(video, audio, language, label, offsetSeconds, merged);
  if (!(await RNFS.exists(merged))) {
    throw new Error('The merged file was not created');
  }
  return merged;
};

export const cleanupAudioMerge = async (workDir: string): Promise<void> => {
  if (await RNFS.exists(workDir)) {
    await RNFS.unlink(workDir).catch(() => undefined);
  }
};
