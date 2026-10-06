import type {Stream} from '../providers/types';
import {
  applyQualityPreference,
  getServerLabel,
  isTorrentStream,
  normalizeServerName,
  orderServersByRule,
  serverKeyMatches,
  type ServerRule,
} from './serverRules';

export type ProbeStatus = 'ok' | 'dead' | 'unknown';

export interface ProbeResult {
  status: ProbeStatus;
  httpStatus?: number;
  /** File size in bytes, when the server told us. */
  size?: number;
}

export type ProbeFn = (stream: Stream) => Promise<ProbeResult>;

export type PickResult =
  | {
      status: 'picked';
      server: Stream;
      /** 'rule' when the server came from the rule, 'auto' otherwise. */
      via: 'rule' | 'auto';
      /** Labels of rule servers that were missing or failed the check. */
      skipped: string[];
      /** File size in bytes, when the check could read it. */
      size?: number;
    }
  | {status: 'ask'; skipped: string[]}
  | {status: 'none'; skipped: string[]};

const PROBE_TIMEOUT_MS = 8000;
/** Most servers checked when falling back to "best available". */
const MAX_AUTO_PROBES = 4;

const HEADERS_RECEIVED = 2;

const parseTotalSize = (
  contentRange: string | null,
  contentLength: string | null,
): number | undefined => {
  const total = contentRange?.match(/\/(\d+)\s*$/)?.[1];
  if (total) {
    return Number(total);
  }
  // A server that ignores Range answers 200 with the whole file's length.
  const length = Number(contentLength);
  return Number.isFinite(length) && length > 1 ? length : undefined;
};

/**
 * Check that a download link answers, without downloading the file. Sends a
 * one-byte range request and aborts as soon as the headers arrive.
 */
export const probeStreamLink: ProbeFn = stream =>
  new Promise(resolve => {
    if (!stream.link || isTorrentStream(stream)) {
      resolve({status: 'unknown'});
      return;
    }

    let settled = false;
    const xhr = new XMLHttpRequest();
    const finish = (result: ProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        xhr.abort();
      } catch {}
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({status: 'unknown'}),
      PROBE_TIMEOUT_MS,
    );

    xhr.onreadystatechange = () => {
      if (xhr.readyState < HEADERS_RECEIVED || settled) {
        return;
      }
      const httpStatus = xhr.status;
      const contentType = (
        xhr.getResponseHeader('content-type') || ''
      ).toLowerCase();
      if (httpStatus === 200 || httpStatus === 206) {
        // Dead file hosts often answer 200 with an HTML error page.
        finish({
          status: contentType.includes('text/html') ? 'dead' : 'ok',
          httpStatus,
          size: parseTotalSize(
            xhr.getResponseHeader('content-range'),
            xhr.getResponseHeader('content-length'),
          ),
        });
      } else if (httpStatus >= 400) {
        finish({status: 'dead', httpStatus});
      } else {
        finish({status: 'unknown', httpStatus});
      }
    };
    xhr.onerror = () => finish({status: 'unknown'});

    try {
      xhr.open('GET', stream.link);
      for (const [name, value] of Object.entries(stream.headers || {})) {
        if (typeof value === 'string') {
          xhr.setRequestHeader(name, value);
        }
      }
      xhr.setRequestHeader('Range', 'bytes=0-0');
      xhr.send();
    } catch {
      finish({status: 'unknown'});
    }
  });

/**
 * Pick the server to download with, following a rule:
 * 1. rule servers in order, using the first one whose link answers;
 * 2. then the rule's "if none work" action: best available, ask, or skip.
 *
 * A link that can't be checked (timeout, network error) is used only when no
 * link could be confirmed, so a blocked check doesn't stop the download.
 *
 * `rank` orders the servers that are not in the rule before the "best
 * available" fallback. `onProbe` sees every check result. `excludeKeys` drops
 * servers by normalized name, for retrying after one of them failed.
 */
export const pickDownloadServer = async ({
  servers: allServers,
  rule,
  probe = probeStreamLink,
  rank,
  onProbe,
  excludeKeys,
}: {
  servers: Stream[];
  rule: Pick<ServerRule, 'order' | 'onNoMatch'> &
    Partial<Pick<ServerRule, 'quality'>>;
  probe?: ProbeFn;
  rank?: (servers: Stream[]) => Stream[];
  onProbe?: (server: Stream, result: ProbeResult) => void;
  excludeKeys?: string[];
}): Promise<PickResult> => {
  const excluded = new Set(excludeKeys || []);
  const servers = applyQualityPreference(
    allServers.filter(
      server => !excluded.has(normalizeServerName(server.server)),
    ),
    rule.quality,
  );
  const {matched, rest} = orderServersByRule(servers, rule);
  const serverKeys = servers.map(server => normalizeServerName(server.server));
  // Rule servers this file doesn't have at all.
  const skipped = rule.order
    .filter(entry => !serverKeys.some(key => serverKeyMatches(key, entry.key)))
    .map(entry => entry.label);

  const check = async (server: Stream): Promise<ProbeResult> => {
    const result = await probe(server);
    onProbe?.(server, result);
    return result;
  };

  let firstUnchecked: Stream | undefined;
  for (const server of matched) {
    const result = await check(server);
    if (result.status === 'ok') {
      return {
        status: 'picked',
        server,
        via: 'rule',
        skipped,
        size: result.size,
      };
    }
    if (result.status === 'unknown' && !firstUnchecked) {
      firstUnchecked = server;
    } else if (result.status === 'dead') {
      skipped.push(getServerLabel(server.server));
    }
  }
  if (firstUnchecked) {
    return {status: 'picked', server: firstUnchecked, via: 'rule', skipped};
  }

  if (rule.onNoMatch === 'ask') {
    return {status: 'ask', skipped};
  }
  if (rule.onNoMatch === 'skip') {
    return {status: 'none', skipped};
  }

  const candidates = (rank ? rank(rest) : rest).filter(
    server => !isTorrentStream(server),
  );
  let firstUncheckedAuto: Stream | undefined;
  for (const server of candidates.slice(0, MAX_AUTO_PROBES)) {
    const result = await check(server);
    if (result.status === 'ok') {
      return {
        status: 'picked',
        server,
        via: 'auto',
        skipped,
        size: result.size,
      };
    }
    if (result.status === 'unknown' && !firstUncheckedAuto) {
      firstUncheckedAuto = server;
    }
  }
  if (firstUncheckedAuto) {
    return {
      status: 'picked',
      server: firstUncheckedAuto,
      via: 'auto',
      skipped,
    };
  }
  return {status: 'none', skipped};
};
