import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/index";
import { parseArgv } from "../src/cli/args";
import { coerce, parseFieldSpec, parseFilter, parseSort } from "../src/cli/values";

const OBJECTS = [{ id: "obj-1", workspaceId: "ws-1", name: "Hóa đơn", position: 0 }];
const FIELDS = [
  { id: "f-1", objectId: "obj-1", key: "status", name: "Trạng thái", type: "single_select", config: null, position: 0, isArchived: false },
  { id: "f-2", objectId: "obj-1", key: "total", name: "Tổng tiền", type: "currency", config: null, position: 1, isArchived: false },
];
const RECORD = {
  id: "rec-1",
  objectId: "obj-1",
  data: { status: "approved", total: 1500000 },
  computedData: null,
  computeStatus: "done",
  version: 2,
  createdBy: "u-1",
  updatedBy: "u-1",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function harness(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      url: url.pathname + url.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (!(key in routes)) {
      return new Response(
        JSON.stringify({ success: false, message: `no route ${key}`, statusCode: 404 }),
        { status: 404 },
      );
    }
    return new Response(
      JSON.stringify({ success: true, message: "ok", statusCode: 200, data: routes[key] }),
      { status: 200 },
    );
  }) as unknown as typeof globalThis.fetch;

  const run = (argv: string[], env: Record<string, string | undefined> = {}) =>
    runCli(argv, {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      env: {
        ERP_BASE_URL: "https://erp.example.com",
        ERP_API_KEY: "erp_sk_test",
        ...env,
      },
      cwd: process.cwd(),
      fetch: fetchImpl,
    });

  return {
    run,
    calls,
    out: () => stdout.join(""),
    err: () => stderr.join(""),
    json: () => JSON.parse(stdout.join("")) as any,
    errorJson: () => JSON.parse(stderr.join("")) as { error: { type: string; [k: string]: unknown } },
  };
}

const SCHEMA_ROUTES = {
  "GET /api/v1/objects": OBJECTS,
  "GET /api/v1/objects/obj-1/fields": FIELDS,
};

describe("value parsing", () => {
  it("reads JSON-ish values but keeps plain strings", () => {
    expect(coerce("42")).toBe(42);
    expect(coerce("true")).toBe(true);
    expect(coerce("approved")).toBe("approved");
    expect(coerce("2026-08-03")).toBe("2026-08-03");
  });

  it("parses both filter syntaxes", () => {
    expect(parseFilter("Tổng tiền:greater_than:1000000")).toEqual({
      field: "Tổng tiền",
      operator: "greater_than",
      value: 1000000,
    });
    expect(parseFilter("Trạng thái=approved")).toEqual({
      field: "Trạng thái",
      operator: "equals",
      value: "approved",
    });
    expect(parseFilter("Ghi chú:is_empty")).toEqual({
      field: "Ghi chú",
      operator: "is_empty",
    });
    expect(() => parseFilter("Trạng thái")).toThrowError(/Cannot parse filter/);
  });

  it("parses sorts and field specs", () => {
    expect(parseSort("Tổng tiền:desc")).toEqual({ field: "Tổng tiền", direction: "desc" });
    expect(parseSort("Tổng tiền")).toEqual({ field: "Tổng tiền", direction: "asc" });
    expect(parseFieldSpec("Lý do:long_text")).toEqual({ name: "Lý do", type: "long_text" });
    expect(parseFieldSpec("Trạng thái:single_select:pending,approved")).toEqual({
      name: "Trạng thái",
      type: "single_select",
      config: { source: "static", options: ["pending", "approved"] },
    });
    expect(parseFieldSpec('Người:single_select:{"source":"workspace_users"}')).toEqual({
      name: "Người",
      type: "single_select",
      config: { source: "workspace_users" },
    });
  });
});

describe("argv parsing", () => {
  it("collects repeated flags, inline values and negations", () => {
    const args = parseArgv(["records", "query", "Hóa đơn", "--where", "a=1", "--where=b=2", "--all", "--no-total"]);
    expect(args.positional).toEqual(["records", "query", "Hóa đơn"]);
    expect(args.flags.get("where")).toEqual(["a=1", "b=2"]);
    expect(args.flags.get("all")).toBe(true);
    expect(args.flags.get("total")).toBe(false);
  });
});

describe("help", () => {
  it("exposes the whole command surface as JSON", async () => {
    const cli = harness({});
    expect(await cli.run(["help", "--json"])).toBe(0);
    const spec = cli.json();
    expect(spec.commands.map((c: { name: string }) => c.name)).toContain("records query");
    expect(spec.globalFlags.map((f: { name: string }) => f.name)).toContain("api-key");
  });

  it("describes a single command", async () => {
    const cli = harness({});
    expect(await cli.run(["help", "records", "create", "--json"])).toBe(0);
    expect(cli.json().usage).toBe("erp records create <object>");
  });
});

describe("records query", () => {
  it("resolves display names to field keys and returns named rows", async () => {
    const cli = harness({
      ...SCHEMA_ROUTES,
      "POST /api/v1/objects/obj-1/records/query": {
        records: [RECORD],
        hasMore: false,
      },
    });

    const code = await cli.run([
      "records",
      "query",
      "Hóa đơn",
      "--where",
      "Trạng thái=approved",
      "--where",
      "Tổng tiền:greater_than:1000000",
      "--sort",
      "Tổng tiền:desc",
      "--limit",
      "10",
    ]);

    expect(code).toBe(0);
    const query = cli.calls.find((call) => call.url.endsWith("/records/query"));
    expect(query?.body).toEqual({
      filters: [
        { field: "status", operator: "equals", value: "approved" },
        { field: "total", operator: "greater_than", value: 1000000 },
      ],
      sorts: [{ field: "total", direction: "desc" }],
      limit: 10,
    });
    expect(cli.json().records[0]).toMatchObject({
      id: "rec-1",
      "Trạng thái": "approved",
      "Tổng tiền": 1500000,
    });
  });

  it("reports unknown fields with the known list", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["records", "query", "Hóa đơn", "--where", "Sai tên=1"])).toBe(1);
    const error = cli.errorJson().error;
    expect(error.type).toBe("UnknownFieldError");
    expect(error.known).toEqual(["Trạng thái", "Tổng tiền"]);
  });
});

describe("records create", () => {
  it("merges --data and --set, keyed by display name", async () => {
    const cli = harness({
      ...SCHEMA_ROUTES,
      "POST /api/v1/objects/obj-1/records": RECORD,
    });
    const code = await cli.run([
      "records",
      "create",
      "Hóa đơn",
      "--data",
      '{"Trạng thái":"draft"}',
      "--set",
      "Tổng tiền=1500000",
    ]);
    expect(code).toBe(0);
    const create = cli.calls.find((call) => call.method === "POST");
    expect(create?.body).toEqual({ data: { status: "draft", total: 1500000 } });
  });

  it("refuses an empty payload and lists the fields", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["records", "create", "Hóa đơn"])).toBe(2);
    expect(cli.errorJson().error.message).toContain("Trạng thái");
  });
});

describe("objects", () => {
  it("shows fields with types", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "show", "Hóa đơn"])).toBe(0);
    expect(cli.json()).toMatchObject({
      id: "obj-1",
      name: "Hóa đơn",
      fields: [{ key: "status", type: "single_select" }, { key: "total", type: "currency" }],
    });
  });

  it("refuses to delete without --yes", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "delete", "Hóa đơn"])).toBe(2);
    expect(cli.errorJson().error.type).toBe("UsageError");
    expect(cli.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});

describe("doctor", () => {
  it("fails with hints when nothing is configured", async () => {
    const cli = harness({});
    const code = await cli.run(["doctor"], { ERP_BASE_URL: undefined, ERP_API_KEY: undefined });
    expect(code).toBe(1);
    const report = cli.json();
    expect(report.ok).toBe(false);
    expect(report.checks.map((c: { name: string }) => c.name)).toEqual(["base-url", "credentials"]);
    expect(report.checks[0].hint).toContain("ERP_BASE_URL");
  });

  it("checks required permissions", async () => {
    const cli = harness({
      "GET /api/v1/iam/me/permissions": [
        { id: "p1", ruleId: "r1", resource: "object", action: "read", effect: "allow", scopeType: "all", scope: null, createdAt: "" },
      ],
      "GET /api/v1/objects": OBJECTS,
    });
    expect(await cli.run(["doctor", "--require", "object:record:create"])).toBe(1);
    const checks = cli.json().checks as { name: string; status: string }[];
    expect(checks.find((check) => check.name === "permission object:record:create")?.status).toBe("fail");
  });
});

describe("usage errors", () => {
  it("rejects unknown commands and flags", async () => {
    const cli = harness({});
    expect(await cli.run(["recordz"])).toBe(2);
    expect(cli.errorJson().error.type).toBe("UsageError");

    const other = harness(SCHEMA_ROUTES);
    expect(await other.run(["objects", "list", "--nope", "1"])).toBe(2);
    expect(other.errorJson().error.message).toContain("Unknown flag --nope");
  });

  it("explains missing credentials before making a request", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "list"], { ERP_API_KEY: undefined })).toBe(2);
    expect(cli.errorJson().error.message).toContain("Missing credentials");
    expect(cli.calls).toHaveLength(0);
  });
});

describe("scaffolding", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function temp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "erp-cli-"));
    dirs.push(dir);
    return dir;
  }

  it("writes a runnable mini app", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(await cli.run(["init", join(dir, "don-xin-nghi"), "--name", "Đơn xin nghỉ"])).toBe(0);

    const result = cli.json();
    expect(result.files).toContain("server.js");
    const manifest = JSON.parse(
      await readFile(join(dir, "don-xin-nghi", "package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(manifest.name).toBe("don-xin-nghi");
    expect(manifest.dependencies["erp-sdk"]).toBeTruthy();

    const server = await readFile(join(dir, "don-xin-nghi", "server.js"), "utf8");
    expect(server).toContain('const OBJECT_NAME = "Đơn xin nghỉ"');
    expect(server).toContain("app.session(initData)");

    // Second run must not clobber files silently.
    expect(await cli.run(["init", join(dir, "don-xin-nghi")])).toBe(2);
  });

  it("installs the skill", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(await cli.run(["skill", "install", "--dir", join(dir, "skills")])).toBe(0);
    const skill = await readFile(join(dir, "skills", "erp-miniapp", "SKILL.md"), "utf8");
    expect(skill).toContain("name: erp-miniapp");
    expect(await cli.run(["skill", "install", "--dir", join(dir, "skills")])).toBe(2);
    expect(await cli.run(["skill", "install", "--dir", join(dir, "skills"), "--force"])).toBe(0);
  });
});
