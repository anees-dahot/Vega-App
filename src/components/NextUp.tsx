import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import React, {useMemo} from 'react';
import {FlatList, View} from 'react-native';
import type {HomeStackParamList} from '../App';
import {pickNextUp} from '../lib/library/nextUp';
import useContinueWatchingStore, {
  type ContinueWatchingItem,
} from '../lib/zustand/continueWatchingStore';
import {useM3Colors} from '../theme/M3PaletteContext';
import MediaPosterCard from './MediaPosterCard';
import AppText from './ui/Text';

/** Titles whose last episode is finished, with the one that comes next. */
const NextUp = () => {
  const colors = useM3Colors();
  const navigation =
    useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const storedItems = useContinueWatchingStore(state => state.items);
  const items = useMemo(() => pickNextUp(storedItems), [storedItems]);

  if (items.length === 0) {
    return null;
  }

  const open = (item: ContinueWatchingItem) =>
    navigation.navigate('Info', {
      link: item.infoUrl,
      provider: item.providerValue,
      poster: item.poster || item.background,
    });

  return (
    <View style={{gap: 14, marginTop: 28}}>
      <AppText
        role="titleLargeEmphasized"
        numberOfLines={1}
        style={{color: colors.onBackground, paddingHorizontal: 20}}>
        Next up
      </AppText>
      <FlatList
        horizontal
        data={items}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        style={{overflow: 'visible'}}
        contentContainerStyle={{
          paddingVertical: 12,
          paddingHorizontal: 20,
          overflow: 'visible',
        }}
        ItemSeparatorComponent={() => <View style={{width: 14}} />}
        renderItem={({item}) => (
          <MediaPosterCard
            title={item.title}
            subtitle={item.nextTitle}
            poster={item.poster || item.background}
            width={124}
            onPress={() => open(item)}
          />
        )}
      />
    </View>
  );
};

export default NextUp;
