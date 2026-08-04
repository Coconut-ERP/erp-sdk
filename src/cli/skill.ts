import { access, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./args";

export const SKILL_NAME = "erp-miniapp";
const DEFAULT_TARGET = ".claude/skills";

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
  files: string[];
}

export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
  const source = await skillSource();
  const root = resolve(options.cwd, options.dir ?? DEFAULT_TARGET);
  const target = join(root, SKILL_NAME);

  if (await exists(target)) {
    if (!options.force) {
      throw new UsageError(`${target} already exists — pass --force to overwrite`);
    }
    await rm(target, { recursive: true, force: true });
  }

  const files = await copyTree(source, target);
  return { skill: SKILL_NAME, dir: target, files };
}
