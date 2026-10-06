import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Modal, View} from 'react-native';
import {
  getCurrentLockoutSeconds,
  getLockTimeoutSeconds,
  getPinLength,
  isAppLockEnabled,
  shouldLockAfterBackground,
  verifyAppLockPin,
} from '../lib/appLock';
import {useM3Colors} from '../theme/M3PaletteContext';
import PinPad from './PinPad';
import AppText from './ui/Text';

/**
 * Covers the app with a PIN screen when the PIN lock is on: when the app
 * opens, and when it comes back after being away for the chosen time.
 */
const AppLockGate = () => {
  const colors = useM3Colors();
  const [locked, setLocked] = useState(() => isAppLockEnabled());
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (
          away !== null &&
          isAppLockEnabled() &&
          shouldLockAfterBackground(away, Date.now(), getLockTimeoutSeconds())
        ) {
          setPin('');
          setMessage('');
          setLocked(true);
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Counts down the wait that follows too many wrong tries.
  useEffect(() => {
    if (wait <= 0) {
      return;
    }
    const timer = setTimeout(() => setWait(getCurrentLockoutSeconds()), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = useCallback(async (value: string) => {
    if (busy || value.length === 0) {
      return;
    }
    setBusy(true);
    const result = await verifyAppLockPin(value);
    setBusy(false);
    setPin('');
    if (result === 'ok') {
      setMessage('');
      setLocked(false);
    } else if (result === 'wait') {
      setWait(getCurrentLockoutSeconds());
      setMessage('Too many wrong tries.');
    } else {
      const remaining = getCurrentLockoutSeconds();
      setWait(remaining);
      setMessage(remaining > 0 ? 'Too many wrong tries.' : 'Wrong PIN');
    }
  }, [busy]);

  if (!locked) {
    return null;
  }

  return (
    <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => undefined}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.background,
          flex: 1,
          gap: 24,
          justifyContent: 'center',
        }}>
        <AppText role="headlineSmall" style={{color: colors.onBackground}}>
          Enter your PIN
        </AppText>
        <AppText
          role="bodyMedium"
          style={{color: wait > 0 || message ? colors.error : colors.onSurfaceVariant, minHeight: 22}}>
          {wait > 0 ? `${message} Try again in ${wait} s` : message || 'Vega is locked'}
        </AppText>
        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={value => {
            submit(value).catch(() => undefined);
          }}
          autoSubmitLength={getPinLength()}
          disabled={busy || wait > 0}
        />
      </View>
    </Modal>
  );
};

export default AppLockGate;
