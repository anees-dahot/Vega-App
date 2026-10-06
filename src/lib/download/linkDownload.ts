import {sanitizeDownloadFileName} from '../downloadId';

/** Downloading from an address the user pastes: a direct file link, a stream playlist or a magnet. */

export type LinkKind = 'http' | 'hls' | 'torrent';

export interface ParsedDownloadLink {
  url: string;
  kind: LinkKind;
  /** File type for the saved file: "mp4", "mkv", "torrent" and so on. */
  fileType: string;
  /** A title taken from the address, to start from. */
  suggestedName: string;
}

export type ParseLinkResult =
  | {ok: true; link: ParsedDownloadLink}
  | {ok: false; error: string};

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ts', 'flv', 'wmv', '3gp'];

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const nameFromPath = (path: string): string => {
  const last = decode(path.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
  return last.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').trim();
};

export const parseDownloadLink = (input: string): ParseLinkResult => {
  const text = input.trim();
  if (!text) {
    return {ok: false, error: 'Paste a link first'};
  }

  if (/^magnet:/i.test(text)) {
    if (!/xt=urn:btih:[a-z0-9]{20,}/i.test(text)) {
      return {ok: false, error: 'This magnet link has no torrent hash'};
    }
    const displayName = text.match(/[?&]dn=([^&]+)/i)?.[1];
    return {
      ok: true,
      link: {
        url: text,
        kind: 'torrent',
        fileType: 'torrent',
        suggestedName: displayName
          ? decode(displayName.replace(/\+/g, ' '))
          : 'Torrent download',
      },
    };
  }

  if (!/^https?:\/\//i.test(text)) {
    return {ok: false, error: 'Only http, https and magnet links are supported'};
  }
  if (/\s/.test(text)) {
    return {ok: false, error: 'The link contains spaces'};
  }

  const path = text.replace(/^https?:\/\/[^/]+/i, '') || '/';
  const extension = path.split('?')[0].split('#')[0].match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase();
  const host = text.replace(/^https?:\/\//i, '').split('/')[0];
  const suggestedName = nameFromPath(path) || host;

  if (extension === 'm3u8') {
    return {
      ok: true,
      link: {url: text, kind: 'hls', fileType: 'm3u8', suggestedName},
    };
  }
  return {
    ok: true,
    link: {
      url: text,
      kind: 'http',
      fileType: extension && VIDEO_EXTENSIONS.includes(extension) ? extension : 'mp4',
      suggestedName,
    },
  };
};

/** A stable id, so the same link is not queued twice. */
export const createLinkDownloadId = (url: string): string => {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
  }
  return `link_${(hash >>> 0).toString(16)}`;
};

export const buildLinkDownloadRequest = (
  link: ParsedDownloadLink,
  title: string,
) => {
  const cleanTitle = title.trim() || link.suggestedName || 'Download';
  return {
    downloadId: createLinkDownloadId(link.url),
    title: cleanTitle,
    mediaType: 'movie' as const,
    url: link.url,
    fileName: sanitizeDownloadFileName(cleanTitle),
    fileType: link.fileType,
    deleteDownload: () => undefined,
  };
};
