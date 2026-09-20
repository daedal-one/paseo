import { useCallback, useRef } from "react";
import {
  FlatList,
  View,
  type NativeScrollEvent,
  type ListRenderItemInfo,
  type NativeSyntheticEvent,
} from "react-native";
import { Button } from "@/components/ui/button";
import type { HistoryListProps } from "./history-list-props";
import { styles } from "./styles";

const keyExtractor = (key: string) => key;
const maintainPosition = { minIndexForVisible: 0 };
export function HistoryList({ keys, renderItem, latestLabel }: HistoryListProps) {
  const list = useRef<FlatList<string>>(null);
  const pinned = useRef(true);
  const latest = useCallback(() => {
    pinned.current = true;
    list.current?.scrollToEnd({ animated: false });
  }, []);
  const resized = useCallback(() => {
    if (pinned.current) list.current?.scrollToEnd({ animated: false });
  }, []);
  const scroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentSize, contentOffset, layoutMeasurement } = event.nativeEvent;
    pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 32;
  }, []);
  const render = useCallback(
    ({ item }: ListRenderItemInfo<string>) => <>{renderItem(item)}</>,
    [renderItem],
  );
  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        style={styles.fill}
        data={keys}
        renderItem={render}
        keyExtractor={keyExtractor}
        testID="dsh-history-scroll"
        maintainVisibleContentPosition={maintainPosition}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        onScroll={scroll}
        onLayout={resized}
        onContentSizeChange={resized}
      />
      <Button size="sm" variant="ghost" onPress={latest}>
        {latestLabel}
      </Button>
    </View>
  );
}
