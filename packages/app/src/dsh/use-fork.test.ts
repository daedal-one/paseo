import { describe, expect, it } from "vitest";
import { forkAnchor, forkAnchorInvalid } from "./use-fork";

describe("native fork anchor field", () => {
  it("treats an empty field as no anchor and passes an exact integer position", () => {
    expect(forkAnchor("")).toBeNull();
    expect(forkAnchor("   ")).toBeNull();
    expect(forkAnchor("0")).toBe(0);
    expect(forkAnchor(" 7 ")).toBe(7);
    expect(forkAnchor("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuses anything that is not a whole non-negative position", () => {
    for (const value of ["-1", "1.5", "abc", "1e3", "0x10", "+2", "1 2", "１２"])
      expect(forkAnchor(value), value).toBeNull();
    expect(forkAnchor("9007199254740992")).toBeNull();
  });

  it("only reports an invalid anchor when something was actually typed", () => {
    expect(forkAnchorInvalid("")).toBe(false);
    expect(forkAnchorInvalid("  ")).toBe(false);
    expect(forkAnchorInvalid("3")).toBe(false);
    expect(forkAnchorInvalid("three")).toBe(true);
    expect(forkAnchorInvalid("-1")).toBe(true);
  });
});
