import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, ToastAndroid, Pressable, UIManager, findNodeHandle } from 'react-native';
import { ifExists } from '../lib/file/ifExists';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Octicons from '@expo/vector-icons/Octicons';
import { Stream, SkipInterval } from '../lib/providers/types';
import Svg, { Circle, Path } from 'react-native-svg';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import useContentStore from '../lib/zustand/contentStore';
import * as IntentLauncher from 'expo-intent-launcher';
import { cancelDownload } from '../lib/downloadManager';
import { downloadManager } from '../lib/downloader';
import DownloadBottomSheet, { type RememberScope } from './DownloadBottomSheet';
import ServerOrderEditor from './ServerOrderEditor';
import LoadingIndicator from './ui/LoadingIndicator';
import { settingsStorage } from '../lib/storage';
import { useTVFocusBorderColor } from '../lib/tv/useTVFocusBorderColor';
import { isTV } from '../lib/tv';
import { TVFocusable } from './tv';
import { providerManager } from '../lib/services/ProviderManager';
import { deleteDownloadedFileByBaseName } from '../lib/downloadLocation';
import { deleteDownloadOutput } from '../lib/downloadDestination';
import {
  createDownloadDirectoryName,
  createDownloadSeasonDirectoryName,
  createSubtitleFileName,
  isSubtitleDownloadItem,
} from '../lib/downloadId';
import useDownloadsStore, {
  CURRENT_DOWNLOAD_STATUSES,
  type DownloadItem,
} from '../lib/zustand/downloadsStore';
import {
  selectDownloadLocation,
  validateDownloadLocationAccess,
} from '../lib/downloadLocation';
import DownloadLocationDialog from './DownloadLocationDialog';
import { useM3Colors } from '../theme/M3PaletteContext';
import { LEGACY_TERTIARY_BACKGROUND } from '../theme/seeds';
import { showAppDialog } from '../lib/zustand/appDialogStore';
import { extensionStorage } from '../lib/storage/extensionStorage';
import {
  buildRuleFromSelection,
  describeRule,
  getServerLabel,
  isTorrentStream,
  serverRulesStorage,
  toRuleEntry,
  type NoMatchAction,
  type QualityPreference,
  type ServerRule,
  type ServerRuleEntry,
  type ServerRuleScope,
} from '../lib/download/serverRules';
import { type PickResult } from '../lib/download/pickServer';
import { pickServerWithHealth } from '../lib/download/pickWithHealth';
import { getServerHealth } from '../lib/download/serverHealth';
import { findDuplicateDownload } from '../lib/download/duplicates';
import { getAudioLanguageCode } from '../lib/download/audioMerge';
import TextPromptDialog from './TextPromptDialog';
import { pickDownloadSubtitle } from '../lib/download/subtitlePick';

const DOWNLOAD_PROGRESS_SIZE = 42;
const DOWNLOAD_PROGRESS_RADIUS = 18;
const DOWNLOAD_PROGRESS_CENTER = DOWNLOAD_PROGRESS_SIZE / 2;

const createProgressPiePath = (progress: number) => {
  if (progress <= 0 || progress >= 1) {
    return undefined;
  }
  const endAngle = progress * Math.PI * 2 - Math.PI / 2;
  const endX =
    DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.cos(endAngle);
  const endY =
    DOWNLOAD_PROGRESS_CENTER + DOWNLOAD_PROGRESS_RADIUS * Math.sin(endAngle);
  const largeArcFlag = progress > 0.5 ? 1 : 0;

  return [
    `M ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER}`,
    `L ${DOWNLOAD_PROGRESS_CENTER} ${DOWNLOAD_PROGRESS_CENTER - DOWNLOAD_PROGRESS_RADIUS
    }`,
    `A ${DOWNLOAD_PROGRESS_RADIUS} ${DOWNLOAD_PROGRESS_RADIUS} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
    'Z',
  ].join(' ');
};

const DownloadProgress = ({
  downloadedBytes,
  totalBytes,
  color,
}: {
  downloadedBytes: number;
  totalBytes: number;
  color: string;
}) => {
  const hasKnownTotal = totalBytes > 0;
  const progress = hasKnownTotal
    ? Math.min(1, Math.max(0, downloadedBytes / totalBytes))
    : 0;
  const progressPath = createProgressPiePath(progress);

  return (
    <View
      style={{
        alignItems: 'center',
        height: DOWNLOAD_PROGRESS_SIZE,
        justifyContent: 'center',
        width: DOWNLOAD_PROGRESS_SIZE,
      }}>
      <Svg
        height={DOWNLOAD_PROGRESS_SIZE}
        width={DOWNLOAD_PROGRESS_SIZE}
        style={{ position: 'absolute' }}>
        <Circle
          cx={DOWNLOAD_PROGRESS_CENTER}
          cy={DOWNLOAD_PROGRESS_CENTER}
          r={DOWNLOAD_PROGRESS_RADIUS}
          fill="rgba(255,255,255,0.16)"
        />
        {progress >= 1 ? (
          <Circle
            cx={DOWNLOAD_PROGRESS_CENTER}
            cy={DOWNLOAD_PROGRESS_CENTER}
            r={DOWNLOAD_PROGRESS_RADIUS}
            fill={color}
          />
        ) : progressPath ? (
          <Path d={progressPath} fill={color} />
        ) : null}
      </Svg>
      {!hasKnownTotal ? (
        <MaterialIcons name="downloading" size={24} color={color} />
      ) : null}
    </View>
  );
};

type PendingDownload = {
  downloadId: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  mediaType: 'movie' | 'series';
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  provider?: string;
  server?: string;
  isSubtitle?: boolean;
  infoUrl?: string;
  sourceLink?: string;
  url: string;
  fileName: string;
  fileType: string;
  headers?: Record<string, string>;
  subtitles?: Array<{ url: string; language: string; format?: string }>;
  skip?: SkipInterval[];
  audio?: { targetId: string; label: string; language: string };
  deleteDownload: () => void;
};

const DownloadComponent = ({
  link,
  downloadId,
  fileName,
  type,
  mediaType,
  providerValue,
  title,
  showName,
  episodeName,
  seasonTitle,
  episodeIndex,
  imdbId,
  poster,
  background,
  synopsis,
  infoUrl,
  skip,
}: {
  link: string;
  downloadId: string;
  fileName: string;
  type: string;
  mediaType: 'movie' | 'series';
  providerValue: string;
  title: string;
  showName?: string;
  episodeName?: string;
  seasonTitle?: string;
  episodeIndex?: number;
  imdbId?: string;
  poster?: string;
  background?: string;
  synopsis?: string;
  infoUrl?: string;
  skip?: SkipInterval[];
}) => {
  const colors = useM3Colors();
  const primary = colors.primary;
  const focusBorderColor = useTVFocusBorderColor(primary);
  const provider = useContentStore(state => state.provider);

  const videoDownload = useDownloadsStore(
    state =>
      (state.downloads[downloadId] &&
        !isSubtitleDownloadItem(state.downloads[downloadId])
        ? state.downloads[downloadId]
        : null) ||
      Object.values(state.downloads).find(
        item =>
          !isSubtitleDownloadItem(item) &&
          item.infoUrl === infoUrl &&
          item.sourceLink === link,
      ),
  );

  const subDownloads = useDownloadsStore(state =>
    Object.values(state.downloads).filter(
      item =>
        isSubtitleDownloadItem(item) &&
        (item.id.startsWith(`${downloadId}_subtitle_`) ||
          (item.infoUrl === infoUrl && item.sourceLink === link)),
    ),
  );

  const removeDownload = useDownloadsStore(state => state.removeDownload);
  const [legacyDownloadedFile, setLegacyDownloadedFile] = useState<
    string | boolean
  >(false);
  const [downloadModal, setDownloadModal] = useState(false);
  const downloadButtonRef = React.useRef<View>(null);
  // Set while the user picks a server only to take its audio for a video that
  // is already downloaded.
  const audioModeRef = useRef<{
    target: DownloadItem;
    label: string;
    armedAt: number;
  } | null>(null);
  const [audioPromptFor, setAudioPromptFor] = useState<DownloadItem | null>(null);
  const getAudioMode = () => {
    const mode = audioModeRef.current;
    return mode && Date.now() - mode.armedAt < 120000 ? mode : null;
  };
  const setDownloadModalWithFocus = (visible: boolean) => {
    setDownloadModal(visible);
    if (!visible) {
      // After a server was tapped (which reads it first), the mode is over.
      setTimeout(() => {
        audioModeRef.current = null;
      }, 0);
    }
    if (!visible && isTV) {
      setTimeout(() => {
        const handle = findNodeHandle(downloadButtonRef.current);
        if (handle) {
          UIManager.dispatchViewManagerCommand(handle, 'requestTVFocus', []);
        }
      }, 150);
    }
  };
  const [servers, setServers] = useState<Stream[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingDownload, setPendingDownload] =
    useState<PendingDownload | null>(null);
  const [locationDialogVisible, setLocationDialogVisible] = useState(false);
  const [selectingLocation, setSelectingLocation] = useState(false);
  // Why the sheet opened instead of downloading with the saved rule.
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [editorScope, setEditorScope] = useState<ServerRuleScope | null>(null);
  // Bumped when a rule changes, so the sheet re-reads it.
  const [, setRuleVersion] = useState(0);

  const providerKey = providerValue || provider.value;
  const canRememberSeries = mediaType === 'series' && Boolean(infoUrl);

  const isVideoActive = Boolean(
    videoDownload && CURRENT_DOWNLOAD_STATUSES.has(videoDownload.status),
  );
  const activeSubDownload = subDownloads.find(sub =>
    CURRENT_DOWNLOAD_STATUSES.has(sub.status),
  );
  const downloadActive = isVideoActive || Boolean(activeSubDownload);
  const currentActiveDownload =
    videoDownload && isVideoActive ? videoDownload : activeSubDownload;

  const isVideoDownloaded =
    videoDownload?.status === 'completed' || Boolean(legacyDownloadedFile);
  const hasDownloadedSubs = subDownloads.some(
    sub => sub.status === 'completed',
  );

  const downloadedSubsList = subDownloads
    .filter(s => s.status === 'completed')
    .map(s => {
      let subTitle = s.episodeName || s.title;
      if (s.id.includes('_subtitle_')) {
        const parts = s.id.split('_subtitle_');
        if (parts[1]) subTitle = parts[1];
      }
      return {
        id: s.id,
        title: subTitle,
        filePath: s.filePath,
      };
    });

  const startDownloadWithLocation = async (request: PendingDownload) => {
    const currentLocation = settingsStorage.getDownloadLocationConfig();
    if (await validateDownloadLocationAccess(currentLocation)) {
      await downloadManager(request);
      return;
    }
    setPendingDownload(request);
    setLocationDialogVisible(true);
  };

  const selectLocationAndContinue = async () => {
    if (!pendingDownload || selectingLocation) {
      return;
    }
    setSelectingLocation(true);
    try {
      const location = await selectDownloadLocation();
      if (!location || !(await validateDownloadLocationAccess(location))) {
        return;
      }
      settingsStorage.setDownloadLocation(location);
      const request = pendingDownload;
      setPendingDownload(null);
      setLocationDialogVisible(false);
      await downloadManager(request);
    } finally {
      setSelectingLocation(false);
    }
  };

  useEffect(() => {
    if (videoDownload) {
      return;
    }
    const checkIfDownloaded = async () => {
      const exists = await ifExists(fileName);
      setLegacyDownloadedFile(exists);
    };
    checkIfDownloaded();
  }, [videoDownload, fileName]);

  // handle video download deletion
  const deleteVideoDownload = async () => {
    try {
      const target = videoDownload;
      const deleted = target?.filePath
        ? await deleteDownloadOutput(target.filePath, {
          downloadLocation: target.downloadLocation,
          outputDirectoryNames: [
            createDownloadDirectoryName(target.showName || target.title),
            ...[createDownloadSeasonDirectoryName(target.seasonTitle)].filter(
              (name): name is string => Boolean(name),
            ),
          ],
        })
        : await deleteDownloadedFileByBaseName(
          settingsStorage.getDownloadLocationConfig(),
          fileName,
        );

      if (deleted) {
        removeDownload(target?.id || downloadId);
        setLegacyDownloadedFile(false);
      }
    } catch (error) {
      console.error('Error deleting video download:', error);
    }
  };

  // handle subtitle download deletion
  const deleteSubtitleDownload = async (subTitle: string) => {
    try {
      const subItem = subDownloads.find(
        s =>
          s.id === `${downloadId}_subtitle_${subTitle}` ||
          s.title.includes(subTitle),
      );
      if (!subItem) {
        return;
      }

      const deleted = subItem.filePath
        ? await deleteDownloadOutput(subItem.filePath, {
          downloadLocation: subItem.downloadLocation,
          outputDirectoryNames: [
            createDownloadDirectoryName(subItem.showName || subItem.title),
            ...[createDownloadSeasonDirectoryName(subItem.seasonTitle)].filter(
              (name): name is string => Boolean(name),
            ),
          ],
        })
        : await deleteDownloadedFileByBaseName(
          settingsStorage.getDownloadLocationConfig(),
          createSubtitleFileName(fileName, subTitle),
        );

      if (deleted) {
        removeDownload(subItem.id);
      }
    } catch (error) {
      console.error('Error deleting subtitle download:', error);
    }
  };

  const isSubDownloaded = (subTitle: string): boolean => {
    return subDownloads.some(
      s =>
        (s.id === `${downloadId}_subtitle_${subTitle}` ||
          s.title.includes(subTitle)) &&
        s.status === 'completed',
    );
  };

  const downloadAudioStream = async (
    server: Stream,
    mode: { target: DownloadItem; label: string },
  ) => {
    await startDownloadWithLocation({
      downloadId: `${downloadId}_audio_${mode.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
      title: `${showName || title} - ${mode.label} audio`,
      showName,
      episodeName,
      seasonTitle,
      episodeIndex,
      mediaType,
      imdbId,
      provider: providerValue || provider.value,
      server: server.server,
      infoUrl,
      sourceLink: link,
      url: server.link,
      fileName: `${fileName} [${mode.label} audio]`,
      fileType: server.type,
      headers: server?.headers,
      audio: {
        targetId: mode.target.id,
        label: mode.label,
        language: getAudioLanguageCode(mode.label),
      },
      deleteDownload: () => undefined,
    });
    ToastAndroid.show(
      `${mode.label} audio will be added to the video you have`,
      ToastAndroid.LONG,
    );
  };

  const downloadSingleVideoStream = async (server: Stream) => {
    const audioMode = getAudioMode();
    if (audioMode) {
      audioModeRef.current = null;
      await downloadAudioStream(server, audioMode);
      return;
    }
    const resolvedSkip =
      server.skip && server.skip.length > 0
        ? server.skip
        : (server as any)?.skips && (server as any).skips.length > 0
          ? (server as any).skips
          : skip && skip.length > 0
            ? skip
            : undefined;

    await startDownloadWithLocation({
      downloadId,
      title: title,
      showName,
      episodeName,
      seasonTitle,
      episodeIndex,
      mediaType,
      imdbId,
      poster,
      background,
      synopsis,
      provider: providerValue || provider.value,
      server: server.server,
      infoUrl,
      sourceLink: link,
      url: server.link,
      fileName: fileName,
      fileType: server.type,
      headers: server?.headers,
      skip: resolvedSkip,
      subtitles: server.subtitles?.map(subtitle => ({
        url: subtitle.uri,
        language: subtitle.language || 'Unknown',
        format: subtitle.type === 'text/vtt' ? 'vtt' : 'srt',
      })),
      deleteDownload: deleteVideoDownload,
    });
  };

  const downloadQuickStream = async (server: Stream) => {
    const audioOnly = Boolean(getAudioMode());
    await downloadSingleVideoStream(server);
    if (audioOnly) {
      return;
    }

    const sub = settingsStorage.isDownloadSubtitlesEnabled()
      ? pickDownloadSubtitle(
          server.subtitles,
          settingsStorage.getDownloadSubtitleLanguage(),
        )
      : undefined;
    if (sub) {
      await startDownloadWithLocation({
        downloadId: `${downloadId}_subtitle_${sub.title}`,
        title: title + ' ' + sub.title + ' Subtitle ',
        showName,
        episodeName,
        seasonTitle,
        episodeIndex,
        mediaType,
        imdbId,
        poster,
        background,
        synopsis,
        provider: providerValue || provider.value,
        isSubtitle: true,
        infoUrl,
        sourceLink: link,
        url: sub.uri,
        fileName: createSubtitleFileName(fileName, sub.title),
        fileType: sub.type === 'text/vtt' ? 'vtt' : 'srt',
        deleteDownload: () => deleteSubtitleDownload(sub.title),
      });
    }
  };

  const getProviderName = () =>
    extensionStorage
      .getInstalledProviders()
      .find(item => item.value === providerKey)?.display_name ||
    provider.display_name ||
    providerKey;

  const loadServers = async (): Promise<Stream[]> => {
    const availableServers = await providerManager.getStream({
      link,
      type,
      signal: new AbortController().signal,
      providerValue: providerKey,
      isDownload: true,
    });
    const validServers = availableServers || [];
    setServers(validServers);
    serverRulesStorage.recordKnownServers(providerKey, validServers);
    return validServers;
  };

  const openSheetWithNotice = (notice: string | null) => {
    setServerNotice(notice);
    setDownloadModal(true);
  };

  const showPickToast = (result: Extract<PickResult, { status: 'picked' }>) => {
    const label = getServerLabel(result.server.server);
    const unavailable =
      result.skipped.length > 0
        ? ` (${result.skipped.join(', ')} unavailable)`
        : '';
    const via = result.via === 'auto' ? ' · best available' : '';
    ToastAndroid.show(
      `Downloading via ${label}${via}${unavailable}`,
      ToastAndroid.SHORT,
    );
  };

  const getRuleForScope = (scope: ServerRuleScope): ServerRule | undefined =>
    scope === 'series'
      ? serverRulesStorage.getSeriesRule(providerKey, infoUrl)
      : serverRulesStorage.getProviderRule(providerKey);

  const saveRule = (scope: ServerRuleScope, rule: ServerRule) => {
    if (scope === 'series' && infoUrl) {
      serverRulesStorage.setSeriesRule(
        providerKey,
        infoUrl,
        rule,
        showName || title,
      );
    } else {
      serverRulesStorage.setProviderRule(providerKey, rule);
    }
    setRuleVersion(version => version + 1);
    ToastAndroid.show(
      `Saved for ${scope === 'series' ? 'this series' : getProviderName()}: ${describeRule(rule)}`,
      ToastAndroid.SHORT,
    );
  };

  const clearRule = (scope: ServerRuleScope) => {
    if (scope === 'series' && infoUrl) {
      serverRulesStorage.clearSeriesRule(providerKey, infoUrl);
    } else {
      serverRulesStorage.clearProviderRule(providerKey);
    }
    setRuleVersion(version => version + 1);
  };

  const fetchAndOpenSheet = async (
    isLongPress = false,
    skipDuplicateCheck = false,
  ) => {
    const isAlwaysExternal =
      settingsStorage.getBool('alwaysExternalDownloader') === true;
    const canAutoDownload =
      !isLongPress &&
      !isAlwaysExternal &&
      !isVideoDownloaded &&
      !hasDownloadedSubs;
    const resolved = canAutoDownload
      ? serverRulesStorage.resolve(providerKey, infoUrl)
      : null;

    // The same episode may already be here from another source.
    if (canAutoDownload && !downloadActive && !skipDuplicateCheck) {
      const duplicate = findDuplicateDownload(
        {
          id: downloadId,
          title,
          showName,
          imdbId,
          type: mediaType,
          seasonTitle,
          episodeName,
          episodeIndex,
        },
        useDownloadsStore.getState().downloads,
      );
      if (duplicate) {
        const where = duplicate.item.provider
          ? ` from ${duplicate.item.provider}`
          : '';
        showAppDialog({
          title:
            duplicate.kind === 'completed'
              ? 'Already downloaded'
              : 'Already downloading',
          message:
            duplicate.kind === 'completed'
              ? `This episode is already on your device${where}. Download it again?`
              : `This episode is already queued or downloading${where}. Download it again?`,
          variant: 'warning',
          actions: [
            { label: 'Cancel' },
            ...(duplicate.kind === 'completed'
              ? [
                {
                  label: 'Add as audio',
                  onPress: () => setAudioPromptFor(duplicate.item),
                },
              ]
              : []),
            {
              label: 'Download again',
              onPress: () => {
                fetchAndOpenSheet(false, true).catch(console.error);
              },
            },
          ],
        });
        return;
      }
    }

    if (!resolved) {
      openSheetWithNotice(null);
      if (serverLoading || (!isLongPress && servers.length > 0)) {
        return;
      }
      setServerLoading(true);
      setServerError(null);
      try {
        const validServers = await loadServers();
        if (validServers.length === 0) {
          setServerError('No downloadable streams found');
        }
      } catch (error: any) {
        console.error('Error fetching servers:', error);
        setServerError(error?.message || 'Failed to fetch servers');
        setServers([]);
      } finally {
        setServerLoading(false);
      }
      return;
    }

    if (serverLoading) {
      return;
    }
    setServerLoading(true);
    setServerError(null);
    try {
      const availableServers =
        servers.length > 0 ? servers : await loadServers();
      if (availableServers.length === 0) {
        setServerError('No downloadable streams found');
        openSheetWithNotice(null);
        return;
      }
      const result = await pickServerWithHealth({
        provider: providerKey,
        servers: availableServers,
        rule: resolved.rule,
      });
      if (result.status === 'picked') {
        await downloadQuickStream(result.server);
        showPickToast(result);
        return;
      }
      openSheetWithNotice(
        result.skipped.length > 0
          ? `${result.skipped.join(', ')} not available for this file. Pick a server.`
          : 'None of your saved servers are available for this file. Pick a server.',
      );
    } catch (error: any) {
      console.error('Error fetching servers:', error);
      setServerError(error?.message || 'Failed to fetch servers');
      setServers([]);
      openSheetWithNotice(null);
    } finally {
      setServerLoading(false);
    }
  };

  const downloadWithRule = async (rule: ServerRule) => {
    setServerLoading(true);
    try {
      const result = await pickServerWithHealth({
        provider: providerKey,
        servers,
        rule,
      });
      if (result.status === 'picked') {
        await downloadQuickStream(result.server);
        showPickToast(result);
      } else {
        openSheetWithNotice(
          'None of the servers in your order are available for this file. Pick a server.',
        );
      }
    } finally {
      setServerLoading(false);
    }
  };

  const getEditorEntries = (): {
    order: ServerRuleEntry[];
    available: ServerRuleEntry[];
    onNoMatch: NoMatchAction;
    quality: QualityPreference;
  } => {
    const currentEntries = servers
      .filter(server => !isTorrentStream(server))
      .map(server => toRuleEntry(server.server));
    // This title's own servers; names remembered from other titles only
    // fill in when the current list isn't loaded.
    const available =
      currentEntries.length > 0
        ? currentEntries
        : serverRulesStorage.getKnownServers(providerKey);
    const existing = editorScope ? getRuleForScope(editorScope) : undefined;
    return {
      order: existing?.order ?? currentEntries,
      available,
      onNoMatch: existing?.onNoMatch ?? 'auto',
      quality: existing?.quality ?? 'any',
    };
  };

  const openExternalApp = async (
    targetLink: string,
    targetType?: string,
    headers?: Record<string, string>,
  ) => {
    try {
      const isTorrent =
        targetType === 'torrent' || targetLink.startsWith('magnet:');
      const intentParams: any = {
        data: targetLink,
        flags: 1,
      };

      if (!isTorrent) {
        intentParams.type = 'application/octet-stream';
      }

      if (headers && Object.keys(headers).length > 0) {
        const extra: Record<string, any> = {
          ...headers,
          headers: headers,
          'android.media.intent.extra.HTTP_HEADERS': headers,
        };

        const referer = headers.Referer || headers.referer;
        if (referer) {
          extra['android.intent.extra.REFERRER'] = referer;
          extra['android.intent.extra.REFERRER_NAME'] = referer;
        }

        intentParams.extra = extra;
      }

      await IntentLauncher.startActivityAsync(
        'android.intent.action.VIEW',
        intentParams,
      );
    } catch (error) {
      console.log('Error opening with application/octet-stream:', error);
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: targetLink,
        });
      } catch (fallbackError) {
        console.log('Fallback intent error:', fallbackError);
        ToastAndroid.show(
          'No app found to handle this download',
          ToastAndroid.SHORT,
        );
      }
    }
  };

  const showCancelConfirmation = () => {
    const activeId = currentActiveDownload?.id || downloadId;
    showAppDialog({
      title: 'Cancel download?',
      message:
        'The current download will stop and its partial file will be removed.',
      variant: 'warning',
      actions: [
        { label: 'Keep downloading' },
        {
          label: 'Cancel download',
          variant: 'destructive',
          onPress: async () => {
            try {
              await cancelDownload(activeId);
            } catch (error) {
              console.log('Error cancelling download', error);
            }
          },
        },
      ],
    });
  };

  return (
    <>
      <View
        collapsable={false}
        className="h-12 w-12 flex-row items-center justify-center rounded-full"
        style={{ backgroundColor: LEGACY_TERTIARY_BACKGROUND }}>
        {isTV ? (
          <TVFocusable
            ref={downloadButtonRef}
            accessibilityRole="button"
            accessibilityLabel={
              downloadActive
                ? 'Cancel download'
                : isVideoDownloaded || hasDownloadedSubs
                ? 'Downloaded episode. Tap to manage.'
                : 'Download episode'
            }
            borderRadius={24}
            focusScale={1.15}
            focusBorderColor={focusBorderColor}
            onPress={() => {
              if (serverLoading) return;
              if (downloadActive) {
                showCancelConfirmation();
                return;
              }
              fetchAndOpenSheet(false);
            }}
            onLongPress={() => {
              if (serverLoading || downloadActive) return;
              fetchAndOpenSheet(true);
            }}
            style={{
              height: 48,
              width: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {downloadActive ? (
              <DownloadProgress
                downloadedBytes={currentActiveDownload?.downloadedBytes ?? 0}
                totalBytes={currentActiveDownload?.totalBytes ?? 0}
                color={primary}
              />
            ) : serverLoading ? (
              <LoadingIndicator size={28} color={primary} />
            ) : isVideoDownloaded || hasDownloadedSubs ? (
              <MaterialIcons name="check-circle" size={24} color={primary} />
            ) : (
              <Octicons name="download" size={22} color={primary} />
            )}
          </TVFocusable>
        ) : downloadActive ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              currentActiveDownload?.totalBytes
                ? `Download ${Math.round(
                  (currentActiveDownload.downloadedBytes /
                    currentActiveDownload.totalBytes) *
                  100,
                )} percent complete. Tap to cancel.`
                : 'Download in progress. Tap to cancel.'
            }
            onPress={showCancelConfirmation}
            className="h-12 w-12 items-center justify-center">
            <DownloadProgress
              downloadedBytes={currentActiveDownload?.downloadedBytes ?? 0}
              totalBytes={currentActiveDownload?.totalBytes ?? 0}
              color={primary}
            />
          </TouchableOpacity>
        ) : isVideoDownloaded || hasDownloadedSubs ? (
          <TouchableOpacity
            disabled={serverLoading}
            onPress={() => fetchAndOpenSheet(false)}
            onLongPress={() => {
              if (settingsStorage.getBool('hapticFeedback') !== false) {
                ReactNativeHapticFeedback.trigger('effectHeavyClick', {
                  enableVibrateFallback: true,
                  ignoreAndroidSystemSettings: false,
                });
              }
              fetchAndOpenSheet(true);
            }}
            className="h-12 w-12 items-center justify-center">
            {serverLoading ? (
              <LoadingIndicator size={35} color={primary} />
            ) : (
              <MaterialIcons name="check-circle" size={24} color={primary} />
            )}
          </TouchableOpacity>
        ) : (
          <Pressable
            disabled={serverLoading}
            accessibilityRole="button"
            focusable={!serverLoading}
            isTVSelectable={!serverLoading}
            onPress={() => fetchAndOpenSheet(false)}
            onLongPress={() => {
              if (settingsStorage.getBool('hapticFeedback') !== false) {
                ReactNativeHapticFeedback.trigger('effectHeavyClick', {
                  enableVibrateFallback: true,
                  ignoreAndroidSystemSettings: false,
                });
              }
              fetchAndOpenSheet(true);
            }}
            className="h-12 w-12 items-center justify-center rounded-xl"
            style={({ pressed, focused }) => ({
              borderWidth: focused ? 2 : 0,
              borderColor: focused ? focusBorderColor : 'transparent',
              backgroundColor: focused
                ? 'rgba(255, 255, 255, 0.12)'
                : 'transparent',
              transform: [{ scale: focused ? 1.15 : pressed ? 0.92 : 1 }],
            })}>
            {serverLoading ? (
              <LoadingIndicator size={35} color={primary} />
            ) : (
              <Octicons
                name="download"
                size={24}
                color={primary}
              />
            )}
          </Pressable>
        )}
      </View>
      <TextPromptDialog
        visible={audioPromptFor !== null}
        title="Add audio to your video"
        description={`Only the audio of the server you pick is taken and added to "${audioPromptFor?.showName || audioPromptFor?.title || 'the video'}". Name the language.`}
        placeholder="Hindi"
        initialValue={seasonTitle && /[a-z]/i.test(seasonTitle) ? seasonTitle : ''}
        confirmLabel="Pick a server"
        validate={value => (value.length < 2 ? 'Enter a language name' : undefined)}
        onClose={() => setAudioPromptFor(null)}
        onConfirm={value => {
          const target = audioPromptFor;
          setAudioPromptFor(null);
          if (target) {
            audioModeRef.current = { target, label: value, armedAt: Date.now() };
            fetchAndOpenSheet(false, true).catch(console.error);
          }
        }}
      />
      {/* download modal */}
      <DownloadBottomSheet
        setModal={setDownloadModalWithFocus}
        showModal={downloadModal}
        data={servers}
        loading={serverLoading}
        error={serverError}
        title=""
        videoDownloaded={isVideoDownloaded}
        downloadedServer={videoDownload?.server}
        onDeleteVideo={deleteVideoDownload}
        downloadedSubtitles={downloadedSubsList}
        isSubDownloaded={isSubDownloaded}
        onDeleteSub={deleteSubtitleDownload}
        onPressVideo={(server: Stream, rememberScope: RememberScope) => {
          if (rememberScope !== 'off') {
            saveRule(rememberScope, buildRuleFromSelection(server, servers));
          }
          downloadSingleVideoStream(server);
        }}
        rememberOptions={
          downloadModal
            ? (() => {
              const active = serverRulesStorage.resolve(providerKey, infoUrl);
              return {
                providerName: getProviderName(),
                canRememberSeries,
                defaultScope: active ? 'off' : 'provider',
                activeRule: active
                  ? { summary: describeRule(active.rule), scope: active.scope }
                  : undefined,
                notice: serverNotice,
                onEditOrder: scope => setEditorScope(scope),
                onClearRule: active ? () => clearRule(active.scope) : undefined,
              };
            })()
            : undefined
        }
        onPressExternalVideo={(server: Stream) => {
          openExternalApp(server.link, server.type, server.headers);
        }}
        onPressSubs={(sub: { link: string; type: string; title: string }) => {
          startDownloadWithLocation({
            downloadId: `${downloadId}_subtitle_${sub.title}`,
            title: title + ' ' + sub.title + ' Subtitle ',
            showName,
            episodeName,
            seasonTitle,
            mediaType,
            imdbId,
            poster,
            background,
            synopsis,
            provider: providerValue || provider.value,
            isSubtitle: true,
            infoUrl,
            sourceLink: link,
            url: sub.link,
            fileName: createSubtitleFileName(fileName, sub.title),
            fileType: sub.type,
            deleteDownload: () => deleteSubtitleDownload(sub.title),
          });
        }}
        onPressExternalSubs={(sub: { link: string; type: string; title: string }) => {
          openExternalApp(sub.link, 'text/vtt');
        }}
      />
      {editorScope ? (
        <ServerOrderEditor
          visible
          title={
            editorScope === 'series'
              ? `Servers for ${showName || title}`
              : `Servers for ${getProviderName()}`
          }
          subtitle="Downloads use the first available server in this order."
          {...getEditorEntries()}
          saveLabel="Save & download"
          getHealth={entry => getServerHealth(providerKey, entry.label)}
          onCancel={() => {
            setEditorScope(null);
            setDownloadModal(true);
          }}
          onSave={(order, onNoMatch, quality) => {
            const rule: ServerRule = {
              order,
              onNoMatch,
              ...(quality !== 'any' ? { quality } : {}),
              updatedAt: Date.now(),
            };
            saveRule(editorScope, rule);
            setEditorScope(null);
            downloadWithRule(rule).catch(console.error);
          }}
        />
      ) : null}
      <DownloadLocationDialog
        visible={locationDialogVisible}
        primary={primary}
        selecting={selectingLocation}
        onCancel={() => {
          if (selectingLocation) {
            return;
          }
          setPendingDownload(null);
          setLocationDialogVisible(false);
        }}
        onSelectFolder={() => {
          selectLocationAndContinue().catch(console.error);
        }}
      />
    </>
  );
};

export default DownloadComponent;
