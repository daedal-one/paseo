import { expect, it } from "vitest";
import { trajectoryRecordId, type RequestView } from "@deepseek-ai/dsh-client";
import {
  selectedRequest,
  matchesInspection,
  inspectionMetrics,
  inspectionLabel,
} from "./inspection";

const request = (startSeq: number): RequestView => ({
  purpose: "assistant",
  startSeq,
  startedAt: startSeq,
  completedAt: null,
  status: "running",
  turn: 1,
  step: 1,
});
it("keeps a historical request selected across prepends, appends and missing windows", () => {
  const pinned = request(20);
  expect(selectedRequest([pinned, request(30)], 20)).toBe(pinned);
  expect(selectedRequest([request(1), pinned, request(30)], 20)).toBe(pinned);
  expect(selectedRequest([request(30)], 20)).toBeUndefined();
  expect(selectedRequest([pinned, request(30)], "latest")?.startSeq).toBe(30);
});
it("searches hidden details while record identity survives renumbering", () => {
  const cell = {
    index: 1,
    kind: "tool" as const,
    text: "Read",
    sourceSeq: 20,
    timeSeconds: null,
    schemaDetail: "unique-parameter",
    outputDetail: "saved output",
  };
  expect(matchesInspection(cell, "unique-parameter")).toBe(true);
  expect(matchesInspection(cell, "SAVED OUTPUT")).toBe(true);
  expect(matchesInspection(cell, "missing")).toBe(false);
  expect(trajectoryRecordId({ ...cell, index: 50 })).toBe(trajectoryRecordId(cell));
});

it("uses full request time for output rate and keeps unrecorded timing unknown", () => {
  const node = {
    kind: "assistant" as const,
    seq: 7,
    time: 3000,
    turn: 1,
    step: 1,
    blocks: [],
    usage: { outputTokens: 100 },
  };
  expect(inspectionMetrics([node]).get(7)).toEqual({
    ttftMs: null,
    requestMs: null,
    outputTokens: 100,
    streamMs: null,
    tokensPerSecond: null,
  });
  expect(
    inspectionMetrics([
      { ...node, timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 3000 } },
    ]).get(7),
  ).toEqual({
    ttftMs: 500,
    requestMs: 2000,
    outputTokens: 100,
    streamMs: 1500,
    tokensPerSecond: 50,
  });
  expect(
    inspectionMetrics([
      { ...node, timing: { stepStartTime: 3000, firstTokenTime: 3000, completedTime: 3000 } },
    ]).get(7)?.tokensPerSecond,
  ).toBeNull();
});

it("keeps the tool name beside its argument preview", () => {
  expect(
    inspectionLabel({
      kind: "tool",
      index: 1,
      text: "bash",
      previewMarkdown: '{"command":"echo done"}',
      timeSeconds: null,
    }),
  ).toBe('bash · {"command":"echo done"}');
});
