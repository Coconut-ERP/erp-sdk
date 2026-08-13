import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import { DryRunUnsupportedError, RelationValueError } from "../src/errors";
import type { Http, HttpOptions } from "../src/http";
import { ERP_ENV_VAR, resolveMode } from "../src/mode";
import { MAX_RELATION_IDS, ObjectHandle } from "../src/objects";
import type { FieldDto, ObjectDto, RecordDto } from "../src/types";

const meta: ObjectDto = {
  id: "obj-1",
  workspaceId: "ws-1",
  name: "Đơn hàng",
  position: 0,
  createdAt: "",
  updatedAt: "",
};

function field(key: string, name: string, type = "text"): FieldDto {
  return {
    id: `field-${key}`,
    objectId: meta.id,
    key,
    name,
    type,
    config: {},
    position: 0,
    isArchived: false,
    createdAt: "",
    updatedAt: "",
  };
}

const fields = [
  field("title", "Tiêu đề"),
  field("lines", "Chi tiết", "relation"),
];

function record(id: string, data: Record<string, unknown>): RecordDto {
  return {
    id,
    objectId: meta.id,
    data,
    computedData: {},
    computeStatus: "done",
    version: 1,
    createdBy: "u",
    updatedBy: "u",
    createdAt: "",
    updatedAt: "",
  };
}

class FakeHttp implements Http {
  calls: { method: string; path: string; options?: HttpOptions }[] = [];
  constructor(private readonly responses: Record<string, unknown[]> = {}) {}

  async request<T>(method: string, path: string, options?: HttpOptions): Promise<T> {
    this.calls.push({ method, path, options });
    const queue = this.responses[`${method} ${path}`];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected request: ${method} ${path}`);
    }
    return queue.shift() as T;
  }

  body(index = 0): Record<string, unknown> {
    return this.calls[index]?.options?.body as Record<string, unknown>;
  }
}

function devClient(http: Http): ErpClient {
  return new ErpClient(http, [], {
    baseUrl: "https://erp.example.com",
    apiKey: "erp_sk_test",
    env: { [ERP_ENV_VAR]: "development" },
  });
}

describe("resolveMode", () => {
  it("defaults to production and reads ERP_ENV case- and alias-insensitively", () => {
    expect(resolveMode({})).toBe("production");
    expect(resolveMode({ [ERP_ENV_VAR]: "" })).toBe("production");
    expect(resolveMode({ [ERP_ENV_VAR]: " Production " })).toBe("production");
    expect(resolveMode({ [ERP_ENV_VAR]: "prod" })).toBe("production");
    expect(resolveMode({ [ERP_ENV_VAR]: "development" })).toBe("development");
    expect(resolveMode({ [ERP_ENV_VAR]: "DEV" })).toBe("development");
    expect(resolveMode({ [ERP_ENV_VAR]: "dry-run" })).toBe("development");
  });

  it("refuses a value it does not know instead of guessing production", () => {
    expect(() => resolveMode({ [ERP_ENV_VAR]: "devlopment" })).toThrow(/not a known environment/);
  });

  it("ignores NODE_ENV — only ERP_ENV switches the mode", () => {
    expect(resolveMode({ NODE_ENV: "development" })).toBe("production");
  });
});

describe("development mode", () => {
  it("marks every record write as a dry run", async () => {
    const http = new FakeHttp({
      "GET /objects": [[meta]],
      "GET /objects/obj-1/fields": [fields],
      "POST /objects/obj-1/records": [{ ...record("r1", {}), dryRun: true }],
      "POST /objects/obj-1/records/bulk": [{ created: 1, records: [], dryRun: true }],
      "PUT /objects/obj-1/records/r1": [{ ...record("r1", {}), dryRun: true }],
      "POST /objects/obj-1/records/bulk-update": [
        { matched: 7, updated: 7, hasMore: false, dryRun: true },
      ],
    });
    const client = devClient(http);
    expect(client.mode).toBe("development");
    expect(client.dryRun).toBe(true);

    const orders = await client.object("Đơn hàng");
    expect(orders.dryRun).toBe(true);

    const created = await orders.create({ "Tiêu đề": "Đơn A" });
    expect(created.dryRun).toBe(true);
    const bulk = await orders.createMany([{ "Tiêu đề": "Đơn B" }]);
    expect(bulk.dryRun).toBe(true);
    await orders.update("r1", { "Tiêu đề": "Đơn A2" }, 1);
    const mass = await orders.records().where("Tiêu đề", "equals", "x").update({ "Tiêu đề": "y" });
    expect(mass.matched).toBe(7);

    const bodies = http.calls
      .filter((call) => call.method !== "GET")
      .map((call) => (call.options?.body as { dryRun?: boolean }).dryRun);
    expect(bodies).toEqual([true, true, true, true]);
  });

  it("lets a single call opt out, and production opt in", async () => {
    const http = new FakeHttp({
      // Twice: withMode() starts with empty caches, so it re-reads the schema.
      "GET /objects": [[meta], [meta]],
      "GET /objects/obj-1/fields": [fields, fields],
      "POST /objects/obj-1/records": [record("r1", {}), record("r2", {})],
    });
    const client = devClient(http);
    const orders = await client.object("Đơn hàng");

    await orders.create({ "Tiêu đề": "thật" }, { dryRun: false });
    expect(http.body(2)).toEqual({ data: { title: "thật" } });

    const real = await client.production().object("Đơn hàng");
    expect(real.dryRun).toBe(false);
    await real.create({ "Tiêu đề": "thử" }, { dryRun: true });
    expect(http.body(5)).toEqual({ data: { title: "thử" }, dryRun: true });
  });

  it("refuses deletes rather than pretending or deleting for real", async () => {
    const http = new FakeHttp({
      "GET /objects": [[meta]],
      "GET /objects/obj-1/fields": [fields],
      "DELETE /objects/obj-1/records/r1": [null],
    });
    const orders = await devClient(http).object("Đơn hàng");

    await expect(orders.delete("r1", 3)).rejects.toBeInstanceOf(DryRunUnsupportedError);
    await expect(orders.createLink("r1", "Chi tiết", "r9")).rejects.toBeInstanceOf(
      DryRunUnsupportedError,
    );
    expect(http.calls.filter((call) => call.method !== "GET")).toHaveLength(0);

    await orders.delete("r1", { version: 3, dryRun: false });
    expect(http.calls[http.calls.length - 1]?.options?.query).toEqual({ version: 3 });
  });
});

describe("relation fields in data", () => {
  it("writes the whole list of ids in the same request as the rest of the row", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records": [record("r1", { title: "Đơn A", lines: ["l1", "l2"] })],
      "PUT /objects/obj-1/records/r1": [record("r1", { lines: [] })],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const created = await handle.create({ "Tiêu đề": "Đơn A", "Chi tiết": ["l1", "l2"] });
    expect(http.body(0)).toEqual({ data: { title: "Đơn A", lines: ["l1", "l2"] } });
    expect(handle.linkedIds(created, "Chi tiết")).toEqual(["l1", "l2"]);

    // null leaves the links alone, [] clears them — never the other way round.
    await handle.update("r1", { "Chi tiết": null, "Tiêu đề": "Đơn A" }, 1);
    expect((http.body(1).data as Record<string, unknown>).lines).toBeNull();
  });

  it("catches the shapes the server would reject, naming the field as written", async () => {
    const handle = new ObjectHandle(new FakeHttp({}), meta, fields);

    await expect(handle.create({ "Chi tiết": "l1" })).rejects.toBeInstanceOf(RelationValueError);
    await expect(
      handle.create({ "Chi tiết": [{ id: "l1" }] }),
    ).rejects.toThrow(/map them to ids/);
    await expect(
      handle.create({
        "Chi tiết": Array.from({ length: MAX_RELATION_IDS + 1 }, (_, i) => `l${i}`),
      }),
    ).rejects.toThrow(/at most 100/);
    await expect(handle.create({ "Chi tiết": ["l1", ""] })).rejects.toBeInstanceOf(
      RelationValueError,
    );
  });

  it("leaves non-relation values alone", async () => {
    const http = new FakeHttp({ "POST /objects/obj-1/records": [record("r1", {})] });
    const handle = new ObjectHandle(http, meta, fields);

    await handle.create({ "Tiêu đề": ["vẫn", "là", "mảng"] });
    expect((http.body(0).data as Record<string, unknown>).title).toEqual(["vẫn", "là", "mảng"]);
  });
});
