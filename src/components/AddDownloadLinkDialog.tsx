import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {
  Clipboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import {
  buildLinkDownloadRequest,
  parseDownloadLink,
} from '../lib/download/linkDownload';
import {downloadManager} from '../lib/downloader';
import useDownloadsStore from '../lib/zustand/downloadsStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';

/** Dialog to download from a pasted link: a direct file, a playlist or a magnet. */
const AddDownloadLinkDialog = ({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setLink('');
      setName('');
      setNameEdited(false);
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const updateLink = (value: string) => {
    setLink(value);
    setError(null);
    // The name follows the link until the user types their own.
    if (!nameEdited) {
      const parsed = parseDownloadLink(value);
      setName(parsed.ok ? parsed.link.suggestedName : '');
    }
  };

  const paste = async () => {
    const text = await Clipboard.getString();
    if (text) {
      updateLink(text.trim());
    }
  };

  const start = async () => {
    if (busy) {
      return;
    }
    const parsed = parseDownloadLink(link);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const request = buildLinkDownloadRequest(parsed.link, name);
    const existing = useDownloadsStore.getState().downloads[request.downloadId];
    if (existing?.status === 'completed') {
      setError('This link is already downloaded');
      return;
    }
    setBusy(true);
    try {
      await downloadManager(request);
      ToastAndroid.show('Added to downloads', ToastAndroid.SHORT);
      onClose();
    } catch (failure: any) {
      setError(failure?.message || 'Could not start the download');
      setBusy(false);
    }
  };

  if (!visible) {
    return null;
  }

  const field = {
    backgroundColor: colors.surfaceContainerHighest,
    borderColor: colors.outlineVariant,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.onSurface,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  } as const;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onClose} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View
            className="rounded-t-3xl p-5"
            style={{backgroundColor: colors.surfaceContainer}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              Download from a link
            </AppText>
            <AppText
              role="bodySmall"
              style={{color: colors.onSurfaceVariant, marginTop: 2}}>
              A direct file link, an .m3u8 playlist or a magnet link.
            </AppText>

            <View style={{flexDirection: 'row', gap: 8, marginTop: 14}}>
              <TextInput
                value={link}
                onChangeText={updateLink}
                placeholder="https://… or magnet:?…"
                placeholderTextColor={colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                multiline={false}
                style={[field, {flex: 1}]}
                accessibilityLabel="Download link"
              />
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Paste from clipboard"
                borderRadius={14}
                focusScale={1}
                onPress={() => {
                  paste().catch(console.error);
                }}
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.secondaryContainer,
                  borderRadius: 14,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                }}>
                <MaterialCommunityIcons
                  name="content-paste"
                  size={22}
                  color={colors.onSecondaryContainer}
                />
              </TVFocusable>
            </View>

            <TextInput
              value={name}
              onChangeText={value => {
                setName(value);
                setNameEdited(true);
              }}
              placeholder="Name"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[field, {marginTop: 10}]}
              accessibilityLabel="File name"
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
                accessibilityLabel="Start download"
                disabled={busy}
                borderRadius={16}
                focusScale={1}
                onPress={() => {
                  start().catch(console.error);
                }}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 16,
                  opacity: busy ? 0.5 : 1,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                }}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  {busy ? 'Adding…' : 'Download'}
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default AddDownloadLinkDialog;
