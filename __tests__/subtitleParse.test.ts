import {
  clampSubtitleDelay,
  cleanCueText,
  findCueText,
  formatSubtitleDelay,
  parseSubtitles,
} from '../src/lib/subtitles/parse';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i>

2
00:00:04,000 --> 00:00:06,000
{\\an8}Second line
with two rows

3
00:01:02,250 --> 00:01:04,000
Later &amp; louder
`;

const VTT = `WEBVTT

NOTE a comment

intro
00:00:01.000 --> 00:00:02.000 align:start
<c.yellow>First</c>

00:03.000 --> 00:04.000
Short form
`;

describe('parseSubtitles', () => {
  it('reads SRT with styling removed', () => {
    expect(parseSubtitles(SRT)).toEqual([
      {start: 1000, end: 3500, text: 'Hello there'},
      {start: 4000, end: 6000, text: 'Second line\nwith two rows'},
      {start: 62250, end: 64000, text: 'Later & louder'},
    ]);
  });

  it('reads WebVTT with cue names, settings and short timestamps', () => {
    expect(parseSubtitles(VTT)).toEqual([
      {start: 1000, end: 2000, text: 'First'},
      {start: 3000, end: 4000, text: 'Short form'},
    ]);
  });

  it('copes with a byte order mark, Windows line ends and bad blocks', () => {
    const text = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\nnot a cue\r\n\r\n2\r\n00:00:05,000 --> 00:00:04,000\r\nBackwards\r\n';
    expect(parseSubtitles(text)).toEqual([{start: 1000, end: 2000, text: 'Hi'}]);
    expect(parseSubtitles('')).toEqual([]);
  });

  it('sorts cues by start time', () => {
    const out = parseSubtitles('2\n00:00:05,000 --> 00:00:06,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n');
    expect(out.map(cue => cue.text)).toEqual(['A', 'B']);
  });
});

describe('findCueText', () => {
  const cues = parseSubtitles(SRT);

  it('shows the cue that is on screen', () => {
    expect(findCueText(cues, 500)).toBe('');
    expect(findCueText(cues, 1000)).toBe('Hello there');
    expect(findCueText(cues, 3499)).toBe('Hello there');
    expect(findCueText(cues, 3500)).toBe('');
    expect(findCueText(cues, 5000)).toBe('Second line\nwith two rows');
    expect(findCueText(cues, 99_999)).toBe('');
  });

  it('shifts later with a positive delay and earlier with a negative one', () => {
    // With +2s the first cue shows from 3.0s to 5.5s.
    expect(findCueText(cues, 2000, 2000)).toBe('');
    expect(findCueText(cues, 3000, 2000)).toBe('Hello there');
    // With -0.5s it shows from 0.5s.
    expect(findCueText(cues, 500, -500)).toBe('Hello there');
  });

  it('shows overlapping cues together', () => {
    const overlap = parseSubtitles('1\n00:00:01,000 --> 00:00:05,000\nLong\n\n2\n00:00:02,000 --> 00:00:03,000\nShort\n');
    expect(findCueText(overlap, 2500)).toBe('Long\nShort');
    expect(findCueText(overlap, 4000)).toBe('Long');
  });
});

describe('subtitle delay helpers', () => {
  it('limits and rounds the delay', () => {
    expect(clampSubtitleDelay(250.4)).toBe(250);
    expect(clampSubtitleDelay(999_999)).toBe(60_000);
    expect(clampSubtitleDelay(-999_999)).toBe(-60_000);
  });

  it('writes the delay for people', () => {
    expect(formatSubtitleDelay(0)).toBe('No delay');
    expect(formatSubtitleDelay(1500)).toBe('+1.5 s');
    expect(formatSubtitleDelay(-250)).toBe('−0.25 s');
    expect(formatSubtitleDelay(2000)).toBe('+2 s');
  });

  it('cleans cue text', () => {
    expect(cleanCueText('  <b>Bold</b>\n\n {\\an8}Top ')).toBe('Bold\nTop');
  });
});
