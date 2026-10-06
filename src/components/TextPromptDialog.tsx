import React, {useEffect, useState} from 'react';
import {KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View} from 'react-native';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';

/** Asks for one line of text. `validate` returns an error message, or nothing when the text is fine. */
const TextPromptDialog = ({
  visible,
  title,
  description,
  placeholder,
  initialValue = '',
  confirmLabel = 'Save',
  validate,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | undefined;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setError('');
    }
  }, [visible, initialValue]);

  if (!visible) {
    return null;
  }

  const confirm = () => {
    const problem = validate?.(value.trim());
    if (problem) {
      setError(problem);
      return;
    }
    onConfirm(value.trim());
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View className="rounded-t-3xl p-5" style={{backgroundColor: colors.surfaceContainer}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              {title}
            </AppText>
            {description ? (
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
                {description}
              </AppText>
            ) : null}
            <TextInput
              value={value}
              onChangeText={text => {
                setValue(text);
                setError('');
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={title}
              style={{
                backgroundColor: colors.surfaceContainerHighest,
                borderColor: colors.outlineVariant,
                borderRadius: 14,
                borderWidth: 1,
                color: colors.onSurface,
                fontSize: 15,
                marginTop: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            />
            {error ? (
              <AppText role="bodySmall" style={{color: colors.error, marginTop: 8}}>
                {error}
              </AppText>
            ) : null}
            <View className="mt-4 flex-row items-center" style={{gap: 8}}>
              <View style={{flex: 1}} />
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                borderRadius={16}
                focusScale={1}
                onPress={onClose}
                style={{paddingHorizontal: 16, paddingVertical: 12}}>
                <AppText role="labelLarge" style={{color: colors.onSurface}}>
                  Cancel
                </AppText>
              </TVFocusable>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                borderRadius={16}
                focusScale={1}
                onPress={confirm}
                style={{backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 22, paddingVertical: 12}}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  {confirmLabel}
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default TextPromptDialog;
