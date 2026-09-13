# `schema.json` — the tables an app needs

An app cannot create tables. It declares them; the deployer reviews the declaration
and creates what is missing under their own permissions. The file sits at the project
root (the repo root, or the zip root — a zip with a single top directory counts that
directory as the root).

## Contents

- [Format](#format)
- [Field types and config](#field-types-and-config)
- [Backend rules](#backend-rules)
- [Checking a schema](#checking-a-schema)
- [`assertSchema` at boot](#assertschema-at-boot)
- [Evolving a schema](#evolving-a-schema)

## Format

Each `objects` entry is the body of `POST /objects` (`name`, `position`) plus
`fields`; each field is the body of `POST /objects/:id/fields` (`name`, `type`,
`config`, `position`).

```json
{
  "objects": [
    {
      "name": "Leave Request",
      "position": 0,
      "fields": [
        { "name": "Requester", "type": "single_select", "config": { "source": "workspace_users" }, "position": 0 },
        { "name": "Reason", "type": "long_text", "position": 1 },
        { "name": "From Date", "type": "date", "position": 2 },
        { "name": "Days", "type": "number", "position": 3 },
        { "name": "Status", "type": "single_select",
          "config": { "source": "static", "options": ["pending", "approved", "rejected"] }, "position": 4 }
      ]
    }
  ]
}
```

Unknown keys are rejected at every level.

## Field types and config

| Group | Types |
| --- | --- |
| Text | `text`, `long_text`, `url`, `email`, `phone` |
| Number | `number`, `currency`, `percent` |
| Date | `date`, `datetime` |
| Choice | `single_select`, `multi_select`, `checkbox` |
| Other | `relation`, `attachment` |
| **Not declarable** | `formula`, `lookup`, `rollup` — their config addresses fields by internal key; create them in the workspace and read them from `computedData` |

Constants: `FIELD_TYPES`, `DECLARABLE_FIELD_TYPES`, `COMPUTED_FIELD_TYPES`.

| Config | Meaning |
| --- | --- |
| `{ "source": "workspace_users" }` on `single_select` | The value is a user id — requester, approver |
| `{ "source": "static", "options": ["a", "b"] }` | Fixed options |
| `{ "targetObject": "Customer" }` on `relation` | Target **by table name**, declared in this file or already in the workspace |

## Backend rules

| Rule | Limit |
| --- | --- |
| Names unique, case-insensitive | within the file |
| Name length | ≤ 255 (`MAX_NAME_LENGTH`) |
| Tables | ≤ 50 (`MAX_SCHEMA_OBJECTS`) |
| Fields per table | ≤ 200 (`MAX_SCHEMA_FIELDS`) |
| File size | ≤ 256 KB (`MAX_SCHEMA_BYTES`) |
| `position` | non-negative integer |

A violation is a 400 on upload whose message names the problem; show it to the user
as is.

## Checking a schema

The same rules as the backend, as pure functions:

```js
import { readFileSync } from "node:fs";
import { validateSchema, planSchema, schemaConflicts, schemaSettled, unresolvedRelations } from "erp-sdk";

const schema = JSON.parse(readFileSync("schema.json", "utf8"));
validateSchema(schema);                          // string[]; [] = valid

// npx erp schema dump --out workspace.json
const workspace = JSON.parse(readFileSync("workspace.json", "utf8")).objects;
const plans = planSchema(schema, workspace);
schemaConflicts(plans);                          // [] = no type mismatches
schemaSettled(plans);                            // true = nothing left to review
unresolvedRelations(schema, workspace);          // relations to tables that exist nowhere
```

With a client, `await app.schemaPlan(schema)` reads the workspace and diffs in one call.

| `action` | Meaning |
| --- | --- |
| `create` | New; will be created |
| `update` | Table exists but lacks fields |
| `unchanged` | Already there |
| `conflict` | Field name exists with a **different type** (`currentType`) |

## `assertSchema` at boot

```ts
const handles = await app.assertSchema(schema);
const leaves = handles["Leave Request"];         // keyed by the declared name
```

A match returns `Record<name, ObjectHandle>`. A mismatch throws `SchemaMismatchError`
with `.missing` and `.conflicts`, and a message telling the deployer to approve. Call
it once at boot, not per request; `{ refresh: true }` skips the cache.

## Evolving a schema

1. Edit `schema.json`.
2. Upload the new source (`PUT /mini-apps/:id/source`).
3. The deployer approves again.

Only additions are applied. Retyping a field is a `conflict`: fix the workspace or the
declaration, then approve. Deleting tables or fields is manual too, and removing the
app deletes no data.

`createObject` / `ensureObject` / `addField` exist for **admin-key tooling** such as
staging a demo workspace; from an app they return 403. Structure changes have no dry
run, so ask before making them, and call `client.invalidate()` afterwards.
