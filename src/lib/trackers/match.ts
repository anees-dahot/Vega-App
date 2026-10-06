/** Telling whether a tracker's title is the same show as the one in the library. */

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\(\d{4}\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const bigrams = (value: string): string[] => {
  const text = value.replace(/\s+/g, ' ');
  if (text.length < 2) {
    return text ? [text] : [];
  }
  return Array.from({length: text.length - 1}, (_, index) => text.slice(index, index + 2));
};

/** 0 to 1: how alike two titles are (Dice coefficient on letter pairs). */
export const titleSimilarity = (left: string, right: string): number => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const pairsA = bigrams(a);
  const pairsB = bigrams(b);
  const counts = new Map<string, number>();
  pairsB.forEach(pair => counts.set(pair, (counts.get(pair) || 0) + 1));
  let shared = 0;
  for (const pair of pairsA) {
    const left = counts.get(pair) || 0;
    if (left > 0) {
      shared += 1;
      counts.set(pair, left - 1);
    }
  }
  return (2 * shared) / (pairsA.length + pairsB.length);
};

export const MATCH_THRESHOLD = 0.8;

/**
 * The candidate that is the same show, or null. Each candidate has several
 * names (romaji, English, synonyms); the best one counts. A title that only
 * differs by a season number ("2nd Season") must not match another season.
 */
export const pickBestMatch = <T>(
  title: string,
  candidates: T[],
  getNames: (candidate: T) => string[],
  threshold = MATCH_THRESHOLD,
): T | null => {
  const seasonOf = (value: string): string =>
    normalize(value).match(/(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*season|\bpart\s*(\d+))/)?.slice(1).find(Boolean) ?? '';
  const wantedSeason = seasonOf(title);
  let best: {candidate: T; score: number} | null = null;
  for (const candidate of candidates) {
    const names = getNames(candidate).filter(Boolean);
    const score = Math.max(0, ...names.map(name => titleSimilarity(title, name)));
    const sameSeason = names.some(name => seasonOf(name) === wantedSeason);
    if (score >= threshold && (sameSeason || wantedSeason === '') && (!best || score > best.score)) {
      best = {candidate, score};
    }
  }
  return best ? best.candidate : null;
};
