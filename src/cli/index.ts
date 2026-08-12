import { createMiniApp, type ErpClient } from "../client";
import {
  ErpApiError,
  FilterValueError,
  MissingPermissionsError,
  SchemaMismatchError,
  UnknownFieldError,
  UnknownObjectError,
} from "../errors";
import { flagBool, flagString, parseArgv, UsageError, type ParsedArgs } from "./args";
import { COMMANDS, ExitCode, matchCommand, type CliContext, type CommandSpec } from "./commands";
import { GLOBAL_FLAGS, helpJson, helpText } from "./help";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  fetch?: typeof globalThis.fetch;
}

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof UsageError) {
    return { type: "UsageError", message: error.message, hint: "Run `erp help <command>`" };
  }
  if (error instanceof MissingPermissionsError) {
    return {
      type: "MissingPermissionsError",
      message: error.message,
      missing: error.missing,
      hint: "Add IAM allow rules for the listed resource:action pairs",
    };
  }
  if (error instanceof UnknownObjectError) {
    return {
      type: "UnknownObjectError",
      message: error.message,
      object: error.object,
      hint: "Run `erp objects list` to see what exists",
    };
  }
  if (error instanceof SchemaMismatchError) {
    return {
      type: "SchemaMismatchError",
      message: error.message,
      missing: error.missing,
      conflicts: error.conflicts,
      hint:
        "Compare the declaration with `erp schema dump`, or diff it in code with " +
        "planSchema() from erp-sdk; applying it is the deployer's step",
    };
  }
  if (error instanceof FilterValueError) {
    return {
      type: "FilterValueError",
      message: error.message,
      field: error.field,
      operator: error.operator,
      hint: "in/not_in take an array of 1..200 values: .whereIn(field, [a, b])",
    };
  }
  if (error instanceof UnknownFieldError) {
    return {
      type: "UnknownFieldError",
      message: error.message,
      field: error.field,
      object: error.objectName,
      known: error.known,
    };
  }
  if (error instanceof ErpApiError) {
    return {
      type: "ErpApiError",
      message: error.message,
      status: error.status,
      trace: error.trace,
      details: error.details,
      hint:
        error.status === 401 || error.status === 403
          ? "Check the API key and its IAM rules (`erp doctor`)"
          : undefined,
    };
  }
  const known = error as Error;
  return { type: known?.name ?? "Error", message: known?.message ?? String(error) };
}

function knownFlagNames(command?: CommandSpec): Set<string> {
  const names = new Set(GLOBAL_FLAGS.map((flag) => flag.name));
  names.add("env-file");
  names.add("json");
  for (const flag of command?.flags ?? []) names.add(flag.name);
  return names;
}

function assertKnownFlags(args: ParsedArgs, command?: CommandSpec): void {
  const known = knownFlagNames(command);
  for (const name of args.flags.keys()) {
    if (!known.has(name)) {
      throw new UsageError(
        `Unknown flag --${name}. Valid flags here: ${[...known].map((f) => `--${f}`).join(", ")}`,
      );
    }
  }
}

async function loadEnvFile(
  path: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  let content: string;
  try {
    content = await readFile(resolve(cwd, path), "utf8");
  } catch (error) {
    throw new UsageError(`Cannot read --env-file ${path}: ${(error as Error).message}`);
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    // Real environment wins — the file only fills in what is missing.
    if (env[key] === undefined) env[key] = value;
  }
}

async function readVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of ["../package.json", "../../package.json", "../../../package.json"]) {
      try {
        const raw = await readFile(resolve(here, candidate), "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === "erp-sdk" && parsed.version) return parsed.version;
      } catch {
        continue;
      }
    }
  } catch {
    // fall through
  }
  return "unknown";
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgv(argv);
  const env = { ...io.env };
  const compact = flagBool(args, "compact");

  const out = (data: unknown) => {
    io.stdout(`${JSON.stringify(data ?? null, null, compact ? 0 : 2)}\n`);
  };
  const note = (message: string) => io.stderr(`${message}\n`);

  try {
    const envFile = flagString(args, "env-file");
    if (envFile) await loadEnvFile(envFile, io.cwd, env);

    if (flagBool(args, "version")) {
      out({ name: "erp-sdk", version: await readVersion() });
      return EXIT_OK;
    }

    const positional = [...args.positional];
    const wantsHelp = flagBool(args, "help");

    if (positional[0] === "help" || (positional.length === 0 && !wantsHelp)) {
      if (positional[0] === "help") positional.shift();
      const target = matchCommand(positional)?.command;
      if (positional.length > 0 && !target) {
        throw new UsageError(`Unknown command "${positional.join(" ")}"`);
      }
      if (flagBool(args, "json")) out(helpJson(target));
      else io.stdout(helpText(target));
      return EXIT_OK;
    }

    const matched = matchCommand(positional);
    if (!matched) {
      if (wantsHelp && positional.length === 0) {
        io.stdout(helpText());
        return EXIT_OK;
      }
      const attempted = positional.join(" ");
      const near = COMMANDS.filter((command) => command.name.startsWith(positional[0] ?? ""))
        .map((command) => command.name)
        .slice(0, 6);
      throw new UsageError(
        `Unknown command "${attempted}".` +
          (near.length ? ` Did you mean: ${near.join(", ")}?` : " Run `erp help`."),
      );
    }

    const { command, rest } = matched;
    if (wantsHelp) {
      if (flagBool(args, "json")) out(helpJson(command));
      else io.stdout(helpText(command));
      return EXIT_OK;
    }

    assertKnownFlags(args, command);

    let cached: ErpClient | undefined;
    const client = async (): Promise<ErpClient> => {
      if (cached) return cached;
      const baseUrl = flagString(args, "base-url") ?? env.ERP_BASE_URL;
      if (!baseUrl) {
        throw new UsageError(
          "Missing ERP base URL — set ERP_BASE_URL, pass --base-url, or point --env-file at a .env",
        );
      }
      const apiKey = flagString(args, "api-key") ?? env.ERP_API_KEY;
      const accessToken = flagString(args, "token") ?? env.ERP_ACCESS_TOKEN;
      if (!apiKey && !accessToken) {
        throw new UsageError(
          "Missing credentials — set ERP_API_KEY (erp_sk_…) or ERP_ACCESS_TOKEN, or pass --api-key/--token",
        );
      }
      cached = await createMiniApp({
        baseUrl,
        apiKey,
        accessToken,
        workspaceId: flagString(args, "workspace") ?? env.ERP_WORKSPACE_ID,
        fetch: io.fetch,
      });
      return cached;
    };

    const context: CliContext = { args, rest, client, out, note, cwd: io.cwd, env };
    await command.run(context);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof ExitCode) return error.code;
    io.stderr(`${JSON.stringify({ error: serializeError(error) }, null, compact ? 0 : 2)}\n`);
    return error instanceof UsageError ? EXIT_USAGE : EXIT_ERROR;
  }
}
