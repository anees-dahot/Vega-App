import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Modal, Pressable, ToastAndroid, View} from 'react-native';
import ServerOrderEditor from './ServerOrderEditor';
import TextPromptDialog from './TextPromptDialog';
import {getAudioLanguageCode} from '../lib/download/audioMerge';
import {mainStorage} from '../lib/storage/StorageService';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';
import {
  checkStorageForBatch,
  describeAudioSkipped,
  describeSkipped,
  enqueueBulkAudio,
  enqueueBulkDownload,
  planBulkAudio,
  getEpisodeDownloadState,
  loadBulkSample,
  planBulkDownload,
  probeBulkFileSize,
  selectNextUnwatched,
  type BulkContext,
  type BulkEpisode,
  type EpisodeDownloadState,
} from '../lib/download/bulkDownload';
import {formatDownloadBytes} from '../lib/downloadFormatting';
import {getServerHealth} from '../lib/download/serverHealth';
import {
  describeRule,
  serverRulesStorage,
  toRuleEntry,
  type NoMatchAction,
  type QualityPreference,
  type ServerRule,
  type ServerRuleEntry,
} from '../lib/download/serverRules';
import {
  deleteWatchedDownloads,
  summarizeWatchedDownloads,
} from '../lib/download/storageCleanup';
import type {Stream} from '../lib/providers/types';
import {extensionStorage} from '../lib/storage/extensionStorage';
import useDownloadsStore from '../lib/zustand/downloadsStore';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import {useM3Colors} from '../theme/M3PaletteContext';

const DEFAULT_NEXT_COUNT = 5;
const MAX_NEXT_COUNT = 50;

const STATE_BADGES: Record<
  Exclude<EpisodeDownloadState, 'none'>,
  {label: string; icon: string}
> = {
  completed: {label: 'Downloaded', icon: 'check-circle'},
  queued: {label: 'Queued', icon: 'timer-sand'},
  failed: {label: 'Failed', icon: 'alert-circle-outline'},
};

const AUDIO_BADGES: Record<string, {label: string; icon: string}> = {
  'no-video': {label: 'No video yet', icon: 'video-off-outline'},
  'has-audio': {label: 'Has audio', icon: 'check-circle'},
  queued: {label: 'Queued', icon: 'timer-sand'},
  ambiguous: {label: 'Unclear match', icon: 'help-circle-outline'},
};

const BulkDownloadSheet = ({
  visible,
  heading,
  context,
  episodes,
  onClose,
}: {
  visible: boolean;
  heading: string;
  context: BulkContext;
  episodes: BulkEpisode[];
  onClose: () => void;
}) => {
  const colors = useM3Colors();
  const downloads = useDownloadsStore(state => state.downloads);
  const providerName =
    extensionStorage
      .getInstalledProviders()
      .find(item => item.value === context.providerValue)?.display_name ||
    context.providerValue;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nextCount, setNextCount] = useState(DEFAULT_NEXT_COUNT);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // "Add audio" brings another language to videos that are already downloaded.
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [audioLabel, setAudioLabel] = useState(
    () => mainStorage.getString('bulkAudioLabel') || 'Hindi',
  );
  const [labelPrompt, setLabelPrompt] = useState(false);
  const [editorServers, setEditorServers] = useState<Stream[] | null>(null);
  // Called with the rule the user saves, to carry on queueing.
  const [afterRule, setAfterRule] = useState<((rule: ServerRule) => void) | null>(
    null,
  );
  const [, setRuleVersion] = useState(0);

  const stateOf = useCallback(
    (id: string) => getEpisodeDownloadState(id, downloads),
    [downloads],
  );

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setAllowDuplicates(false);
      setBusy(null);
      setMode('video');
    }
  }, [visible]);

  useEffect(() => {
    setSelected(new Set());
  }, [mode, audioLabel]);

  const selectedEpisodes = useMemo(
    () => episodes.filter(episode => selected.has(episode.id)),
    [episodes, selected],
  );
  const plan = useMemo(
    () =>
      planBulkDownload(context, selectedEpisodes, {allowDuplicates}, downloads),
    [context, selectedEpisodes, allowDuplicates, downloads],
  );
  const audioLanguage = getAudioLanguageCode(audioLabel);
  // Which episodes can take the audio, and why the others cannot.
  const audioOverview = useMemo(() => {
    if (mode !== 'audio') {
      return null;
    }
    const all = planBulkAudio(context, episodes, audioLabel, audioLanguage, downloads);
    return {
      eligible: new Set(all.toQueue.map(entry => entry.episode.id)),
      reasons: new Map(all.skipped.map(entry => [entry.episode.id, entry.reason])),
    };
  }, [mode, context, episodes, audioLabel, audioLanguage, downloads]);
  const audioPlan = useMemo(
    () =>
      mode === 'audio'
        ? planBulkAudio(context, selectedEpisodes, audioLabel, audioLanguage, downloads)
        : null,
    [mode, context, selectedEpisodes, audioLabel, audioLanguage, downloads],
  );
  const queueEpisodes: BulkEpisode[] = audioPlan
    ? audioPlan.toQueue.map(entry => entry.episode)
    : plan.toQueue;
  const listState = useMemo(
    () => ({selected, downloads, mode, audioOverview}),
    [selected, downloads, mode, audioOverview],
  );
  const duplicateCount = plan.skipped.filter(
    entry => entry.reason === 'duplicate',
  ).length;
  const activeRule = serverRulesStorage.resolve(
    context.providerValue,
    context.infoUrl,
  );

  const selectIds = (ids: string[]) => setSelected(new Set(ids));
  const selectableIds = (predicate?: (episode: BulkEpisode) => boolean) =>
    episodes
      .filter(episode => {
        if (audioOverview) {
          return audioOverview.eligible.has(episode.id) && (!predicate || predicate(episode));
        }
        const state = stateOf(episode.id);
        return (
          (state === 'none' || state === 'failed') &&
          (!predicate || predicate(episode))
        );
      })
      .map(episode => episode.id);

  const toggle = (id: string) => {
    if (audioOverview) {
      if (!audioOverview.eligible.has(id)) {
        return;
      }
    } else if (stateOf(id) === 'completed' || stateOf(id) === 'queued') {
      return;
    }
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const saveRule = (order: ServerRuleEntry[], onNoMatch: NoMatchAction, quality: QualityPreference) => {
    const rule: ServerRule = {
      order,
      onNoMatch,
      ...(quality !== 'any' ? {quality} : {}),
      updatedAt: Date.now(),
    };
    serverRulesStorage.setSeriesRule(
      context.providerValue,
      context.infoUrl,
      rule,
      context.showName,
    );
    setRuleVersion(version => version + 1);
    return rule;
  };

  const confirmStorage = (
    count: number,
    perFileBytes: number | undefined,
  ): Promise<boolean> => {
    const check = checkStorageForBatch(count, perFileBytes);
    if (check.enough) {
      return Promise.resolve(true);
    }
    const watched = summarizeWatchedDownloads();
    const need = check.neededBytes
      ? `About ${formatDownloadBytes(check.neededBytes)} is needed and `
      : '';
    return new Promise(resolve => {
      showAppDialog({
        title: 'Not enough free space',
        message: `${need}${formatDownloadBytes(
          check.freeBytes ?? 0,
        )} is free (${formatDownloadBytes(
          check.minFreeBytes,
        )} is kept free). Downloads will wait until there is room.`,
        variant: 'warning',
        actions: [
          {label: 'Cancel', onPress: () => resolve(false)},
          ...(watched.count > 0
            ? [
                {
                  label: `Delete ${watched.count} watched (${formatDownloadBytes(
                    watched.bytes,
                  )})`,
                  onPress: () => {
                    deleteWatchedDownloads()
                      .then(() => resolve(true))
                      .catch(() => resolve(false));
                  },
                },
              ]
            : []),
          {label: 'Queue anyway', onPress: () => resolve(true)},
        ],
      });
    });
  };

  const queue = async (rule: ServerRule | null, servers: Stream[]) => {
    if (queueEpisodes.length === 0) {
      return;
    }
    let perFileBytes: number | undefined;
    if (rule && servers.length > 0) {
      setBusy('Checking the first server…');
      perFileBytes = await probeBulkFileSize(context, servers, rule).catch(
        () => undefined,
      );
    }
    if (!(await confirmStorage(queueEpisodes.length, perFileBytes))) {
      setBusy(null);
      return;
    }
    setBusy('Queueing…');
    const result = audioPlan
      ? await enqueueBulkAudio(context, audioPlan.toQueue, {
          label: audioLabel,
          language: audioLanguage,
        })
      : await enqueueBulkDownload(context, plan.toQueue);
    setBusy(null);
    if (result.locationMissing) {
      ToastAndroid.show(
        'Choose a download folder to start',
        ToastAndroid.SHORT,
      );
      return;
    }
    const skipped = audioPlan ? describeAudioSkipped(audioPlan) : describeSkipped(plan);
    ToastAndroid.show(
      `${audioPlan ? `${audioLabel} audio queued for` : 'Queued'} ${result.queued} episode${result.queued === 1 ? '' : 's'}${
        skipped ? ` · ${skipped}` : ''
      }`,
      ToastAndroid.LONG,
    );
    onClose();
  };

  const start = async () => {
    if (busy || queueEpisodes.length === 0) {
      return;
    }
    try {
      setBusy('Looking up servers…');
      const servers = await loadBulkSample(context, queueEpisodes[0]);
      if (servers.length === 0) {
        setBusy(null);
        ToastAndroid.show(
          'No downloadable servers found for the first episode',
          ToastAndroid.LONG,
        );
        return;
      }
      if (!activeRule) {
        // First time for this series: choose the server order once.
        setBusy(null);
        setAfterRule(() => (rule: ServerRule) => {
          queue(rule, servers).catch(console.error);
        });
        setEditorServers(servers);
        return;
      }
      await queue(activeRule.rule, servers);
    } catch (error: any) {
      setBusy(null);
      ToastAndroid.show(
        error?.message || 'Could not look up servers',
        ToastAndroid.LONG,
      );
    }
  };

  const changeRule = async () => {
    if (busy || episodes.length === 0) {
      return;
    }
    try {
      setBusy('Looking up servers…');
      const servers = await loadBulkSample(
        context,
        queueEpisodes[0] || selectedEpisodes[0] || episodes[0],
      );
      setBusy(null);
      setAfterRule(null);
      setEditorServers(servers);
    } catch (error: any) {
      setBusy(null);
      ToastAndroid.show(
        error?.message || 'Could not look up servers',
        ToastAndroid.LONG,
      );
    }
  };

  const editorEntries = (() => {
    const current = (editorServers || [])
      .filter(server => server.type !== 'torrent')
      .map(server => toRuleEntry(server.server));
    return {
      order: activeRule?.rule.order ?? current,
      available:
        current.length > 0
          ? current
          : serverRulesStorage.getKnownServers(context.providerValue),
    };
  })();

  const selectionLabel =
    selectedEpisodes.length === 0
      ? 'Select episodes'
      : `${audioPlan ? 'Add audio to' : 'Download'} ${queueEpisodes.length} episode${
          queueEpisodes.length === 1 ? '' : 's'
        }`;
  const skippedLabel = audioPlan ? describeAudioSkipped(audioPlan) : describeSkipped(plan);

  const renderItem = ({item}: {item: BulkEpisode}) => {
    const state = stateOf(item.id);
    const audioReason = audioOverview?.reasons.get(item.id);
    const locked = audioOverview
      ? !audioOverview.eligible.has(item.id)
      : state === 'completed' || state === 'queued';
    const isSelected = selected.has(item.id);
    const badge = audioOverview
      ? audioReason
        ? AUDIO_BADGES[audioReason]
        : null
      : state === 'none'
        ? null
        : STATE_BADGES[state];
    return (
      <TVFocusable
        accessibilityRole="checkbox"
        accessibilityLabel={`${item.episodeName}${item.watched ? ', watched' : ''}${
          badge ? `, ${badge.label}` : ''
        }`}
        accessibilityState={{checked: isSelected, disabled: locked}}
        borderRadius={12}
        focusScale={1}
        onPress={() => toggle(item.id)}
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          gap: 10,
          minHeight: 44,
          opacity: locked ? 0.55 : 1,
          paddingHorizontal: 6,
          paddingVertical: 6,
        }}>
        <MaterialCommunityIcons
          name={
            locked
              ? 'checkbox-blank-off-outline'
              : isSelected
                ? 'checkbox-marked'
                : 'checkbox-blank-outline'
          }
          size={22}
          color={isSelected ? colors.primary : colors.onSurfaceVariant}
        />
        <AppText
          role="bodyMedium"
          numberOfLines={1}
          style={{color: colors.onSurface, flex: 1}}>
          {item.episodeName}
        </AppText>
        {item.watched ? (
          <MaterialCommunityIcons
            name="eye-check-outline"
            size={18}
            color={colors.onSurfaceVariant}
          />
        ) : null}
        {badge ? (
          <View
            className="flex-row items-center rounded-full px-2 py-0.5"
            style={{
              backgroundColor:
                state === 'failed'
                  ? colors.errorContainer
                  : colors.secondaryContainer,
              gap: 4,
            }}>
            <MaterialCommunityIcons
              name={badge.icon as any}
              size={14}
              color={
                state === 'failed'
                  ? colors.onErrorContainer
                  : colors.onSecondaryContainer
              }
            />
            <AppText
              role="labelSmall"
              style={{
                color:
                  state === 'failed'
                    ? colors.onErrorContainer
                    : colors.onSecondaryContainer,
              }}>
              {badge.label}
            </AppText>
          </View>
        ) : null}
      </TVFocusable>
    );
  };

  const chip = (label: string, onPress: () => void, accessibilityLabel?: string) => (
    <TVFocusable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      borderRadius={12}
      focusScale={1}
      onPress={onPress}
      style={{
        borderColor: colors.outlineVariant,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}>
      <AppText role="labelLarge" style={{color: colors.onSurface}}>
        {label}
      </AppText>
    </TVFocusable>
  );

  return (
    <>
      <Modal
        visible={visible && editorServers === null}
        transparent
        animationType="fade"
        onRequestClose={onClose}>
        <View className="flex-1 justify-end bg-black/60">
          <Pressable style={{flex: 1}} onPress={onClose} />
          <TVFocusGuide
            autoFocus
            trapFocusUp
            trapFocusDown
            trapFocusLeft
            trapFocusRight>
            <View
              className="rounded-t-3xl p-5"
              style={{
                backgroundColor: colors.surfaceContainer,
                maxHeight: '90%',
              }}>
              <AppText role="titleMedium" style={{color: colors.onSurface}}>
                {mode === 'audio' ? 'Add audio to downloads' : 'Download episodes'}
              </AppText>
              <AppText
                role="bodySmall"
                numberOfLines={1}
                style={{color: colors.onSurfaceVariant, marginTop: 2}}>
                {heading}
              </AppText>

              <View
                className="flex-row flex-wrap items-center"
                style={{gap: 8, marginTop: 12}}>
                {chip(mode === 'video' ? '● Videos' : 'Videos', () => setMode('video'))}
                {chip(mode === 'audio' ? '● Add audio' : 'Add audio', () => setMode('audio'), 'Add this version as an audio track to downloaded videos')}
                {mode === 'audio'
                  ? chip(`Language: ${audioLabel}`, () => setLabelPrompt(true), 'Change the audio language name')
                  : null}
              </View>
              {mode === 'audio' ? (
                <AppText
                  role="bodySmall"
                  style={{color: colors.onSurfaceVariant, marginTop: 6}}>
                  Only the audio of each chosen episode is taken and added to the
                  video you already downloaded. Episodes without a downloaded video
                  are left out, and so are releases cut differently.
                </AppText>
              ) : null}
              <View
                className="flex-row flex-wrap items-center"
                style={{gap: 8, marginTop: 12}}>
                {chip(mode === 'audio' ? 'All matching' : 'All new', () => selectIds(selectableIds()))}
                {chip('Unwatched', () =>
                  selectIds(selectableIds(episode => !episode.watched)),
                )}
                {chip('None', () => selectIds([]))}
              </View>
              <View
                className="flex-row items-center"
                style={{gap: 8, marginTop: 8}}>
                {chip(
                  `Next ${nextCount} unwatched`,
                  () =>
                    selectIds(selectNextUnwatched(episodes, nextCount, stateOf)),
                  `Select the next ${nextCount} unwatched episodes`,
                )}
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="Fewer episodes"
                  borderRadius={12}
                  focusScale={1}
                  onPress={() => setNextCount(count => Math.max(count - 1, 1))}
                  style={{padding: 8}}>
                  <MaterialCommunityIcons
                    name="minus-circle-outline"
                    size={24}
                    color={colors.onSurfaceVariant}
                  />
                </TVFocusable>
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="More episodes"
                  borderRadius={12}
                  focusScale={1}
                  onPress={() =>
                    setNextCount(count => Math.min(count + 1, MAX_NEXT_COUNT))
                  }
                  style={{padding: 8}}>
                  <MaterialCommunityIcons
                    name="plus-circle-outline"
                    size={24}
                    color={colors.onSurfaceVariant}
                  />
                </TVFocusable>
              </View>

              <FlatList
                focusable={false}
                data={episodes}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                extraData={listState}
                style={{marginTop: 10, flexGrow: 0, maxHeight: 300}}
                initialNumToRender={20}
              />

              <View
                style={{
                  borderColor: colors.outlineVariant,
                  borderRadius: 14,
                  borderWidth: 1,
                  marginTop: 10,
                  padding: 10,
                }}>
                <View className="flex-row items-center" style={{gap: 8}}>
                  <MaterialCommunityIcons
                    name="server-network"
                    size={18}
                    color={colors.primary}
                  />
                  <AppText
                    role="bodySmall"
                    numberOfLines={2}
                    style={{color: colors.onSurface, flex: 1}}>
                    {activeRule
                      ? `${
                          activeRule.scope === 'series'
                            ? 'This series'
                            : providerName
                        }: ${describeRule(activeRule.rule)}`
                      : `No server order saved yet. You will choose one for ${providerName} first.`}
                  </AppText>
                  {chip(activeRule ? 'Change' : 'Choose', () => {
                    changeRule().catch(console.error);
                  }, 'Choose server order')}
                </View>
                {skippedLabel ? (
                  <AppText
                    role="bodySmall"
                    style={{color: colors.onSurfaceVariant, marginTop: 6}}>
                    Skipping: {skippedLabel}
                  </AppText>
                ) : null}
                {mode === 'video' && (duplicateCount > 0 || allowDuplicates) ? (
                  <TVFocusable
                    accessibilityRole="checkbox"
                    accessibilityLabel="Also download episodes found from another source"
                    accessibilityState={{checked: allowDuplicates}}
                    borderRadius={10}
                    focusScale={1}
                    onPress={() => setAllowDuplicates(value => !value)}
                    style={{
                      alignItems: 'center',
                      flexDirection: 'row',
                      gap: 8,
                      marginTop: 6,
                    }}>
                    <MaterialCommunityIcons
                      name={
                        allowDuplicates
                          ? 'checkbox-marked'
                          : 'checkbox-blank-outline'
                      }
                      size={20}
                      color={colors.primary}
                    />
                    <AppText
                      role="bodySmall"
                      style={{color: colors.onSurfaceVariant, flex: 1}}>
                      Download episodes I already have from another source
                    </AppText>
                  </TVFocusable>
                ) : null}
              </View>

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
                  accessibilityLabel={selectionLabel}
                  disabled={queueEpisodes.length === 0 || Boolean(busy)}
                  borderRadius={16}
                  focusScale={1}
                  onPress={() => {
                    start().catch(console.error);
                  }}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 16,
                    opacity: queueEpisodes.length === 0 || busy ? 0.5 : 1,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                  }}>
                  <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                    {busy || selectionLabel}
                  </AppText>
                </TVFocusable>
              </View>
            </View>
          </TVFocusGuide>
        </View>
      </Modal>

      <TextPromptDialog
        visible={labelPrompt}
        title="Audio language"
        description="Name the language of this version, for example Hindi or English. It is shown in the player's audio menu."
        placeholder="Hindi"
        initialValue={audioLabel}
        confirmLabel="Use"
        validate={value => (value.trim() ? undefined : 'Enter a language')}
        onClose={() => setLabelPrompt(false)}
        onConfirm={value => {
          const label = value.trim();
          mainStorage.setString('bulkAudioLabel', label);
          setAudioLabel(label);
          setLabelPrompt(false);
        }}
      />

      {editorServers !== null ? (
        <ServerOrderEditor
          visible
          title={`Servers for ${context.showName}`}
          subtitle={`Used for every episode. Saved for this series; change it for all ${providerName} in the provider's settings.`}
          order={editorEntries.order}
          available={editorEntries.available}
          onNoMatch={activeRule?.rule.onNoMatch ?? 'auto'}
          quality={activeRule?.rule.quality ?? 'any'}
          getHealth={entry =>
            getServerHealth(context.providerValue, entry.label)
          }
          saveLabel={afterRule ? 'Save & download' : 'Save'}
          onCancel={() => {
            setEditorServers(null);
            setAfterRule(null);
          }}
          onSave={(order, onNoMatch, quality) => {
            const rule = saveRule(order, onNoMatch, quality);
            const servers = editorServers;
            const carryOn = afterRule;
            setEditorServers(null);
            setAfterRule(null);
            if (carryOn) {
              carryOn(rule);
            } else if (servers) {
              ToastAndroid.show(
                `Saved: ${describeRule(rule)}`,
                ToastAndroid.SHORT,
              );
            }
          }}
        />
      ) : null}
    </>
  );
};

export default BulkDownloadSheet;
