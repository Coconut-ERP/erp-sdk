import { describe, expect, it } from "vitest";
import { ErpClient } from "../src/client";
import {
  assertSelectStatement,
  DashboardsApi,
  QueryResult,
  quoteIdentifier,
} from "../src/dashboards";
import {
  SqlQueryError,
  UnknownDashboardError,
  UnknownQueryError,
} from "../src/errors";
import type {
  DashboardDto,
  DashboardQueryDto,
  QueryResultDto,
} from "../src/types";
import { FakeHttp } from "./helpers/http";

function dashboard(overrides: Partial<DashboardDto> = {}): DashboardDto {
  return {
    id: "dash-1",
    workspaceId: "ws-1",
    name: "Monitor sản xuất",
    description: "",
    visibility: "restricted",
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function query(overrides: Partial<DashboardQueryDto> = {}): DashboardQueryDto {
  return {
    id: "q-1",
    dashboardId: "dash-1",
    name: "Sản lượng theo chuyền",
    sql: 'SELECT "Tên chuyền" AS chuyen FROM "Sản xuất"',
    params: [],
    chartType: "bar",
    chartConfig: {},
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const result: QueryResultDto = {
  columns: ["chuyen", "actual"],
  rows: [
    { chuyen: "C1", actual: 120 },
    { chuyen: "C2", actual: 80 },
  ],
  rowCount: 2,
  truncated: false,
};

describe("SQL guards", () => {
  it("rejects anything that is not a single SELECT", () => {
    expect(() => assertSelectStatement('DELETE FROM "PO"')).toThrow(
      SqlQueryError,
    );
    expect(() => assertSelectStatement("SELECT 1; SELECT 2")).toThrow(
      /one statement/,
    );
    expect(() => assertSelectStatement("   ")).toThrow(SqlQueryError);
  });

  it("allows a leading WITH, comments and a trailing semicolon", () => {
    expect(() =>
      assertSelectStatement(
        "-- báo cáo\nWITH t AS (SELECT 1 AS a) SELECT * FROM t;",
      ),
    ).not.toThrow();
  });

  it("does not mistake a semicolon inside a literal for a second statement", () => {
    expect(() => assertSelectStatement("SELECT 'a;b' AS x")).not.toThrow();
  });

  it("quotes display names, doubling any inner quote", () => {
    expect(quoteIdentifier("Đơn hàng")).toBe('"Đơn hàng"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });
});

describe("ad-hoc SQL", () => {
  it("posts to the preview endpoint and frames the rows", async () => {
    const http = new FakeHttp({ "POST /dashboards/queries/preview": [result] });
    const client = new ErpClient(http);
    const rows = await client.sql('SELECT * FROM "Sản xuất"');

    expect(http.body(0)).toMatchObject({
      sql: 'SELECT * FROM "Sản xuất"',
    });
    expect(rows.rowCount).toBe(2);
    expect(rows.value<number>("actual")).toBe(120);
    expect(rows.column("chuyen")).toEqual(["C1", "C2"]);
    expect(rows.toFrame().sum("actual")).toBe(200);
  });

  it("passes declared params and their values through", async () => {
    const http = new FakeHttp({ "POST /dashboards/queries/preview": [result] });
    await new DashboardsApi(http).sql("SELECT @tu AS d", {
      params: [{ name: "tu", type: "date" }],
      values: { tu: "2026-01-01" },
    });
    expect(http.body(0)).toEqual({
      sql: "SELECT @tu AS d",
      params: [{ name: "tu", type: "date" }],
      values: { tu: "2026-01-01" },
    });
  });

  it("never sends SQL the endpoint would refuse", async () => {
    const http = new FakeHttp({});
    await expect(
      new DashboardsApi(http).sql('DROP TABLE "PO"'),
    ).rejects.toBeInstanceOf(SqlQueryError);
    expect(http.calls).toHaveLength(0);
  });

  it("flags a truncated result instead of hiding it", () => {
    const capped = QueryResult.from({
      ...result,
      rowCount: 1000,
      truncated: true,
    });
    expect(capped.truncated).toBe(true);
  });
});

describe("DashboardsApi", () => {
  it("keeps paging while meta says there are more pages", async () => {
    const http = new FakeHttp(
      {
        "GET /dashboards": [[dashboard({ id: "a" })], [dashboard({ id: "b" })]],
      },
      { page: 1, perPage: 100, totalItems: 12, totalPages: 2 },
    );
    const all = await new DashboardsApi(http).listAll();
    expect(all.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("resolves a dashboard by name and loads its queries", async () => {
    const http = new FakeHttp(
      {
        "GET /dashboards": [[dashboard()]],
        "GET /dashboards/dash-1": [dashboard({ queries: [query()] })],
      },
      { page: 1, perPage: 100, totalItems: 1, totalPages: 1 },
    );
    const handle = await new DashboardsApi(http).handle("monitor sản xuất");
    expect((await handle.queries()).map((q) => q.name)).toEqual([
      "Sản lượng theo chuyền",
    ]);
  });

  it("names the known dashboards when the name is wrong", async () => {
    const http = new FakeHttp(
      { "GET /dashboards": [[dashboard()]] },
      { page: 1, perPage: 100, totalItems: 1, totalPages: 1 },
    );
    await expect(new DashboardsApi(http).handle("Nope")).rejects.toBeInstanceOf(
      UnknownDashboardError,
    );
  });
});

describe("DashboardHandle", () => {
  async function handle(responses: Record<string, unknown[]> = {}) {
    const http = new FakeHttp(
      {
        "GET /dashboards": [[dashboard()]],
        "GET /dashboards/dash-1": [dashboard({ queries: [query()] })],
        ...responses,
      },
      { page: 1, perPage: 100, totalItems: 1, totalPages: 1 },
    );
    return { http, dash: await new DashboardsApi(http).handle("dash-1") };
  }

  it("runs a saved query by display name, with its params", async () => {
    const { http, dash } = await handle({
      "POST /dashboards/dash-1/queries/q-1/run": [result],
    });
    const rows = await dash.run("sản lượng theo chuyền", { thang: "2026-01" });

    const last = http.calls[http.calls.length - 1];
    expect(last?.options.body).toEqual({ params: { thang: "2026-01" } });
    expect(rows.columns).toEqual(["chuyen", "actual"]);
  });

  it("frames a saved query in one step", async () => {
    const { dash } = await handle({
      "POST /dashboards/dash-1/queries/q-1/run": [result],
    });
    expect((await dash.toFrame("q-1")).toArray()).toHaveLength(2);
  });

  it("says which queries exist when the name is wrong", async () => {
    const { dash } = await handle();
    await expect(dash.run("Không có")).rejects.toBeInstanceOf(
      UnknownQueryError,
    );
  });

  it("checks a saved query's SQL before creating it", async () => {
    const { http, dash } = await handle();
    await expect(
      dash.addQuery({ name: "x", sql: 'UPDATE "PO" SET a = 1' }),
    ).rejects.toBeInstanceOf(SqlQueryError);
    expect(http.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("re-reads queries after one is added", async () => {
    const { http, dash } = await handle({
      "POST /dashboards/dash-1/queries": [query({ id: "q-2", name: "Mới" })],
      "GET /dashboards/dash-1/queries": [
        [query(), query({ id: "q-2", name: "Mới" })],
      ],
    });
    await dash.addQuery({
      name: "Mới",
      sql: "SELECT 1 AS a",
      chartType: "number",
    });
    expect(await dash.queries()).toHaveLength(2);
    expect(
      http.calls.some((c) => c.path === "/dashboards/dash-1/queries"),
    ).toBe(true);
  });
});
