/**
 * Which environment the SDK believes it is running in, and therefore whether a
 * record write actually lands.
 *
 * `production` (the default) writes for real. `development` turns every record
 * write into a server-side dry run: the backend runs the real statement —
 * validation, unique checks, version checks, relation ids, rules, computed
 * fields — inside a transaction it then rolls back. Same status, same error
 * message as the real call, no trace left behind.
 *
 * It exists so an agent can rehearse a script against real data before letting
 * it write, by flipping one environment variable instead of rewriting the code.
 */
export type ErpMode = "production" | "development";

/**
 * The only variable consulted. `NODE_ENV` is deliberately ignored: a mini app
 * running locally normally has `NODE_ENV=development`, and having every write
 * silently disappear in that setup is worse than an explicit opt-in.
 */
export const ERP_ENV_VAR = "ERP_ENV";

const MODES: Record<string, ErpMode> = {
  production: "production",
  prod: "production",
  live: "production",
  development: "development",
  dev: "development",
  "dry-run": "development",
  dryrun: "development",
};

function processEnv(): Record<string, string | undefined> {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env ?? {};
}

/**
 * Reads {@link ERP_ENV_VAR}; unset or empty means `production`.
 *
 * An unrecognised value throws rather than falling back, because the direction
 * of a wrong guess matters: a typo (`ERP_ENV=devlopment`) silently writing to
 * real data is exactly the accident this feature is meant to prevent.
 */
export function resolveMode(
  env: Record<string, string | undefined> = processEnv(),
): ErpMode {
  const raw = env[ERP_ENV_VAR]?.trim().toLowerCase();
  if (!raw) return "production";
  const mode = MODES[raw];
  if (!mode) {
    throw new Error(
      `${ERP_ENV_VAR}="${env[ERP_ENV_VAR]}" is not a known environment. ` +
        `Use "production" (writes for real, the default) or "development" ` +
        `(every record write runs as a server-side dry run).`,
    );
  }
  return mode;
}

/** True when writes should default to `dryRun: true`. */
export function isDryRunMode(mode: ErpMode): boolean {
  return mode === "development";
}
