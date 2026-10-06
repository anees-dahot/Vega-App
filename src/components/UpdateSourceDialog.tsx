import React, {useEffect, useState} from 'react';
import {KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View} from 'react-native';
import {getUpdateRepo, normalizeRepo} from '../lib/updateSource';
import {settingsStorage} from '../lib/storage';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';

/** Set the GitHub repository whose releases the app checks for updates. */
const UpdateSourceDialog = ({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const colors = useM3Colors();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setText(getUpdateRepo());
      setError('');
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const save = () => {
    if (!text.trim()) {
      settingsStorage.setUpdateRepo('');
    } else {
      const repo = normalizeRepo(text);
      if (!repo) {
        setError('Enter it as owner/repo, or paste the GitHub address');
        return;
      }
      settingsStorage.setUpdateRepo(repo);
    }
    onSaved();
    onClose();
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
              Update source
            </AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              The GitHub repository whose latest release holds the app's APK. Leave it empty to turn update checks off.
            </AppText>
            <TextInput
              value={text}
              onChangeText={value => {
                setText(value);
                setError('');
              }}
              placeholder="owner/repo"
              placeholderTextColor={colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Update source"
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
                accessibilityLabel="Save"
                borderRadius={16}
                focusScale={1}
                onPress={save}
                style={{backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 22, paddingVertical: 12}}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  Save
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default UpdateSourceDialog;
