import {
  assistantStepReading,
  type RequestView,
  type TrajectoryCellProps,
  type TrajectorySnapshot,
} from "@deepseek-ai/dsh-client";

export type RequestSelection = "latest" | number;
/** A pinned request stays pinned when history is prepended, replaced, or extended. */
export function selectedRequest(
  requests: readonly RequestView[],
  selection: RequestSelection,
): RequestView | undefined {
  return selection === "latest"
    ? requests.at(-1)
    : requests.find((request) => request.startSeq === selection);
}

/** Search includes complete recorded inputs, outputs, source metadata and tool schemas. */
export function matchesInspection(record: TrajectoryCellProps, query: string): boolean {
  return (
    query.trim() === "" ||
    JSON.stringify(record).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
}

/** Compute request metrics only from the recorded assistant timing and provider usage. */
export function inspectionMetrics(nodes: TrajectorySnapshot["eventNodes"]) {
  return new Map(
    nodes.flatMap((node) => {
      if (node.kind !== "assistant") return [];
      const reading = assistantStepReading(node);
      const streamMs =
        reading.requestMs !== null && reading.ttftMs !== null
          ? Math.max(0, reading.requestMs - reading.ttftMs)
          : null;
      const tokensPerSecond =
        reading.requestMs !== null && reading.requestMs > 0 && reading.outputTokens !== null
          ? reading.outputTokens / (reading.requestMs / 1000)
          : null;
      return [[node.seq, { ...reading, streamMs, tokensPerSecond }] as const];
    }),
  );
}

/** A tool's name and arguments are separate projection fields; retain both in its row. */
export function inspectionLabel(record: TrajectoryCellProps): string {
  return [record.text, record.previewMarkdown]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
}
