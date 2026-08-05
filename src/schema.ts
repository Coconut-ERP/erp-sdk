/**
 * `schema.json` — what a mini app declares it needs from the workspace.
 *
 * A mini app cannot create objects or fields any more: it ships a `schema.json`
 * at the root of its source, and whoever deploys it reviews the declaration and
 * applies it under *their own* authority. Everything here mirrors the backend
 * rules so a developer can catch a bad declaration before uploading the zip.
 */

/** File name the backend looks for at the root of the uploaded source. */
export const SCHEMA_FILE = "schema.json";

export const MAX_SCHEMA_BYTES = 256 * 1024;
export const MAX_SCHEMA_OBJECTS = 50;
export const MAX_SCHEMA_FIELDS = 200;
export const MAX_NAME_LENGTH = 255;

/** Every field type the object engine supports. */
export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "percent",
  "checkbox",
  "date",
  "datetime",
  "single_select",
  "multi_select",
  "url",
  "email",
  "phone",
  "relation",
  "lookup",
  "rollup",
  "formula",
  "attachment",
] as const;

/**
 * Computed types cannot be declared: their config points at other fields by
 * internal key, which the app cannot know. Create them by hand in the workspace.
 */
export const COMPUTED_FIELD_TYPES = ["formula", "lookup", "rollup"] as const;

/** Types a `schema.json` may declare. */
export const DECLARABLE_FIELD_TYPES = FIELD_TYPES.filter(
  (type) => !(COMPUTED_FIELD_TYPES as readonly string[]).includes(type),
);

export type FieldType = (typeof FIELD_TYPES)[number];
export type ComputedFieldType = (typeof COMPUTED_FIELD_TYPES)[number];
export type DeclarableFieldType = Exclude<FieldType, ComputedFieldType>;

export interface SchemaFieldSpec {
  name: string;
  /** One of `DECLARABLE_FIELD_TYPES` — editors suggest them, unknown strings still type-check. */
  type: DeclarableFieldType | (string & {});
  /** Same config as `POST /objects/:id/fields` — except relations, which name their target with `targetObject`. */
  config?: Record<string, unknown>;
  position?: number;
}

export interface SchemaObjectSpec {
  name: string;
  position?: number;
  fields?: SchemaFieldSpec[];
}

/** The content of `schema.json`. */
export interface MiniAppSchema {
  objects: SchemaObjectSpec[];
}

/** Where an app stands with its declaration — mirrors `MiniApp.schemaStatus`. */
export type SchemaStatus =
  /** The source carries no `schema.json`; the app deploys as before. */
  | "none"
  /** Waiting for a review — the backend queued no build. */
  | "pending"
  /** Reviewed (or the workspace already matched) — deploys normally. */
  | "applied";

/** What applying the declaration would do to one object or field. */
export type SchemaAction =
  /** Missing — will be created. */
  | "create"
  /** Objects only: the table exists but some of its fields do not. */
  | "update"
  /** Already there, untouched. */
  | "unchanged"
  /** Fields only: same name, different type — a human has to resolve it. */
  | "conflict";

export interface SchemaFieldPlan {
  name: string;
  type: string;
  action: SchemaAction;
  /** Only on `conflict`: the type the workspace currently holds. */
  currentType?: string;
}

export interface SchemaObjectPlan {
  name: string;
  action: SchemaAction;
  fields: SchemaFieldPlan[];
}

/** Body of `GET /mini-apps/:appId/schema`. */
export interface MiniAppSchemaPlan {
  miniAppId: string;
  status: SchemaStatus;
  objects: SchemaObjectPlan[];
}

/** An object as it exists in the workspace, reduced to what a diff needs. */
export interface WorkspaceObjectShape {
  name: string;
  fields: { name: string; type: string }[];
}

/** Types the SDK helper accepts as a declaration source. */
export type SchemaInput = MiniAppSchema | { objects?: unknown } | unknown;

const ROOT_KEYS = new Set(["objects"]);
const OBJECT_KEYS = new Set(["name", "position", "fields"]);
const FIELD_KEYS = new Set(["name", "type", "config", "position"]);

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function unknownKeys(value: object, allowed: Set<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkName(value: unknown, where: string, problems: string[]): string {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${where} needs a non-empty "name"`);
    return "";
  }
  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    problems.push(`${where}: name is longer than ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function checkPosition(value: unknown, where: string, problems: string[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    problems.push(`${where}: "position" must be an integer >= 0`);
  }
}

/** The target object a relation field points at, by display name. */
export function relationTarget(field: SchemaFieldSpec): string {
  const target = field.config?.targetObject;
  return typeof target === "string" ? target.trim() : "";
}

/**
 * Checks a declaration against the rules the backend applies when the zip is
 * uploaded. Returns the problems it found — empty means the file is accepted.
 *
 * This is a pure, offline check: whether the workspace *already* holds those
 * tables is a separate question, answered by {@link planSchema}.
 */
export function validateSchema(schema: SchemaInput): string[] {
  const problems: string[] = [];
  if (!isRecord(schema)) {
    return [`${SCHEMA_FILE} must be a JSON object with an "objects" array`];
  }
  for (const key of unknownKeys(schema, ROOT_KEYS)) {
    problems.push(`${SCHEMA_FILE} has an unknown key "${key}"`);
  }

  const objects = schema.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    problems.push(`${SCHEMA_FILE} declares no objects`);
    return problems;
  }
  if (objects.length > MAX_SCHEMA_OBJECTS) {
    problems.push(
      `${SCHEMA_FILE} declares more than ${MAX_SCHEMA_OBJECTS} objects`,
    );
  }

  const seenObjects = new Set<string>();
  objects.forEach((raw, index) => {
    const where = `Object #${index + 1}`;
    if (!isRecord(raw)) {
      problems.push(`${where} in ${SCHEMA_FILE} is not an object`);
      return;
    }
    for (const key of unknownKeys(raw, OBJECT_KEYS)) {
      problems.push(`${where} has an unknown key "${key}"`);
    }

    const object = raw as unknown as SchemaObjectSpec;
    const name = checkName(object.name, where, problems);
    checkPosition(object.position, `Object "${name || index + 1}"`, problems);
    if (name) {
      if (seenObjects.has(lower(name))) {
        problems.push(`${SCHEMA_FILE} declares object "${name}" twice`);
      }
      seenObjects.add(lower(name));
    }

    const fields = object.fields ?? [];
    if (!Array.isArray(fields)) {
      problems.push(`Object "${name}": "fields" must be an array`);
      return;
    }
    if (fields.length > MAX_SCHEMA_FIELDS) {
      problems.push(
        `Object "${name}" declares more than ${MAX_SCHEMA_FIELDS} fields`,
      );
    }
    checkFields(name, fields, problems);
  });

  return problems;
}

function checkFields(
  objectName: string,
  fields: unknown[],
  problems: string[],
): void {
  const seen = new Set<string>();
  fields.forEach((raw, index) => {
    const where = `Field #${index + 1} of "${objectName}"`;
    if (!isRecord(raw)) {
      problems.push(`${where} is not an object`);
      return;
    }
    for (const key of unknownKeys(raw, FIELD_KEYS)) {
      problems.push(`${where} has an unknown key "${key}"`);
    }

    const field = raw as unknown as SchemaFieldSpec;
    const name = checkName(field.name, where, problems);
    checkPosition(field.position, `Field "${name || index + 1}"`, problems);
    if (name) {
      if (seen.has(lower(name))) {
        problems.push(`Object "${objectName}" declares field "${name}" twice`);
      }
      seen.add(lower(name));
    }

    if (field.config !== undefined && !isRecord(field.config)) {
      problems.push(`${where}: "config" must be an object`);
    }

    const label = name ? `Field "${name}" of "${objectName}"` : where;
    if (typeof field.type !== "string" || field.type === "") {
      problems.push(`${label} needs a "type"`);
      return;
    }
    if (!(FIELD_TYPES as readonly string[]).includes(field.type)) {
      problems.push(`${label} has unsupported type "${field.type}"`);
      return;
    }
    if ((COMPUTED_FIELD_TYPES as readonly string[]).includes(field.type)) {
      problems.push(
        `${label}: ${field.type} fields are computed from other fields and cannot be declared in ${SCHEMA_FILE}`,
      );
      return;
    }
    if (field.type === "relation" && !relationTarget(field)) {
      problems.push(
        `Relation field "${name}" of "${objectName}" needs config.targetObject naming the object it points at`,
      );
    }
  });
}

/**
 * Serialised size of the declaration, in bytes — the backend rejects anything
 * over {@link MAX_SCHEMA_BYTES}.
 */
export function schemaSize(schema: MiniAppSchema): number {
  return new TextEncoder().encode(JSON.stringify(schema, null, 2)).length;
}

/**
 * Diffs a declaration against the workspace, the same way the review screen
 * does: name-and-type comparison, case-insensitive, additive only.
 */
export function planSchema(
  schema: MiniAppSchema,
  workspace: WorkspaceObjectShape[],
): SchemaObjectPlan[] {
  const existing = new Map<string, Map<string, string>>();
  for (const object of workspace) {
    const types = new Map<string, string>();
    for (const field of object.fields) types.set(lower(field.name), field.type);
    existing.set(lower(object.name), types);
  }

  return schema.objects.map((declared) => {
    const types = existing.get(lower(declared.name));
    const plan: SchemaObjectPlan = {
      name: declared.name,
      action: types ? "unchanged" : "create",
      fields: [],
    };

    for (const field of declared.fields ?? []) {
      const current = types?.get(lower(field.name));
      const item: SchemaFieldPlan = {
        name: field.name,
        type: field.type,
        action: current === undefined ? "create" : "unchanged",
      };
      if (current !== undefined && current !== field.type) {
        item.action = "conflict";
        item.currentType = current;
      }
      if (item.action !== "unchanged" && plan.action === "unchanged") {
        plan.action = "update";
      }
      plan.fields.push(item);
    }
    return plan;
  });
}

/** True when nothing would change — the backend deploys such an app straight away. */
export function schemaSettled(plans: SchemaObjectPlan[]): boolean {
  return plans.every((plan) => plan.action === "unchanged");
}

/** Human-readable conflicts, in the wording the apply endpoint uses. */
export function schemaConflicts(plans: SchemaObjectPlan[]): string[] {
  const conflicts: string[] = [];
  for (const plan of plans) {
    for (const field of plan.fields) {
      if (field.action === "conflict") {
        conflicts.push(
          `${plan.name}.${field.name} is ${field.currentType}, the app declares ${field.type}`,
        );
      }
    }
  }
  return conflicts;
}

/**
 * Relation targets that resolve to neither a declared nor an existing object.
 * Applying such a declaration fails with 400.
 */
export function unresolvedRelations(
  schema: MiniAppSchema,
  workspace: WorkspaceObjectShape[],
): string[] {
  const known = new Set<string>([
    ...schema.objects.map((object) => lower(object.name)),
    ...workspace.map((object) => lower(object.name)),
  ]);

  const problems: string[] = [];
  for (const object of schema.objects) {
    for (const field of object.fields ?? []) {
      if (field.type !== "relation") continue;
      const target = relationTarget(field);
      if (target && !known.has(lower(target))) {
        problems.push(
          `Relation field "${field.name}" of "${object.name}" points at "${target}", which is neither declared nor in the workspace`,
        );
      }
    }
  }
  return problems;
}

/**
 * Types a declaration written in TypeScript, so the app and its `schema.json`
 * can be generated from one source. Pure identity at runtime.
 */
export function defineSchema(schema: MiniAppSchema): MiniAppSchema {
  return schema;
}
