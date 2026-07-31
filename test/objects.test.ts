import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import type { Http, HttpOptions } from "../src/http";
import { ObjectHandle } from "../src/objects";
import type { FieldDto, ObjectDto, RecordDto, RecordPage } from "../src/types";

const meta: ObjectDto = {
  id: "obj-1",
  workspaceId: "ws-1",
  name: "Hóa đơn bán hàng",
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

interface Call {
  method: string;
  path: string;
  options?: HttpOptions;
}

class FakeHttp implements Http {
  calls: Call[] = [];
  constructor(private readonly responses: Record<string, unknown[]>) {}

  async request<T>(method: string, path: string, options?: HttpOptions): Promise<T> {
    this.calls.push({ method, path, options });
    const queue = this.responses[`${method} ${path}`];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected request: ${method} ${path}`);
    }
    return queue.shift() as T;
  }
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

    expect(http.calls[0]?.options?.body).toEqual({
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
    expect((http.calls[1]?.options?.body as { cursor?: string }).cursor).toBe("c2");
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
    expect(http.calls[1]?.options?.body).toEqual({
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

    expect(http.calls[0]?.options?.body).toEqual({ name: "Đơn đặt hàng", position: 0 });
    expect(http.calls[1]?.options?.body).toEqual({
      name: "Số lượng",
      type: "number",
      config: {},
      position: 0,
    });
    expect(http.calls[2]?.options?.body).toEqual({ data: { qty: 3 } });
  });

  it("re-indexes a field after rename via updateField", async () => {
    const renamed = { ...fields[0]!, name: "Tình trạng" };
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
    const leaveMeta: ObjectDto = { ...meta, id: "obj-leave", name: "Đơn xin nghỉ" };
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
    expect(http.calls.some((c) => c.method === "POST" && c.path === "/objects")).toBe(true);
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
