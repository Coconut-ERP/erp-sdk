import type { ErpClient } from "../client";
import { ErpApiError } from "../errors";
import type { ObjectHandle } from "../objects";
import type { Row } from "../frame";
import type { FieldDto, RecordDto } from "../types";
import {
  flagBool,
  flagJson,
  flagList,
  flagNumber,
  flagString,
  UsageError,
  type ParsedArgs,
} from "./args";
import { scaffoldMiniApp } from "./scaffold";
import { installSkill, skillSource, SKILL_NAME } from "./skill";
import {
  OPERATORS,
  parseAssignments,
  parseFieldSpec,
  parseFilter,
  parseSort,
} from "./values";

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
  /** Space-separated path, e.g. "records query". */
  name: string;
  summary: string;
  args?: { name: string; required?: boolean; description: string }[];
  flags?: FlagSpec[];
  examples?: string[];
  run(ctx: CliContext): Promise<void>;
}

const BY_FLAG: FlagSpec = {
  name: "by",
  value: "name|key",
  description: 'Column naming for rows: field display names (default) or field keys',
};
const RAW_FLAG: FlagSpec = {
  name: "raw",
  description: "Return the raw RecordDto (data keyed by field key, plus metadata)",
};
const YES_FLAG: FlagSpec = {
  name: "yes",
  description: "Confirm a destructive operation (required)",
};

function requireArg(ctx: CliContext, index: number, name: string): string {
  const value = ctx.rest[index];
  if (value === undefined || value === "") {
    throw new UsageError(`Missing required argument <${name}>`);
  }
  return value;
}

function rowNaming(ctx: CliContext): "name" | "key" {
  const by = flagString(ctx.args, "by") ?? "name";
  if (by !== "name" && by !== "key") {
    throw new UsageError(`--by must be "name" or "key", got "${by}"`);
  }
  return by;
}

function project(row: Row, select: string[]): Row {
  if (select.length === 0) return row;
  const picked: Row = {};
  for (const column of select) picked[column] = row[column];
  return picked;
}

function selectedColumns(ctx: CliContext): string[] {
  return flagList(ctx.args, "select").flatMap((value) =>
    value.split(",").map((column) => column.trim()).filter(Boolean),
  );
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

function payload(ctx: CliContext, handle: ObjectHandle): Row {
  const data = {
    ...(flagJson(ctx.args, "data") ?? {}),
    ...parseAssignments(flagList(ctx.args, "set")),
  };
  if (Object.keys(data).length === 0) {
    throw new UsageError(
      `No values given. Use --data '{"Field":"value"}' or --set "Field=value". ` +
        `Known fields on "${handle.name}": ${handle.fields.map((f) => f.name).join(", ")}`,
    );
  }
  return data;
}

function renderRecord(ctx: CliContext, handle: ObjectHandle, record: RecordDto): Row | RecordDto {
  if (flagBool(ctx.args, "raw")) return record;
  return handle.rowFromRecord(record, rowNaming(ctx));
}

function buildQuery(ctx: CliContext, handle: ObjectHandle) {
  const query = handle.records();
  for (const raw of flagList(ctx.args, "where")) {
    const filter = parseFilter(raw);
    query.where(filter.field, filter.operator, filter.value);
  }
  for (const raw of flagList(ctx.args, "sort")) {
    const sort = parseSort(raw);
    query.orderBy(sort.field, sort.direction);
  }
  return query;
}

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

      let client: ErpClient | undefined;
      if (checks.every((check) => check.status === "ok")) {
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
    name: "objects create",
    summary: "Create an empty object",
    args: [{ name: "name", required: true, description: "Display name" }],
    flags: [{ name: "position", value: "n", description: "Sort position (default 0)" }],
    examples: ['erp objects create "Đơn đặt hàng"'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.createObject(requireArg(ctx, 0, "name"), {
        position: flagNumber(ctx.args, "position"),
      });
      ctx.out(describeObject(handle));
    },
  },
  {
    name: "objects ensure",
    summary: "Idempotently create an object and any missing fields",
    args: [{ name: "name", required: true, description: "Display name" }],
    flags: [
      {
        name: "field",
        value: "Name:type[:config]",
        repeatable: true,
        description:
          'Field to ensure. config is JSON, or a comma list for selects: "Trạng thái:single_select:pending,approved"',
      },
    ],
    examples: [
      'erp objects ensure "Đơn xin nghỉ" --field "Lý do:long_text" --field "Từ ngày:date" --field "Trạng thái:single_select:pending,approved,rejected"',
    ],
    async run(ctx) {
      const client = await ctx.client();
      const fields = flagList(ctx.args, "field").map(parseFieldSpec);
      const handle = await client.ensureObject(requireArg(ctx, 0, "name"), fields);
      ctx.out(describeObject(handle));
    },
  },
  {
    name: "objects delete",
    summary: "Delete an object and its records",
    args: [{ name: "object", required: true, description: "Object name or id" }],
    flags: [YES_FLAG],
    examples: ['erp objects delete "Đơn hàng" --yes'],
    async run(ctx) {
      const nameOrId = requireArg(ctx, 0, "object");
      if (!flagBool(ctx.args, "yes")) {
        throw new UsageError(
          `Refusing to delete object "${nameOrId}" without --yes (this drops its records too)`,
        );
      }
      const client = await ctx.client();
      const handle = await client.object(nameOrId);
      await client.deleteObject(handle.id);
      ctx.out({ deleted: { id: handle.id, name: handle.name } });
    },
  },
  {
    name: "fields add",
    summary: "Add a field to an object",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "name", required: true, description: "Field display name" },
      { name: "type", required: true, description: "Field type (see `erp fields types`)" },
    ],
    flags: [
      { name: "config", value: "json", description: "Field config, e.g. select options" },
      { name: "position", value: "n", description: "Sort position" },
    ],
    examples: [
      'erp fields add "Đơn hàng" "Số lượng" number',
      `erp fields add "Đơn hàng" "Trạng thái" single_select --config '{"source":"static","options":["new","done"]}'`,
    ],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const field = await handle.addField(
        requireArg(ctx, 1, "name"),
        requireArg(ctx, 2, "type"),
        { config: flagJson(ctx.args, "config"), position: flagNumber(ctx.args, "position") },
      );
      ctx.out(describeField(field));
    },
  },
  {
    name: "fields update",
    summary: "Rename, reconfigure, archive or restore a field",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "field", required: true, description: "Field name or key" },
    ],
    flags: [
      { name: "name", value: "text", description: "New display name" },
      { name: "config", value: "json", description: "Replacement config" },
      { name: "position", value: "n", description: "New sort position" },
      { name: "archive", description: "Archive the field (--no-archive restores it)" },
    ],
    examples: ['erp fields update "Đơn hàng" "Số lượng" --name "SL"'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const changes: {
        name?: string;
        config?: Record<string, unknown>;
        position?: number;
        isArchived?: boolean;
      } = {
        name: flagString(ctx.args, "name"),
        config: flagJson(ctx.args, "config"),
        position: flagNumber(ctx.args, "position"),
      };
      if (ctx.args.flags.has("archive")) changes.isArchived = flagBool(ctx.args, "archive");
      for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
        if (changes[key] === undefined) delete changes[key];
      }
      if (Object.keys(changes).length === 0) {
        throw new UsageError("Nothing to update: pass --name, --config, --position or --archive");
      }
      ctx.out(describeField(await handle.updateField(requireArg(ctx, 1, "field"), changes)));
    },
  },
  {
    name: "fields types",
    summary: "List the field types the object engine supports",
    examples: ["erp fields types"],
    async run(ctx) {
      ctx.out(FIELD_TYPES);
    },
  },
  {
    name: "records query",
    summary: "Query records with server-side filters, sorting and pagination",
    args: [{ name: "object", required: true, description: "Object name or id" }],
    flags: [
      {
        name: "where",
        value: "Field:op:value",
        repeatable: true,
        description: `Filter. Shorthand "Field=value" means equals. Operators: ${OPERATORS.join(", ")}`,
      },
      { name: "sort", value: "Field:asc|desc", repeatable: true, description: "Sort (default asc)" },
      { name: "limit", value: "n", description: "Page size (server max 100)" },
      { name: "cursor", value: "c", description: "Continue from a previous nextCursor" },
      { name: "all", description: "Follow the cursor and return every match" },
      { name: "max", value: "n", description: "Cap for --all" },
      { name: "total", description: "Include the total match count" },
      { name: "select", value: "A,B", repeatable: true, description: "Only return these columns" },
      BY_FLAG,
      RAW_FLAG,
    ],
    examples: [
      'erp records query "Hóa đơn" --where "Trạng thái=approved" --sort "Tổng tiền:desc" --limit 20',
      'erp records query "Hóa đơn" --where "Tổng tiền:greater_than:1000000" --all',
    ],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const query = buildQuery(ctx, handle);

      const cursor = flagString(ctx.args, "cursor");
      if (cursor) query.cursor(cursor);
      const limit = flagNumber(ctx.args, "limit");
      if (limit !== undefined) query.limit(limit);

      const select = selectedColumns(ctx);
      const raw = flagBool(ctx.args, "raw");
      const by = rowNaming(ctx);
      const render = (record: RecordDto) =>
        raw ? record : project(handle.rowFromRecord(record, by), select);

      if (flagBool(ctx.args, "all")) {
        const records = await query.fetchAll({ max: flagNumber(ctx.args, "max") });
        ctx.out({ records: records.map(render), hasMore: false, count: records.length });
        return;
      }

      if (flagBool(ctx.args, "total")) query.withTotal();
      const page = await query.fetch();
      ctx.out({
        records: page.records.map(render),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        total: page.total,
        count: page.records.length,
      });
    },
  },
  {
    name: "records count",
    summary: "Count records matching a filter",
    args: [{ name: "object", required: true, description: "Object name or id" }],
    flags: [
      {
        name: "where",
        value: "Field:op:value",
        repeatable: true,
        description: "Filter (same syntax as `records query`)",
      },
    ],
    examples: ['erp records count "Đơn xin nghỉ" --where "Trạng thái=pending"'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const query = buildQuery(ctx, handle);
      ctx.out({ object: handle.name, count: await query.count() });
    },
  },
  {
    name: "records get",
    summary: "Read one record by id",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
    ],
    flags: [BY_FLAG, RAW_FLAG],
    examples: ['erp records get "Hóa đơn" 018f…'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const record = await handle.get(requireArg(ctx, 1, "id"));
      ctx.out(renderRecord(ctx, handle, record));
    },
  },
  {
    name: "records create",
    summary: "Create a record",
    args: [{ name: "object", required: true, description: "Object name or id" }],
    flags: [
      { name: "data", value: "json", description: "Field values keyed by display name or key" },
      { name: "set", value: "Field=value", repeatable: true, description: "Single field value" },
      BY_FLAG,
      RAW_FLAG,
    ],
    examples: [
      `erp records create "Đơn xin nghỉ" --set "Lý do=Việc gia đình" --set "Từ ngày=2026-08-03"`,
      `erp records create "Hóa đơn" --data '{"Tổng tiền":500000,"Trạng thái":"draft"}'`,
    ],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const record = await handle.create(payload(ctx, handle));
      ctx.out(renderRecord(ctx, handle, record));
    },
  },
  {
    name: "records update",
    summary: "Update a record (optimistic locking on version)",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
    ],
    flags: [
      { name: "data", value: "json", description: "Field values keyed by display name or key" },
      { name: "set", value: "Field=value", repeatable: true, description: "Single field value" },
      { name: "version", value: "n", description: "Expected version (default: read it first)" },
      BY_FLAG,
      RAW_FLAG,
    ],
    examples: ['erp records update "Đơn xin nghỉ" 018f… --set "Trạng thái=approved"'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const record = await handle.update(
        requireArg(ctx, 1, "id"),
        payload(ctx, handle),
        flagNumber(ctx.args, "version"),
      );
      ctx.out(renderRecord(ctx, handle, record));
    },
  },
  {
    name: "records delete",
    summary: "Soft-delete a record (undo with `records restore`)",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
    ],
    flags: [{ name: "version", value: "n", description: "Expected version" }],
    examples: ['erp records delete "Hóa đơn" 018f…'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const id = requireArg(ctx, 1, "id");
      await handle.delete(id, flagNumber(ctx.args, "version"));
      ctx.out({ deleted: { object: handle.name, id } });
    },
  },
  {
    name: "records restore",
    summary: "Restore a soft-deleted record",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
    ],
    flags: [
      { name: "version", value: "n", description: "Version to restore (required)" },
      BY_FLAG,
      RAW_FLAG,
    ],
    examples: ['erp records restore "Hóa đơn" 018f… --version 3'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const version = flagNumber(ctx.args, "version");
      if (version === undefined) throw new UsageError("--version is required to restore");
      const record = await handle.restore(requireArg(ctx, 1, "id"), version);
      ctx.out(renderRecord(ctx, handle, record));
    },
  },
  {
    name: "links list",
    summary: "List linked records for a relation field",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
      { name: "field", required: true, description: "Relation field name or key" },
    ],
    flags: [
      { name: "direction", value: "outgoing|incoming", description: "Link direction (default outgoing)" },
    ],
    examples: ['erp links list "Hóa đơn" 018f… "Khách hàng"'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      const direction = flagString(ctx.args, "direction") ?? "outgoing";
      if (direction !== "outgoing" && direction !== "incoming") {
        throw new UsageError(`--direction must be "outgoing" or "incoming"`);
      }
      ctx.out(
        await handle.listLinks(requireArg(ctx, 1, "id"), requireArg(ctx, 2, "field"), direction),
      );
    },
  },
  {
    name: "links add",
    summary: "Link a record to another record",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
      { name: "field", required: true, description: "Relation field name or key" },
      { name: "target-id", required: true, description: "Record id to link to" },
    ],
    flags: [{ name: "position", value: "n", description: "Order within the link list" }],
    examples: ['erp links add "Hóa đơn" 018f… "Khách hàng" 019a…'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      ctx.out(
        await handle.createLink(
          requireArg(ctx, 1, "id"),
          requireArg(ctx, 2, "field"),
          requireArg(ctx, 3, "target-id"),
          flagNumber(ctx.args, "position") ?? 0,
        ),
      );
    },
  },
  {
    name: "links remove",
    summary: "Remove a link between two records",
    args: [
      { name: "object", required: true, description: "Object name or id" },
      { name: "id", required: true, description: "Record id" },
      { name: "field", required: true, description: "Relation field name or key" },
      { name: "target-id", required: true, description: "Linked record id" },
    ],
    examples: ['erp links remove "Hóa đơn" 018f… "Khách hàng" 019a…'],
    async run(ctx) {
      const client = await ctx.client();
      const handle = await client.object(requireArg(ctx, 0, "object"));
      await handle.deleteLink(
        requireArg(ctx, 1, "id"),
        requireArg(ctx, 2, "field"),
        requireArg(ctx, 3, "target-id"),
      );
      ctx.out({ removed: true });
    },
  },
  {
    name: "perms list",
    summary: "List the effective permissions of the current credentials",
    examples: ["erp perms list"],
    async run(ctx) {
      const client = await ctx.client();
      ctx.out(await client.myPermissions());
    },
  },
  {
    name: "perms check",
    summary: "Check one permission (deny beats allow; `manage` implies nothing)",
    args: [
      { name: "resource", required: true, description: 'e.g. "object:record"' },
      { name: "action", required: true, description: 'e.g. "create"' },
    ],
    examples: ["erp perms check object:record create"],
    async run(ctx) {
      const client = await ctx.client();
      const resource = requireArg(ctx, 0, "resource");
      const action = requireArg(ctx, 1, "action");
      ctx.out({ resource, action, allowed: await client.can(resource, action) });
    },
  },
  {
    name: "schema dump",
    summary: "Dump every object + field as JSON — the context an agent needs before writing code",
    flags: [{ name: "out", value: "file", description: "Write to a file instead of stdout" }],
    examples: ["erp schema dump", "erp schema dump --out schema.json"],
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
    summary: "Scaffold a runnable mini app (Express + initData bridge + ensureObject)",
    args: [{ name: "dir", description: "Target directory (default: current directory)" }],
    flags: [
      { name: "name", value: "text", description: "App display name" },
      { name: "object", value: "text", description: "Object the app provisions and reads/writes" },
      { name: "sdk", value: "spec", description: 'erp-sdk dependency spec (default "^0.1.0")' },
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
      ctx.note("Next: npm install && ERP_BASE_URL=… ERP_API_KEY=… npm start");
      ctx.out(result);
    },
  },
  {
    name: "skill install",
    summary: "Install the erp-miniapp skill so coding agents know this SDK",
    flags: [
      { name: "dir", value: "path", description: "Target skills directory (default .claude/skills)" },
      { name: "force", description: "Overwrite an existing installation" },
    ],
    examples: ["erp skill install", "erp skill install --dir ~/.claude/skills"],
    async run(ctx) {
      const result = await installSkill({
        cwd: ctx.cwd,
        dir: flagString(ctx.args, "dir"),
        force: flagBool(ctx.args, "force"),
      });
      ctx.note(`Installed skill "${result.skill}" to ${result.dir}`);
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
];

/** Longest command path first, so "records query" beats a hypothetical "records". */
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
