import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Clipboard, Linking, Modal, ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import Surface from '../../../components/ui/Surface';
import TextPromptDialog from '../../../components/TextPromptDialog';
import {TVFocusable, TVFocusGuide} from '../../../components/tv';
import {
  getTrackerClientId,
  getTrackerClientSecret,
  getTrackerUser,
  isTrackerSyncEnabled,
  setTrackerClientId,
  setTrackerClientSecret,
  setTrackerSyncEnabled,
} from '../../../lib/trackers/storage';
import {
  disconnectTrakt,
  isTraktConnected,
  pollDeviceLogin,
  startDeviceLogin,
  type DeviceLogin,
} from '../../../lib/trackers/trakt';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

/** Connect Trakt with a code typed on trakt.tv, so what you finish watching goes to your history. */
const TraktPreference = () => {
  const colors = useM3Colors();
  const [, setVersion] = useState(0);
  const refresh = () => setVersion(value => value + 1);
  const [prompt, setPrompt] = useState<'id' | 'secret' | null>(null);
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const cancelledRef = useRef(false);

  const connected = isTraktConnected();
  const clientId = getTrackerClientId('trakt');
  const clientSecret = getTrackerClientSecret('trakt');

  const begin = useCallback(() => {
    cancelledRef.current = false;
    startDeviceLogin()
      .then(setLogin)
      .catch(error =>
        ToastAndroid.show(error instanceof Error ? error.message : 'Could not start sign-in', ToastAndroid.LONG),
      );
  }, []);

  // Checks every few seconds whether the code was entered on trakt.tv.
  useEffect(() => {
    if (!login) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = login.interval * 1000;
    const check = () => {
      if (cancelledRef.current) {
        return;
      }
      pollDeviceLogin(login)
        .then(result => {
          if (cancelledRef.current) {
            return;
          }
          if (result.status === 'ok') {
            setLogin(null);
            refresh();
            ToastAndroid.show(`Trakt connected as ${result.user}`, ToastAndroid.SHORT);
            return;
          }
          if (result.status === 'denied' || result.status === 'expired') {
            setLogin(null);
            ToastAndroid.show(
              result.status === 'denied' ? 'Sign-in was refused' : 'The code expired. Try again',
              ToastAndroid.LONG,
            );
            return;
          }
          if (result.status === 'slow') {
            delay += 5000;
          }
          timer = setTimeout(check, delay);
        })
        .catch(error => {
          setLogin(null);
          ToastAndroid.show(error instanceof Error ? error.message : 'Sign-in failed', ToastAndroid.LONG);
        });
    };
    timer = setTimeout(check, delay);
    return () => {
      cancelledRef.current = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [login]);

  const explain = () =>
    showAppDialog({
      title: 'Set up Trakt',
      message:
        '1. Open trakt.tv/oauth/applications and create a new application.\n2. Set its redirect URI to:\nurn:ietf:wg:oauth:2.0:oob\n3. Come back and enter its client ID, then its client secret.\n\nThe app shows a short code to type on trakt.tv. Your password is never shared with the app.',
      actions: [
        {label: 'Open Trakt', onPress: () => Linking.openURL('https://trakt.tv/oauth/applications').catch(() => undefined)},
        {label: 'Enter client ID', variant: 'primary', onPress: () => setPrompt('id')},
      ],
    });

  return (
    <View className="mb-6">
      <Surface level="low" className="overflow-hidden">
        <SettingsRow
          title="Trakt"
          description={
            connected
              ? `Connected${getTrackerUser('trakt') ? ` as ${getTrackerUser('trakt')}` : ''}`
              : clientId && clientSecret
                ? 'Keys saved. Tap to sign in'
                : 'Not connected. Tap to set up'
          }
          icon={connected ? 'check-circle-outline' : 'link-variant'}
          divider={connected || Boolean(clientId)}
          onPress={() => {
            if (connected) {
              return;
            }
            if (clientId && clientSecret) {
              begin();
            } else {
              explain();
            }
          }}
        />
        {connected ? (
          <>
            <SettingsSwitchRow
              title="Send what I watch to Trakt"
              description="Episodes and movies you finish. Episodes need a named season, like Season 2"
              value={isTrackerSyncEnabled('trakt')}
              onValueChange={next => {
                setTrackerSyncEnabled('trakt', next);
                refresh();
              }}
            />
            <SettingsRow
              title="Disconnect Trakt"
              icon="link-variant-off"
              divider={false}
              onPress={() => {
                disconnectTrakt();
                refresh();
                ToastAndroid.show('Trakt disconnected', ToastAndroid.SHORT);
              }}
            />
          </>
        ) : clientId ? (
          <SettingsRow
            title="Change client ID and secret"
            icon="key-outline"
            divider={false}
            onPress={() => setPrompt('id')}
          />
        ) : null}
      </Surface>

      <TextPromptDialog
        visible={prompt === 'id'}
        title="Trakt client ID"
        description="From the application you made on trakt.tv."
        placeholder="Client ID"
        initialValue={clientId}
        confirmLabel="Next"
        validate={value => (value.length < 8 ? 'Enter the client ID' : undefined)}
        onClose={() => setPrompt(null)}
        onConfirm={value => {
          setTrackerClientId('trakt', value);
          setPrompt('secret');
        }}
      />
      <TextPromptDialog
        visible={prompt === 'secret'}
        title="Trakt client secret"
        description="Optional. Leave empty if your Trakt app was not issued one. It stays on this device."
        placeholder="Client secret"
        initialValue={clientSecret}
        confirmLabel="Save and sign in"
        onClose={() => setPrompt(null)}
        onConfirm={value => {
          setTrackerClientSecret('trakt', value);
          setPrompt(null);
          refresh();
          begin();
        }}
      />

      <Modal visible={login !== null} transparent animationType="fade" onRequestClose={() => setLogin(null)}>
        <View className="flex-1 items-center justify-center bg-black/60 p-6">
          <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
            <View className="rounded-3xl p-6" style={{backgroundColor: colors.surfaceContainer, minWidth: 280}}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>
                Sign in to Trakt
              </AppText>
              <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 8}}>
                Open {login?.verificationUrl} and enter this code:
              </AppText>
              <AppText
                role="headlineMedium"
                selectable
                style={{color: colors.primary, letterSpacing: 4, marginVertical: 14, textAlign: 'center'}}>
                {login?.userCode}
              </AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                Waiting for you to approve it…
              </AppText>
              <View className="mt-4 flex-row justify-end" style={{gap: 8}}>
                <TVFocusable
                  accessibilityRole="button"
                  borderRadius={16}
                  onPress={() => login && Clipboard.setString(login.userCode)}
                  style={{paddingHorizontal: 14, paddingVertical: 10}}>
                  <AppText role="labelLarge" style={{color: colors.onSurface}}>
                    Copy code
                  </AppText>
                </TVFocusable>
                <TVFocusable
                  accessibilityRole="button"
                  borderRadius={16}
                  onPress={() => login && Linking.openURL(login.verificationUrl).catch(() => undefined)}
                  style={{backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10}}>
                  <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                    Open trakt.tv
                  </AppText>
                </TVFocusable>
                <TVFocusable
                  accessibilityRole="button"
                  borderRadius={16}
                  onPress={() => setLogin(null)}
                  style={{paddingHorizontal: 14, paddingVertical: 10}}>
                  <AppText role="labelLarge" style={{color: colors.onSurface}}>
                    Cancel
                  </AppText>
                </TVFocusable>
              </View>
            </View>
          </TVFocusGuide>
        </View>
      </Modal>
    </View>
  );
};

export default TraktPreference;
