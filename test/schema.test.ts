import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import { SchemaMismatchError } from "../src/errors";
import {
  type MiniAppSchema,
  planSchema,
  schemaConflicts,
  schemaSettled,
  unresolvedRelations,
  validateSchema,
} from "../src/schema";
import { FakeHttp } from "./helpers/http";

const SCHEMA: MiniAppSchema = {
  objects: [
    {
      name: "Đơn nghỉ phép",
      position: 0,
      fields: [
        { name: "Lý do", type: "long_text" },
        { name: "Số ngày", type: "number", config: { precision: 1 } },
        {
          name: "Nhân viên",
          type: "relation",
          config: { targetObject: "Nhân viên" },
        },
      ],
    },
    { name: "Nhân viên", fields: [{ name: "Mã NV", type: "text" }] },
  ],
};

describe("validateSchema", () => {
  it("accepts a declaration the backend would accept", () => {
    expect(validateSchema(SCHEMA)).toEqual([]);
  });

  it("rejects an empty or malformed file", () => {
    expect(validateSchema({ objects: [] })[0]).toContain("declares no objects");
    expect(validateSchema([])[0]).toContain("must be a JSON object");
    expect(validateSchema({ object: [] })).toContain(
      'schema.json has an unknown key "object"',
    );
  });

  it("catches the typos the backend rejects at upload", () => {
    const problems = validateSchema({
      objects: [
        {
          name: "A",
          field: [],
          fields: [
            { name: "X", type: "barcode" },
            { name: "x", type: "text" },
            { name: "Tổng", type: "rollup" },
            { name: "Chủ", type: "relation" },
          ],
        },
        { name: "a" },
      ],
    });

    expect(problems).toContain('Object #1 has an unknown key "field"');
    expect(problems).toContain(
      'Field "X" of "A" has unsupported type "barcode"',
    );
    expect(problems).toContain('Object "A" declares field "x" twice');
    expect(problems.some((p) => p.includes("rollup fields are computed"))).toBe(
      true,
    );
    expect(problems.some((p) => p.includes("needs config.targetObject"))).toBe(
      true,
    );
    expect(problems).toContain('schema.json declares object "a" twice');
  });
});

describe("planSchema", () => {
  const workspace = [
    {
      name: "Nhân viên",
      fields: [
        { name: "Mã NV", type: "text" },
        { name: "Phòng ban", type: "single_select" },
      ],
    },
  ];

  it("diffs the declaration the way the review screen does", () => {
    const plans = planSchema(SCHEMA, workspace);
    expect(plans[0]).toMatchObject({ name: "Đơn nghỉ phép", action: "create" });
    expect(plans[0]?.fields.every((field) => field.action === "create")).toBe(
      true,
    );
    expect(plans[1]).toMatchObject({ name: "Nhân viên", action: "unchanged" });
    expect(schemaSettled(plans)).toBe(false);
  });

  it("marks an existing table that is missing a field as update", () => {
    const plans = planSchema(
      {
        objects: [
          { name: "Nhân viên", fields: [{ name: "Email", type: "email" }] },
        ],
      },
      workspace,
    );
    expect(plans[0]?.action).toBe("update");
    expect(plans[0]?.fields[0]?.action).toBe("create");
  });

  it("reports a same-name different-type field as a conflict", () => {
    const plans = planSchema(
      {
        objects: [
          { name: "Nhân viên", fields: [{ name: "Mã NV", type: "number" }] },
        ],
      },
      workspace,
    );
    expect(plans[0]?.fields[0]).toMatchObject({
      action: "conflict",
      currentType: "text",
    });
    expect(schemaConflicts(plans)).toEqual([
      "Nhân viên.Mã NV is text, the app declares number",
    ]);
  });

  it("settles when the workspace already matches", () => {
    const plans = planSchema(
      {
        objects: [
          { name: "nhân viên", fields: [{ name: "mã nv", type: "text" }] },
        ],
      },
      workspace,
    );
    expect(schemaSettled(plans)).toBe(true);
  });

  it("flags a relation whose target exists nowhere", () => {
    expect(unresolvedRelations(SCHEMA, workspace)).toEqual([]);
    expect(
      unresolvedRelations(
        {
          objects: [
            {
              name: "A",
              fields: [
                {
                  name: "Chủ",
                  type: "relation",
                  config: { targetObject: "Khách" },
                },
              ],
            },
          ],
        },
        workspace,
      )[0],
    ).toContain('points at "Khách"');
  });
});

function field(objectId: string, key: string, name: string, type: string) {
  return {
    id: `f-${key}`,
    objectId,
    key,
    name,
    type,
    config: null,
    position: 0,
    isArchived: false,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

const SMALL: MiniAppSchema = {
  objects: [{ name: "Nhân viên", fields: [{ name: "Mã NV", type: "text" }] }],
};

describe("assertSchema", () => {
  it("returns a handle per declared object when the workspace matches", async () => {
    const http = new FakeHttp({
      "GET /objects": [
        [{ id: "obj-1", workspaceId: "ws-1", name: "Nhân viên", position: 0 }],
      ],
      "GET /objects/obj-1/fields": [[field("obj-1", "code", "Mã NV", "text")]],
    });
    const objects = await new ErpClient(http).assertSchema(SMALL);
    expect(objects["Nhân viên"]?.id).toBe("obj-1");
  });

  it("fails fast, and says the review is someone else's step", async () => {
    const http = new FakeHttp({ "GET /objects": [[]] });
    await expect(new ErpClient(http).assertSchema(SMALL)).rejects.toThrowError(
      SchemaMismatchError,
    );

    const error = await new ErpClient(http).assertSchema(SMALL).catch((e) => e);
    expect(error.missing).toEqual([{ object: "Nhân viên" }]);
    expect(error.message).toContain("review its schema");
  });

  it("separates a type conflict from a missing field", async () => {
    const http = new FakeHttp({
      "GET /objects": [
        [{ id: "obj-1", workspaceId: "ws-1", name: "Nhân viên", position: 0 }],
      ],
      "GET /objects/obj-1/fields": [
        [field("obj-1", "code", "Mã NV", "number")],
      ],
    });
    const error = await new ErpClient(http)
      .assertSchema(SMALL)
      .catch((e: SchemaMismatchError) => e);

    expect(error).toBeInstanceOf(SchemaMismatchError);
    expect((error as SchemaMismatchError).missing).toEqual([]);
    expect((error as SchemaMismatchError).conflicts).toEqual([
      {
        object: "Nhân viên",
        field: "Mã NV",
        type: "text",
        currentType: "number",
      },
    ]);
  });
});
