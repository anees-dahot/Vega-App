import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, ToastAndroid, View} from 'react-native';
import {findCueText, type SubtitleCue} from '../lib/subtitles/parse';
import {loadSubtitleCues} from '../lib/subtitles/load';
import {settingsStorage} from '../lib/storage';

const POLL_MS = 200;

/**
 * Shows subtitles from a file itself, so they can be shifted in time. Used
 * while a delay is set; the video's own subtitle display is off then.
 */
const CustomSubtitleOverlay = ({
  uri,
  delayMs,
  visible,
  getPositionMs,
  onUnsupported,
}: {
  uri: string | undefined;
  delayMs: number;
  visible: boolean;
  /** Where the video is now, in milliseconds. */
  getPositionMs: () => Promise<number>;
  /** The file has no readable subtitles (an unsupported format, or it failed to load). */
  onUnsupported: () => void;
}) => {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [text, setText] = useState('');
  const delayRef = useRef(delayMs);
  delayRef.current = delayMs;
  const unsupportedRef = useRef(onUnsupported);
  unsupportedRef.current = onUnsupported;

  useEffect(() => {
    let active = true;
    setCues([]);
    setText('');
    if (!uri || !visible) {
      return;
    }
    loadSubtitleCues(uri)
      .then(loaded => {
        if (!active) {
          return;
        }
        if (loaded.length === 0) {
          ToastAndroid.show(
            "This subtitle format can't be shifted",
            ToastAndroid.SHORT,
          );
          unsupportedRef.current();
          return;
        }
        setCues(loaded);
      })
      .catch(() => {
        if (active) {
          ToastAndroid.show("Couldn't load the subtitle file", ToastAndroid.SHORT);
          unsupportedRef.current();
        }
      });
    return () => {
      active = false;
    };
  }, [uri, visible]);

  useEffect(() => {
    if (!visible || cues.length === 0) {
      return;
    }
    let active = true;
    const tick = () => {
      getPositionMs()
        .then(position => {
          if (active) {
            setText(findCueText(cues, position, delayRef.current));
          }
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cues, visible, getPositionMs]);

  if (!visible || !text) {
    return null;
  }

  const fontSize = settingsStorage.getSubtitleFontSize() ?? 16;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        {paddingBottom: (settingsStorage.getSubtitleBottomPadding() ?? 10) + 8},
      ]}>
      <Text
        style={[
          styles.text,
          {
            color: settingsStorage.getSubtitleTextColor(),
            fontSize,
            lineHeight: fontSize * 1.3,
            opacity: settingsStorage.getSubtitleTextOpacity() ?? 1,
          },
        ]}>
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    paddingHorizontal: 48,
    position: 'absolute',
    right: 0,
    zIndex: 60,
  },
  text: {
    textAlign: 'center',
    textShadowColor: '#000000',
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 6,
  },
});

export default CustomSubtitleOverlay;
