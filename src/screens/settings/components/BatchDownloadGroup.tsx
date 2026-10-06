import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {TVFocusable} from '../../../components/tv';
import {formatDownloadBytes} from '../../../lib/downloadFormatting';
import type {BatchSummary} from '../../../lib/download/batchDownloads';
import {useTVFocusBorderColor} from '../../../lib/tv/useTVFocusBorderColor';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import DownloadProgressBar from './DownloadProgressBar';

const ActionButton = ({
  icon,
  label,
  onPress,
  tone = 'neutral',
  primary,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger';
  primary: string;
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const danger = tone === 'danger';
  return (
    <TVFocusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      borderRadius={14}
      focusScale={1.05}
      focusBorderColor={focusBorderColor}
      style={{
        alignItems: 'center',
        backgroundColor: danger
          ? colors.errorContainer
          : colors.surfaceContainerHighest,
        borderRadius: 14,
        flexDirection: 'row',
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}>
      <MaterialCommunityIcons
        name={icon as any}
        size={18}
        color={danger ? colors.onErrorContainer : primary}
      />
      <Text
        className="ml-1 text-sm font-medium"
        style={{color: danger ? colors.onErrorContainer : colors.onSurface}}>
        {label}
      </Text>
    </TVFocusable>
  );
};

/** One card for a bulk download: overall progress and actions for all of it. */
const BatchDownloadGroup = ({
  summary,
  progress,
  primary,
  onPauseAll,
  onResumeAll,
  onRetryFailed,
  onCancelAll,
  firstActionRef,
  onFirstActionLayout,
  children,
}: {
  summary: BatchSummary;
  /** 0 to 1, counting the part-done episodes. */
  progress: number;
  primary: string;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onRetryFailed: () => void;
  onCancelAll: () => void;
  /** Set when this group is the first thing on the screen, for TV focus. */
  firstActionRef?: React.RefObject<View | null>;
  onFirstActionLayout?: () => void;
  children?: React.ReactNode;
}) => {
  const colors = useM3Colors();
  const focusBorderColor = useTVFocusBorderColor();
  const [expanded, setExpanded] = useState(false);
  const canPause = summary.active + summary.waiting > 0;
  const canResume = summary.paused > 0;
  const parts = [
    `${summary.done} of ${summary.total} done`,
    summary.active > 0 ? `${summary.active} downloading` : '',
    summary.failed > 0 ? `${summary.failed} failed` : '',
  ].filter(Boolean);

  return (
    <View
      className="mb-3 p-3"
      style={{
        backgroundColor: colors.surfaceContainerHigh,
        borderColor: colors.outlineVariant,
        borderRadius: 20,
        borderWidth: 1,
      }}>
      <TVFocusable
        ref={firstActionRef}
        onLayout={onFirstActionLayout}
        hasTVPreferredFocus={Boolean(firstActionRef)}
        accessibilityRole="button"
        accessibilityLabel={`${summary.title}, ${parts.join(', ')}. ${
          expanded ? 'Hide' : 'Show'} episodes`}
        onPress={() => setExpanded(value => !value)}
        borderRadius={14}
        focusScale={1.01}
        focusBorderColor={focusBorderColor}
        style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <MaterialCommunityIcons
          name="download-multiple"
          size={26}
          color={primary}
        />
        <View style={{flex: 1}}>
          <Text
            className="text-base font-semibold"
            style={{color: colors.onSurface}}
            numberOfLines={2}>
            {summary.title}
          </Text>
          <Text
            className="mt-1 text-xs"
            style={{color: summary.failed > 0 ? colors.error : colors.onSurfaceVariant}}>
            {parts.join(' · ')}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={24}
          color={colors.onSurfaceVariant}
        />
      </TVFocusable>

      <View className="mt-3">
        <DownloadProgressBar
          progress={Math.min(Math.max(progress, 0), 1)}
          color={summary.failed > 0 && summary.active === 0 ? colors.error : primary}
        />
        {summary.bytesTotal > 0 ? (
          <Text className="mt-2 text-xs" style={{color: colors.onSurfaceVariant}}>
            {formatDownloadBytes(summary.bytesDone)} downloaded so far
          </Text>
        ) : null}
      </View>

      <View className="mt-3 flex-row flex-wrap justify-end gap-2">
        {canPause ? (
          <ActionButton
            icon="pause"
            label="Pause all"
            primary={primary}
            onPress={onPauseAll}
          />
        ) : null}
        {canResume ? (
          <ActionButton
            icon="play"
            label="Resume all"
            primary={primary}
            onPress={onResumeAll}
          />
        ) : null}
        {summary.failed > 0 ? (
          <ActionButton
            icon="refresh"
            label="Retry failed"
            primary={primary}
            onPress={onRetryFailed}
          />
        ) : null}
        <ActionButton
          icon="close"
          label="Cancel all"
          tone="danger"
          primary={primary}
          onPress={onCancelAll}
        />
      </View>

      {expanded ? <View className="mt-3">{children}</View> : null}
    </View>
  );
};

export default BatchDownloadGroup;
