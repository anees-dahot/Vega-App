import React from 'react';
import {StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Text from '../ui/Text';
import {TVFocusable} from '../tv';
import {useM3Colors} from '../../theme/M3PaletteContext';

export interface EpisodeGridItem {
  title: string;
  link: string;
  filler?: boolean;
}

interface EpisodeGridProps {
  items: EpisodeGridItem[];
  isCompleted: (link: string) => boolean;
  onPress: (item: EpisodeGridItem) => void;
  onLongPress: (item: EpisodeGridItem) => void;
  focusBorderColor: string;
}

const FILLER_COLOR = '#E0A23B';

/** The episode number from a title like "Episode 12", or its position. */
const episodeLabel = (title: string, index: number): string => {
  const numbers = title.match(/\d+(\.\d+)?/g);
  return numbers ? numbers[numbers.length - 1] : String(index + 1);
};

/**
 * Compact numbered tiles for long series. Fillers are tinted, watched
 * episodes are marked, and a long press opens the usual episode actions.
 */
const EpisodeGrid: React.FC<EpisodeGridProps> = ({
  items,
  isCompleted,
  onPress,
  onLongPress,
  focusBorderColor,
}) => {
  const colors = useM3Colors();
  const hasFiller = items.some(item => item.filler);

  return (
    <View>
      {hasFiller && (
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, {backgroundColor: FILLER_COLOR}]} />
          <Text style={{color: colors.onSurfaceVariant, fontSize: 13}}>
            Filler
          </Text>
        </View>
      )}
      <View style={styles.grid}>
        {items.map((item, index) => {
          const done = isCompleted(item.link);
          const label = episodeLabel(item.title, index);
          return (
            <View key={`${item.link}-${index}`} style={styles.cell}>
              <TVFocusable
                accessibilityLabel={`${item.title}${item.filler ? ', filler' : ''}${done ? ', watched' : ''}`}
                focusBorderColor={focusBorderColor}
                borderRadius={12}
                focusScale={1.06}
                onPress={() => onPress(item)}
                onLongPress={() => onLongPress(item)}
                style={[
                  styles.tile,
                  {
                    backgroundColor: item.filler
                      ? `${FILLER_COLOR}33`
                      : colors.surfaceContainerHigh,
                    borderColor: item.filler ? FILLER_COLOR : colors.outlineVariant,
                    opacity: done ? 0.55 : 1,
                  },
                ]}>
                {() => (
                  <>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: item.filler ? FILLER_COLOR : colors.onSurface,
                        fontSize: 15,
                        fontWeight: '700',
                      }}>
                      {label}
                    </Text>
                    {done && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={13}
                        color={colors.primary}
                        style={styles.check}
                      />
                    )}
                  </>
                )}
              </TVFocusable>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  legendSwatch: {width: 12, height: 12, borderRadius: 3},
  grid: {flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4},
  cell: {width: '20%', padding: 4},
  tile: {
    aspectRatio: 1.25,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {position: 'absolute', top: 4, right: 4},
});

export default EpisodeGrid;
