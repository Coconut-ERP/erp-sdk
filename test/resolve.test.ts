import { describe, expect, it } from "vitest";
import { resolveByName } from "../src/resolve";

/**
 * `resolveByName` is the single implementation behind `client.object()`,
 * `workflows.handle()`, `dashboards.handle()` and `DashboardHandle.query()`, so
 * its precedence is asserted here rather than four times over. Line coverage
 * alone would not catch a reordering — every call site keeps passing when the
 * three lookups are swapped.
 */
describe("resolveByName", () => {
  it("prefers an id over a display name that collides with it", () => {
    const items = [
      { id: "obj-1", name: "Đơn hàng" },
      { id: "Đơn hàng", name: "Khách hàng" },
    ];
    expect(resolveByName(items, "Đơn hàng")?.id).toBe("Đơn hàng");
  });

  it("prefers an exact display name over a case-insensitive one", () => {
    const items = [
      { id: "a", name: "đơn hàng" },
      { id: "b", name: "Đơn hàng" },
    ];
    expect(resolveByName(items, "Đơn hàng")?.id).toBe("b");
  });

  it("falls back to a case-insensitive display name", () => {
    const items = [{ id: "a", name: "Đơn Hàng" }];
    expect(resolveByName(items, "đơn hàng")?.id).toBe("a");
  });

  it("returns the first match when two names differ only by case", () => {
    const items = [
      { id: "a", name: "Đơn Hàng" },
      { id: "b", name: "ĐƠN HÀNG" },
    ];
    expect(resolveByName(items, "đơn hàng")?.id).toBe("a");
  });

  it("returns undefined instead of throwing when nothing matches", () => {
    expect(resolveByName([{ id: "a", name: "X" }], "Y")).toBeUndefined();
    expect(resolveByName([], "X")).toBeUndefined();
  });

  it("does not trim — a stray space is a different address", () => {
    expect(resolveByName([{ id: "a", name: "Đơn hàng" }], " Đơn hàng")).toBe(
      undefined,
    );
  });
});
