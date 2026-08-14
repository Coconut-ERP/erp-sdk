import { describe, expect, it } from "vitest";
import { isAllowed, missingPermissions } from "../src/permissions";
import type { PermissionDto } from "../src/types";

function perm(
  resource: string,
  action: string,
  effect: "allow" | "deny" = "allow",
): PermissionDto {
  return {
    id: "p",
    ruleId: "r",
    resource,
    action,
    effect,
    scopeType: "all",
    scope: {},
    createdAt: "",
  };
}

describe("isAllowed", () => {
  it("allows exact resource/action match", () => {
    expect(
      isAllowed([perm("object:record", "read")], "object:record", "read"),
    ).toBe(true);
  });

  it("denies when nothing matches", () => {
    expect(
      isAllowed([perm("object:record", "read")], "object:record", "update"),
    ).toBe(false);
    expect(isAllowed([perm("object:record", "read")], "workflow", "read")).toBe(
      false,
    );
  });

  it("matches wildcard action and resource", () => {
    expect(
      isAllowed([perm("object:record", "*")], "object:record", "delete"),
    ).toBe(true);
    expect(isAllowed([perm("*", "*")], "dashboard", "manage")).toBe(true);
  });

  it("deny beats allow", () => {
    const perms = [
      perm("object:record", "*"),
      perm("object:record", "delete", "deny"),
    ];
    expect(isAllowed(perms, "object:record", "delete")).toBe(false);
    expect(isAllowed(perms, "object:record", "read")).toBe(true);
  });

  it("does not treat manage as implying other actions", () => {
    expect(isAllowed([perm("file", "manage")], "file", "read")).toBe(false);
  });
});

describe("missingPermissions", () => {
  it("reports only the unmet requirements", () => {
    const perms = [perm("object", "read"), perm("object:record", "*")];
    const missing = missingPermissions(perms, [
      { resource: "object", action: "read" },
      { resource: "object:record", action: "update" },
      { resource: "workflow", action: "read" },
    ]);
    expect(missing).toEqual([{ resource: "workflow", action: "read" }]);
  });
});
