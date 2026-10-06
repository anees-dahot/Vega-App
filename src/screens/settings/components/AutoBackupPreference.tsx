import * as FileSystem from 'expo-file-system/legacy';
import * as Updates from 'expo-updates';
import React, {useState} from 'react';
import {DevSettings, ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import Surface from '../../../components/ui/Surface';
import {restoreLatestAutoBackup, runAutoBackup} from '../../../lib/autoBackup';
import {getSafEntryName} from '../../../lib/downloadLocation';
import {settingsStorage} from '../../../lib/storage';
import {showAppDialog} from '../../../lib/zustand/appDialogStore';
import {useM3Colors} from '../../../theme/M3PaletteContext';

const INTERVALS = [
  {days: 1, label: 'Every day'},
  {days: 7, label: 'Every week'},
  {days: 30, label: 'Every month'},
];

const describeFolder = (uri: string): string => {
  if (!uri) {
    return 'No folder chosen';
  }
  try {
    return decodeURIComponent(getSafEntryName(uri));
  } catch {
    return 'Chosen folder';
  }
};

const formatLast = (seconds: number): string =>
  seconds > 0 ? new Date(seconds * 1000).toLocaleString() : 'Never';

/** Backups that save themselves into a folder, and a one-tap restore of the newest. */
const AutoBackupPreference = () => {
  const colors = useM3Colors();
  const [enabled, setEnabled] = useState(settingsStorage.isAutoBackupEnabled());
  const [folder, setFolder] = useState(settingsStorage.getAutoBackupFolder());
  const [days, setDays] = useState(settingsStorage.getAutoBackupIntervalDays());
  const [lastAt, setLastAt] = useState(settingsStorage.getAutoBackupLastAt());
  const [busy, setBusy] = useState(false);

  const pickFolder = async (): Promise<boolean> => {
    const permission =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) {
      return false;
    }
    settingsStorage.setAutoBackupFolder(permission.directoryUri);
    setFolder(permission.directoryUri);
    return true;
  };

  const toggle = async (next: boolean) => {
    if (next && !folder && !(await pickFolder())) {
      return;
    }
    settingsStorage.setAutoBackupEnabled(next);
    setEnabled(next);
    if (next) {
      // The first backup is made at once.
      runAutoBackup().then(() => setLastAt(settingsStorage.getAutoBackupLastAt()));
    }
  };

  const backupNow = async () => {
    if (busy) {
      return;
    }
    if (!folder && !(await pickFolder())) {
      return;
    }
    setBusy(true);
    const result = await runAutoBackup({force: true});
    setBusy(false);
    setLastAt(settingsStorage.getAutoBackupLastAt());
    ToastAndroid.show(
      result === 'done' ? 'Backup saved' : 'Could not save the backup',
      ToastAndroid.SHORT,
    );
  };

  const restore = () => {
    if (!folder) {
      ToastAndroid.show('Choose a backup folder first', ToastAndroid.SHORT);
      return;
    }
    showAppDialog({
      title: 'Restore the latest backup?',
      message:
        'This replaces your settings, providers and library with the newest automatic backup in the folder. Vega will restart after restoring.',
      variant: 'warning',
      actions: [
        {label: 'Cancel'},
        {
          label: 'Restore',
          variant: 'destructive',
          onPress: async () => {
            try {
              const name = await restoreLatestAutoBackup();
              if (!name) {
                ToastAndroid.show('No automatic backup found in the folder', ToastAndroid.LONG);
                return;
              }
              if (Updates.isEnabled) {
                await Updates.reloadAsync();
              } else {
                DevSettings.reload('Backup restored');
              }
            } catch (error) {
              showAppDialog({
                title: 'Could not restore the backup',
                message: error instanceof Error ? error.message : 'Failed to read the file',
                variant: 'error',
                actions: [{label: 'OK'}],
              });
            }
          },
        },
      ],
    });
  };

  return (
    <View className="mb-6">
      <AppText role="labelLarge" className="mb-3 text-m3-on-surface-variant">
        Automatic backup
      </AppText>
      <Surface level="low" className="overflow-hidden">
        <SettingsSwitchRow
          title="Back up automatically"
          description="Saves your settings, providers and library to a folder, and keeps the newest 5"
          value={enabled}
          onValueChange={next => {
            toggle(next).catch(console.error);
          }}
        />
        <SettingsRow
          title="Backup folder"
          description={describeFolder(folder)}
          icon="folder-outline"
          onPress={() => {
            pickFolder().catch(console.error);
          }}
        />
        {enabled ? (
          <View className="px-4 py-3">
            <AppText role="bodyLarge" style={{color: colors.onSurface}}>
              How often
            </AppText>
            <View style={{height: 8}} />
            <DropdownField
              options={INTERVALS}
              value={INTERVALS.find(item => item.days === days) ?? INTERVALS[1]}
              getKey={option => String(option.days)}
              getLabel={option => option.label}
              onChange={option => {
                settingsStorage.setAutoBackupIntervalDays(option.days);
                setDays(option.days);
              }}
            />
          </View>
        ) : null}
        <SettingsRow
          title="Back up now"
          description={`Last backup: ${formatLast(lastAt)}`}
          icon="content-save-outline"
          onPress={() => {
            backupNow().catch(console.error);
          }}
        />
        <SettingsRow
          title="Restore the latest backup"
          description="Replaces your data with the newest backup in the folder"
          icon="backup-restore"
          divider={false}
          onPress={restore}
        />
      </Surface>
    </View>
  );
};

export default AutoBackupPreference;
