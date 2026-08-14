# AGENTS.md

This file provides guidance to coding agents (Claude Code and others) when working with
code in this repository.

## What this is

`erp-sdk` is the TypeScript SDK **and** the `erp` CLI for the 1kk ERP backend. It has no
runtime dependency other than lodash and uses global `fetch` (Node 18+).

Its audience is **mini apps**: ordinary web apps (Express, Next.js, …) that use the ERP
as their engine instead of a database. Data lives in the workspace's object engine
(objects → fields → records), the app authenticates with a service-account API key
(`erp_sk_…`), and it learns *who* is using it through Telegram-style signed `initData`.

Documentation is Vietnamese and lives in `docs/` (`docs/README.md` is the index); the
English README covers the same surface. Keep both in sync when public API changes.

## Commands

```bash
npm test                          # vitest run
npx vitest run test/cli.test.ts   # one file
npx vitest run -t "schema check"  # one test by name
npx vitest                        # watch mode
npm run typecheck                 # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run build                     # tsup → dist/ (ESM + CJS + d.ts, plus dist/cli.js)
```

There is no linter configured at the repo root. The CLI must be built before it can be
exercised end to end: `npm run build && ./dist/cli.js doctor`.

## Distribution

The package is **never published to npm** — `prepublishOnly` deliberately fails so it
cannot happen by accident. A release is a **prebuilt tarball attached to a GitHub
Release**, installed by URL:

```
https://github.com/Coconut-ERP/erp-sdk/releases/download/v<version>/erp-sdk.tgz   # pinned
https://github.com/Coconut-ERP/erp-sdk/releases/download/latest/erp-sdk.tgz       # moving
```

The asset is **always named `erp-sdk.tgz`** — the tag carries the version, and npm reads
the real one from the package.json inside the tarball. `latest` is a tag and a Release
that the workflow force-updates on every release, so a fresh machine can install without
editing a URL; it is for `npm i -g` and one-off scripts only. Anything with a lockfile
pins the version URL, because package managers cache and lock by URL.

**Cutting a release** is `npm version <patch|minor|major> && git push --follow-tags`.
`.github/workflows/release.yml` fires on the `v*` tag: `npm ci` (which runs `prepare`,
building `dist/`), typecheck, test, build, `npm pack` → `erp-sdk.tgz`, smoke-test that
tarball under both npm and bun, `gh release create` for the tag, then re-point `latest`.
Running the workflow manually from the Actions tab does everything except publish, leaving
the tarball as an artifact — use that to test pipeline changes. Afterwards, bump the
pinned URL wherever it appears: `README.md`, `docs/`, `skills/`, and `DEFAULT_SDK_SPEC`
in `src/cli/scaffold.ts` (what `erp init` writes into a generated app).

Why a tarball and not just `github:Coconut-ERP/erp-sdk`:

- **npm, pnpm and yarn** can install from the repo — they install its devDependencies and
  run `prepare` (`tsup`) to build `dist/`, which is gitignored. This still works and is
  fine for tracking `main`.
- **Bun cannot.** It blocks lifecycle scripts by default, and even listed in
  `trustedDependencies` it does not install a git dependency's devDependencies, so
  `prepare` dies on `tsup: command not found`. Bun also ignores the `files` field for git
  deps and checks out the whole repo. Mini apps built with bun are normal, so the
  tarball is the only spec that works everywhere.
- The tarball is also what `files` filters down to (~68 kB: `dist` + `skills`), needs no
  `git` on the installing machine, and pins the version in the URL itself.

`prepare` is therefore a consumer-facing build for the npm/pnpm/yarn path *and* the build
step CI relies on: anything that breaks `tsup` on a clean clone — a missing devDependency,
a type error under `dts: true` — breaks both. `npm ci && npm run build` from a fresh clone
is the check.

## Talking to a real workspace

Object and field **display names are the addresses** of data — guessing them fails at
runtime with `UnknownFieldError`. Read the real schema before writing code against a
workspace:

```bash
./dist/cli.js doctor                    # env + connectivity + permissions → {ok, checks[]}
./dist/cli.js whoami                    # which identity, and its effective IAM rules
./dist/cli.js objects list
./dist/cli.js objects show "<Object>"
./dist/cli.js schema dump --out workspace.json
```

That is the whole discovery surface — **the CLI has no data commands**. Reading,
writing and analysing records happens in a script against the SDK, because the real
tasks are multi-step (filter, join, count before writing, aggregate) and flags express
that badly. Checking an app's `schema.json` is likewise SDK work: `validateSchema`
(format), `planSchema(schema, dump.objects)` (offline diff) or `client.schemaPlan`.

Needs `ERP_BASE_URL` and `ERP_API_KEY` in the environment, or `--env-file .env`
(real env wins over the file). Without credentials, do not invent a schema — ask, or
write the app's `schema.json` and validate its format with `validateSchema`.

## Architecture

| Path | What it holds |
| --- | --- |
| `src/http.ts` | `FetchHttp` — appends `/api/v1`, sets `X-API-Key` or `Bearer`, unwraps the `{success, data, message, trace}` envelope, throws `ErpApiError` on non-2xx |
| `src/client.ts` | `createMiniApp`, `ErpClient` — permission preflight, object resolution + caching, `assertSchema`, `issueInitData`/`session`, admin-only `createObject`/`ensureObject` |
| `src/objects.ts` | `ObjectHandle` (CRUD, fields, links) and `RecordQuery` (chainable filter/sort/paginate over `POST /records/query`) |
| `src/dashboards.ts` | `DashboardsApi`/`DashboardHandle` and `QueryResult` — read-only SQL (`client.sql`) plus saved queries, their params and chart config |
| `src/workflows.ts` | `WorkflowsApi`/`WorkflowHandle` — server-side scripts: versions, publish, write-only env, queued runs and the helpers that unpack a run's output |
| `src/schema.ts` | The `schema.json` model plus the backend's validation and diff rules as **pure functions** (`validateSchema`, `planSchema`, `schemaConflicts`, `unresolvedRelations`) — no I/O, so the CLI, the SDK and build scripts all share one source of truth |
| `src/frame.ts` | `DataFrame`/`GroupedFrame` — immutable pandas-style analysis over fetched records; every method returns a new frame |
| `src/permissions.ts` | `isAllowed`/`missingPermissions`, mirroring the backend enforcer (deny beats allow, `*` wildcards, `manage` implies nothing) |
| `src/webapp.ts` | Browser side of the initData bridge: URL param, `postMessage`, and `parseInitData` (unverified, display only) |
| `src/errors.ts` | Error classes that carry the fix, not just a message |
| `src/mode.ts` | `ERP_ENV` → `production` \| `development`, the switch that makes every record write a server-side dry run |
| `src/cli/` | `args` (parsing), `commands` (the registry), `index` (`runCli`), `help`, `main` (bin entry), `scaffold` (`erp init`), `skill` (`erp skill install`) |
| `skills/erp-data/` | Skill shipped inside the package — using the **SDK** to read, write and analyse workspace data; `erp skill install` copies it to `~/.agents/skills/` (tool-neutral, one copy per machine) and prints how each agent reaches it |

Two cross-cutting ideas explain most of the code:

**Names, not ids.** `ErpClient.object()` resolves an object by id, exact name, then
case-insensitive name, and caches the handle under both keys. `ObjectHandle` does the
same for fields and translates display names ↔ field keys on every read and write, so
callers never see internal keys (`toFrame({ by: "key" })` opts out). Mutations must call
`invalidate()`/`objects(true)` or the caches go stale.

**A mini app has no schema authority.** Its service account joins the workspace as
`member`, so it cannot create objects or fields. It declares what it needs in a
`schema.json` at the root of its source; the deployer reviews and applies that under
*their* permissions before the first build; the app only calls `assertSchema(schema)` at
boot, which diffs and throws `SchemaMismatchError` naming exactly what is missing or
retyped. `createObject`/`ensureObject`/`addField` still exist but are for admin-key
tooling only — called from an app they just produce 403s. Computed types (`formula`,
`lookup`, `rollup`) cannot be declared at all: their config addresses other fields by
internal key.

**Two environment modes**, read once at client construction from `ERP_ENV`
(`config.mode`/`config.env` override, `NODE_ENV` is deliberately ignored — a locally
developed app still means its writes). `development` makes the four record-write
endpoints send `dryRun: true`, which the backend runs for real and rolls back; every
write method takes `{ dryRun }` to override per call. What has no dry run on the server
— `delete`, `restore`, the link endpoints, **starting a workflow run**, anything
structural — throws `DryRunUnsupportedError` in that mode rather than silently doing
the real thing. A new write path must decide which of those two it is. Workflow and
dashboard *definitions* are structural, so they write for real in either mode, the
same as `createObject`.

**Names are the address beyond records too.** `client.workflow()`,
`client.dashboard()` and `DashboardHandle.query()` resolve id → exact name →
case-insensitive name, exactly like `client.object()`, and their errors carry the
`known` list. Dashboard SQL goes further: the backend compiles each object into a CTE
named after its **display name**, with fields as columns — so `SELECT "Tổng tiền" FROM
"Đơn hàng"` is the real query surface, it is case-sensitive, and `numeric` columns
come back as JSON strings. Two list endpoints paginate *before* filtering by sharing
(`/dashboards` has `meta`, `/workflows` has nothing) — hence `Http.requestPaged` and
the `listAll` helpers; a short page is not the end.

**Two authority modes** in a mini app, worth keeping straight when touching
`client.ts` or the docs:
- *App authority* (default, Telegram-bot style): data calls run on the service-account
  client; `session(initData)` is used only to know verifiably who is acting, and the
  user id gets written into a field. Per-user data boundaries are the app's job.
- *User authority* (opt-in): `session(initData).client` / `asUser(token)` — every call
  is limited by that user's own IAM permissions and row scopes.

## Conventions

- **The CLI's scope is closed: setup, diagnosis, discovery.** `doctor`, `whoami`,
  `objects list/show`, `schema dump`, `init`, `skill install/path` — and nothing that
  reads, writes or analyses records. New capability belongs in the SDK (and in the
  `erp-data` skill that teaches it), not in a new command; a command that only wraps one
  SDK call in flags is exactly what was removed. If a command genuinely is setup work, it
  is one entry in `COMMANDS` (`src/cli/commands.ts`) with summary, args, flags and
  examples — the same spec renders `erp help` and `erp help --json`, and unknown flags are
  rejected against it, so there is no separate help text to update.
- CLI results go to **stdout as JSON**; notes and errors to **stderr** as `{"error":{…}}`.
  Exit codes: 0 ok, 1 runtime/API error, 2 usage error. Never print progress to stdout.
- Errors carry what you need to fix them — `UnknownFieldError.known` lists valid fields,
  `MissingPermissionsError.missing` lists the exact `resource:action` pairs to grant,
  `SchemaMismatchError.missing`/`.conflicts` name the gap. New errors should follow this,
  and be serialized with a `hint` in `serializeError` (`src/cli/index.ts`).
- Anything new that is part of the public surface must be re-exported from `src/index.ts`.
- Tests are unit tests with no network: SDK tests inject a fake `Http`, CLI tests inject a
  fake `fetch` plus captured stdout/stderr into `runCli` (`harness()` in `test/cli.test.ts`).
  Keep it that way — no live workspace in the suite.
- API keys are server-side only: never log them, never ship them to a browser, never write
  them into examples, tests or docs. `.env` at the repo root is gitignored and real.
