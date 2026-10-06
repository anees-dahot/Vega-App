import * as RNFS from '@dr.pogodin/react-native-fs';
import {parseSubtitles, type SubtitleCue} from './parse';

const cache = new Map<string, SubtitleCue[]>();
const MAX_CACHED = 6;

/**
 * Reads a subtitle file from the web, or from the device, into timed lines.
 * An unsupported format (such as ASS or TTML) gives an empty list.
 */
export const loadSubtitleCues = async (uri: string): Promise<SubtitleCue[]> => {
  const cached = cache.get(uri);
  if (cached) {
    return cached;
  }
  let text: string;
  if (/^https?:\/\//i.test(uri)) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Subtitle download failed (${response.status})`);
    }
    text = await response.text();
  } else {
    text = await RNFS.readFile(uri.replace(/^file:\/\//, ''), 'utf8');
  }
  const cues = parseSubtitles(text);
  if (cache.size >= MAX_CACHED) {
    cache.delete(cache.keys().next().value as string);
  }
  cache.set(uri, cues);
  return cues;
};
