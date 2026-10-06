import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, ScrollView, View} from 'react-native';
import {
  QUALITY_PREFERENCES,
  type NoMatchAction,
  type QualityPreference,
  type ServerRuleEntry,
} from '../lib/download/serverRules';
import {
  describeServerHealth,
  scoreServerHealth,
  type ServerHealthEntry,
} from '../lib/download/serverHealth';
import {useM3Colors} from '../theme/M3PaletteContext';
import AppText from './ui/Text';
import {TVFocusable, TVFocusGuide} from './tv';

type EditorItem = {entry: ServerRuleEntry; included: boolean};

const NO_MATCH_OPTIONS: {value: NoMatchAction; label: string; hint: string}[] = [
  {value: 'auto', label: 'Best available', hint: 'Use any other working server'},
  {value: 'ask', label: 'Ask me', hint: 'Show the server list'},
  {value: 'skip', label: 'Skip', hint: "Don't download"},
];

const buildItems = (
  order: ServerRuleEntry[],
  available: ServerRuleEntry[],
): EditorItem[] => {
  const seen = new Set<string>();
  const items: EditorItem[] = [];
  for (const entry of order) {
    if (entry.key && !seen.has(entry.key)) {
      seen.add(entry.key);
      items.push({entry, included: true});
    }
  }
  for (const entry of available) {
    if (entry.key && !seen.has(entry.key)) {
      seen.add(entry.key);
      items.push({entry, included: false});
    }
  }
  return items;
};

/**
 * Edit a download server rule: which servers to use, in which order, and what
 * to do when none of them is available.
 */
const ServerOrderEditor = ({
  visible,
  title,
  subtitle,
  order,
  available,
  onNoMatch: initialOnNoMatch,
  quality: initialQuality = 'any',
  getHealth,
  saveLabel = 'Save',
  onSave,
  onCancel,
  onClear,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Servers in the rule, in order. */
  order: ServerRuleEntry[];
  /** Other servers the user can add. */
  available: ServerRuleEntry[];
  onNoMatch: NoMatchAction;
  quality?: QualityPreference;
  /** How well a server has worked, for the hint under its name and "Smart order". */
  getHealth?: (entry: ServerRuleEntry) => ServerHealthEntry | undefined;
  saveLabel?: string;
  onSave: (
    order: ServerRuleEntry[],
    onNoMatch: NoMatchAction,
    quality: QualityPreference,
  ) => void;
  onCancel: () => void;
  onClear?: () => void;
}) => {
  const colors = useM3Colors();
  const [items, setItems] = useState<EditorItem[]>([]);
  const [onNoMatch, setOnNoMatch] = useState<NoMatchAction>(initialOnNoMatch);
  const [quality, setQuality] = useState<QualityPreference>(initialQuality);

  useEffect(() => {
    if (visible) {
      setItems(buildItems(order, available));
      setOnNoMatch(initialOnNoMatch);
      setQuality(initialQuality);
    }
  }, [visible]);

  const move = (index: number, delta: number) => {
    setItems(current => {
      const target = index + delta;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  /** Tick the servers that have worked best, best first, and untick the rest. */
  const smartOrder = () => {
    setItems(current => {
      const scored = current
        .map((item, index) => ({
          item,
          index,
          health: getHealth?.(item.entry),
        }))
        .sort(
          (a, b) =>
            scoreServerHealth(b.health) - scoreServerHealth(a.health) ||
            a.index - b.index,
        );
      const withHistory = scored.filter(
        entry => entry.health && entry.health.ok + entry.health.fail > 0,
      );
      const ranked = withHistory.length > 0 ? withHistory : scored.slice(0, 3);
      const rankedKeys = new Set(ranked.map(entry => entry.item.entry.key));
      return [
        ...ranked.map(entry => ({...entry.item, included: true})),
        ...scored
          .filter(entry => !rankedKeys.has(entry.item.entry.key))
          .map(entry => ({...entry.item, included: false})),
      ];
    });
  };

  const toggle = (index: number) => {
    setItems(current =>
      current.map((item, i) =>
        i === index ? {...item, included: !item.included} : item,
      ),
    );
  };

  const includedItems = items.filter(item => item.included);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-end bg-black/60">
        <Pressable style={{flex: 1}} onPress={onCancel} />
        <TVFocusGuide autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
          <View
            className="max-h-[85%] rounded-t-3xl p-5"
            style={{backgroundColor: colors.surfaceContainer}}>
            <AppText role="titleMedium" style={{color: colors.onSurface}}>
              {title}
            </AppText>
            {subtitle ? (
              <AppText
                role="bodySmall"
                style={{color: colors.onSurfaceVariant, marginTop: 2}}>
                {subtitle}
              </AppText>
            ) : null}

            <ScrollView
              focusable={false}
              style={{marginTop: 12}}
              contentContainerStyle={{gap: 8, paddingBottom: 8}}>
              {items.length === 0 ? (
                <AppText
                  role="bodyMedium"
                  style={{color: colors.onSurfaceVariant, paddingVertical: 16}}>
                  No servers seen yet for this provider. Download once from
                  the server list and they will show up here.
                </AppText>
              ) : null}
              {items.map((item, index) => {
                const position = item.included
                  ? includedItems.indexOf(item)
                  : -1;
                return (
                  <View
                    key={item.entry.key}
                    className="flex-row items-center rounded-2xl px-3 py-2"
                    style={{
                      backgroundColor: item.included
                        ? colors.surfaceContainerHighest
                        : colors.surfaceContainerHigh,
                      borderColor: colors.outlineVariant,
                      borderWidth: 1,
                      gap: 8,
                    }}>
                    <TVFocusable
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${item.included ? 'Remove' : 'Add'} ${item.entry.label}`}
                      accessibilityState={{checked: item.included}}
                      hasTVPreferredFocus={index === 0}
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => toggle(index)}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 44,
                      }}>
                      <MaterialCommunityIcons
                        name={
                          item.included
                            ? 'checkbox-marked'
                            : 'checkbox-blank-outline'
                        }
                        size={22}
                        color={
                          item.included ? colors.primary : colors.onSurfaceVariant
                        }
                      />
                      <View style={{flex: 1}}>
                        <AppText
                          role="bodyLargeEmphasized"
                          numberOfLines={1}
                          style={{
                            color: item.included
                              ? colors.onSurface
                              : colors.onSurfaceVariant,
                          }}>
                          {item.entry.label}
                        </AppText>
                        {position >= 0 ? (
                          <AppText
                            role="bodySmall"
                            style={{color: colors.primary}}>
                            {position === 0 ? 'Primary' : `Fallback ${position}`}
                          </AppText>
                        ) : null}
                        {(() => {
                          const hint = describeServerHealth(
                            getHealth?.(item.entry),
                          );
                          return hint ? (
                            <AppText
                              role="bodySmall"
                              style={{color: colors.onSurfaceVariant}}>
                              {hint}
                            </AppText>
                          ) : null;
                        })()}
                      </View>
                    </TVFocusable>
                    <TVFocusable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${item.entry.label} up`}
                      disabled={index === 0}
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => move(index, -1)}
                      style={{padding: 8, opacity: index === 0 ? 0.3 : 1}}>
                      <MaterialCommunityIcons
                        name="arrow-up"
                        size={20}
                        color={colors.onSurfaceVariant}
                      />
                    </TVFocusable>
                    <TVFocusable
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${item.entry.label} down`}
                      disabled={index === items.length - 1}
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => move(index, 1)}
                      style={{
                        padding: 8,
                        opacity: index === items.length - 1 ? 0.3 : 1,
                      }}>
                      <MaterialCommunityIcons
                        name="arrow-down"
                        size={20}
                        color={colors.onSurfaceVariant}
                      />
                    </TVFocusable>
                  </View>
                );
              })}

              {getHealth && items.length > 1 ? (
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="Sort servers by how well they have worked"
                  borderRadius={12}
                  focusScale={1}
                  onPress={smartOrder}
                  style={{
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                  }}>
                  <MaterialCommunityIcons
                    name="auto-fix"
                    size={18}
                    color={colors.primary}
                  />
                  <AppText role="labelLarge" style={{color: colors.primary}}>
                    Smart order
                  </AppText>
                </TVFocusable>
              ) : null}

              <AppText
                role="labelLarge"
                style={{color: colors.onSurfaceVariant, marginTop: 12}}>
                Preferred quality
              </AppText>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {QUALITY_PREFERENCES.map(option => {
                  const selected = option === quality;
                  return (
                    <TVFocusable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityLabel={
                        option === 'any' ? 'Any quality' : `${option}p quality`
                      }
                      accessibilityState={{selected}}
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => setQuality(option)}
                      style={{
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected
                          ? colors.primary
                          : colors.outlineVariant,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                      }}>
                      <AppText
                        role="labelLarge"
                        style={{
                          color: selected
                            ? colors.onSecondaryContainer
                            : colors.onSurface,
                        }}>
                        {option === 'any' ? 'Any' : `${option}p`}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>
                Used when a file offers several qualities: the best one at or
                below this.
              </AppText>

              <AppText
                role="labelLarge"
                style={{color: colors.onSurfaceVariant, marginTop: 12}}>
                If none of these work
              </AppText>
              <View className="flex-row" style={{gap: 8}}>
                {NO_MATCH_OPTIONS.map(option => {
                  const selected = option.value === onNoMatch;
                  return (
                    <TVFocusable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityLabel={`${option.label}: ${option.hint}`}
                      accessibilityState={{selected}}
                      borderRadius={12}
                      focusScale={1}
                      onPress={() => setOnNoMatch(option.value)}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected ? colors.primary : colors.outlineVariant,
                        backgroundColor: selected
                          ? colors.secondaryContainer
                          : 'transparent',
                        paddingHorizontal: 8,
                        paddingVertical: 10,
                      }}>
                      <AppText
                        role="labelLarge"
                        style={{
                          color: selected
                            ? colors.onSecondaryContainer
                            : colors.onSurface,
                          textAlign: 'center',
                        }}>
                        {option.label}
                      </AppText>
                      <AppText
                        role="bodySmall"
                        style={{
                          color: colors.onSurfaceVariant,
                          textAlign: 'center',
                        }}>
                        {option.hint}
                      </AppText>
                    </TVFocusable>
                  );
                })}
              </View>
            </ScrollView>

            <View className="mt-4 flex-row items-center" style={{gap: 8}}>
              {onClear ? (
                <TVFocusable
                  accessibilityRole="button"
                  accessibilityLabel="Remove this rule"
                  borderRadius={16}
                  focusScale={1}
                  onPress={onClear}
                  style={{paddingHorizontal: 12, paddingVertical: 12}}>
                  <AppText role="labelLarge" style={{color: colors.error}}>
                    Remove rule
                  </AppText>
                </TVFocusable>
              ) : null}
              <View style={{flex: 1}} />
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                borderRadius={16}
                focusScale={1}
                onPress={onCancel}
                style={{paddingHorizontal: 16, paddingVertical: 12}}>
                <AppText role="labelLarge" style={{color: colors.onSurface}}>
                  Cancel
                </AppText>
              </TVFocusable>
              <TVFocusable
                accessibilityRole="button"
                accessibilityLabel={saveLabel}
                borderRadius={16}
                focusScale={1}
                onPress={() =>
                  onSave(
                    includedItems.map(item => item.entry),
                    onNoMatch,
                    quality,
                  )
                }
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 16,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                }}>
                <AppText role="labelLarge" style={{color: colors.onPrimary}}>
                  {saveLabel}
                </AppText>
              </TVFocusable>
            </View>
          </View>
        </TVFocusGuide>
      </View>
    </Modal>
  );
};

export default ServerOrderEditor;
