import * as RNFS from '@dr.pogodin/react-native-fs';
import axios from 'axios';
import {NativeModules, Platform} from 'react-native';
import {
  aes128CbcDecrypt,
  base64ToBytes,
  bytesToBase64,
  ivFromHex,
  ivFromSequence,
} from './aes128Cbc';

interface SegmentKey {
  uri: string;
  /** Explicit IV from the playlist; otherwise the media sequence number is used. */
  iv?: string;
}

interface SegmentInfo {
  duration: number;
  url: string;
  index: number;
  /** Set when the segment is AES-128 encrypted. */
  key?: SegmentKey;
  mediaSequence: number;
}

interface M3U8Data {
  segments: SegmentInfo[];
  initSegmentUrl?: string;
  totalDuration: number;
  isLive: boolean;
  /** Advertised bits per second of the chosen stream, when the master playlist had it. */
  bandwidth?: number;
}

/** Byte counts for a running HLS download. Sizes are estimates, since the playlist doesn't list them. */
export interface HlsProgressStats {
  bytes: number;
  estimatedTotal: number;
  /** Bytes per second over the last few seconds. */
  speed: number;
}

const SPEED_WINDOW_MS = 5000;
const MAX_CONCURRENT_SEGMENTS = 16;
const SEGMENT_ATTEMPTS = 3;

const cancelledDownloads = new Set<string>();
const pausedDownloads = new Set<string>();
const activeDownloads = new Set<string>();

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const resolveUrl = (targetUrl: string, baseUrl: string): string => {
  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    if (targetUrl.startsWith('http')) {
      return targetUrl;
    }
    if (targetUrl.startsWith('/')) {
      try {
        const u = new URL(baseUrl);
        return `${u.origin}${targetUrl}`;
      } catch {
        return base + targetUrl;
      }
    }
    return base + targetUrl;
  }
};

const normalizeHeaders = (headers?: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...(headers || {}),
  };
  return result;
};

/** What an audio-only download is after: the language it brings. */
export interface HlsAudioWish {
  label?: string;
  /** ISO 639-2 code such as "hin"; "und" when unknown. */
  language?: string;
}

const attributeOf = (line: string, name: string): string | undefined =>
  line.match(new RegExp(`(?:^|[,:])${name}=("([^"]*)"|[^,]*)`))?.[2] ??
  line.match(new RegExp(`(?:^|[,:])${name}=([^,"]*)`))?.[1];

/**
 * The playlist to take for an audio-only download of a master playlist: an
 * audio rendition of its own (best match for the wanted language, else the
 * default one), otherwise the lowest quality stream, whose sound is the same.
 */
export const pickAudioPlaylist = (
  lines: string[],
  baseUrl: string,
  wish: HlsAudioWish = {},
): {url: string; bandwidth?: number} | null => {
  const renditions = lines
    .filter(line => line.startsWith('#EXT-X-MEDIA:') && attributeOf(line, 'TYPE') === 'AUDIO')
    .map(line => ({
      uri: attributeOf(line, 'URI'),
      name: (attributeOf(line, 'NAME') || '').toLowerCase(),
      language: (attributeOf(line, 'LANGUAGE') || '').toLowerCase(),
      isDefault: attributeOf(line, 'DEFAULT') === 'YES',
    }))
    .filter(entry => entry.uri);
  if (renditions.length > 0) {
    const label = (wish.label || '').trim().toLowerCase();
    const code = (wish.language || '').toLowerCase();
    const matches = (entry: (typeof renditions)[number]): boolean => {
      const sameName =
        label !== '' && entry.name !== '' && (entry.name.includes(label) || label.includes(entry.name));
      const sameCode =
        code !== '' &&
        code !== 'und' &&
        entry.language !== '' &&
        (entry.language === code || code.startsWith(entry.language));
      return sameName || sameCode;
    };
    const chosen =
      renditions.find(matches) || renditions.find(entry => entry.isDefault) || renditions[0];
    return {url: resolveUrl(chosen.uri as string, baseUrl)};
  }
  let best: {url: string; bandwidth: number} | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) {
      continue;
    }
    const bandwidth = Number(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || 0);
    const next = lines.slice(i + 1).find(line => line && !line.startsWith('#'));
    if (next && (!best || (bandwidth > 0 && bandwidth < best.bandwidth) || best.bandwidth === 0)) {
      best = {url: resolveUrl(next, baseUrl), bandwidth};
    }
  }
  return best ? {url: best.url, bandwidth: best.bandwidth || undefined} : null;
};

const parseM3U8Playlist = async (
  url: string,
  headers: Record<string, string> = {},
  audioWish?: HlsAudioWish,
): Promise<M3U8Data> => {
  try {
    console.log('Fetching M3U8 playlist:', url);
    const reqHeaders = normalizeHeaders(headers);
    const response = await axios.get(url, {
      headers: reqHeaders,
      timeout: 15000,
    });

    const content = typeof response.data === 'string' ? response.data : String(response.data);
    console.log('M3U8 content preview:', content.substring(0, 300));
    const lines = content.split('\n').map((line: string) => line.trim());

    const segments: SegmentInfo[] = [];
    let initSegmentUrl: string | undefined;
    let totalDuration = 0;
    let isLive = false;
    let segmentIndex = 0;
    let currentKey: SegmentKey | undefined;
    const mediaSequenceStart = Number(
      content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] ?? 0,
    );

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    const hasMasterPlaylist = lines.some((line: string) =>
      line.includes('#EXT-X-STREAM-INF'),
    );

    if (hasMasterPlaylist && audioWish) {
      const audio = pickAudioPlaylist(lines, url, audioWish);
      if (!audio) {
        throw new Error('No valid stream found in master playlist');
      }
      const chosen = await parseM3U8Playlist(audio.url, headers);
      return {...chosen, bandwidth: chosen.bandwidth ?? audio.bandwidth};
    }

    if (hasMasterPlaylist) {
      console.log(
        'Detected master playlist, looking for best quality stream...',
      );

      let bestQualityUrl: string | null = null;
      let highestBandwidth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('#EXT-X-STREAM-INF')) {
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          const bandwidth = bandwidthMatch
            ? parseInt(bandwidthMatch[1], 10)
            : 0;

          // Find the next non-empty, non-comment line which is the stream playlist URL
          let playlistUrl = '';
          for (let j = i + 1; j < lines.length; j++) {
            const candidate = lines[j];
            if (candidate && !candidate.startsWith('#')) {
              playlistUrl = candidate;
              break;
            }
          }

          if (playlistUrl) {
            const resolvedUrl = resolveUrl(playlistUrl, url);
            if (bandwidth > highestBandwidth || !bestQualityUrl) {
              highestBandwidth = bandwidth;
              bestQualityUrl = resolvedUrl;
            }
          }
        }
      }

      if (bestQualityUrl) {
        console.log(
          'Found best quality stream:',
          bestQualityUrl,
          'with bandwidth:',
          highestBandwidth,
        );
        const chosen = await parseM3U8Playlist(bestQualityUrl, headers);
        return {...chosen, bandwidth: chosen.bandwidth ?? (highestBandwidth || undefined)};
      } else {
        throw new Error('No valid stream found in master playlist');
      }
    }

    // Parse regular playlist with segments
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('#EXT-X-ENDLIST')) {
        isLive = false;
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const method = line.match(/METHOD=([^,\s]+)/)?.[1];
        if (!method || method === 'NONE') {
          currentKey = undefined;
        } else if (method === 'AES-128') {
          const keyUri = line.match(/URI="([^"]+)"/)?.[1];
          if (!keyUri) {
            throw new Error('Encrypted HLS playlist has no key URI');
          }
          currentKey = {
            uri: resolveUrl(keyUri, url),
            iv: line.match(/IV=(0x[0-9a-fA-F]+)/i)?.[1],
          };
        } else {
          // SAMPLE-AES and friends need codec level handling.
          throw new Error(`Encrypted HLS (${method}) cannot be downloaded`);
        }
      } else if (line.startsWith('#EXT-X-BYTERANGE')) {
        throw new Error('HLS byte range playlists cannot be downloaded');
      } else if (line.includes('#EXT-X-MAP:')) {
        const uriMatch = line.match(/URI=["']?([^"']+)["']?/);
        if (uriMatch && uriMatch[1]) {
          initSegmentUrl = resolveUrl(uriMatch[1], url);
        }
      } else if (line.includes('#EXTINF:')) {
        const durationMatch = line.match(/#EXTINF:([\d.]+)/);
        const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;

        // Scan subsequent lines for the segment URL
        let segmentUrl = '';
        for (let j = i + 1; j < lines.length; j++) {
          const candidate = lines[j];
          if (candidate && !candidate.startsWith('#')) {
            segmentUrl = candidate;
            break;
          }
        }

        if (segmentUrl) {
          const resolvedSegmentUrl = resolveUrl(segmentUrl, url);
          segments.push({
            duration,
            url: resolvedSegmentUrl,
            index: segmentIndex,
            key: currentKey,
            mediaSequence: mediaSequenceStart + segmentIndex,
          });
          segmentIndex++;
          totalDuration += duration;
        }
      }
    }

    console.log(
      `Parsed ${segments.length} segments, total duration: ${totalDuration}s, hasInit: ${Boolean(initSegmentUrl)}`,
    );

    return {
      segments,
      initSegmentUrl,
      totalDuration,
      isLive,
    };
  } catch (error) {
    console.error('Error parsing M3U8:', error);
    throw error;
  }
};

// Hosts that refuse RNFS's HTTP/1.1 downloader (some CDNs only accept
// HTTP/2 clients). Segments from these go through axios/OkHttp instead.
const http2OnlyHosts = new Set<string>();

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const downloadSegmentViaAxios = async (
  segmentUrl: string,
  outputPath: string,
  reqHeaders: Record<string, string>,
): Promise<number> => {
  const response = await axios.get(segmentUrl, {
    headers: reqHeaders,
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  const bytes = new Uint8Array(response.data as ArrayBuffer);
  await RNFS.writeFile(outputPath, bytesToBase64(bytes), 'base64');
  return bytes.length;
};

const downloadSegment = async (
  downloadId: string,
  segmentUrl: string,
  outputPath: string,
  headers: Record<string, string> = {},
): Promise<number> => {
  if (cancelledDownloads.has(downloadId)) {
    throw new Error('Download cancelled');
  }

  const reqHeaders = normalizeHeaders(headers);
  const host = hostOf(segmentUrl);
  if (http2OnlyHosts.has(host)) {
    return downloadSegmentViaAxios(segmentUrl, outputPath, reqHeaders);
  }

  const download = RNFS.downloadFile({
    fromUrl: segmentUrl,
    toFile: outputPath,
    headers: reqHeaders,
    background: false,
    discretionary: false,
    cacheable: false,
    progressDivider: 0,
    connectionTimeout: 30000,
    readTimeout: 30000,
  });

  const result = await download.promise;
  if (result.statusCode < 200 || result.statusCode >= 400) {
    if (await RNFS.exists(outputPath)) {
      await RNFS.unlink(outputPath).catch(() => undefined);
    }
    if (result.statusCode === 403 && host) {
      // Likely an HTTP/1.1 block: switch this host to the HTTP/2 client
      // rather than retrying the same refused request.
      http2OnlyHosts.add(host);
      return downloadSegmentViaAxios(segmentUrl, outputPath, reqHeaders);
    }
    throw new Error(
      `Segment download failed with HTTP status ${result.statusCode}`,
    );
  }
  if (result.bytesWritten > 0) {
    return result.bytesWritten;
  }
  const info = await RNFS.stat(outputPath).catch(() => undefined);
  return Number(info?.size) || 0;
};

const downloadSegmentWithRetry = async (
  downloadId: string,
  segmentUrl: string,
  outputPath: string,
  headers: Record<string, string>,
): Promise<number> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt++) {
    try {
      return await downloadSegment(downloadId, segmentUrl, outputPath, headers);
    } catch (error) {
      lastError = error;
      const status = (error as any)?.response?.status;
      const refused =
        status === 401 ||
        status === 403 ||
        status === 404 ||
        /HTTP status (401|403|404)\b/.test(String((error as any)?.message));
      if (
        refused ||
        cancelledDownloads.has(downloadId) ||
        attempt === SEGMENT_ATTEMPTS
      ) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError;
};

const keyCache = new Map<string, Promise<Uint8Array>>();

const fetchKey = (
  keyUri: string,
  headers: Record<string, string>,
): Promise<Uint8Array> => {
  let pending = keyCache.get(keyUri);
  if (!pending) {
    pending = axios
      .get(keyUri, {
        headers: normalizeHeaders(headers),
        responseType: 'arraybuffer',
        timeout: 15000,
      })
      .then(res => new Uint8Array(res.data as ArrayBuffer))
      .then(key => {
        if (key.length !== 16) {
          throw new Error('HLS key is not 16 bytes');
        }
        return key;
      });
    pending.catch(() => keyCache.delete(keyUri));
    keyCache.set(keyUri, pending);
  }
  return pending;
};

/** Replaces an encrypted segment file with its decrypted bytes. */
const decryptSegmentFile = async (
  segment: SegmentInfo,
  filePath: string,
  headers: Record<string, string>,
): Promise<void> => {
  if (!segment.key) {
    return;
  }
  const key = await fetchKey(segment.key.uri, headers);
  const iv = segment.key.iv
    ? ivFromHex(segment.key.iv)
    : ivFromSequence(segment.mediaSequence);
  const encrypted = base64ToBytes(await RNFS.readFile(filePath, 'base64'));
  const decrypted = aes128CbcDecrypt(encrypted, key, iv);
  await RNFS.writeFile(filePath, bytesToBase64(decrypted), 'base64');
};

type NativeSegmentModule = {
  downloadSegment?: (
    url: string,
    headers: Record<string, string>,
    outputPath: string,
    keyBase64: string | null,
    ivHex: string | null,
  ) => Promise<number>;
};

const getNativeSegmentDownloader = () => {
  const native = NativeModules.ProviderHttpModule as NativeSegmentModule | undefined;
  return Platform.OS === 'android' && native?.downloadSegment
    ? native.downloadSegment
    : undefined;
};

const ivToHex = (iv: Uint8Array): string =>
  Array.from(iv, byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * Download a segment and decrypt it if needed. On Android this runs natively
 * (HTTP/2, streamed AES), so big downloads don't block the JavaScript thread
 * and freeze the app; elsewhere it falls back to the JavaScript path.
 */
const fetchSegment = async (
  downloadId: string,
  segment: SegmentInfo,
  outputPath: string,
  headers: Record<string, string>,
): Promise<number> => {
  const nativeDownload = getNativeSegmentDownloader();
  if (!nativeDownload) {
    const written = await downloadSegmentWithRetry(
      downloadId,
      segment.url,
      outputPath,
      headers,
    );
    await decryptSegmentFile(segment, outputPath, headers);
    return written;
  }
  let keyBase64: string | null = null;
  let ivHex: string | null = null;
  if (segment.key) {
    keyBase64 = bytesToBase64(await fetchKey(segment.key.uri, headers));
    ivHex = ivToHex(
      segment.key.iv
        ? ivFromHex(segment.key.iv)
        : ivFromSequence(segment.mediaSequence),
    );
  }
  const reqHeaders = normalizeHeaders(headers);
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt++) {
    if (cancelledDownloads.has(downloadId)) {
      throw new Error('Download cancelled');
    }
    try {
      return await nativeDownload(
        segment.url,
        reqHeaders,
        outputPath,
        keyBase64,
        ivHex,
      );
    } catch (error) {
      lastError = error;
      if (/HTTP status (401|403|404)\b/.test(String((error as any)?.message))) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError;
};

const mergeSegments = async (
  segmentPaths: string[],
  outputPath: string,
): Promise<void> => {
  const native = NativeModules.SafCopyModule as
    | {concatFiles?: (from: string[], to: string) => Promise<number>}
    | undefined;
  if (native?.concatFiles) {
    const existing: string[] = [];
    for (const segmentPath of segmentPaths) {
      if (segmentPath && (await RNFS.exists(segmentPath))) {
        existing.push(segmentPath);
      }
    }
    if (existing.length === 0) {
      throw new Error('Failed to merge HLS segments: no downloaded segments available');
    }
    await native.concatFiles(existing, outputPath);
    return;
  }

  let isFirstFile = true;
  let mergedCount = 0;

  for (const segmentPath of segmentPaths) {
    if (!segmentPath) continue;
    if (await RNFS.exists(segmentPath)) {
      if (isFirstFile) {
        await RNFS.copyFile(segmentPath, outputPath);
        isFirstFile = false;
      } else {
        const content = await RNFS.readFile(segmentPath, 'base64');
        await RNFS.appendFile(outputPath, content, 'base64');
      }
      mergedCount++;

      // Clean up segment file immediately
      await RNFS.unlink(segmentPath).catch(() => undefined);
    }
  }

  if (mergedCount === 0 || !(await RNFS.exists(outputPath))) {
    throw new Error('Failed to merge HLS segments: no downloaded segments available');
  }
};

export const hlsDownloader2 = async ({
  videoUrl,
  downloadId,
  path,
  title,
  tempDirectory,
  onJobStarted,
  onProgress,
  onCompleted,
  headers = {},
  audioOnly,
}: {
  videoUrl: string;
  downloadId: string;
  path: string;
  title: string;
  tempDirectory?: string;
  onJobStarted?: (jobId: string) => void;
  onProgress?: (
    completedSegments: number,
    totalSegments: number,
    stats: HlsProgressStats,
  ) => void;
  onCompleted?: (outputPath: string) => void | Promise<void>;
  headers?: any;
  /** Take only the sound: an audio rendition, or else the lightest stream. */
  audioOnly?: HlsAudioWish;
}) => {
  cancelledDownloads.delete(downloadId);
  activeDownloads.add(downloadId);
  onJobStarted?.(downloadId);

  const tempDir = tempDirectory || `${RNFS.CachesDirectoryPath}/hls_segments`;

  try {
    // Ensure temp directory exists
    if (!(await RNFS.exists(tempDir))) {
      await RNFS.mkdir(tempDir);
    }

    // Parse the M3U8 playlist
    console.log('Parsing M3U8 playlist...');
    const m3u8Data = await parseM3U8Playlist(videoUrl, headers, audioOnly);

    if (m3u8Data.segments.length === 0) {
      throw new Error('No segments found in playlist');
    }

    console.log(
      `Found ${m3u8Data.segments.length} segments, total duration: ${m3u8Data.totalDuration}s`,
    );

    const segmentPaths: string[] = [];
    let initBytes = 0;

    // Download init segment (fMP4 EXT-X-MAP) if present
    if (m3u8Data.initSegmentUrl) {
      const initPath = `${tempDir}/init_segment.mp4`;
      console.log('Downloading fMP4 init segment...');
      initBytes = await downloadSegment(downloadId, m3u8Data.initSegmentUrl, initPath, headers);
      segmentPaths.push(initPath);
    }

    let downloadedSegments = 0;
    let downloadedBytes = initBytes;
    let downloadedDuration = 0;
    const samples: Array<{at: number; bytes: number}> = [];
    // Until real segments arrive, guess the size from the stream's bitrate.
    const bandwidthEstimate = m3u8Data.bandwidth
      ? (m3u8Data.bandwidth / 8) * m3u8Data.totalDuration
      : 0;
    const reportProgress = () => {
      const now = Date.now();
      samples.push({at: now, bytes: downloadedBytes});
      while (samples.length > 1 && now - samples[0].at > SPEED_WINDOW_MS) {
        samples.shift();
      }
      const first = samples[0];
      const span = (now - first.at) / 1000;
      const speed = span >= 0.5 ? (downloadedBytes - first.bytes) / span : 0;
      const measured =
        downloadedDuration > 0 && m3u8Data.totalDuration > 0
          ? (downloadedBytes / downloadedDuration) * m3u8Data.totalDuration
          : 0;
      // Trust the measured size once enough of the video has arrived.
      const enough = downloadedSegments >= 3 || downloadedSegments / m3u8Data.segments.length >= 0.05;
      const estimate = enough && measured > 0 ? measured : bandwidthEstimate || measured;
      onProgress?.(downloadedSegments, m3u8Data.segments.length, {
        bytes: downloadedBytes,
        estimatedTotal: estimate > 0 ? Math.max(estimate, downloadedBytes) : 0,
        speed: Math.max(speed, 0),
      });
    };
    reportProgress();
    // A pool of workers, so one slow segment doesn't hold up the others.
    const queue = m3u8Data.segments.slice();
    let failed = false;
    const worker = async () => {
      for (;;) {
        if (failed) {
          return;
        }
        // Paused: segments already running finish, no new ones start.
        while (
          pausedDownloads.has(downloadId) &&
          !cancelledDownloads.has(downloadId)
        ) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (cancelledDownloads.has(downloadId)) {
          throw new Error('Download cancelled by user');
        }
        const segment = queue.shift();
        if (!segment) {
          return;
        }
        const segmentPath = `${tempDir}/segment_${segment.index}.ts`;
        segmentPaths[segment.index + (m3u8Data.initSegmentUrl ? 1 : 0)] = segmentPath;
        // Add after the await: segments finish concurrently.
        let written: number;
        try {
          written = await fetchSegment(
            downloadId,
            segment,
            segmentPath,
            headers,
          );
        } catch (error) {
          failed = true;
          throw error;
        }
        downloadedBytes += written;
        downloadedSegments++;
        downloadedDuration += segment.duration;
        reportProgress();
      }
    };
    await Promise.all(
      Array.from(
        {length: Math.min(MAX_CONCURRENT_SEGMENTS, m3u8Data.segments.length)},
        worker,
      ),
    );

    if (cancelledDownloads.has(downloadId)) {
      throw new Error('Download cancelled by user');
    }

    // Merge all segments into final file
    console.log('Merging segments...');
    await mergeSegments(segmentPaths, path);

    // Clean up temp directory
    if (await RNFS.exists(tempDir)) {
      await RNFS.unlink(tempDir).catch(() => undefined);
    }

    if (cancelledDownloads.has(downloadId)) {
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path).catch(() => undefined);
      }
      throw new Error('Download cancelled by user');
    }

    // Success
    console.log('Download completed successfully');
    await onCompleted?.(path);
  } catch (error) {
    console.error('HLS download failed:', error);

    const cancelled = cancelledDownloads.has(downloadId);

    if (await RNFS.exists(tempDir)) {
      await RNFS.unlink(tempDir).catch(() => undefined);
    }

    if (await RNFS.exists(path)) {
      await RNFS.unlink(path).catch(() => undefined);
    }

    const errorMessage = cancelled
      ? 'Download cancelled'
      : `Failed to download ${title}`;
    console.error(errorMessage);

    throw error;
  } finally {
    activeDownloads.delete(downloadId);
    cancelledDownloads.delete(downloadId);
    pausedDownloads.delete(downloadId);
  }
};

export const pauseHlsDownload = (downloadId: string) => {
  if (activeDownloads.has(downloadId)) {
    pausedDownloads.add(downloadId);
  }
};

export const resumeHlsDownload = (downloadId: string) => {
  pausedDownloads.delete(downloadId);
};

// Function to cancel ongoing download
export const cancelHlsDownload = (downloadId: string) => {
  if (activeDownloads.has(downloadId)) {
    cancelledDownloads.add(downloadId);
    console.log(`Cancelling HLS download: ${downloadId}`);
  }
};

// Check if a download is in progress
export const isHlsDownloadInProgress = (downloadId: string): boolean =>
  activeDownloads.has(downloadId) && !cancelledDownloads.has(downloadId);

