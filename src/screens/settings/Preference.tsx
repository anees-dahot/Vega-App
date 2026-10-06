import {useFocusEffect} from '@react-navigation/native';
import {View, ScrollView, ToastAndroid, BackHandler} from 'react-native';
import React, {useState, useCallback} from 'react';
import {settingsStorage} from '../../lib/storage';
import RNReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Constants from 'expo-constants';
import DownloadLocationPreference from './components/DownloadLocationPreference';
import useNavigationPreferencesStore from '../../lib/zustand/navigationPreferencesStore';
import DownloadConcurrencyPreference from './components/DownloadConcurrencyPreference';
import DownloadPolicyPreference from './components/DownloadPolicyPreference';
import AutoBackupPreference from './components/AutoBackupPreference';
import TrackersPreference from './components/TrackersPreference';
import TraktPreference from './components/TraktPreference';
import AppLockPreference from './components/AppLockPreference';
import {syncAiringReminders} from '../../lib/library/airingReminders';
import BufferPreference from './components/BufferPreference';
import TmdbApiKeyPreference from './components/TmdbApiKeyPreference';
import AppText from '../../components/ui/Text';
import SettingsSection from '../../components/ui/SettingsSection';
import SettingsSwitchRow from '../../components/ui/SettingsSwitchRow';
import SettingsRow from '../../components/ui/SettingsRow';
import Surface from '../../components/ui/Surface';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {isTV} from '../../lib/tv';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  getAnalytics,
  getCrashlytics,
  isFirebaseNativeReady,
} from '../../lib/utils/firebaseSafe';

const Preferences = ({navigation}: any) => {
  const hasFirebase =
    Boolean(Constants?.expoConfig?.extra?.hasFirebase) &&
    isFirebaseNativeReady();
  const colors = useM3Colors();

  // Register only while this screen is focused. A hidden screen in a
  // mounted tab or stack must not swallow back presses.
  useFocusEffect(
    useCallback(() => {
      if (!isTV) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (navigation?.canGoBack?.()) {
          navigation.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [navigation]),
  );
  const [disableDrawer, setDisableDrawer] = useState(
    settingsStorage.getBool('disableDrawer') || false,
  );

  const [ExcludedQualities, setExcludedQualities] = useState(
    settingsStorage.getExcludedQualities(),
  );

  const [showMediaControls, setShowMediaControls] = useState<boolean>(
    settingsStorage.showMediaControls(),
  );

  const [showHamburgerMenu, setShowHamburgerMenu] = useState<boolean>(
    settingsStorage.showHamburgerMenu(),
  );

  const [hideSeekButtons, setHideSeekButtons] = useState<boolean>(
    settingsStorage.hideSeekButtons(),
  );

  const [showEpisodeSidebar, setShowEpisodeSidebar] = useState<boolean>(
    settingsStorage.showPlayerEpisodeSidebar(),
  );

  const [autoplayNext, setAutoplayNext] = useState<boolean>(
    settingsStorage.isAutoplayNextEpisode(),
  );

  const [preloadNext, setPreloadNext] = useState<boolean>(
    settingsStorage.isPreloadNextEpisode(),
  );

  const [autoDownloadNew, setAutoDownloadNew] = useState<boolean>(
    settingsStorage.isAutoDownloadNewEpisodes(),
  );

  const [switchMode, setSwitchMode] = useState(
    settingsStorage.getProviderSwitchMode(),
  );

  const [autoSubtitleSearch, setAutoSubtitleSearch] = useState<boolean>(
    settingsStorage.isAutoSubtitleSearch(),
  );

  const [playInBackground, setPlayInBackground] = useState<boolean>(
    settingsStorage.isPlayInBackground(),
  );

  const [communitySkips, setCommunitySkips] = useState<boolean>(
    settingsStorage.isCommunitySkipsEnabled(),
  );

  const [airingReminders, setAiringReminders] = useState<boolean>(
    settingsStorage.isAiringRemindersEnabled(),
  );

  const [newEpisodeCheck, setNewEpisodeCheck] = useState<boolean>(
    settingsStorage.isNewEpisodeCheckEnabled(),
  );

  const [_enable2xGesture, _setEnable2xGesture] = useState<boolean>(
    settingsStorage.isEnable2xGestureEnabled(),
  );

  const [enableSwipeGesture, setEnableSwipeGesture] = useState<boolean>(
    settingsStorage.isSwipeGestureEnabled(),
  );

  const [showTabBarLables, setShowTabBarLables] = useState<boolean>(
    settingsStorage.showTabBarLabels(),
  );
  const hideDownloadsTab = useNavigationPreferencesStore(
    state => state.hideDownloadsTab,
  );
  const setHideDownloadsTab = useNavigationPreferencesStore(
    state => state.setHideDownloadsTab,
  );
  const showContinueWatching = useNavigationPreferencesStore(
    state => state.showContinueWatching,
  );
  const setShowContinueWatching = useNavigationPreferencesStore(
    state => state.setShowContinueWatching,
  );

  const [OpenExternalPlayer, setOpenExternalPlayer] = useState(
    settingsStorage.getBool('useExternalPlayer', false),
  );

  const [torrentFullDownload, setTorrentFullDownload] = useState<boolean>(() =>
    settingsStorage.isTorrentFullDownload(),
  );
  const [alwaysCastMode, setAlwaysCastMode] = useState<boolean>(() =>
    settingsStorage.isAlwaysCastMode(),
  );

  const [hapticFeedback, setHapticFeedback] = useState(
    settingsStorage.isHapticFeedbackEnabled(),
  );

  const [alwaysUseExternalDownload, setAlwaysUseExternalDownload] = useState(
    settingsStorage.getBool('alwaysExternalDownloader') || false,
  );

  const [skipInAppWebview, setSkipInAppWebview] = useState<boolean>(
    settingsStorage.isSkipInAppWebview(),
  );

  const [telemetryOptIn, setTelemetryOptIn] = useState<boolean>(
    settingsStorage.isTelemetryOptIn(),
  );

  return (
    <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
      <ScrollView
        focusable={false}
        accessible={false}
        className="h-full w-full bg-m3-background"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 40, paddingTop: 20}}>
        <View className="px-5">
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 12}}>
            <TVFocusable
              hasTVPreferredFocus={isTV}
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => navigation.goBack()}
              borderRadius={22}
              style={{
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                marginRight: 10,
                width: 44,
              }}>
              <MaterialCommunityIcons
                name="arrow-left"
                size={28}
                color={colors.onBackground}
              />
            </TVFocusable>
            <AppText
              role="headlineLargeEmphasized"
              className="text-m3-on-background">
              Preferences
            </AppText>
          </View>
        <AppText
          role="bodyLarge"
          className="mb-7 mt-1 text-m3-on-surface-variant">
          Shape how Vega looks, plays, and downloads
        </AppText>

        <SettingsSection title="Experience">
          <SettingsSwitchRow
            title="Haptic feedback"
            description="Use subtle vibration for actions and selections"
            value={hapticFeedback}
            onValueChange={next => {
              settingsStorage.setHapticFeedbackEnabled(next);
              setHapticFeedback(next);
            }}
          />
          <SettingsSwitchRow
            title="Tab bar labels"
            description="Show destination names below navigation icons"
            value={showTabBarLables}
            onValueChange={next => {
              settingsStorage.setShowTabBarLabels(next);
              setShowTabBarLables(next);
              ToastAndroid.show(
                'Restart App to Apply Changes',
                ToastAndroid.SHORT,
              );
            }}
          />
          <SettingsSwitchRow
            title="Hide downloads tab"
            value={hideDownloadsTab}
            onValueChange={setHideDownloadsTab}
          />
          <SettingsSwitchRow
            title="Hamburger menu"
            value={showHamburgerMenu}
            onValueChange={next => {
              settingsStorage.setShowHamburgerMenu(next);
              setShowHamburgerMenu(next);
            }}
          />
          <SettingsSwitchRow
            title="Continue watching"
            description="Show the Continue watching row on Home. Playback positions are still saved."
            value={showContinueWatching}
            onValueChange={setShowContinueWatching}
          />
          <SettingsSwitchRow
            title="Disable drawer"
            value={disableDrawer}
            onValueChange={next => {
              settingsStorage.setBool('disableDrawer', next);
              setDisableDrawer(next);
            }}
          />
          <SettingsSwitchRow
            title="External downloader"
            description="Send every download to another app"
            value={alwaysUseExternalDownload}
            onValueChange={next => {
              settingsStorage.setBool('alwaysExternalDownloader', next);
              setAlwaysUseExternalDownload(next);
            }}
          />
          <SettingsSwitchRow
            title="Skip in-app webview"
            description="Open web links directly in your default browser"
            value={skipInAppWebview}
            divider={!isTV}
            onValueChange={next => {
              settingsStorage.setSkipInAppWebview(next);
              setSkipInAppWebview(next);
            }}
          />
          {!isTV && (
            <SettingsSwitchRow
              title="Always cast mode"
              description="Stream directly to TV instead of opening the local phone player"
              value={alwaysCastMode}
              divider={false}
              onValueChange={next => {
                settingsStorage.setAlwaysCastMode(next);
                setAlwaysCastMode(next);
              }}
            />
          )}
        </SettingsSection>

        {hasFirebase ? (
          <SettingsSection title="Privacy">
            <SettingsSwitchRow
              title="Usage and crash reports"
              description="Help improve Vega with anonymous diagnostics"
              value={telemetryOptIn}
              divider={false}
              onValueChange={async next => {
                setTelemetryOptIn(next);
                settingsStorage.setTelemetryOptIn(next);
                try {
                  const crashlytics = getCrashlytics();
                  crashlytics &&
                    (await crashlytics().setCrashlyticsCollectionEnabled(next));
                } catch {}
                try {
                  const analytics = getAnalytics();
                  analytics &&
                    (await analytics().setAnalyticsCollectionEnabled(next));
                  analytics &&
                    (await analytics().setConsent({
                      analytics_storage: next,
                      ad_storage: next,
                      ad_user_data: next,
                      ad_personalization: next,
                    }));
                } catch {}
              }}
            />
          </SettingsSection>
        ) : null}

        <TmdbApiKeyPreference />

        <SettingsSection title="Playback">
          <SettingsSwitchRow
            title="External player"
            description="Open streams in your preferred video app"
            value={OpenExternalPlayer}
            onValueChange={next => {
              settingsStorage.setBool('useExternalPlayer', next);
              setOpenExternalPlayer(next);
            }}
          />
          <SettingsSwitchRow
            title="Media controls"
            value={showMediaControls}
            onValueChange={next => {
              settingsStorage.setShowMediaControls(next);
              setShowMediaControls(next);
            }}
          />
          <SettingsSwitchRow
            title="Hide seek buttons"
            value={hideSeekButtons}
            onValueChange={next => {
              settingsStorage.setHideSeekButtons(next);
              setHideSeekButtons(next);
            }}
          />
          <SettingsSwitchRow
            title="Episode list button"
            description="Show button on the right edge to quickly open the episode list sidebar"
            value={showEpisodeSidebar}
            onValueChange={next => {
              settingsStorage.setShowPlayerEpisodeSidebar(next);
              setShowEpisodeSidebar(next);
            }}
          />
          <SettingsSwitchRow
            title="Autoplay next episode"
            description="Start the next episode a few seconds after one ends"
            value={autoplayNext}
            onValueChange={next => {
              settingsStorage.setAutoplayNextEpisode(next);
              setAutoplayNext(next);
            }}
          />
          <SettingsSwitchRow
            title="Preload next episode"
            description="Near the end of an episode, look up the next one's links so it starts faster"
            value={preloadNext}
            onValueChange={next => {
              settingsStorage.setPreloadNextEpisode(next);
              setPreloadNext(next);
            }}
          />
          <SettingsRow
            title="When a video won't play"
            description={
              switchMode === 'ask'
                ? 'Ask before playing it from another provider'
                : switchMode === 'auto'
                  ? 'Switch to another provider by itself when the match is certain'
                  : 'Do nothing'
            }
            trailing={
              <AppText role="labelLarge" style={{color: colors.primary}}>
                {switchMode === 'ask' ? 'Ask' : switchMode === 'auto' ? 'Automatic' : 'Off'}
              </AppText>
            }
            onPress={() => {
              const next =
                switchMode === 'ask' ? 'auto' : switchMode === 'auto' ? 'off' : 'ask';
              settingsStorage.setProviderSwitchMode(next);
              setSwitchMode(next);
            }}
          />
          <SettingsSwitchRow
            title="Find subtitles automatically"
            description="When a video has no subtitles, search OpenSubtitles in your download subtitle language and add the best match"
            value={autoSubtitleSearch}
            onValueChange={next => {
              settingsStorage.setAutoSubtitleSearch(next);
              setAutoSubtitleSearch(next);
            }}
          />
          <SettingsSwitchRow
            title="Keep playing in the background"
            description="Sound continues when you leave the app. Use the notification to pause"
            value={playInBackground}
            onValueChange={next => {
              settingsStorage.setPlayInBackground(next);
              setPlayInBackground(next);
            }}
          />
          <SettingsSwitchRow
            title="Skip intro for anime"
            description="Looks up intro, outro and recap times in the AniSkip community database when a provider gives none. Sends the show title to Jikan and AniSkip"
            value={communitySkips}
            onValueChange={next => {
              settingsStorage.setCommunitySkipsEnabled(next);
              setCommunitySkips(next);
            }}
          />
          <SettingsSwitchRow
            title="Airing reminders"
            description="Allow notifications on the day a new episode airs, for the titles you chose in your library"
            value={airingReminders}
            onValueChange={next => {
              settingsStorage.setAiringRemindersEnabled(next);
              setAiringReminders(next);
              syncAiringReminders().catch(() => undefined);
            }}
          />
          <SettingsSwitchRow
            title="Check for new episodes"
            description="When the app opens, look for new episodes of shows in your library and notify you"
            value={newEpisodeCheck}
            onValueChange={next => {
              settingsStorage.setNewEpisodeCheckEnabled(next);
              setNewEpisodeCheck(next);
            }}
          />
          <SettingsSwitchRow
            title="Download new episodes automatically"
            description="Queue up to 5 new episodes at a time of library titles marked Watching, found by the check above. Wi-Fi and storage rules still apply"
            value={autoDownloadNew}
            onValueChange={next => {
              settingsStorage.setAutoDownloadNewEpisodes(next);
              setAutoDownloadNew(next);
            }}
          />
          <SettingsSwitchRow
            title="Swipe gestures"
            description="Adjust playback with gestures over the video"
            value={enableSwipeGesture}
            onValueChange={next => {
              settingsStorage.setSwipeGestureEnabled(next);
              setEnableSwipeGesture(next);
            }}
          />
          <SettingsSwitchRow
            title="Download full torrent"
            description={
              torrentFullDownload
                ? 'Keep downloading the whole video while it plays'
                : 'Download only about 1 minute ahead of playback'
            }
            value={torrentFullDownload}
            divider={false}
            onValueChange={next => {
              settingsStorage.setTorrentFullDownload(next);
              setTorrentFullDownload(next);
            }}
          />
        </SettingsSection>

        <BufferPreference />

        <DownloadLocationPreference primary={colors.primary} />

        <DownloadConcurrencyPreference primary={colors.primary} />

        <DownloadPolicyPreference />

        <TrackersPreference />
        <TraktPreference />

        <AutoBackupPreference />

        <AppLockPreference />

        <View className="mb-6">
          <AppText
            role="labelLarge"
            className="mb-3 text-m3-on-surface-variant">
            Quality
          </AppText>
          <Surface level="low" className="p-4">
            <AppText role="bodyLarge" className="text-m3-on-surface">
              Excluded Qualities
            </AppText>
            <AppText
              role="bodySmall"
              className="mb-4 mt-1 text-m3-on-surface-variant">
              Hide lower resolutions from stream results
            </AppText>
            <View className="flex-row flex-wrap gap-3">
              {['360p', '480p', '720p'].map(quality => {
                const selected = ExcludedQualities.includes(quality);
                return (
                  <TVFocusable
                    key={quality}
                    borderRadius={16}
                    accessibilityRole="button"
                    accessibilityLabel={`Quality ${quality}`}
                    onPress={() => {
                      if (settingsStorage.isHapticFeedbackEnabled()) {
                        RNReactNativeHapticFeedback.trigger('effectTick');
                      }
                      const newExcluded = ExcludedQualities.includes(quality)
                        ? ExcludedQualities.filter(q => q !== quality)
                        : [...ExcludedQualities, quality];
                      setExcludedQualities(newExcluded);
                      settingsStorage.setExcludedQualities(newExcluded);
                    }}
                    style={{
                      backgroundColor: selected
                        ? colors.secondaryContainer
                        : colors.surfaceContainerHigh,
                      borderColor: selected
                        ? colors.primary
                        : colors.outlineVariant,
                      borderRadius: 16,
                      borderWidth: 1,
                      paddingHorizontal: 18,
                      paddingVertical: 10,
                    }}>
                    <AppText
                      role="labelLargeEmphasized"
                      style={{
                        color: selected
                          ? colors.onSecondaryContainer
                          : colors.onSurface,
                      }}>
                      {quality}
                    </AppText>
                  </TVFocusable>
                );
              })}
            </View>
          </Surface>
        </View>
      </View>
    </ScrollView>
  </TVFocusGuide>
  );
};

export default Preferences;
