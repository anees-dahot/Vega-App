/** Finding a subtitle online without the user searching: the best match for the title, season, episode and language. */

export interface AutoSubtitleQuery {
  title: string;
  season?: number;
  episode?: number;
  /** Language code such as "en". */
  languageCode: string;
}

export interface FoundSubtitleTrack {
  type: string;
  language: string;
  title: string;
  uri: string;
}

/** The three-letter ids OpenSubtitles uses. */
export const OPENSUBTITLES_LANGUAGE_IDS: Record<string, string> = {
  en: 'eng',
  hi: 'hin',
  es: 'spa',
  fr: 'fre',
  de: 'ger',
  pt: 'por',
  it: 'ita',
  ru: 'rus',
  ar: 'ara',
  tr: 'tur',
  id: 'ind',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi',
  bn: 'ben',
  ur: 'urd',
};

export const buildSubtitleSearchUrl = (query: AutoSubtitleQuery): string => {
  const language = OPENSUBTITLES_LANGUAGE_IDS[query.languageCode.toLowerCase()] || 'eng';
  const parts = [
    query.episode ? `/episode-${query.episode}` : '',
    `/query-${encodeURIComponent(query.title.trim().toLowerCase())}`,
    query.season ? `/season-${query.season}` : '',
    `/sublanguageid-${language}`,
  ];
  return `https://rest.opensubtitles.org/search${parts.join('')}`;
};

interface SearchResult {
  SubDownloadLink?: string;
  SubFormat?: string;
  SubDownloadsCnt?: string | number;
  SubRating?: string | number;
  ISO639?: string;
  InfoReleaseGroup?: string;
  UserNickName?: string;
  MovieReleaseName?: string;
}

/** Results that can be downloaded, best first: SRT, then most downloaded, then best rated. */
export const rankSubtitleResults = (results: SearchResult[]): SearchResult[] =>
  results
    .filter(result => Boolean(result?.SubDownloadLink))
    .map((result, index) => ({result, index}))
    .sort((a, b) => {
      const srt = Number(b.result.SubFormat === 'srt') - Number(a.result.SubFormat === 'srt');
      if (srt !== 0) {
        return srt;
      }
      const downloads = Number(b.result.SubDownloadsCnt || 0) - Number(a.result.SubDownloadsCnt || 0);
      if (downloads !== 0) {
        return downloads;
      }
      const rating = Number(b.result.SubRating || 0) - Number(a.result.SubRating || 0);
      return rating !== 0 ? rating : a.index - b.index;
    })
    .map(entry => entry.result);

export const findBestSubtitle = async (
  query: AutoSubtitleQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<FoundSubtitleTrack | null> => {
  if (!query.title.trim()) {
    return null;
  }
  const response = await fetchImpl(buildSubtitleSearchUrl(query), {
    method: 'GET',
    headers: {'x-user-agent': 'VLSub 0.10.2'},
  });
  if (!response.ok) {
    throw new Error(`Subtitle search failed (${response.status})`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    return null;
  }
  const best = rankSubtitleResults(data)[0];
  if (!best?.SubDownloadLink) {
    return null;
  }
  return {
    type: 'application/x-subrip',
    language: best.ISO639 || query.languageCode,
    title: `Auto · ${best.MovieReleaseName || best.InfoReleaseGroup || 'OpenSubtitles'}`.slice(0, 80),
    // The site serves the plain file when the ".gz" ending is left off.
    uri: best.SubDownloadLink.replace('.gz', ''),
  };
};
