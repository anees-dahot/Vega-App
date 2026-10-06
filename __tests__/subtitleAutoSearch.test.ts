import {
  buildSubtitleSearchUrl,
  findBestSubtitle,
  rankSubtitleResults,
} from '../src/lib/subtitles/autoSearch';

const result = (overrides: Record<string, unknown>) => ({
  SubDownloadLink: 'https://dl.opensubtitles.org/x.srt.gz',
  SubFormat: 'srt',
  SubDownloadsCnt: '10',
  SubRating: '0',
  ISO639: 'en',
  MovieReleaseName: 'Release',
  ...overrides,
});

describe('subtitle search address', () => {
  it('builds a movie search', () => {
    expect(buildSubtitleSearchUrl({title: 'The Matrix', languageCode: 'en'})).toBe(
      'https://rest.opensubtitles.org/search/query-the%20matrix/sublanguageid-eng',
    );
  });

  it('builds an episode search in another language', () => {
    expect(
      buildSubtitleSearchUrl({title: 'Show', season: 2, episode: 5, languageCode: 'hi'}),
    ).toBe('https://rest.opensubtitles.org/search/episode-5/query-show/season-2/sublanguageid-hin');
  });

  it('uses English for a language it does not know', () => {
    expect(buildSubtitleSearchUrl({title: 'x', languageCode: 'xx'})).toContain('sublanguageid-eng');
  });
});

describe('rankSubtitleResults', () => {
  it('prefers SRT, then the most downloaded, then the best rated', () => {
    const ranked = rankSubtitleResults([
      result({SubFormat: 'sub', SubDownloadsCnt: '9999', MovieReleaseName: 'sub'}),
      result({SubDownloadsCnt: '5', MovieReleaseName: 'few'}),
      result({SubDownloadsCnt: '500', MovieReleaseName: 'popular'}),
      result({SubDownloadsCnt: '500', SubRating: '8', MovieReleaseName: 'popular-rated'}),
    ]);
    expect(ranked.map(r => r.MovieReleaseName)).toEqual(['popular-rated', 'popular', 'few', 'sub']);
  });

  it('drops results with nothing to download', () => {
    expect(rankSubtitleResults([result({SubDownloadLink: ''}), {}])).toEqual([]);
  });
});

describe('findBestSubtitle', () => {
  const respond = (body: unknown, ok = true, status = 200) =>
    jest.fn(async () => ({ok, status, json: async () => body})) as unknown as typeof fetch;

  it('returns the best match as a subtitle track', async () => {
    const found = await findBestSubtitle(
      {title: 'Show', season: 1, episode: 2, languageCode: 'en'},
      respond([result({SubDownloadsCnt: '1'}), result({SubDownloadsCnt: '90', MovieReleaseName: 'Best.Release'})]),
    );
    expect(found).toEqual({
      type: 'application/x-subrip',
      language: 'en',
      title: 'Auto · Best.Release',
      uri: 'https://dl.opensubtitles.org/x.srt',
    });
  });

  it('returns null when nothing matches or the title is empty', async () => {
    await expect(findBestSubtitle({title: 'Show', languageCode: 'en'}, respond([]))).resolves.toBeNull();
    await expect(findBestSubtitle({title: 'Show', languageCode: 'en'}, respond({error: 1}))).resolves.toBeNull();
    const never = jest.fn();
    await expect(findBestSubtitle({title: '  ', languageCode: 'en'}, never as never)).resolves.toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  it('reports a failed search', async () => {
    await expect(
      findBestSubtitle({title: 'Show', languageCode: 'en'}, respond(null, false, 429)),
    ).rejects.toThrow('429');
  });
});
