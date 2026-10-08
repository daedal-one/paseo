import type { ReactNode } from "react";
export interface HistoryListProps {
  keys: readonly string[];
  renderItem: (key: string) => ReactNode;
  latestLabel: string;
}
