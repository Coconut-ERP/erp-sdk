import type { ErpClient } from "../client";
import { ErpApiError } from "../errors";
import { ERP_ENV_VAR, resolveMode } from "../mode";
import type { ObjectHandle } from "../objects";
import { SCHEMA_FILE } from "../schema";
import type { FieldDto } from "../types";
import { flagBool, flagList, flagString, UsageError, type ParsedArgs } from "./args";
import { scaffoldMiniApp } from "./scaffold";
import { installSkill, skillSource, SKILL_NAME } from "./skill";

export interface CliContext {
  args: ParsedArgs;
  /** Positional arguments after the command path. */
  rest: string[];
  client: () => Promise<ErpClient>;
  /** Structured result — stdout, JSON. */
  out: (data: unknown) => void;
  /** Human note — stderr, so stdout stays machine-readable. */
  note: (message: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface FlagSpec {
  name: string;
  value?: string;
  repeatable?: boolean;
  description: string;
}

export interface CommandSpec {
  /** Space-separated path, e.g. "objects show". */
  name: string;
  summary: string;
  args?: { name: string; required?: boolean; description: string }[];
  flags?: FlagSpec[];
  examples?: string[];
  run(ctx: CliContext): Promise<void>;
}

function requireArg(ctx: CliContext, index: number, name: string): string {
  const value = ctx.rest[index];
  if (value === undefined || value === "") {
    throw new UsageError(`Missing required argument <${name}>`);
  }
  return value;
}

function describeField(field: FieldDto) {
  return {
    key: field.key,
    name: field.name,
    type: field.type,
    config: field.config ?? {},
    position: field.position,
    isArchived: field.isArchived,
  };
}

function describeObject(handle: ObjectHandle) {
  return {
    id: handle.id,
    name: handle.name,
    fields: handle.fields.map(describeField),
  };
}

/**
 * The CLI is deliberately small: it sets an environment up (`init`, `skill
 * install`), proves the credentials work (`doctor`, `whoami`) and prints the
 * real object/field names an agent needs before writing code (`objects …`,
 * `schema dump`). Everything else — reading, writing and analysing records —
 * is the SDK's job, so it happens in a script instead of a shell one-liner.
 */
export const COMMANDS: CommandSpec[] = [
  {
    name: "whoami",
    summary: "Show who the current credentials act as, and what they may do",
    examples: ["erp whoami"],
    async run(ctx) {
      const client = await ctx.client();
      const permissions = await client.myPermissions();
      let user: unknown = null;
      let userError: string | undefined;
      try {
        user = await client.me();
      } catch (error) {
        // Service-account keys have no /users/me — not an error worth failing on.
        userError = (error as Error).message;
      }
      const apiKey = flagString(ctx.args, "api-key") ?? ctx.env.ERP_API_KEY;
      ctx.out({
        baseUrl: flagString(ctx.args, "base-url") ?? ctx.env.ERP_BASE_URL ?? null,
        auth: apiKey ? "api-key" : "access-token",
        mode: client.mode,
        dryRunWrites: client.dryRun,
        user,
        userError,
        permissions: permissions.map((p) => ({
          resource: p.resource,
          action: p.action,
          effect: p.effect,
          objectId: p.objectId,
          scopeType: p.scopeType,
        })),
      });
    },
  },
  {
    name: "doctor",
    summary: "Diagnose connection, credentials and required permissions",
    flags: [
      {
        name: "require",
        value: "resource:action",
        repeatable: true,
        description: "Also check that this permission is granted",
      },
    ],
    examples: [
      "erp doctor",
      'erp doctor --require object:read --require object:record:create',
    ],
    async run(ctx) {
      const checks: {
        name: string;
        status: "ok" | "fail";
        detail: string;
        hint?: string;
      }[] = [];

      const baseUrl = flagString(ctx.args, "base-url") ?? ctx.env.ERP_BASE_URL;
      checks.push(
        baseUrl
          ? { name: "base-url", status: "ok", detail: baseUrl }
          : {
              name: "base-url",
              status: "fail",
              detail: "not set",
              hint: "export ERP_BASE_URL=http://localhost:8000 (or pass --base-url)",
            },
      );

      const apiKey = flagString(ctx.args, "api-key") ?? ctx.env.ERP_API_KEY;
      const token = flagString(ctx.args, "token") ?? ctx.env.ERP_ACCESS_TOKEN;
      checks.push(
        apiKey || token
          ? {
              name: "credentials",
              status: "ok",
              detail: apiKey
                ? `API key (${apiKey.slice(0, 7)}…)`
                : "user access token",
            }
          : {
              name: "credentials",
              status: "fail",
              detail: "no ERP_API_KEY / ERP_ACCESS_TOKEN",
              hint: "export ERP_API_KEY=erp_sk_… (issued from IAM service accounts)",
            },
      );

      // Decided before the mode check so a bad ERP_ENV still gets diagnosed
      // alongside connectivity instead of hiding it.
      const canConnect = checks.every((check) => check.status === "ok");

      try {
        const mode = resolveMode(ctx.env);
        checks.push({
          name: "mode",
          status: "ok",
          detail:
            mode === "development"
              ? `${ERP_ENV_VAR}=development — record writes run as dry runs and roll back`
              : `production${ctx.env[ERP_ENV_VAR] ? "" : ` (${ERP_ENV_VAR} not set)`} — writes are real`,
          hint:
            mode === "development"
              ? "Set ERP_ENV=production (or pass { dryRun: false }) to write for real"
              : undefined,
        });
      } catch (error) {
        checks.push({
          name: "mode",
          status: "fail",
          detail: (error as Error).message,
          hint: `${ERP_ENV_VAR} takes "production" or "development"`,
        });
      }

      let client: ErpClient | undefined;
      if (canConnect) {
        try {
          client = await ctx.client();
          const permissions = await client.myPermissions();
          checks.push({
            name: "connection",
            status: "ok",
            detail: `${permissions.length} effective permission(s)`,
          });
        } catch (error) {
          const message =
            error instanceof ErpApiError
              ? `HTTP ${error.status}: ${error.message}`
              : (error as Error).message;
          checks.push({
            name: "connection",
            status: "fail",
            detail: message,
            hint: "Check ERP_BASE_URL is reachable and the key is valid and not rotated",
          });
        }
      }

      if (client) {
        try {
          const objects = await client.objects();
          checks.push({
            name: "objects",
            status: "ok",
            detail: `${objects.length} object(s) visible`,
            hint: objects.length === 0 ? "The key may lack object:read, or the workspace is empty" : undefined,
          });
        } catch (error) {
          checks.push({
            name: "objects",
            status: "fail",
            detail: (error as Error).message,
            hint: "Grant object:read to the service account",
          });
        }

        for (const required of flagList(ctx.args, "require")) {
          const separator = required.lastIndexOf(":");
          if (separator <= 0) {
            throw new UsageError(`--require must be "resource:action", got "${required}"`);
          }
          const resource = required.slice(0, separator);
          const action = required.slice(separator + 1);
          const allowed = await client.can(resource, action);
          checks.push({
            name: `permission ${resource}:${action}`,
            status: allowed ? "ok" : "fail",
            detail: allowed ? "granted" : "not granted",
            hint: allowed ? undefined : `Add an IAM allow rule for ${resource}:${action}`,
          });
        }
      }

      const ok = checks.every((check) => check.status === "ok");
      ctx.out({ ok, checks });
      if (!ok) throw new ExitCode(1);
    },
  },
  {
    name: "objects list",
    summary: "List the objects (tables) in the workspace",
    flags: [{ name: "fields", description: "Include each object's fields (one request per object)" }],
    examples: ["erp objects list", "erp objects list --fields"],
    async run(ctx) {
      const client = await ctx.client();
      const objects = await client.objects();
      if (!flagBool(ctx.args, "fields")) {
        ctx.out(objects.map((o) => ({ id: o.id, name: o.name, position: o.position })));
        return;
      }
      const detailed = [];
      for (const object of objects) {
        detailed.push(describeObject(await client.object(object.id)));
      }
      ctx.out(detailed);
    },
  },
  {
    name: "objects show",
    summary: "Show one object with all of its fields (types + config)",
    args: [{ name: "object", required: true, description: "Object name or id" }],
    examples: ['erp objects show "Đơn xin nghỉ"'],
    async run(ctx) {
      const client = await ctx.client();
      ctx.out(describeObject(await client.object(requireArg(ctx, 0, "object"))));
    },
  },
  {
    name: "schema dump",
    summary: "Dump every object + field as JSON — the context an agent needs before writing code",
    flags: [{ name: "out", value: "file", description: "Write to a file instead of stdout" }],
    examples: ["erp schema dump", "erp schema dump --out workspace.json"],
    async run(ctx) {
      const client = await ctx.client();
      const objects = await client.objects();
      const schema = { objects: [] as ReturnType<typeof describeObject>[] };
      for (const object of objects) {
        schema.objects.push(describeObject(await client.object(object.id)));
      }
      const file = flagString(ctx.args, "out");
      if (file) {
        const { writeFile } = await import("node:fs/promises");
        const { resolve } = await import("node:path");
        const target = resolve(ctx.cwd, file);
        await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
        ctx.out({ written: target, objects: schema.objects.length });
        return;
      }
      ctx.out(schema);
    },
  },
  {
    name: "init",
    summary: `Scaffold a runnable mini app (Express + initData bridge + ${SCHEMA_FILE})`,
    args: [{ name: "dir", description: "Target directory (default: current directory)" }],
    flags: [
      { name: "name", value: "text", description: "App display name" },
      {
        name: "object",
        value: "text",
        description: `Object the app declares in ${SCHEMA_FILE} and reads/writes`,
      },
      {
        name: "sdk",
        value: "spec",
        description: "erp-sdk dependency spec (default: the pinned release tarball URL)",
      },
      { name: "force", description: "Overwrite existing files" },
    ],
    examples: ['erp init my-app --name "Đơn xin nghỉ" --object "Đơn xin nghỉ"'],
    async run(ctx) {
      const result = await scaffoldMiniApp({
        cwd: ctx.cwd,
        dir: ctx.rest[0] ?? ".",
        appName: flagString(ctx.args, "name"),
        objectName: flagString(ctx.args, "object"),
        sdkSpec: flagString(ctx.args, "sdk"),
        force: flagBool(ctx.args, "force"),
      });
      ctx.note(`Scaffolded ${result.files.length} files in ${result.dir}`);
      ctx.note(
        `Edit ${SCHEMA_FILE} to declare the tables this app needs, then check it with ` +
          `validateSchema()/planSchema() from erp-sdk`,
      );
      ctx.note("Next: npm install && ERP_BASE_URL=… ERP_API_KEY=… npm start");
      ctx.out(result);
    },
  },
  {
    name: "skill install",
    summary: `Install the ${SKILL_NAME} skill so coding agents know this SDK`,
    flags: [
      {
        name: "dir",
        value: "path",
        description: `Where to install it (default ~/.agents/skills — shared by every agent)`,
      },
      { name: "force", description: "Overwrite an existing installation" },
    ],
    examples: [
      "erp skill install",
      "erp skill install --dir .claude/skills",
      "erp skill install --force",
    ],
    async run(ctx) {
      const result = await installSkill({
        cwd: ctx.cwd,
        dir: flagString(ctx.args, "dir"),
        force: flagBool(ctx.args, "force"),
      });
      ctx.note(`Installed skill "${result.skill}" to ${result.dir}`);
      ctx.note("Point your agents at it:");
      for (const { agent, how } of result.wiring) ctx.note(`  ${agent}: ${how}`);
      ctx.out(result);
    },
  },
  {
    name: "skill path",
    summary: "Print where the bundled skill lives, so an agent can read it in place",
    examples: ["erp skill path"],
    async run(ctx) {
      const dir = await skillSource();
      const { join } = await import("node:path");
      ctx.out({ skill: SKILL_NAME, dir, entry: join(dir, "SKILL.md") });
    },
  },
];

/** Thrown to end the process with a specific status without printing twice. */
export class ExitCode extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
    this.name = "ExitCode";
  }
}

/** Longest command path first, so "objects show" beats a hypothetical "objects". */
export function matchCommand(
  positional: string[],
): { command: CommandSpec; rest: string[] } | undefined {
  for (const length of [2, 1]) {
    const path = positional.slice(0, length).join(" ");
    const command = COMMANDS.find((candidate) => candidate.name === path);
    if (command) return { command, rest: positional.slice(length) };
  }
  return undefined;
}
