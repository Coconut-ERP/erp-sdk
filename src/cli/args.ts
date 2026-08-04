/**
 * Tiny argv parser. Deliberately dependency-free and predictable:
 * `--flag value`, `--flag=value`, `--flag` (boolean), `--no-flag` (false),
 * repeatable flags collect into a list, `--` ends flag parsing.
 */

export class UsageError extends Error {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
    this.name = "UsageError";
  }
}

export type FlagValue = string[] | boolean;

export interface ParsedArgs {
  positional: string[];
  flags: Map<string, FlagValue>;
}

const ALIASES: Record<string, string> = {
  h: "help",
  v: "version",
  w: "where",
  f: "field",
  s: "set",
};

export function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, FlagValue>();
  let literal = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (literal || token === "-" || !token.startsWith("-")) {
      positional.push(token);
      continue;
    }
    if (token === "--") {
      literal = true;
      continue;
    }

    const dashless = token.replace(/^--?/, "");
    const eq = dashless.indexOf("=");
    let name = eq === -1 ? dashless : dashless.slice(0, eq);
    let inline = eq === -1 ? undefined : dashless.slice(eq + 1);

    name = ALIASES[name] ?? name;

    if (inline === undefined && name.startsWith("no-")) {
      flags.set(name.slice(3), false);
      continue;
    }

    if (inline === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && (next === "-" || !next.startsWith("-"))) {
        inline = next;
        i++;
      }
    }

    if (inline === undefined) {
      flags.set(name, true);
      continue;
    }

    const existing = flags.get(name);
    if (Array.isArray(existing)) existing.push(inline);
    else flags.set(name, [inline]);
  }

  return { positional, flags };
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.flags.get(name);
  return Array.isArray(value) ? value : [];
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  if (value === false) return undefined;
  return value[value.length - 1];
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  const value = args.flags.get(name);
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  const last = value[value.length - 1];
  return last !== "false" && last !== "0";
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new UsageError(`--${name} must be a number, got "${raw}"`);
  }
  return value;
}

export function flagJson(
  args: ParsedArgs,
  name: string,
): Record<string, unknown> | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(
      `--${name} must be valid JSON: ${(error as Error).message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UsageError(`--${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
