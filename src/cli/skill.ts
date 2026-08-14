import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./args";

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

/** Directories under `root` that actually carry a `SKILL.md`, alphabetically. */
async function listSkillNames(root: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (await exists(join(root, entry.name, "SKILL.md"))) {
        names.push(entry.name);
      }
    }
  } catch {
    return [];
  }
  return names.sort();
}

/**
 * The skills ship inside the package (`skills/`). Resolve that directory
 * relative to this module so it works from `dist/cli.js`, from `src/` in
 * development, and from `node_modules/erp-sdk` alike.
 */
export async function skillsSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../skills"),
    resolve(here, "../../skills"),
    resolve(here, "../../../skills"),
  ];
  for (const candidate of candidates) {
    if ((await listSkillNames(candidate)).length > 0) return candidate;
  }
  throw new Error(
    `Cannot locate the bundled skills (looked in: ${candidates.join(", ")})`,
  );
}

/** Every skill this package ships, with where it lives and its entry point. */
export async function bundledSkills(): Promise<
  { skill: string; dir: string; entry: string }[]
> {
  const root = await skillsSource();
  return (await listSkillNames(root)).map((skill) => ({
    skill,
    dir: join(root, skill),
    entry: join(root, skill, "SKILL.md"),
  }));
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
  /** Install just this one. Omitted, every bundled skill is installed. */
  skill?: string;
}

export interface InstalledSkill {
  skill: string;
  dir: string;
  entry: string;
  files: string[];
}

export interface InstallSkillResult {
  root: string;
  skills: InstalledSkill[];
  wiring: { agent: string; how: string }[];
}

/**
 * How each agent is told the skills exist. Only Claude Code loads a `SKILL.md`
 * on its own, and only from its own directory — hence the symlinks. The rest
 * read `AGENTS.md`, so they get one line pointing at the same files.
 */
function wiring(
  installed: InstalledSkill[],
  root: string,
): { agent: string; how: string }[] {
  const home = homedir();
  const short = (path: string) =>
    path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  const links = installed
    .map((item) => `ln -sfn ${short(item.dir)} ~/.claude/skills/${item.skill}`)
    .join(" && ");
  const names = installed.map((item) => item.skill).join(", ");
  return [
    { agent: "claude", how: `mkdir -p ~/.claude/skills && ${links}` },
    {
      agent: "codex / opencode / pi",
      how:
        "add one line to AGENTS.md (repo root, or ~/.codex/AGENTS.md for all " +
        `repos): "ERP tasks (erp-sdk): read the SKILL.md files under ` +
        `${short(root)} first — ${names}."`,
    },
  ];
}

export async function installSkill(
  options: InstallSkillOptions,
): Promise<InstallSkillResult> {
  const available = await bundledSkills();
  const wanted = options.skill
    ? available.filter((item) => item.skill === options.skill)
    : available;
  if (wanted.length === 0) {
    throw new UsageError(
      `Unknown skill "${options.skill}". Bundled: ${available
        .map((item) => item.skill)
        .join(", ")}`,
    );
  }

  const root = options.dir
    ? resolve(options.cwd, expandHome(options.dir))
    : DEFAULT_SKILLS_DIR;
  const targets = wanted.map((item) => ({
    ...item,
    target: join(root, item.skill),
  }));

  // Every collision is resolved before anything is written, so a refused
  // install never leaves half the skills replaced and half stale.
  for (const item of targets) {
    if (!(await exists(item.target))) continue;
    if (!options.force) {
      throw new UsageError(
        `${item.target} already exists — pass --force to overwrite`,
      );
    }
    await rm(item.target, { recursive: true, force: true });
  }

  const skills: InstalledSkill[] = [];
  for (const item of targets) {
    const files = await copyTree(item.dir, item.target);
    skills.push({
      skill: item.skill,
      dir: item.target,
      entry: join(item.target, "SKILL.md"),
      files,
    });
  }
  return { root, skills, wiring: wiring(skills, root) };
}
