import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { View } from 'react-native';
import ServerOrderEditor from '../../../components/ServerOrderEditor';
import AppText from '../../../components/ui/Text';
import { TVFocusable } from '../../../components/tv';
import { getServerHealth } from '../../../lib/download/serverHealth';
import {
  describeRule,
  serverRulesStorage,
  type NoMatchAction,
  type SeriesServerRule,
} from '../../../lib/download/serverRules';
import { useM3Colors } from '../../../theme/M3PaletteContext';

const NO_MATCH_LABELS: Record<NoMatchAction, string> = {
  auto: 'then best available',
  ask: 'then ask',
  skip: 'then skip',
};

type EditorTarget = { scope: 'provider' } | { scope: 'series'; rule: SeriesServerRule };

/**
 * Settings section for a provider's download server rules: the provider-wide
 * order and any per-series overrides.
 */
const DownloadServerRulesSection = ({
  providerValue,
  providerName,
}: {
  providerValue: string;
  providerName: string;
}) => {
  const colors = useM3Colors();
  const [, setVersion] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const refresh = () => setVersion(version => version + 1);

  const providerRule = serverRulesStorage.getProviderRule(providerValue);
  const seriesRules = serverRulesStorage.listSeriesRules(providerValue);
  const knownServers = serverRulesStorage.getKnownServers(providerValue);

  const editorRule =
    editor?.scope === 'series' ? editor.rule : editor ? providerRule : undefined;

  return (
    <View
      className="rounded-2xl p-4"
      style={{
        backgroundColor: colors.surfaceContainerHigh,
        borderColor: colors.outlineVariant,
        borderWidth: 1,
      }}>
      <AppText role="bodyLargeEmphasized" style={{ color: colors.onSurface }}>
        Download servers
      </AppText>
      <AppText
        role="bodySmall"
        style={{ color: colors.onSurfaceVariant, marginTop: 2 }}>
        With a saved order, the download button starts right away using the
        first server that works. Long-press it to pick a server by hand.
      </AppText>

      <TVFocusable
        accessibilityRole="button"
        accessibilityLabel={`Edit server order for ${providerName}`}
        borderRadius={12}
        focusScale={1}
        onPress={() => setEditor({ scope: 'provider' })}
        style={{
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHighest,
          borderRadius: 12,
          flexDirection: 'row',
          gap: 10,
          marginTop: 12,
          padding: 12,
        }}>
        <MaterialCommunityIcons
          name="sort-variant"
          size={20}
          color={colors.primary}
        />
        <View style={{ flex: 1 }}>
          <AppText role="labelLarge" style={{ color: colors.onSurface }}>
            All {providerName} downloads
          </AppText>
          <AppText role="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {providerRule
              ? `${describeRule(providerRule)}, ${NO_MATCH_LABELS[providerRule.onNoMatch]}`
              : 'Not set: shows the server list each time'}
          </AppText>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={colors.onSurfaceVariant}
        />
      </TVFocusable>

      {seriesRules.length > 0 ? (
        <AppText
          role="labelMedium"
          style={{ color: colors.onSurfaceVariant, marginTop: 14 }}>
          Series overrides
        </AppText>
      ) : null}
      {seriesRules.map(rule => (
        <View
          key={rule.infoUrl}
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 6,
            marginTop: 6,
          }}>
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`Edit server order for ${rule.title || 'series'}`}
            borderRadius={12}
            focusScale={1}
            onPress={() => setEditor({ scope: 'series', rule })}
            style={{
              backgroundColor: colors.surfaceContainerHighest,
              borderRadius: 12,
              flex: 1,
              padding: 10,
            }}>
            <AppText
              role="labelLarge"
              numberOfLines={1}
              style={{ color: colors.onSurface }}>
              {rule.title || rule.infoUrl}
            </AppText>
            <AppText
              role="bodySmall"
              numberOfLines={1}
              style={{ color: colors.onSurfaceVariant }}>
              {describeRule(rule)}, {NO_MATCH_LABELS[rule.onNoMatch]}
            </AppText>
          </TVFocusable>
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel={`Remove server order for ${rule.title || 'series'}`}
            borderRadius={12}
            focusScale={1}
            onPress={() => {
              serverRulesStorage.clearSeriesRule(providerValue, rule.infoUrl);
              refresh();
            }}
            style={{ padding: 10 }}>
            <MaterialCommunityIcons
              name="delete-outline"
              size={20}
              color={colors.error}
            />
          </TVFocusable>
        </View>
      ))}

      {editor ? (
        <ServerOrderEditor
          visible
          title={
            editor.scope === 'series'
              ? `Servers for ${editor.rule.title || 'this series'}`
              : `Servers for ${providerName}`
          }
          subtitle="Downloads use the first available server in this order."
          order={editorRule?.order ?? []}
          available={knownServers}
          onNoMatch={editorRule?.onNoMatch ?? 'auto'}
          quality={editorRule?.quality ?? 'any'}
          getHealth={entry => getServerHealth(providerValue, entry.label)}
          onCancel={() => setEditor(null)}
          onClear={
            editorRule
              ? () => {
                if (editor.scope === 'series') {
                  serverRulesStorage.clearSeriesRule(
                    providerValue,
                    editor.rule.infoUrl,
                  );
                } else {
                  serverRulesStorage.clearProviderRule(providerValue);
                }
                setEditor(null);
              }
              : undefined
          }
          onSave={(order, onNoMatch, quality) => {
            const rule = {
              order,
              onNoMatch,
              ...(quality !== 'any' ? { quality } : {}),
              updatedAt: Date.now(),
            };
            if (editor.scope === 'series') {
              serverRulesStorage.setSeriesRule(
                providerValue,
                editor.rule.infoUrl,
                rule,
                editor.rule.title,
              );
            } else {
              serverRulesStorage.setProviderRule(providerValue, rule);
            }
            setEditor(null);
          }}
        />
      ) : null}
    </View>
  );
};

export default DownloadServerRulesSection;
