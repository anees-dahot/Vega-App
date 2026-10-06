/** Reading subtitle files (SRT and WebVTT) into timed lines, for showing them with a delay. */

export interface SubtitleCue {
  /** Milliseconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

const TIMESTAMP =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

const toMs = (hours: string | undefined, minutes: string, seconds: string, fraction: string): number =>
  (Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 +
  Number(fraction.padEnd(3, '0').slice(0, 3));

/** Removes styling: <i>, <c.color>, {\an8}, and decodes the common character codes. */
export const cleanCueText = (raw: string): string =>
  raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

export const parseSubtitles = (input: string): SubtitleCue[] => {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeIndex = lines.findIndex(line => TIMESTAMP.test(line));
    if (timeIndex < 0) {
      continue;
    }
    const match = lines[timeIndex].match(TIMESTAMP)!;
    const start = toMs(match[1], match[2], match[3], match[4]);
    const end = toMs(match[5], match[6], match[7], match[8]);
    const body = cleanCueText(lines.slice(timeIndex + 1).join('\n'));
    if (body && end > start) {
      cues.push({start, end, text: body});
    }
  }
  return cues.sort((a, b) => a.start - b.start);
};

/**
 * The lines to show at a time. `delayMs` shifts the subtitles later when
 * positive and earlier when negative.
 */
export const findCueText = (
  cues: SubtitleCue[],
  timeMs: number,
  delayMs = 0,
): string => {
  const time = timeMs - delayMs;
  let low = 0;
  let high = cues.length - 1;
  let last = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      last = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lines: string[] = [];
  // A few cues before may still be showing when cues overlap.
  for (let index = last; index >= 0 && index > last - 6; index -= 1) {
    if (cues[index].end > time) {
      lines.unshift(cues[index].text);
    }
  }
  return lines.join('\n');
};

/** Step sizes for the delay buttons, in milliseconds. */
export const SUBTITLE_DELAY_STEP_MS = 250;
export const SUBTITLE_DELAY_LIMIT_MS = 60_000;

export const clampSubtitleDelay = (delayMs: number): number =>
  Math.max(-SUBTITLE_DELAY_LIMIT_MS, Math.min(SUBTITLE_DELAY_LIMIT_MS, Math.round(delayMs)));

export const formatSubtitleDelay = (delayMs: number): string =>
  delayMs === 0
    ? 'No delay'
    : `${delayMs > 0 ? '+' : '−'}${(Math.abs(delayMs) / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
