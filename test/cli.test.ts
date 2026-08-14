import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgv } from "../src/cli/args";
import { runCli } from "../src/cli/index";

const OBJECTS = [
  { id: "obj-1", workspaceId: "ws-1", name: "Hóa đơn", position: 0 },
];
const FIELDS = [
  {
    id: "f-1",
    objectId: "obj-1",
    key: "status",
    name: "Trạng thái",
    type: "single_select",
    config: null,
    position: 0,
    isArchived: false,
  },
  {
    id: "f-2",
    objectId: "obj-1",
    key: "total",
    name: "Tổng tiền",
    type: "currency",
    config: null,
    position: 1,
    isArchived: false,
  },
];

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
        JSON.stringify({
          success: false,
          message: `no route ${key}`,
          statusCode: 404,
        }),
        { status: 404 },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        message: "ok",
        statusCode: 200,
        data: routes[key],
      }),
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
    // The parsed result is a different shape per command, so a test that cares
    // passes its own T rather than this file restating every spec in COMMANDS.
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary parsed CLI output
    json: <T = any>(): T => JSON.parse(stdout.join("")) as T,
    errorJson: () =>
      JSON.parse(stderr.join("")) as {
        error: { type: string; [k: string]: unknown };
      },
  };
}

const SCHEMA_ROUTES = {
  "GET /api/v1/objects": OBJECTS,
  "GET /api/v1/objects/obj-1/fields": FIELDS,
};

describe("argv parsing", () => {
  it("collects repeated flags, inline values and negations", () => {
    const args = parseArgv([
      "doctor",
      "--require",
      "object:read",
      "--require=object:record:create",
      "--compact",
      "--no-fields",
    ]);
    expect(args.positional).toEqual(["doctor"]);
    expect(args.flags.get("require")).toEqual([
      "object:read",
      "object:record:create",
    ]);
    expect(args.flags.get("compact")).toBe(true);
    expect(args.flags.get("fields")).toBe(false);
  });
});

describe("help", () => {
  it("exposes the whole command surface as JSON", async () => {
    const cli = harness({});
    expect(await cli.run(["help", "--json"])).toBe(0);
    const spec = cli.json();
    const names = spec.commands.map((c: { name: string }) => c.name);
    expect(names).toContain("objects show");
    expect(names).toContain("schema dump");
    expect(spec.globalFlags.map((f: { name: string }) => f.name)).toContain(
      "api-key",
    );
  });

  it("keeps record CRUD out of the CLI — that is the SDK's job", async () => {
    const cli = harness({});
    expect(await cli.run(["help", "--json"])).toBe(0);
    const names: string[] = cli
      .json()
      .commands.map((c: { name: string }) => c.name);
    expect(
      names.some((name) => /^(records|fields|links|perms) /.test(name)),
    ).toBe(false);
    expect(names).not.toContain("objects create");
    expect(names).not.toContain("objects delete");
  });

  it("describes a single command", async () => {
    const cli = harness({});
    expect(await cli.run(["help", "objects", "show", "--json"])).toBe(0);
    expect(cli.json().usage).toBe("erp objects show <object>");
  });
});

describe("objects", () => {
  it("lists objects without touching their fields", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "list"])).toBe(0);
    expect(cli.json()).toEqual([{ id: "obj-1", name: "Hóa đơn", position: 0 }]);
    expect(cli.calls.some((call) => call.url.endsWith("/fields"))).toBe(false);
  });

  it("shows fields with types", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "show", "Hóa đơn"])).toBe(0);
    expect(cli.json()).toMatchObject({
      id: "obj-1",
      name: "Hóa đơn",
      fields: [
        { key: "status", type: "single_select" },
        { key: "total", type: "currency" },
      ],
    });
  });

  it("reports an unknown object with a hint", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "show", "Không có"])).toBe(1);
    const error = cli.errorJson().error;
    expect(error.type).toBe("UnknownObjectError");
    expect(error.hint).toContain("erp objects list");
  });
});

describe("schema dump", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("prints every object with its fields", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["schema", "dump"])).toBe(0);
    const dump = cli.json();
    expect(dump.objects[0]).toMatchObject({ name: "Hóa đơn" });
    expect(dump.objects[0].fields.map((f: { name: string }) => f.name)).toEqual(
      ["Trạng thái", "Tổng tiền"],
    );
  });

  it("writes the dump to a file — the context an agent loads before writing code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "erp-dump-"));
    dirs.push(dir);
    const file = join(dir, "workspace.json");

    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["schema", "dump", "--out", file])).toBe(0);
    expect(cli.json()).toMatchObject({ written: file, objects: 1 });

    const written = JSON.parse(await readFile(file, "utf8")) as {
      objects: { name: string; fields: { name: string; type: string }[] }[];
    };
    expect(written.objects[0]?.fields[1]).toMatchObject({
      name: "Tổng tiền",
      type: "currency",
    });
  });
});

describe("doctor", () => {
  it("fails with hints when nothing is configured", async () => {
    const cli = harness({});
    const code = await cli.run(["doctor"], {
      ERP_BASE_URL: undefined,
      ERP_API_KEY: undefined,
    });
    expect(code).toBe(1);
    const report = cli.json();
    expect(report.ok).toBe(false);
    expect(report.checks.map((c: { name: string }) => c.name)).toEqual([
      "base-url",
      "credentials",
      "mode",
    ]);
    expect(report.checks[0].hint).toContain("ERP_BASE_URL");
  });

  it("reports the write mode, and fails on an ERP_ENV it does not know", async () => {
    const cli = harness({
      "GET /api/v1/iam/me/permissions": [],
      "GET /api/v1/objects": OBJECTS,
    });
    await cli.run(["doctor"], { ERP_ENV: "development" });
    const dev = (cli.json().checks as { name: string; detail: string }[]).find(
      (check) => check.name === "mode",
    );
    expect(dev?.detail).toContain("dry runs");

    const bad = harness({});
    expect(await bad.run(["doctor"], { ERP_ENV: "prodution" })).toBe(1);
    const check = (
      bad.json().checks as { name: string; status: string }[]
    ).find((c) => c.name === "mode");
    expect(check?.status).toBe("fail");
  });

  it("checks required permissions", async () => {
    const cli = harness({
      "GET /api/v1/iam/me/permissions": [
        {
          id: "p1",
          ruleId: "r1",
          resource: "object",
          action: "read",
          effect: "allow",
          scopeType: "all",
          scope: null,
          createdAt: "",
        },
      ],
      "GET /api/v1/objects": OBJECTS,
    });
    expect(await cli.run(["doctor", "--require", "object:record:create"])).toBe(
      1,
    );
    const checks = cli.json().checks as { name: string; status: string }[];
    expect(
      checks.find((check) => check.name === "permission object:record:create")
        ?.status,
    ).toBe("fail");
  });
});

describe("usage errors", () => {
  it("rejects unknown commands and flags", async () => {
    const cli = harness({});
    expect(await cli.run(["records", "query", "Hóa đơn"])).toBe(2);
    expect(cli.errorJson().error.type).toBe("UsageError");

    const other = harness(SCHEMA_ROUTES);
    expect(await other.run(["objects", "list", "--nope", "1"])).toBe(2);
    expect(other.errorJson().error.message).toContain("Unknown flag --nope");
  });

  it("explains missing credentials before making a request", async () => {
    const cli = harness(SCHEMA_ROUTES);
    expect(await cli.run(["objects", "list"], { ERP_API_KEY: undefined })).toBe(
      2,
    );
    expect(cli.errorJson().error.message).toContain("Missing credentials");
    expect(cli.calls).toHaveLength(0);
  });
});

describe("scaffolding", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function temp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "erp-cli-"));
    dirs.push(dir);
    return dir;
  }

  it("writes a runnable mini app that declares its tables", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(
      await cli.run([
        "init",
        join(dir, "don-xin-nghi"),
        "--name",
        "Đơn xin nghỉ",
      ]),
    ).toBe(0);

    const result = cli.json();
    expect(result.files).toContain("server.js");
    expect(result.files).toContain("schema.json");

    const declaration = JSON.parse(
      await readFile(join(dir, "don-xin-nghi", "schema.json"), "utf8"),
    ) as { objects: { name: string }[] };
    expect(declaration.objects[0]?.name).toBe("Đơn xin nghỉ");
    const manifest = JSON.parse(
      await readFile(join(dir, "don-xin-nghi", "package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(manifest.name).toBe("don-xin-nghi");
    expect(manifest.dependencies["erp-sdk"]).toBeTruthy();

    const server = await readFile(
      join(dir, "don-xin-nghi", "server.js"),
      "utf8",
    );
    expect(server).toContain('const OBJECT_NAME = "Đơn xin nghỉ"');
    expect(server).toContain("app.session(initData)");

    // Second run must not clobber files silently.
    expect(await cli.run(["init", join(dir, "don-xin-nghi")])).toBe(2);
  });

  it("installs every bundled skill", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(
      await cli.run(["skill", "install", "--dir", join(dir, "skills")]),
    ).toBe(0);

    const names = cli
      .json()
      .skills.map((s: { skill: string }) => s.skill)
      .sort();
    expect(names).toEqual(["erp-data", "erp-miniapp", "erp-workflow"]);
    for (const name of names) {
      const skill = await readFile(
        join(dir, "skills", name, "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain(`name: ${name}`);
    }

    expect(
      await cli.run(["skill", "install", "--dir", join(dir, "skills")]),
    ).toBe(2);
    expect(
      await cli.run([
        "skill",
        "install",
        "--dir",
        join(dir, "skills"),
        "--force",
      ]),
    ).toBe(0);
  });

  it("installs one skill on request, and rejects a name it does not ship", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(
      await cli.run([
        "skill",
        "install",
        "--skill",
        "erp-data",
        "--dir",
        join(dir, "skills"),
      ]),
    ).toBe(0);
    expect(cli.json().skills).toHaveLength(1);

    const bad = harness({});
    expect(
      await bad.run([
        "skill",
        "install",
        "--skill",
        "erp-nope",
        "--dir",
        join(dir, "skills"),
      ]),
    ).toBe(2);
    expect(bad.errorJson().error.message).toContain("erp-data");
  });

  it("refuses a colliding install without writing anything", async () => {
    const dir = await temp();
    const cli = harness({});
    // Only erp-data is present, so a full install collides on it. The other
    // skill must not be written while the run is being refused.
    expect(
      await cli.run([
        "skill",
        "install",
        "--skill",
        "erp-data",
        "--dir",
        join(dir, "skills"),
      ]),
    ).toBe(0);

    const second = harness({});
    expect(
      await second.run(["skill", "install", "--dir", join(dir, "skills")]),
    ).toBe(2);
    await expect(
      readFile(join(dir, "skills", "erp-miniapp", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("tells every agent how to reach the installed copies", async () => {
    const dir = await temp();
    const cli = harness({});
    expect(
      await cli.run(["skill", "install", "--dir", join(dir, "skills")]),
    ).toBe(0);

    const result = cli.json();
    expect(result.root).toBe(join(dir, "skills"));
    const wiring = result.wiring as { agent: string; how: string }[];
    // Only Claude Code autoloads a SKILL.md, and only from its own directory —
    // so every skill needs its own symlink.
    const claude = wiring.find((w) => w.agent === "claude")?.how ?? "";
    expect(claude).toContain("~/.claude/skills/erp-data");
    expect(claude).toContain("~/.claude/skills/erp-miniapp");
    expect(claude).toContain("~/.claude/skills/erp-workflow");
    // Everything else reads AGENTS.md, so it gets a pointer at the same files.
    const shared = wiring.find((w) => w.agent.includes("codex"))?.how ?? "";
    expect(shared).toContain("AGENTS.md");
    expect(shared).toContain("SKILL.md");
    expect(cli.err()).toContain("Point your agents at it:");
  });

  it("points at the bundled skills in place", async () => {
    const cli = harness({});
    expect(await cli.run(["skill", "path"])).toBe(0);
    const skills = cli.json().skills as { skill: string; entry: string }[];
    expect(skills.map((s) => s.skill).sort()).toEqual([
      "erp-data",
      "erp-miniapp",
      "erp-workflow",
    ]);
    expect(skills[0]?.entry).toMatch(/erp-data[\\/]SKILL\.md$/);
  });
});
