import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {View} from 'react-native';
import {PIN_MAX_LENGTH} from '../lib/appLock';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable} from './tv';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'] as const;

/**
 * A number pad for entering a PIN. Shows a dot per digit. `onSubmit` runs when
 * the user presses the check key, or when `autoSubmitLength` digits are in.
 */
const PinPad = ({
  value,
  onChange,
  onSubmit,
  autoSubmitLength,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  autoSubmitLength?: number;
  disabled?: boolean;
}) => {
  const colors = useM3Colors();

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled) {
      return;
    }
    if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (key === 'ok') {
      onSubmit(value);
    } else if (value.length < PIN_MAX_LENGTH) {
      const next = value + key;
      onChange(next);
      if (autoSubmitLength && next.length === autoSubmitLength) {
        onSubmit(next);
      }
    }
  };

  return (
    <View style={{alignItems: 'center', gap: 18}}>
      <View style={{flexDirection: 'row', gap: 12, minHeight: 20}}>
        {Array.from({length: Math.max(value.length, autoSubmitLength ?? 4)}, (_, index) => (
          <View
            key={index}
            style={{
              backgroundColor: index < value.length ? colors.primary : 'transparent',
              borderColor: index < value.length ? colors.primary : colors.outline,
              borderRadius: 8,
              borderWidth: 2,
              height: 16,
              width: 16,
            }}
          />
        ))}
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', width: 240}}>
        {KEYS.map(key => (
          <TVFocusable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === 'back' ? 'Delete' : key === 'ok' ? 'Confirm' : key}
            hasTVPreferredFocus={key === '5'}
            disabled={disabled}
            borderRadius={36}
            focusScale={1.08}
            onPress={() => press(key)}
            style={{
              alignItems: 'center',
              backgroundColor:
                key === 'ok' ? colors.primary : colors.surfaceContainerHigh,
              borderRadius: 36,
              height: 64,
              justifyContent: 'center',
              opacity: disabled ? 0.5 : 1,
              width: 64,
            }}>
            {key === 'back' ? (
              <MaterialCommunityIcons name="backspace-outline" size={26} color={colors.onSurface} />
            ) : key === 'ok' ? (
              <MaterialCommunityIcons name="check" size={28} color={colors.onPrimary} />
            ) : (
              <AppText role="headlineSmall" style={{color: colors.onSurface}}>
                {key}
              </AppText>
            )}
          </TVFocusable>
        ))}
      </View>
    </View>
  );
};

export default PinPad;
