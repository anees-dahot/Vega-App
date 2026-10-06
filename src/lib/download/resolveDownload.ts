import type {Stream} from '../providers/types';
import {providerManager} from '../services/ProviderManager';
import {getDownloadFileName} from '../downloadLocation';
import {createSubtitleFileName} from '../downloadId';
import useDownloadsStore, {
  type DownloadItem,
  type DownloadSourceType,
} from '../zustand/downloadsStore';
import {pickServerWithHealth} from './pickWithHealth';
import {pickDownloadSubtitle} from './subtitlePick';
import {settingsStorage} from '../storage';
import {
  normalizeServerName,
  serverRulesStorage,
  type ServerRule,
} from './serverRules';

/**
 * Looks up a download's stream link with the saved server rule. Used when a
 * bulk download gets its turn, and when a link expires partway through.
 */

export type ResolveOutcome =
  | {
      status: 'resolved';
      server: Stream;
      via: 'rule' | 'auto';
      skipped: string[];
      size?: number;
    }
  | {status: 'unavailable'; skipped: string[]; message: string};

const EXPIRED_LINK_PATTERN =
  /\bHTTP\s*(401|403|404|410|451)\b|status code (401|403|404|410|451)|forbidden|link (has )?expired|\b(401|403|410)\b/i;

/** Whether a failed download looks like its link stopped working. */
export const isExpiredLinkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return EXPIRED_LINK_PATTERN.test(message);
};

export const canResolveDownload = (
  record: Pick<DownloadItem, 'provider' | 'sourceLink'>,
): boolean => Boolean(record.provider && record.sourceLink);

const getSourceType = (stream: Stream): DownloadSourceType => {
  if (stream.type === 'torrent' || stream.link.startsWith('magnet:')) {
    return 'torrent';
  }
  return stream.type === 'm3u8' ? 'hls' : 'http';
};

const getBulkRule = (record: DownloadItem): ServerRule => {
  const resolved = serverRulesStorage.resolve(
    record.provider || '',
    record.infoUrl,
  );
  const rule: ServerRule = resolved?.rule ?? {
    order: [],
    onNoMatch: 'auto',
    updatedAt: 0,
  };
  // Only the sound of an audio download is wanted: any quality will do, the
  // smallest is best, and no server is worth giving up on.
  if (record.audioFor) {
    return {order: [], onNoMatch: 'auto', updatedAt: rule.updatedAt};
  }
  // Nobody is there to answer a question while a queue works through episodes.
  return rule.onNoMatch === 'ask' ? {...rule, onNoMatch: 'skip'} : rule;
};

export const resolveStreamForRecord = async (
  record: DownloadItem,
  options: {excludeServerKeys?: string[]; signal?: AbortSignal} = {},
): Promise<ResolveOutcome> => {
  if (!record.provider || !record.sourceLink) {
    throw new Error('This download has no source to look up a link from');
  }
  const provider = record.provider;
  const servers = await providerManager.getStream({
    link: record.sourceLink,
    type: record.resolveType || record.type,
    signal: options.signal,
    providerValue: provider,
    isDownload: true,
  });
  serverRulesStorage.recordKnownServers(provider, servers || []);
  if (!servers || servers.length === 0) {
    return {
      status: 'unavailable',
      skipped: [],
      message: 'No downloadable streams found',
    };
  }

  const result = await pickServerWithHealth({
    provider,
    servers,
    rule: getBulkRule(record),
    excludeKeys: options.excludeServerKeys,
    preferSmallest: Boolean(record.audioFor),
  });
  if (result.status === 'picked') {
    return {
      status: 'resolved',
      server: result.server,
      via: result.via,
      skipped: result.skipped,
      size: result.size,
    };
  }
  return {
    status: 'unavailable',
    skipped: result.skipped,
    message:
      result.skipped.length > 0
        ? `${result.skipped.join(', ')} not available. No other server worked.`
        : 'None of the saved servers are available for this episode',
  };
};

/** Store the chosen stream on the download, ready for its backend to start. */
export const applyResolvedStream = (
  record: DownloadItem,
  server: Stream,
): DownloadItem => {
  const sourceType = getSourceType(server);
  const outputType = server.type === 'm3u8' ? 'mp4' : server.type;
  const store = useDownloadsStore.getState();
  const skip =
    server.skip && server.skip.length > 0
      ? server.skip
      : (server as {skips?: DownloadItem['skip']}).skips?.length
        ? (server as {skips?: DownloadItem['skip']}).skips
        : record.skip;
  store.updateDownload(record.id, {
    url: server.link,
    headers: server.headers,
    server: server.server,
    videoType: outputType,
    sourceType,
    isTorrent: sourceType === 'torrent',
    displayFileName: getDownloadFileName(
      record.fileBaseName || record.title,
      outputType,
    ),
    needsResolve: false,
    skip,
    errorCode: undefined,
    errorMessage: undefined,
  });
  return store.getDownload(record.id) || record;
};

/** The subtitle in the preferred language is downloaded with the video. */
export const queueSubtitleForStream = (
  record: DownloadItem,
  server: Stream,
): void => {
  if (!settingsStorage.isDownloadSubtitlesEnabled()) {
    return;
  }
  const subtitle = pickDownloadSubtitle(
    server.subtitles,
    settingsStorage.getDownloadSubtitleLanguage(),
  );
  if (!subtitle?.uri || !record.downloadLocation) {
    return;
  }
  const id = `${record.id}_subtitle_${subtitle.title}`;
  const store = useDownloadsStore.getState();
  if (store.downloads[id]) {
    return;
  }
  const format = subtitle.type === 'text/vtt' ? 'vtt' : 'srt';
  const fileName = createSubtitleFileName(
    record.fileBaseName || record.title,
    subtitle.title,
  );
  store.enqueueDownload({
    id,
    title: `${record.title} ${subtitle.title} Subtitle `,
    showName: record.showName,
    episodeName: record.episodeName,
    seasonTitle: record.seasonTitle,
    episodeIndex: record.episodeIndex,
    type: record.type,
    imdbId: record.imdbId,
    poster: record.poster,
    background: record.background,
    synopsis: record.synopsis,
    provider: record.provider,
    isSubtitle: true,
    infoUrl: record.infoUrl,
    sourceLink: record.sourceLink,
    url: subtitle.uri,
    videoType: format,
    sourceType: 'http',
    displayFileName: getDownloadFileName(fileName, format),
    downloadLocation: record.downloadLocation,
    filePath: '',
    status: 'queued',
    batchId: record.batchId,
  });
};

export const sameServer = (
  left: string | undefined,
  right: string | undefined,
): boolean =>
  normalizeServerName(left) !== '' &&
  normalizeServerName(left) === normalizeServerName(right);
