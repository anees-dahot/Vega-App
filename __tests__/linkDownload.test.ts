import {
  buildLinkDownloadRequest,
  createLinkDownloadId,
  parseDownloadLink,
} from '../src/lib/download/linkDownload';

const parsed = (input: string) => {
  const result = parseDownloadLink(input);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.link;
};

describe('parseDownloadLink', () => {
  it('reads a direct video link and takes a name from the file', () => {
    expect(parsed('https://cdn.example.com/files/My.Movie.2024.mkv?token=abc')).toEqual({
      url: 'https://cdn.example.com/files/My.Movie.2024.mkv?token=abc',
      kind: 'http',
      fileType: 'mkv',
      suggestedName: 'My Movie 2024',
    });
  });

  it('uses mp4 when the link has no known video extension', () => {
    const link = parsed('https://example.com/download?id=42');
    expect(link).toMatchObject({kind: 'http', fileType: 'mp4', suggestedName: 'download'});
    expect(parsed('https://example.com/').suggestedName).toBe('example.com');
  });

  it('recognizes playlists', () => {
    expect(parsed('https://stream.example.com/live/index.m3u8')).toMatchObject({
      kind: 'hls',
      fileType: 'm3u8',
    });
  });

  it('reads magnet links and their display name', () => {
    const link = parsed(
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Big+Buck+Bunny%20HD',
    );
    expect(link).toMatchObject({
      kind: 'torrent',
      fileType: 'torrent',
      suggestedName: 'Big Buck Bunny HD',
    });
    expect(
      parsed('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567').suggestedName,
    ).toBe('Torrent download');
  });

  it('explains what is wrong with a bad link', () => {
    expect(parseDownloadLink('   ')).toEqual({ok: false, error: 'Paste a link first'});
    expect(parseDownloadLink('ftp://x/y.mp4')).toMatchObject({ok: false});
    expect(parseDownloadLink('magnet:?dn=nothing')).toMatchObject({
      ok: false,
      error: 'This magnet link has no torrent hash',
    });
    expect(parseDownloadLink('https://a.com/a b.mp4')).toMatchObject({ok: false});
  });
});

describe('link downloads', () => {
  it('gives the same link the same id and different links different ids', () => {
    const a = createLinkDownloadId('https://a.com/x.mp4');
    expect(a).toBe(createLinkDownloadId('https://a.com/x.mp4'));
    expect(a).not.toBe(createLinkDownloadId('https://a.com/y.mp4'));
    expect(a.startsWith('link_')).toBe(true);
  });

  it('builds a download request with a safe file name', () => {
    const link = parsed('https://a.com/x.mkv');
    expect(buildLinkDownloadRequest(link, ' My: Film? ')).toMatchObject({
      title: 'My: Film?',
      fileName: 'My Film',
      fileType: 'mkv',
      mediaType: 'movie',
      url: 'https://a.com/x.mkv',
    });
    // An empty name falls back to the one from the link.
    expect(buildLinkDownloadRequest(link, '  ').title).toBe('x');
  });
});
