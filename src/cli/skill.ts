import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./args";

export const SKILL_NAME = "erp-data";

/**
 * One copy per machine, in a directory that belongs to no single tool — Claude
 * Code, Codex, opencode and pi each get pointed at it rather than each holding
 * a copy that drifts from the others. {@link wiring} spells out how.
 */
export const DEFAULT_SKILLS_DIR = join(homedir(), ".agents", "skills");

/** `~` only expands in a shell, and `--dir "~/x"` from a script would otherwise create a folder named `~`. */
function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * The skill ships inside the package (`skills/`). Resolve it relative to this
 * module so it works from `dist/cli.js`, from `src/` in development, and from
 * `node_modules/erp-sdk` alike.
 */
export async function skillSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../skills", SKILL_NAME),
    resolve(here, "../../skills", SKILL_NAME),
    resolve(here, "../../../skills", SKILL_NAME),
  ];
  for (const candidate of candidates) {
    if (await exists(join(candidate, "SKILL.md"))) return candidate;
  }
  throw new Error(
    `Cannot locate the bundled "${SKILL_NAME}" skill (looked in: ${candidates.join(", ")})`,
  );
}

async function copyTree(from: string, to: string): Promise<string[]> {
  const copied: string[] = [];
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copied.push(...(await copyTree(source, target)));
    } else {
      await copyFile(source, target);
      copied.push(target);
    }
  }
  return copied;
}

export interface InstallSkillOptions {
  cwd: string;
  dir?: string;
  force?: boolean;
}

export interface InstallSkillResult {
  skill: string;
  dir: string;
  entry: string;
  files: string[];
  wiring: { agent: string; how: string }[];
}

/**
 * How each agent is told the skill exists. Only Claude Code loads a `SKILL.md`
 * on its own, and only from its own directory — hence the symlink. The rest
 * read `AGENTS.md`, so they get one line pointing at the same file.
 */
function wiring(entry: string, dir: string): { agent: string; how: string }[] {
  const home = homedir();
  const short = (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);
  return [
    {
      agent: "claude",
      how: `mkdir -p ~/.claude/skills && ln -sfn ${short(dir)} ~/.claude/skills/${SKILL_NAME}`,
    },
    {
      agent: "codex / opencode / pi",
      how:
        `add one line to AGENTS.md (repo root, or ~/.codex/AGENTS.md for all repos): ` +
        `"ERP data tasks (erp-sdk, object/field/record, ERP_API_KEY): read ${short(entry)} first."`,
    },
  ];
}

export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
  const source = await skillSource();
  const root = options.dir
    ? resolve(options.cwd, expandHome(options.dir))
    : DEFAULT_SKILLS_DIR;
  const target = join(root, SKILL_NAME);

  if (await exists(target)) {
    if (!options.force) {
      throw new UsageError(`${target} already exists — pass --force to overwrite`);
    }
    await rm(target, { recursive: true, force: true });
  }

  const files = await copyTree(source, target);
  const entry = join(target, "SKILL.md");
  return { skill: SKILL_NAME, dir: target, entry, files, wiring: wiring(entry, target) };
}
