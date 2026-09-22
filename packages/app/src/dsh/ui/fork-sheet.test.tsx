/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return { storage, rows };
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

function emptyList() {
  return {
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
  };
}

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
  const list = cell(emptyList());
  const workspacesList = cell<ReturnType<IWorkspaces["list"]["getSnapshot"]>>({
    phase: "ready",
    items: [],
    archivedSessionIds: [],
    state: "idle",
    error: null,
  });
  const sessions = {
    list,
    forkTo: vi.fn<ISessions["forkTo"]>(async (request) => request.childSessionId),
    loadSummary: vi.fn<ISessions["loadSummary"]>(async () => ({ ok: true, value: false })),
  };
  const workspaces = { list: workspacesList };
  let sequence = 0;
  const journalStorage = store();
  const fork = new DshFork(
    sessions,
    workspaces,
    { generation },
    () => capabilities,
    () => sid(`child-${++sequence}`),
    new DshForkJournal(identity.hostId, journalStorage.storage),
  );
  owners.push(fork);
  await fork.restore();
  const runtime = { fork, workspaces } as unknown as DshHostRuntime;
  function changeChild(ids: SessionId[], parent = "source") {
    list.set({
      ...emptyList(),
      ids,
      byId: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            id,
            parentId: sid(parent),
            displayTitle: "Current child",
            running: false,
            blank: false,
            updatedAt: 1,
          },
        ]),
      ),
    });
  }
  return { runtime, fork, sessions, list, workspacesList, changeChild, journalStorage };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function element<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Missing fork control: ${selector}`);
  return found;
}
function click(selector: string): void {
  act(() => element(selector).click());
}
function render(runtime: DshHostRuntime) {
  act(() => root.render(<ForkControl runtime={runtime} sessionId={sid("source")} busy={false} />));
}
function open(runtime: DshHostRuntime) {
  render(runtime);
  click("[data-testid=dsh-fork-session]");
}
function typeAnchor(value: string): void {
  const input = element<HTMLInputElement>("[data-testid=dsh-fork-anchor]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input value setter unavailable");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("visible native fork controls", () => {
  it("offers the fork entry point once the host admits it and storage is ready", async () => {
    const f = await fixture();
    render(f.runtime);
    expect(element("[data-testid=dsh-fork-session]").textContent).toBe("Fork session");
    expect(container.querySelector("[data-testid=dsh-fork-sheet]")).toBeNull();
  });

  it("keeps the retained attempt reachable and labels the control as a review", async () => {
    const f = await fixture();
    open(f.runtime);
    expect(container.querySelector("[data-testid=dsh-fork-submit]")).not.toBeNull();
    click("[data-testid=dsh-fork-submit]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-confirmed]"))
      .not.toBeNull();
    click("[data-testid=dsh-fork-close]");
    expect(element("[data-testid=dsh-fork-session]").textContent).toBe("Review fork");
    click("[data-testid=dsh-fork-session]");
    expect(element("[data-testid=dsh-fork-outcome-confirmed]")).toBeTruthy();
    expect(element("[data-testid=dsh-fork-retained-child]").textContent).toContain("child-1");
    expect(element("[data-testid=dsh-fork-reset]")).toBeTruthy();
    expect(container.querySelector("[data-testid=dsh-fork-submit]")).toBeNull();
    // The retained attempt is not resent by reopening the review.
    expect(f.sessions.forkTo).toHaveBeenCalledTimes(1);
  });

  it("opens a sheet for the exact source session and sends an exact integer anchor", async () => {
    const f = await fixture();
    open(f.runtime);
    expect(element("[data-testid=dsh-fork-sheet]")).toBeTruthy();
    expect(element("[data-testid=dsh-fork-source]").textContent).toBe("source");
    typeAnchor(" 12 ");
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => f.sessions.forkTo.mock.calls.length).toBe(1);
    expect(f.sessions.forkTo.mock.calls[0][0]).toEqual({
      sessionId: "source",
      childSessionId: "child-1",
      atSeq: 12,
    });
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-confirmed]"))
      .not.toBeNull();
  });

  it("forks without an anchor when the field is left empty", async () => {
    const f = await fixture();
    open(f.runtime);
    click("[data-testid=dsh-fork-submit]");
    await expect.poll(() => f.sessions.forkTo.mock.calls.length).toBe(1);
    expect(f.sessions.forkTo.mock.calls[0][0]).toEqual({
      sessionId: "source",
      childSessionId: "child-1",
    });
  });

  it("refuses to send a position that is not a whole non-negative integer", async () => {
    const f = await fixture();
    open(f.runtime);
    typeAnchor("not-a-position");
    expect(element("[data-testid=dsh-fork-anchor-invalid]")).toBeTruthy();
    expect(element<HTMLButtonElement>("[data-testid=dsh-fork-submit]").disabled).toBe(true);
    click("[data-testid=dsh-fork-submit]");
    expect(f.sessions.forkTo).not.toHaveBeenCalled();
  });

  it("reports an unconfirmed fork and offers an explicit check before adoption", async () => {
    const f = await fixture();
    open(f.runtime);
    f.sessions.forkTo.mockRejectedValue(new Error("reply lost"));
    click("[data-testid=dsh-fork-submit]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-unknown]"))
      .not.toBeNull();
    expect(container.querySelector("[data-testid=dsh-fork-submit]")).toBeNull();
    // Absence and a wrong lineage cannot offer adoption.
    click("[data-testid=dsh-fork-check]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-lookup-absent]"))
      .not.toBeNull();
    expect(container.querySelector("[data-testid=dsh-fork-adopt]")).toBeNull();
    f.changeChild([sid("child-1")], "someone-else");
    f.sessions.loadSummary.mockResolvedValue({ ok: true, value: true });
    click("[data-testid=dsh-fork-check]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-lookup-mismatch]"))
      .not.toBeNull();
    expect(container.querySelector("[data-testid=dsh-fork-adopt]")).toBeNull();
    // A matching child is only an observation until adoption is explicit.
    f.changeChild([sid("child-1")]);
    click("[data-testid=dsh-fork-check]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-child-id]"))
      .not.toBeNull();
    expect(element("[data-testid=dsh-fork-child-parent]").textContent).toContain("source");
    expect(element("[data-testid=dsh-fork-membership]").textContent).toContain(
      "not currently in a Workspace",
    );
    expect(f.sessions.forkTo).toHaveBeenCalledTimes(1);
    click("[data-testid=dsh-fork-adopt]");
    await expect
      .poll(() => container.querySelector("[data-testid=dsh-fork-outcome-adopted]"))
      .not.toBeNull();
    expect(f.sessions.forkTo).toHaveBeenCalledTimes(1);
  });
});
