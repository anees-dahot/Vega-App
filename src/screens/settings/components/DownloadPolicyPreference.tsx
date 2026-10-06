import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import Surface from '../../../components/ui/Surface';
import {TVFocusable} from '../../../components/tv';
import {
  applyNativeDownloadPolicy,
  formatMinutesOfDay,
  getFreeStorageBytes,
} from '../../../lib/download/downloadPolicy';
import {
  deleteWatchedDownloads,
  summarizeWatchedDownloads,
} from '../../../lib/download/storageCleanup';
import {SUBTITLE_LANGUAGES} from '../../../lib/download/subtitlePick';
import {scheduleQueuedDownloads} from '../../../lib/downloadManager';
import {formatDownloadBytes} from '../../../lib/downloadFormatting';
import {settingsStorage} from '../../../lib/storage';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

interface Option {
  key: string;
  label: string;
  value: number;
}

const CONNECTIONS: Option[] = [
  {key: '1', label: 'Off (1 connection)', value: 1},
  {key: '2', label: '2 connections', value: 2},
  {key: '4', label: '4 connections', value: 4},
  {key: '8', label: '8 connections (recommended)', value: 8},
  {key: '16', label: '16 connections (fastest)', value: 16},
];

const MIN_FREE: Option[] = [
  {key: '0', label: 'Off', value: 0},
  {key: '500', label: '500 MB', value: 500},
  {key: '1024', label: '1 GB', value: 1024},
  {key: '2048', label: '2 GB', value: 2048},
  {key: '5120', label: '5 GB', value: 5120},
];

// Half-hour steps in a day, as minutes after midnight.
const TIMES: Option[] = Array.from({length: 48}, (_, index) => {
  const minutes = index * 30;
  return {key: String(minutes), label: formatMinutesOfDay(minutes), value: minutes};
});

const pick = (options: Option[], value: number): Option =>
  options.find(option => option.value === value) ?? options[0];

const FieldRow = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => {
  const colors = useM3Colors();
  return (
    <View
      className="px-4 py-3"
      style={{borderBottomColor: colors.outlineVariant, borderBottomWidth: 1}}>
      <AppText role="bodyLarge" style={{color: colors.onSurface}}>
        {title}
      </AppText>
      {description ? (
        <AppText
          role="bodySmall"
          style={{color: colors.onSurfaceVariant, marginBottom: 8, marginTop: 3}}>
          {description}
        </AppText>
      ) : (
        <View style={{height: 8}} />
      )}
      {children}
    </View>
  );
};

/** When downloads may run, how fast, and what to do about storage. */
const DownloadPolicyPreference = () => {
  const colors = useM3Colors();
  const [wifiOnly, setWifiOnly] = useState(settingsStorage.isDownloadWifiOnly());
  const [scheduleEnabled, setScheduleEnabled] = useState(
    settingsStorage.isDownloadScheduleEnabled(),
  );
  const [window, setWindow] = useState(settingsStorage.getDownloadScheduleWindow());
  const [connections, setConnections] = useState(
    settingsStorage.getDownloadConnections(),
  );
  const [minFree, setMinFree] = useState(settingsStorage.getDownloadMinFreeMb());
  const [subtitles, setSubtitles] = useState(
    settingsStorage.isDownloadSubtitlesEnabled(),
  );
  const [subtitleLanguage, setSubtitleLanguage] = useState(
    settingsStorage.getDownloadSubtitleLanguage(),
  );
  const [autoClean, setAutoClean] = useState(
    settingsStorage.isDownloadAutoCleanWatched(),
  );
  const [watched, setWatched] = useState(summarizeWatchedDownloads());

  const free = getFreeStorageBytes();
  const refreshQueue = useCallback(() => {
    applyNativeDownloadPolicy();
    scheduleQueuedDownloads().catch(() => undefined);
  }, []);

  const confirmDeleteWatched = () => {
    const current = summarizeWatchedDownloads();
    setWatched(current);
    if (current.count === 0) {
      ToastAndroid.show('No watched downloads to delete', ToastAndroid.SHORT);
      return;
    }
    showAppDialog({
      title: 'Delete watched downloads?',
      message: `${current.count} episode${
        current.count === 1 ? '' : 's'
      } you have watched to the end will be deleted from your device, freeing about ${formatDownloadBytes(
        current.bytes,
      )}.`,
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: async () => {
            const result = await deleteWatchedDownloads();
            setWatched(summarizeWatchedDownloads());
            ToastAndroid.show(
              `Deleted ${result.count} · freed ${formatDownloadBytes(result.bytes)}`,
              ToastAndroid.SHORT,
            );
            scheduleQueuedDownloads().catch(() => undefined);
          },
        },
      ],
    });
  };

  return (
    <View className="mb-6">
      <AppText role="labelLarge" className="mb-3 text-m3-on-surface-variant">
        Download rules
      </AppText>
      <Surface level="low" className="overflow-hidden">
        <SettingsSwitchRow
          title="Wi-Fi only"
          description="Wait for Wi-Fi before starting, and pause on mobile data"
          value={wifiOnly}
          onValueChange={next => {
            settingsStorage.setDownloadWifiOnly(next);
            setWifiOnly(next);
            refreshQueue();
          }}
        />
        <SettingsSwitchRow
          title="Only download at set times"
          description={`Queued downloads start between ${formatMinutesOfDay(
            window.start,
          )} and ${formatMinutesOfDay(
            window.end,
          )}. Ones already running are not stopped. "Start now" skips this.`}
          value={scheduleEnabled}
          onValueChange={next => {
            settingsStorage.setDownloadScheduleEnabled(next);
            setScheduleEnabled(next);
            refreshQueue();
          }}
        />
        {scheduleEnabled ? (
          <View className="flex-row px-4 py-3" style={{gap: 12}}>
            <View style={{flex: 1}}>
              <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>
                From
              </AppText>
              <DropdownField
                options={TIMES}
                value={pick(TIMES, window.start)}
                getKey={option => option.key}
                getLabel={option => option.label}
                onChange={option => {
                  settingsStorage.setDownloadScheduleWindow(option.value, window.end);
                  setWindow({...window, start: option.value});
                  refreshQueue();
                }}
              />
            </View>
            <View style={{flex: 1}}>
              <AppText role="labelMedium" style={{color: colors.onSurfaceVariant}}>
                Until
              </AppText>
              <DropdownField
                options={TIMES}
                value={pick(TIMES, window.end)}
                getKey={option => option.key}
                getLabel={option => option.label}
                onChange={option => {
                  settingsStorage.setDownloadScheduleWindow(window.start, option.value);
                  setWindow({...window, end: option.value});
                  refreshQueue();
                }}
              />
            </View>
          </View>
        ) : null}
        <FieldRow
          title="Faster downloads"
          description="Splits each large file into parts that download at the same time. Servers that do not allow it use one connection. Applies to direct file downloads, not streams (HLS) or torrents.">
          <DropdownField
            options={CONNECTIONS}
            value={pick(CONNECTIONS, connections)}
            getKey={option => option.key}
            getLabel={option => option.label}
            onChange={option => {
              settingsStorage.setDownloadConnections(option.value);
              setConnections(option.value);
              applyNativeDownloadPolicy();
            }}
          />
        </FieldRow>
        <SettingsSwitchRow
          title="Download subtitles with videos"
          description="When a stream offers subtitles, the one in your language is saved next to the video"
          value={subtitles}
          onValueChange={next => {
            settingsStorage.setDownloadSubtitlesEnabled(next);
            setSubtitles(next);
          }}
        />
        {subtitles ? (
          <FieldRow
            title="Subtitle language"
            description="If none matches, the first subtitle the stream offers is used.">
            <DropdownField
              options={SUBTITLE_LANGUAGES}
              value={
                SUBTITLE_LANGUAGES.find(item => item.code === subtitleLanguage) ??
                SUBTITLE_LANGUAGES[0]
              }
              getKey={option => option.code}
              getLabel={option => option.label}
              onChange={option => {
                settingsStorage.setDownloadSubtitleLanguage(option.code);
                setSubtitleLanguage(option.code);
              }}
            />
          </FieldRow>
        ) : null}
        <FieldRow
          title="Keep free space"
          description={`New downloads wait while free space is below this.${
            free !== undefined ? ` Free now: ${formatDownloadBytes(free)}.` : ''
          }`}>
          <DropdownField
            options={MIN_FREE}
            value={pick(MIN_FREE, minFree)}
            getKey={option => option.key}
            getLabel={option => option.label}
            onChange={option => {
              settingsStorage.setDownloadMinFreeMb(option.value);
              setMinFree(option.value);
              refreshQueue();
            }}
          />
        </FieldRow>
        <SettingsSwitchRow
          title="Delete watched downloads when space is low"
          description="Frees room on its own before new downloads wait for space"
          value={autoClean}
          onValueChange={next => {
            settingsStorage.setDownloadAutoCleanWatched(next);
            setAutoClean(next);
          }}
        />
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel="Delete watched downloads now"
          borderRadius={12}
          focusScale={1}
          onPress={confirmDeleteWatched}
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 12,
            minHeight: 56,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}>
          <MaterialCommunityIcons
            name="delete-sweep-outline"
            size={22}
            color={colors.primary}
          />
          <View style={{flex: 1}}>
            <AppText role="bodyLarge" style={{color: colors.onSurface}}>
              Delete watched downloads
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
              {watched.count > 0
                ? `${watched.count} episode${
                    watched.count === 1 ? '' : 's'
                  } · ${formatDownloadBytes(watched.bytes)}`
                : 'Nothing watched to clear'}
            </AppText>
          </View>
        </TVFocusable>
      </Surface>
    </View>
  );
};

export default DownloadPolicyPreference;
