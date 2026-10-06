import Constants from 'expo-constants';
import React, {useState} from 'react';
import {Clipboard, Linking, ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import Surface from '../../../components/ui/Surface';
import TextPromptDialog from '../../../components/TextPromptDialog';
import {getRedirectUri, startOAuth} from '../../../lib/trackers/oauth';
import {
  clearTrackerAuth,
  getTrackerAuth,
  getTrackerClientId,
  getTrackerUser,
  isTrackerSyncEnabled,
  setTrackerClientId,
  setTrackerSyncEnabled,
} from '../../../lib/trackers/storage';
import type {TrackerId} from '../../../lib/trackers/types';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const TRACKERS: Array<{id: TrackerId; name: string; where: string}> = [
  {id: 'anilist', name: 'AniList', where: 'anilist.co/settings/developer'},
  {id: 'mal', name: 'MyAnimeList', where: 'myanimelist.net/apiconfig'},
];

const scheme = (): string => String(Constants.expoConfig?.scheme || 'vega');

/** Connect AniList or MyAnimeList, so episodes you watch and your library details are sent to them. */
const TrackersPreference = () => {
  const colors = useM3Colors();
  const [, setVersion] = useState(0);
  const [prompt, setPrompt] = useState<TrackerId | null>(null);
  const refresh = () => setVersion(value => value + 1);

  const connect = (tracker: TrackerId) => {
    try {
      Linking.openURL(startOAuth(tracker, scheme())).catch(() =>
        ToastAndroid.show('Could not open the browser', ToastAndroid.SHORT),
      );
    } catch (error) {
      ToastAndroid.show(error instanceof Error ? error.message : 'Could not connect', ToastAndroid.SHORT);
    }
  };

  const explain = (tracker: (typeof TRACKERS)[number]) =>
    showAppDialog({
      title: `Set up ${tracker.name}`,
      message: `1. Open ${tracker.where} and create an API client.\n2. Set its redirect URL to:\n${getRedirectUri(
        tracker.id,
        scheme(),
      )}\n3. Come back and enter its client ID.\n\nThe app asks ${tracker.name} to let it update your list. Your password is never shared with the app.`,
      actions: [
        {label: 'Copy redirect URL', onPress: () => Clipboard.setString(getRedirectUri(tracker.id, scheme()))},
        {label: 'Enter client ID', variant: 'primary', onPress: () => setPrompt(tracker.id)},
      ],
    });

  return (
    <View className="mb-6">
      <AppText role="labelLarge" className="mb-3 text-m3-on-surface-variant">
        Trackers
      </AppText>
      <Surface level="low" className="overflow-hidden">
        {TRACKERS.map((tracker, index) => {
          const connected = Boolean(getTrackerAuth(tracker.id));
          const user = getTrackerUser(tracker.id);
          const clientId = getTrackerClientId(tracker.id);
          const last = index === TRACKERS.length - 1;
          return (
            <View key={tracker.id}>
              <SettingsRow
                title={tracker.name}
                description={
                  connected
                    ? `Connected${user ? ` as ${user}` : ''}`
                    : clientId
                      ? 'Client ID saved. Tap to sign in'
                      : 'Not connected. Tap to set up'
                }
                icon={connected ? 'check-circle-outline' : 'link-variant'}
                divider={connected || !last}
                onPress={() => {
                  if (connected) {
                    return;
                  }
                  if (clientId) {
                    connect(tracker.id);
                  } else {
                    explain(tracker);
                  }
                }}
              />
              {connected ? (
                <>
                  <SettingsSwitchRow
                    title={`Send updates to ${tracker.name}`}
                    description="Episodes you finish, and the status and score you set in your library"
                    value={isTrackerSyncEnabled(tracker.id)}
                    onValueChange={next => {
                      setTrackerSyncEnabled(tracker.id, next);
                      refresh();
                    }}
                  />
                  <SettingsRow
                    title={`Disconnect ${tracker.name}`}
                    icon="link-variant-off"
                    divider={!last}
                    onPress={() => {
                      clearTrackerAuth(tracker.id);
                      refresh();
                      ToastAndroid.show(`${tracker.name} disconnected`, ToastAndroid.SHORT);
                    }}
                  />
                </>
              ) : clientId ? (
                <SettingsRow
                  title="Change client ID"
                  icon="key-outline"
                  divider={!last}
                  onPress={() => setPrompt(tracker.id)}
                />
              ) : null}
            </View>
          );
        })}
      </Surface>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 8, paddingHorizontal: 4}}>
        Only anime that these sites know by name is matched. Sign-in addresses start with {scheme()}://oauth/
      </AppText>

      <TextPromptDialog
        visible={prompt !== null}
        title="Client ID"
        description="From the API client you made on the site."
        placeholder="Client ID"
        initialValue={prompt ? getTrackerClientId(prompt) : ''}
        confirmLabel="Save and sign in"
        validate={value => (value.length < 4 ? 'Enter the client ID' : undefined)}
        onClose={() => setPrompt(null)}
        onConfirm={value => {
          const tracker = prompt;
          setPrompt(null);
          if (tracker) {
            setTrackerClientId(tracker, value);
            refresh();
            connect(tracker);
          }
        }}
      />
    </View>
  );
};

export default TrackersPreference;
