import React, {
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import type { HistoryListProps } from "./history-list-props";
import { styles } from "./styles";

interface ReadingAnchor {
  key: string;
  offset: number;
}
const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowAnchor: "none",
};

interface HistoryRowProps {
  row: VirtualItem;
  measure: (element: HTMLDivElement | null) => void;
  children: ReactNode;
}
function HistoryRow({ row, measure, children }: HistoryRowProps) {
  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      display: "flex",
      flexDirection: "column",
      top: 0,
      left: 0,
      width: "100%",
      transform: `translateY(${row.start}px)`,
    }),
    [row.start],
  );
  return (
    <div data-index={row.index} data-history-key={row.key} ref={measure} style={style}>
      {children}
    </div>
  );
}

export function HistoryList({ keys, renderItem, latestLabel }: HistoryListProps) {
  // The virtualizer mutates its stable instance when its visible range changes.
  "use no memo";
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const mounted = useRef(false);
  const anchor = useRef<ReadingAnchor | null>(null);
  const previous = useRef<readonly string[] | null>(null);
  const restoring = useRef<ReadingAnchor | null>(null);
  const getItemKey = useCallback((index: number) => keys[index], [keys]);
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 100,
    getItemKey,
    overscan: 6,
  });
  const rows = virtualizer.getVirtualItems();
  const height = virtualizer.getTotalSize();
  const latest = useCallback(() => {
    if (!mounted.current) return;
    pinned.current = true;
    restoring.current = null;
    const element = scroller.current;
    if (element !== null) element.scrollTop = virtualizer.getTotalSize() - element.clientHeight;
  }, [virtualizer]);
  useEffect(() => {
    mounted.current = true;
    latest();
    return () => {
      mounted.current = false;
    };
  }, [latest]);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    if (previous.current !== null && previous.current !== keys && !pinned.current)
      restoring.current = anchor.current;
    previous.current = keys;
    const held = restoring.current;
    const next = virtualizer.measurementsCache.find((row) => row.key === held?.key);
    if (held !== null && next !== undefined) element.scrollTop = next.start - held.offset;
    if (pinned.current) latest();
  }, [keys, height, latest, virtualizer]);
  useLayoutEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
      restoring.current === null && item.start < (instance.scrollOffset ?? 0);
    const element = scroller.current;
    const body = content.current;
    if (element === null || body === null) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) latest();
    });
    observer.observe(element);
    observer.observe(body);
    return () => {
      observer.disconnect();
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [latest, virtualizer]);
  const contentStyle = useMemo<CSSProperties>(
    () => ({ height, position: "relative", width: "100%" }),
    [height],
  );
  const releaseAnchor = useCallback(() => {
    restoring.current = null;
  }, []);
  const scroll = useCallback(() => {
    if (restoring.current !== null) return;
    const element = scroller.current;
    if (element === null) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    const top = element.getBoundingClientRect().top;
    const first = [...element.querySelectorAll<HTMLElement>("[data-history-key]")].find(
      (row) => row.getBoundingClientRect().bottom > top,
    );
    if (first !== undefined)
      anchor.current = {
        key: first.dataset.historyKey!,
        offset: first.getBoundingClientRect().top - top,
      };
  }, []);
  return (
    <View style={styles.fill}>
      <div
        ref={scroller}
        data-testid="dsh-history-scroll"
        style={scrollStyle}
        onWheel={releaseAnchor}
        onTouchStart={releaseAnchor}
        onPointerDown={releaseAnchor}
        onKeyDown={releaseAnchor}
        onScroll={scroll}
      >
        <div ref={content} style={contentStyle}>
          {rows.map((row) => (
            <HistoryRow key={row.key} row={row} measure={virtualizer.measureElement}>
              {renderItem(keys[row.index])}
            </HistoryRow>
          ))}
        </div>
      </div>
      <Button size="sm" variant="ghost" onPress={latest}>
        {latestLabel}
      </Button>
    </View>
  );
}
