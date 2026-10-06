import React, {useState} from 'react';
import {Modal, ToastAndroid, View} from 'react-native';
import AppText from '../../../components/ui/Text';
import DropdownField from '../../../components/ui/DropdownField';
import PinPad from '../../../components/PinPad';
import SettingsRow from '../../../components/ui/SettingsRow';
import SettingsSwitchRow from '../../../components/ui/SettingsSwitchRow';
import Surface from '../../../components/ui/Surface';
import {TVFocusable} from '../../../components/tv';
import {
  LOCK_TIMEOUT_OPTIONS,
  PIN_MIN_LENGTH,
  clearAppLock,
  getLockTimeoutSeconds,
  isAppLockEnabled,
  isValidPin,
  setAppLockPin,
  setLockTimeoutSeconds,
  verifyAppLockPin,
} from '../../../lib/appLock';
import {useM3Colors} from '../../../theme/M3PaletteContext';

type Step = 'current' | 'new' | 'confirm';

/** Turn the PIN lock on or off, change the PIN, and choose when it asks again. */
const AppLockPreference = () => {
  const colors = useM3Colors();
  const [enabled, setEnabled] = useState(isAppLockEnabled());
  const [timeout, setTimeoutSeconds] = useState(getLockTimeoutSeconds());
  const [flow, setFlow] = useState<
    {purpose: 'set' | 'change' | 'disable'; step: Step; first?: string} | null
  >(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const start = (purpose: 'set' | 'change' | 'disable') => {
    setPin('');
    setError('');
    setFlow({purpose, step: purpose === 'set' ? 'new' : 'current'});
  };

  const finish = (message: string) => {
    setFlow(null);
    setPin('');
    setEnabled(isAppLockEnabled());
    ToastAndroid.show(message, ToastAndroid.SHORT);
  };

  const submit = async (value: string) => {
    if (!flow) {
      return;
    }
    setError('');
    if (flow.step === 'current') {
      const result = await verifyAppLockPin(value);
      if (result !== 'ok') {
        setPin('');
        setError(result === 'wait' ? 'Too many wrong tries. Wait a little.' : 'Wrong PIN');
        return;
      }
      if (flow.purpose === 'disable') {
        clearAppLock();
        finish('PIN lock turned off');
      } else {
        setPin('');
        setFlow({...flow, step: 'new'});
      }
      return;
    }
    if (flow.step === 'new') {
      if (!isValidPin(value)) {
        setError(`Use ${PIN_MIN_LENGTH} to 8 digits`);
        return;
      }
      setPin('');
      setFlow({...flow, step: 'confirm', first: value});
      return;
    }
    if (value !== flow.first) {
      setPin('');
      setError('The PINs do not match. Try again.');
      setFlow({...flow, step: 'new', first: undefined});
      return;
    }
    await setAppLockPin(value);
    finish(flow.purpose === 'change' ? 'PIN changed' : 'PIN lock turned on');
  };

  const title = !flow
    ? ''
    : flow.step === 'current'
      ? 'Enter your current PIN'
      : flow.step === 'new'
        ? 'Choose a new PIN'
        : 'Enter the PIN again';

  return (
    <View className="mb-6">
      <AppText role="labelLarge" className="mb-3 text-m3-on-surface-variant">
        PIN lock
      </AppText>
      <Surface level="low" className="overflow-hidden">
        <SettingsSwitchRow
          title="Lock the app with a PIN"
          description="Ask for a PIN when the app opens and when you come back to it"
          value={enabled}
          onValueChange={next => start(next ? 'set' : 'disable')}
          divider={enabled}
        />
        {enabled ? (
          <>
            <SettingsRow
              title="Change PIN"
              icon="lock-reset"
              onPress={() => start('change')}
            />
            <View className="px-4 py-3">
              <AppText role="bodyLarge" style={{color: colors.onSurface}}>
                Ask for the PIN again
              </AppText>
              <View style={{height: 8}} />
              <DropdownField
                options={LOCK_TIMEOUT_OPTIONS}
                value={LOCK_TIMEOUT_OPTIONS.find(item => item.seconds === timeout)}
                getKey={option => String(option.seconds)}
                getLabel={option => option.label}
                onChange={option => {
                  setLockTimeoutSeconds(option.seconds);
                  setTimeoutSeconds(option.seconds);
                }}
              />
            </View>
          </>
        ) : null}
      </Surface>

      <Modal visible={flow !== null} transparent animationType="fade" onRequestClose={() => setFlow(null)}>
        <View className="flex-1 items-center justify-center bg-black/70 px-6">
          <View
            className="items-center rounded-3xl p-6"
            style={{backgroundColor: colors.surfaceContainer, gap: 16}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              {title}
            </AppText>
            <AppText
              role="bodySmall"
              style={{color: error ? colors.error : colors.onSurfaceVariant, minHeight: 20}}>
              {error || (flow?.step === 'new' ? `${PIN_MIN_LENGTH} to 8 digits` : ' ')}
            </AppText>
            <PinPad
              value={pin}
              onChange={setPin}
              onSubmit={value => {
                submit(value).catch(console.error);
              }}
            />
            <TVFocusable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              borderRadius={14}
              focusScale={1}
              onPress={() => setFlow(null)}
              style={{paddingHorizontal: 16, paddingVertical: 10}}>
              <AppText role="labelLarge" style={{color: colors.onSurface}}>
                Cancel
              </AppText>
            </TVFocusable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default AppLockPreference;
