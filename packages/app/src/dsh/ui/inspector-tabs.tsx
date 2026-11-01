import { useCallback, useRef, useState } from "react";
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ChoiceTab } from "./choice-tab";

type InspectionTab = "context" | "trajectory" | "prompt" | "usage" | "info" | "events";

export function InspectorTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: readonly InspectionTab[];
  selected: InspectionTab;
  onSelect: (tab: InspectionTab) => void;
}) {
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  const overflow = contentWidth > width + 1;
  const layout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const scrolled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      setOffset(event.nativeEvent.contentOffset.x),
    [],
  );
  const previous = useCallback(
    () => scroll.current?.scrollTo({ x: Math.max(0, offset - width), animated: true }),
    [offset, width],
  );
  const next = useCallback(
    () =>
      scroll.current?.scrollTo({
        x: Math.min(contentWidth - width, offset + width),
        animated: true,
      }),
    [contentWidth, offset, width],
  );
  return (
    <View style={styles.bar}>
      {overflow && (
        <Button
          style={styles.edge}
          variant="ghost"
          leftIcon={ChevronLeft}
          accessibilityLabel={t("nativeDsh.inspect.previousTabs")}
          onPress={previous}
          disabled={offset <= 1}
          testID="dsh-inspector-tabs-previous"
        />
      )}
      <ScrollView
        ref={scroll}
        horizontal
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onLayout={layout}
        onContentSizeChange={setContentWidth}
        onScroll={scrolled}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
      >
        {tabs.map((value) => (
          <ChoiceTab
            key={value}
            value={value}
            selected={selected}
            label={t(`nativeDsh.inspect.tabs.${value}`)}
            onSelect={onSelect}
          />
        ))}
      </ScrollView>
      {overflow && (
        <Button
          style={styles.edge}
          variant="ghost"
          leftIcon={ChevronRight}
          accessibilityLabel={t("nativeDsh.inspect.moreTabs")}
          onPress={next}
          disabled={offset + width >= contentWidth - 1}
          testID="dsh-inspector-tabs-next"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  scroll: { flex: 1, minWidth: 0 },
  content: { alignItems: "center", paddingHorizontal: theme.spacing[2], gap: theme.spacing[1] },
  edge: { width: 44, height: 44, padding: 0, flexShrink: 0 },
}));
