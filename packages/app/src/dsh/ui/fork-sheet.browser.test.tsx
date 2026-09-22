/** Real Chromium: the visible fork control and review content at narrow and wide viewports. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { brandString } from "@deepseek-ai/dsh-brand";
import { selectRemoteCapabilities } from "@deepseek-ai/dsh-client";
import type {
  ConnectionHandle,
  ConnectionHostId,
  HostCapabilities,
  ISessions,
  IWorkspaces,
  SessionId,
} from "@deepseek-ai/dsh-client";
import { i18n } from "@/i18n/i18next";
import { DshFork } from "../fork";
import { DshForkJournal } from "../fork-journal";
import type { DshCreationStorage } from "../creation-journal";
import type { DshHostRuntime } from "../runtime";
import { ForkControl } from "./fork-sheet";

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
// Mirrors the other sheet tests: the native modal presentation is a harness boundary, so the
// product content is mounted directly at a real viewport width.
vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    header,
    children,
    footer,
    onClose,
    testID,
  }: {
    visible: boolean;
    header: { title: string };
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet", "data-modal-title": header.title },
      ReactModule.createElement(
        "button",
        { type: "button", "data-testid": "adaptive-modal-sheet-close", onClick: onClose },
        "Close",
      ),
      children,
      footer === undefined
        ? null
        : ReactModule.createElement("div", { "data-testid": "sheet-footer" }, footer),
    );
  };
  const AdaptiveTextInput = ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        defaultValue?: string;
        editable?: boolean;
        testID?: string;
        accessibilityLabel?: string;
        onChangeText?: (next: string) => void;
      };
      return ReactModule.createElement("input", {
        ref,
        defaultValue: p.initialValue ?? p.defaultValue ?? "",
        disabled: p.editable === false,
        "data-testid": p.testID,
        "aria-label": p.accessibilityLabel,
        onChange: (e: { target: { value: string } }) => p.onChangeText?.(e.target.value),
      });
    },
  );
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

function cell<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    set(next: T) {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}
function store() {
  const rows = new Map<string, string>();
  const storage: DshCreationStorage = {
    async transact(host, update) {
      const before = rows.get(host) ?? null;
      const after = update(before);
      if (after === null) rows.delete(host);
      else rows.set(host, after);
      return { before, after };
    },
  };
  return storage;
}
const sid = (value: string) => brandString<SessionId>(value);
const identity = {
  version: 1 as const,
  hostId: brandString<ConnectionHostId>("host-a"),
  activationId: brandString<HostCapabilities["identity"]["activationId"]>("activation-a"),
};
const owners: DshFork[] = [];
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()));
});

async function fixture() {
  const generation = cell<ReturnType<ConnectionHandle["generation"]["getSnapshot"]>>({
    id: 1,
    host: { home: "/fixture", identity },
  });
  const capabilities: HostCapabilities = {
    version: 3,
    identity,
    capabilities: selectRemoteCapabilities(["session/forkTo"]).map((value) =>
      Object.assign({}, value, { availability: "available" as const }),
    ),
  };
  const list = cell({
    phase: "ready" as const,
    ids: [] as SessionId[],
    byId: {},
    current: undefined,
    hasMore: false,
    loadingMore: false,
    state: "idle" as const,
    error: null,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const workspaces = {
    list: cell<ReturnType<IWorkspaces["list"]["getSnapshot"]>>({
      phase: "ready",
      items: [],
      archivedSessionIds: [],
      state: "idle",
      error: null,
    }),
  };
  const sessions = {
    list,
    forkTo: vi.fn<ISessions["forkTo"]>(async (request) => request.childSessionId),
    loadSummary: vi.fn<ISessions["loadSummary"]>(async () => ({ ok: true, value: false })),
  };
  let sequence = 0;
  const fork = new DshFork(
    sessions,
    workspaces,
    { generation },
    () => capabilities,
    () => sid(`child-${++sequence}`),
    new DshForkJournal(identity.hostId, store()),
  );
  owners.push(fork);
  await fork.restore();
  return { runtime: { fork, workspaces } as unknown as DshHostRuntime, sessions };
}

const previousReact = Reflect.get(globalThis, "React");
beforeAll(() => Reflect.set(globalThis, "React", React));
afterAll(() => {
  if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
  else Reflect.set(globalThis, "React", previousReact);
});

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
function element<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing fork control: ${selector}`);
  return found;
}
function click(selector: string): void {
  act(() => element(selector).click());
}

describe.each([
  { width: 390, label: "narrow" },
  { width: 1280, label: "wide" },
])("visible fork control at $label ($width px)", ({ width }) => {
  it("renders the review entry point, anchor field and an exact confirm without overflow", async () => {
    container = document.createElement("div");
    container.style.cssText = `width:${width}px;display:flex;flex-direction:column`;
    document.body.append(container);
    root = createRoot(container);
    const f = await fixture();
    act(() =>
      root.render(<ForkControl runtime={f.runtime} sessionId={sid("source")} busy={false} />),
    );
    expect(element("[data-testid=dsh-fork-session]")).toBeTruthy();
    click("[data-testid=dsh-fork-session]");
    expect(element("[data-testid=dsh-fork-sheet]")).toBeTruthy();
    expect(element("[data-testid=dsh-fork-source]").textContent).toBe("source");
    const anchor = element<HTMLInputElement>("[data-testid=dsh-fork-anchor]");
    expect(anchor).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter unavailable");
    act(() => {
      setter.call(anchor, "9");
      anchor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => f.sessions.forkTo.mock.calls.length).toBe(1);
    expect(f.sessions.forkTo.mock.calls[0][0]).toEqual({
      sessionId: "source",
      childSessionId: "child-1",
      atSeq: 9,
    });
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-confirmed]"))
      .not.toBeNull();
    expect(element("[data-testid=dsh-fork-request-anchor]").textContent).toBe("9");
    expect(container.scrollWidth).toBeLessThanOrEqual(Math.max(container.clientWidth, width));
  });
});
