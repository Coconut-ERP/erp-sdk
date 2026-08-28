import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import { ObjectDefinitionError } from "../src/errors";
import { ObjectHandle } from "../src/objects";
import type { FieldDto, ObjectDto, RecordDto, RecordPage } from "../src/types";
import { FakeHttp } from "./helpers/http";

const meta: ObjectDto = {
  id: "obj-1",
  workspaceId: "ws-1",
  name: "Hóa đơn bán hàng",
  groups: [],
  position: 0,
  createdAt: "",
  updatedAt: "",
};

function field(key: string, name: string): FieldDto {
  return {
    id: `field-${key}`,
    objectId: meta.id,
    key,
    name,
    type: "text",
    config: {},
    position: 0,
    isArchived: false,
    createdAt: "",
    updatedAt: "",
  };
}

const fields = [field("status", "Trạng thái"), field("total", "Tổng tiền")];

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

describe("RecordQuery", () => {
  it("resolves display names to field keys in filters and sorts", async () => {
    const page: RecordPage = { records: [], hasMore: false };
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [page],
    });
    const handle = new ObjectHandle(http, meta, fields);

    await handle
      .records()
      .where("Trạng thái", "equals", "approved")
      .where("total", "greater_than", 100)
      .orderBy("Tổng tiền", "desc")
      .limit(10)
      .fetch();

    expect(http.body(0)).toEqual({
      filters: [
        { field: "status", operator: "equals", value: "approved" },
        { field: "total", operator: "greater_than", value: 100 },
      ],
      sorts: [{ field: "total", direction: "desc" }],
      cursor: undefined,
      limit: 10,
      includeTotal: undefined,
    });
  });

  it("rejects unknown fields with a helpful error", () => {
    const handle = new ObjectHandle(new FakeHttp({}), meta, fields);
    expect(() => handle.records().where("Ngày", "equals", "x")).toThrowError(
      /Known fields: Trạng thái, Tổng tiền/,
    );
  });

  it("sends in/not_in filters as arrays under the field key", async () => {
    const page: RecordPage = { records: [], hasMore: false };
    const http = new FakeHttp({ "POST /objects/obj-1/records/query": [page] });
    const handle = new ObjectHandle(http, meta, fields);

    await handle
      .records()
      .whereIn("Trạng thái", ["approved", "paid"])
      .whereNotIn("Tổng tiền", [0])
      .fetch();

    expect(http.body(0).filters).toEqual([
      { field: "status", operator: "in", value: ["approved", "paid"] },
      { field: "total", operator: "not_in", value: [0] },
    ]);
  });

  it("filters on the record id without resolving it as a field", async () => {
    const page: RecordPage = { records: [], hasMore: false };
    const http = new FakeHttp({ "POST /objects/obj-1/records/query": [page] });
    const handle = new ObjectHandle(http, meta, fields);

    await handle
      .records()
      .whereIds(["r1", "r2"])
      .where("id", "not_equals", "r3")
      .fetch();

    expect(http.body(0).filters).toEqual([
      { field: "id", operator: "in", value: ["r1", "r2"] },
      { field: "id", operator: "not_equals", value: "r3" },
    ]);
  });

  it("lets a real field named id win over the record id key", async () => {
    const page: RecordPage = { records: [], hasMore: false };
    const http = new FakeHttp({ "POST /objects/obj-1/records/query": [page] });
    const handle = new ObjectHandle(http, meta, [
      ...fields,
      field("code", "ID"),
    ]);

    await handle.records().where("id", "equals", "INV-1").fetch();

    expect(http.body(0).filters).toEqual([
      { field: "code", operator: "equals", value: "INV-1" },
    ]);
  });

  it("refuses in/not_in values the server would reject", () => {
    const handle = new ObjectHandle(new FakeHttp({}), meta, fields);
    expect(() =>
      handle.records().where("Trạng thái", "in", "approved"),
    ).toThrowError(/needs an array of values/);
    expect(() => handle.records().whereIn("Trạng thái", [])).toThrowError(
      /needs at least one value/,
    );
    expect(() =>
      handle.records().whereIn(
        "Trạng thái",
        Array.from({ length: 201 }, (_, i) => i),
      ),
    ).toThrowError(/at most 200 values, got 201/);
  });

  it("paginates through all pages in fetchAll", async () => {
    const pageOne: RecordPage = {
      records: [record("r1", { status: "approved" })],
      hasMore: true,
      nextCursor: "c2",
    };
    const pageTwo: RecordPage = {
      records: [record("r2", { status: "draft" })],
      hasMore: false,
    };
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [pageOne, pageTwo],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const records = await handle.records().fetchAll();
    expect(records.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(http.body(1).cursor).toBe("c2");
  });

  it("maps records to display-name rows in toFrame", async () => {
    const page: RecordPage = {
      records: [record("r1", { status: "approved", total: 120 })],
      hasMore: false,
    };
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [page],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const frame = await handle.records().toFrame();
    expect(frame.first()).toMatchObject({
      id: "r1",
      "Trạng thái": "approved",
      "Tổng tiền": 120,
    });
  });
});

describe("ObjectHandle mutations", () => {
  it("resolves data keys and fetches version when omitted", async () => {
    const existing = record("r1", { status: "draft" });
    existing.version = 3;
    const http = new FakeHttp({
      "GET /objects/obj-1/records/r1": [existing],
      "PUT /objects/obj-1/records/r1": [record("r1", { status: "approved" })],
    });
    const handle = new ObjectHandle(http, meta, fields);

    await handle.update("r1", { "Trạng thái": "approved" });
    expect(http.body(1)).toEqual({
      data: { status: "approved" },
      version: 3,
    });
  });
});

describe("schema management", () => {
  it("creates an object then adds fields usable by display name", async () => {
    const newMeta: ObjectDto = { ...meta, id: "obj-2", name: "Đơn đặt hàng" };
    const newField = { ...field("qty", "Số lượng"), objectId: "obj-2" };
    const http = new FakeHttp({
      "POST /objects": [newMeta],
      "POST /objects/obj-2/fields": [newField],
      "POST /objects/obj-2/records": [record("r1", { qty: 3 })],
    });
    const client = new ErpClient(http);

    const orders = await client.createObject("Đơn đặt hàng");
    await orders.addField("Số lượng", "number");
    await orders.create({ "Số lượng": 3 });

    expect(http.body(0)).toEqual({
      name: "Đơn đặt hàng",
      groups: [],
      position: 0,
    });
    expect(http.body(1)).toEqual({
      name: "Số lượng",
      type: "number",
      config: {},
      position: 0,
    });
    expect(http.body(2)).toEqual({ data: { qty: 3 } });
  });

  it("changes the name, the groups and the position of a table", async () => {
    const updated: ObjectDto = {
      ...meta,
      name: "Hoá đơn",
      groups: ["Bán hàng", "Kế toán"],
      position: 3,
    };
    const http = new FakeHttp({ "PUT /objects/obj-1": [updated] });
    const handle = new ObjectHandle(http, { ...meta }, []);

    await handle.updateDefinition({
      name: "Hoá đơn",
      groups: ["Bán hàng", "Kế toán"],
      position: 3,
    });

    expect(http.body(0)).toEqual({
      name: "Hoá đơn",
      groups: ["Bán hàng", "Kế toán"],
      position: 3,
    });
    expect(handle.name).toBe("Hoá đơn");
    expect(handle.groups).toEqual(["Bán hàng", "Kế toán"]);
  });

  it("adds a group by sending the current ones plus it", async () => {
    const start: ObjectDto = { ...meta, groups: ["Bán hàng"] };
    const http = new FakeHttp({
      "PUT /objects/obj-1": [{ ...start, groups: ["Bán hàng", "Kho"] }],
    });
    const handle = new ObjectHandle(http, start, []);

    await handle.setGroups([...handle.groups, "Kho"]);
    expect(http.body(0)).toEqual({ groups: ["Bán hàng", "Kho"] });
  });

  it("refuses an empty change or more groups than the server stores", async () => {
    const handle = new ObjectHandle(new FakeHttp({}), { ...meta }, []);

    await expect(handle.updateDefinition({})).rejects.toBeInstanceOf(
      ObjectDefinitionError,
    );
    await expect(handle.rename("  ")).rejects.toThrow(/cannot be empty/);
    await expect(
      handle.setGroups(Array.from({ length: 11 }, (_, i) => `G${i}`)),
    ).rejects.toThrow(/at most 10/);
  });

  it("drops the client's name-keyed caches when a table is renamed", async () => {
    const http = new FakeHttp({
      "GET /objects": [[{ ...meta }], [{ ...meta, name: "Hoá đơn" }]],
      "GET /objects/obj-1/fields": [[field("total", "Tổng tiền")]],
      "PUT /objects/obj-1": [{ ...meta, name: "Hoá đơn" }],
    });
    const client = new ErpClient(http);

    const handle = await client.object("Hóa đơn bán hàng");
    await handle.rename("Hoá đơn");

    // The stale name is gone from the cache, so the next lookup re-reads.
    await expect(client.object("Hóa đơn bán hàng")).rejects.toThrow(
      /Object not found/,
    );
  });

  it("re-indexes a field after rename via updateField", async () => {
    const renamed = { ...field("status", "Trạng thái"), name: "Tình trạng" };
    const http = new FakeHttp({
      "PUT /objects/obj-1/fields/field-status": [renamed],
    });
    const handle = new ObjectHandle(http, meta, [
      field("status", "Trạng thái"),
      field("total", "Tổng tiền"),
    ]);

    await handle.updateField("Trạng thái", { name: "Tình trạng" });
    expect(handle.fieldKey("Tình trạng")).toBe("status");
    expect(() => handle.fieldKey("Trạng thái")).toThrowError(/Known fields/);
  });
});

describe("ensureObject", () => {
  it("creates the object and missing fields when absent", async () => {
    const leaveMeta: ObjectDto = {
      ...meta,
      id: "obj-leave",
      name: "Đơn xin nghỉ",
    };
    const reason = { ...field("reason", "Lý do"), objectId: "obj-leave" };
    const http = new FakeHttp({
      "GET /objects": [[], []],
      "POST /objects": [leaveMeta],
      "POST /objects/obj-leave/fields": [reason],
    });
    const client = new ErpClient(http);

    const handle = await client.ensureObject("Đơn xin nghỉ", [
      { name: "Lý do", type: "long_text" },
    ]);
    expect(handle.id).toBe("obj-leave");
    expect(handle.fieldKey("Lý do")).toBe("reason");
    expect(
      http.calls.some((c) => c.method === "POST" && c.path === "/objects"),
    ).toBe(true);
  });

  it("is a no-op when object and fields already exist", async () => {
    const http = new FakeHttp({
      "GET /objects": [[meta]],
      "GET /objects/obj-1/fields": [fields],
    });
    const client = new ErpClient(http);

    const handle = await client.ensureObject("Hóa đơn bán hàng", [
      { name: "Trạng thái", type: "text" },
    ]);
    expect(handle.id).toBe("obj-1");
    expect(http.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("answers hasObject/hasField without throwing, by name or key", async () => {
    const http = new FakeHttp({
      "GET /objects": [[meta]],
      "GET /objects/obj-1/fields": [fields],
    });
    const client = new ErpClient(http);

    expect(await client.hasObject("Hóa đơn bán hàng")).toBe(true);
    expect(await client.hasObject("hóa đơn bán hàng")).toBe(true);
    expect(await client.hasObject("obj-1")).toBe(true);
    expect(await client.hasObject("Không có")).toBe(false);

    const handle = await client.object("obj-1");
    expect(handle.hasField("Trạng thái")).toBe(true);
    expect(handle.hasField("trạng thái")).toBe(true);
    expect(handle.hasField("status")).toBe(true); // internal key
    expect(handle.hasField("Không có")).toBe(false);
    // The throwing sibling still throws — hasField is not a silent alias.
    expect(() => handle.field("Không có")).toThrow();
  });
});

describe("ErpClient", () => {
  it("returns the current user from /users/me", async () => {
    const http = new FakeHttp({
      "GET /users/me": [{ id: "u-1", email: "an@corp.vn" }],
    });
    const client = new ErpClient(http);
    const user = await client.me();
    expect(user.id).toBe("u-1");
    await client.me();
    expect(http.calls).toHaveLength(1);
  });

  it("resolves objects by name and caches handles", async () => {
    const http = new FakeHttp({
      "GET /objects": [[meta]],
      "GET /objects/obj-1/fields": [fields],
    });
    const client = new ErpClient(http);

    const byName = await client.object("Hóa đơn bán hàng");
    const byId = await client.object("obj-1");
    expect(byName).toBe(byId);
    expect(http.calls.filter((c) => c.path === "/objects")).toHaveLength(1);
  });
});

describe("bulk writes", () => {
  it("sends one request per batch and resolves display names", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/bulk": [
        { created: 2, records: [record("r1", {}), record("r2", {})] },
      ],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const result = await handle.createMany([
      { "Trạng thái": "draft", "Tổng tiền": 10 },
      { "Trạng thái": "draft", "Tổng tiền": 20 },
    ]);

    expect(result.created).toBe(2);
    expect(http.calls).toHaveLength(1);
    expect(http.body(0)).toEqual({
      records: [
        { data: { status: "draft", total: 10 } },
        { data: { status: "draft", total: 20 } },
      ],
    });
  });

  it("splits a batch larger than the server's cap and keeps the order", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/bulk": [
        { created: 2, records: [record("r1", {}), record("r2", {})] },
        { created: 1, records: [record("r3", {})] },
      ],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const result = await handle.createMany(
      [{ status: "a" }, { status: "b" }, { status: "c" }],
      { chunkSize: 2 },
    );

    expect(result.created).toBe(3);
    expect(result.records.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(http.calls).toHaveLength(2);
  });

  it("turns a record query into one filtered mass update", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/bulk-update": [
        { matched: 4, updated: 4, hasMore: false },
      ],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const result = await handle
      .records()
      .where("Trạng thái", "equals", "draft")
      .update({ "Trạng thái": "overdue", "Tổng tiền": null });

    expect(result.updated).toBe(4);
    expect(http.body(0)).toEqual({
      filters: [{ field: "status", operator: "equals", value: "draft" }],
      data: { status: "overdue", total: null },
      limit: undefined,
    });
  });
});

describe("getMany", () => {
  it("chunks the ids, keeps the asked-for order and drops what came back missing", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [
        { records: [record("r2", {}), record("r1", {})], hasMore: false },
        { records: [record("r3", {})], hasMore: false },
      ],
    });
    const handle = new ObjectHandle(http, meta, fields);

    const records = await handle.getMany(["r1", "r2", "r3", "r1", "r4"], {
      chunkSize: 2,
    });

    expect(records.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(http.calls).toHaveLength(2);
    expect(http.body(0).filters).toEqual([
      { field: "id", operator: "in", value: ["r1", "r2"] },
    ]);
    expect(http.body(1).filters).toEqual([
      { field: "id", operator: "in", value: ["r3", "r4"] },
    ]);
  });

  it("makes no request for an empty id list", async () => {
    const http = new FakeHttp({});
    const handle = new ObjectHandle(http, meta, fields);

    expect(await handle.getMany([])).toEqual([]);
    expect(http.calls).toHaveLength(0);
  });
});

describe("preload", () => {
  const lineMeta: ObjectDto = {
    ...meta,
    id: "obj-2",
    name: "Chi tiết hóa đơn",
  };
  const lineInvoice: FieldDto = {
    id: "field-invoice",
    objectId: lineMeta.id,
    key: "invoice",
    name: "Hóa đơn",
    type: "relation",
    config: { targetObjectId: meta.id },
    position: 0,
    isArchived: false,
    createdAt: "",
    updatedAt: "",
  };

  it("infers outgoing for this object's own relation field", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-2/records/query": [{ records: [], hasMore: false }],
    });
    const lines = new ObjectHandle(http, lineMeta, [lineInvoice]);

    await lines.records().preload("Hóa đơn").fetch();

    expect(http.body(0).preload).toEqual([
      { field: "invoice", direction: "outgoing", limit: undefined },
    ]);
  });

  it("infers incoming for a relation field belonging to another object", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [{ records: [], hasMore: false }],
    });
    const invoices = new ObjectHandle(http, meta, fields);

    await invoices.records().preload(lineInvoice, { limit: 20 }).fetch();

    expect(http.body(0).preload).toEqual([
      { field: "invoice", direction: "incoming", limit: 20 },
    ]);
  });

  it("reads preloaded records back by field or by raw key", () => {
    const invoices = new ObjectHandle(new FakeHttp({}), meta, fields);
    const line = record("l1", {});
    const parent: RecordDto = {
      ...record("r1", {}),
      related: { invoice: [line] },
    };

    expect(invoices.related(parent, lineInvoice)).toEqual([line]);
    expect(invoices.related(parent, "invoice")).toEqual([line]);
    expect(invoices.related(parent, "khong-co")).toEqual([]);
  });
});

describe("backward compatibility", () => {
  it("keeps the query body byte-identical when no preload is asked for", async () => {
    const http = new FakeHttp({
      "POST /objects/obj-1/records/query": [{ records: [], hasMore: false }],
    });
    const handle = new ObjectHandle(http, meta, fields);

    await handle
      .records()
      .where("Trạng thái", "equals", "approved")
      .limit(25)
      .fetch();

    const body = http.body(0);
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      filters: [{ field: "status", operator: "equals", value: "approved" }],
      limit: 25,
    });
    expect(Object.keys(JSON.parse(JSON.stringify(body)))).not.toContain(
      "preload",
    );
  });

  it("leaves single-record CRUD calls exactly as they were", async () => {
    const created = record("r1", { status: "draft" });
    const http = new FakeHttp({
      "POST /objects/obj-1/records": [created],
      "PUT /objects/obj-1/records/r1": [created],
      "DELETE /objects/obj-1/records/r1": [null],
    });
    const handle = new ObjectHandle(http, meta, fields);

    await handle.create({ "Trạng thái": "draft" });
    await handle.update("r1", { "Trạng thái": "approved" }, 1);
    await handle.delete("r1", 2);

    expect(http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /objects/obj-1/records",
      "PUT /objects/obj-1/records/r1",
      "DELETE /objects/obj-1/records/r1",
    ]);
    expect(http.body(0)).toEqual({ data: { status: "draft" } });
    expect(http.body(1)).toEqual({
      data: { status: "approved" },
      version: 1,
    });
    expect(http.calls[2]?.options.query).toEqual({ version: 2 });
  });

  it("reads a record that carries no `related` without touching it", () => {
    const handle = new ObjectHandle(new FakeHttp({}), meta, fields);
    const legacy = record("r1", { status: "approved", total: 120 });

    expect(handle.related(legacy, "Trạng thái")).toEqual([]);
    expect(handle.rowFromRecord(legacy)).toMatchObject({
      id: "r1",
      "Trạng thái": "approved",
      "Tổng tiền": 120,
    });
  });
});
