# `schema.json` — app's needed tables

Apps **cannot create tables**. They declare what they need, the deployer reviews and creates
with their permissions. File lives at **project root** (repo root or zip root; if zip has one root directory, that's the root).

## Format

Payload inherits straight from the objects API: one `objects` element = body of
`POST /objects` (`name`, `position`) plus `fields`; one `fields` element = body
of `POST /objects/:id/fields` (`name`, `type`, `config`, `position`).

```json
{
  "objects": [
    {
      "name": "Leave Request",
      "position": 0,
      "fields": [
        { "name": "Requester", "type": "single_select",
          "config": { "source": "workspace_users" }, "position": 0 },
        { "name": "Reason", "type": "long_text", "position": 1 },
        { "name": "From Date", "type": "date", "position": 2 },
        { "name": "Days", "type": "number", "position": 3 },
        { "name": "Status", "type": "single_select",
          "config": { "source": "static",
                      "options": ["pending", "approved", "rejected"] },
          "position": 4 }
      ]
    }
  ]
}
```

Unknown keys in JSON are **rejected** — only `objects` at root; `name`/`position`/`fields`
on object; `name`/`type`/`config`/`position` on field.

## Field types

| Group | Type |
| --- | --- |
| Text | `text`, `long_text`, `url`, `email`, `phone` |
| Number | `number`, `currency`, `percent` |
| Date | `date`, `datetime` |
| Selection | `single_select`, `multi_select`, `checkbox` |
| Other | `relation`, `attachment` |
| **Can't declare** | `formula`, `lookup`, `rollup` |

Computed fields (`formula`/`lookup`/`rollup`) can't be declared because their config
references other fields by **internal key**, which apps don't know. Create them manually
in the workspace if needed; apps read them from `record.computedData`.

Constants in SDK: `FIELD_TYPES`, `DECLARABLE_FIELD_TYPES`,
`COMPUTED_FIELD_TYPES`.

### Common `config`

```json
{ "type": "single_select", "config": { "source": "workspace_users" } }
```
Value stored is **user id** — for "created by" or "approver" fields.

```json
{ "type": "single_select", "config": { "source": "static", "options": ["a", "b"] } }
```

```json
{ "type": "relation", "config": { "targetObject": "Customer" } }
```
`targetObject` is **table name** (apps don't know ids). Target must be a table declared
in this file or already in the workspace — if not, `unresolvedRelations()` catches it and backend returns 400.

## Backend rules on upload

| Rule | Limit |
| --- | --- |
| Name not duplicate (case-insensitive) | within this file |
| Name length | ≤ 255 (`MAX_NAME_LENGTH`) |
| Table count | ≤ 50 (`MAX_SCHEMA_OBJECTS`) |
| Fields per table | ≤ 200 (`MAX_SCHEMA_FIELDS`) |
| File size | ≤ 256KB (`MAX_SCHEMA_BYTES`) |
| `position` | non-negative integer |

Any violation → **400 on zip upload**. Backend message pinpoints the exact error —
show it as-is to the user.

## Validate before upload, no credentials needed

Pure functions, same rules as backend:

```js
import { readFileSync } from "node:fs";
import {
  validateSchema, planSchema, schemaConflicts,
  schemaSettled, unresolvedRelations, schemaSize,
} from "erp-sdk";

const schema = JSON.parse(readFileSync("schema.json", "utf8"));

validateSchema(schema);        // string[] of all backend errors; [] = valid

// Diff against real workspace: npx erp schema dump --out workspace.json
const workspace = JSON.parse(readFileSync("workspace.json", "utf8")).objects;
const plans = planSchema(schema, workspace);
schemaConflicts(plans);        // [] = no type mismatches
schemaSettled(plans);          // true = nothing left to review
unresolvedRelations(schema, workspace);   // relations pointing to non-existent tables
```

With a client: `await app.schemaPlan(schema)` does both steps (reads workspace + diff), doesn't throw.

Each table/field has an `action`:

| action | Meaning |
| --- | --- |
| `create` | new, will be created |
| `update` | (table-level) exists but missing fields |
| `unchanged` | already there, untouched |
| `conflict` | (field-level) name exists, **different type** — includes `currentType` |

## `assertSchema` at boot

```ts
const handles = await app.assertSchema(schema);
const leaves = handles["Leave Request"];        // key = exact declared name
```

Match → returns `Record<table name, ObjectHandle>`. Mismatch → throws `SchemaMismatchError`
with `.missing` (tables/fields absent) and `.conflicts` (name exists, type differs), message includes guidance to ask deployer to approve.

Call **once at boot**, not in route handlers. `{ refresh: true }` drops cache if workspace was just changed.

## Evolving schema later

1. Edit `schema.json`
2. Upload new version (`PUT /mini-apps/:id/source`)
3. Deployer approves again

Only **adding** is supported. Changing an existing field's type is a `conflict` → requires manual fix
in the workspace (or edit the declaration to match) then re-approve. Deleting tables/fields is also manual
in the workspace — removing the app doesn't delete data tables.

## Escape hatch: create tables with admin key

`createObject` / `ensureObject` / `addField` still exist in the SDK, but **not for apps** —
calling from an app returns 403. They're for **admin-key tooling**, like pre-staging a demo workspace:

```js
await adminClient.ensureObject("Leave Request", [
  { name: "Reason", type: "long_text" },
  { name: "Days", type: "number" },
]);
```

Modifying the deployer's workspace structure is a big deal — **ask first**. After changing it, call `client.invalidate()`,
or the handle cache keeps old fields. Schema changes **have no dry run**: `ERP_ENV=development` can't protect here.
