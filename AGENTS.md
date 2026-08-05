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
https://github.com/Coconut-ERP/erp-sdk/releases/download/v<version>/erp-sdk-<version>.tgz
```

**Cutting a release** is `npm version <patch|minor|major> && git push --follow-tags`.
`.github/workflows/release.yml` fires on the `v*` tag: `npm ci` (which runs `prepare`,
building `dist/`), typecheck, test, build, `npm pack`, smoke-test the tarball under both
npm and bun, then `gh release create`. Running the workflow manually from the Actions tab
does everything except publish, leaving the tarball as an artifact — use that to test
pipeline changes. Afterwards, bump the pinned URL in `examples/*/package.json`, `README.md`
and `docs/`.

Why a tarball and not just `github:Coconut-ERP/erp-sdk`:

- **npm, pnpm and yarn** can install from the repo — they install its devDependencies and
  run `prepare` (`tsup`) to build `dist/`, which is gitignored. This still works and is
  fine for tracking `main`.
- **Bun cannot.** It blocks lifecycle scripts by default, and even listed in
  `trustedDependencies` it does not install a git dependency's devDependencies, so
  `prepare` dies on `tsup: command not found`. Bun also ignores the `files` field for git
  deps and checks out the whole repo. `examples/miniapp-hr` is a bun project, so the
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
./dist/cli.js objects list
./dist/cli.js objects show "<Object>"
./dist/cli.js schema dump --out workspace.json
./dist/cli.js schema check              # an app's schema.json: format + diff vs workspace
./dist/cli.js schema check --offline    # format only, no credentials needed
```

Needs `ERP_BASE_URL` and `ERP_API_KEY` in the environment, or `--env-file .env`
(real env wins over the file). Without credentials, do not invent a schema — ask, or
write the app's `schema.json` and validate its format with `--offline`.

## Architecture

| Path | What it holds |
| --- | --- |
| `src/http.ts` | `FetchHttp` — appends `/api/v1`, sets `X-API-Key` or `Bearer`, unwraps the `{success, data, message, trace}` envelope, throws `ErpApiError` on non-2xx |
| `src/client.ts` | `createMiniApp`, `ErpClient` — permission preflight, object resolution + caching, `assertSchema`, `issueInitData`/`session`, admin-only `createObject`/`ensureObject` |
| `src/objects.ts` | `ObjectHandle` (CRUD, fields, links) and `RecordQuery` (chainable filter/sort/paginate over `POST /records/query`) |
| `src/schema.ts` | The `schema.json` model plus the backend's validation and diff rules as **pure functions** (`validateSchema`, `planSchema`, `schemaConflicts`, `unresolvedRelations`) — no I/O, so the CLI, the SDK and build scripts all share one source of truth |
| `src/frame.ts` | `DataFrame`/`GroupedFrame` — immutable pandas-style analysis over fetched records; every method returns a new frame |
| `src/permissions.ts` | `isAllowed`/`missingPermissions`, mirroring the backend enforcer (deny beats allow, `*` wildcards, `manage` implies nothing) |
| `src/webapp.ts` | Browser side of the initData bridge: URL param, `postMessage`, and `parseInitData` (unverified, display only) |
| `src/errors.ts` | Error classes that carry the fix, not just a message |
| `src/cli/` | `args`/`values` (parsing), `commands` (the registry), `index` (`runCli`), `main` (bin entry), `scaffold` (`erp init`), `skill` (`erp skill install`) |
| `skills/erp-miniapp/` | Skill shipped inside the package; `erp skill install` copies it into `.claude/skills/` |
| `examples/miniapp-leave-request/` | Complete runnable mini app (Express + static HTML) |
| `examples/miniapp-hr/` | Larger mini app (Next.js + Tailwind + shadcn): 10 linked tables, `relation`/`lookup` columns, per-employee data scoping |

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

**Two authority modes** in a mini app, worth keeping straight when touching
`client.ts` or the docs:
- *App authority* (default, Telegram-bot style): data calls run on the service-account
  client; `session(initData)` is used only to know verifiably who is acting, and the
  user id gets written into a field. Per-user data boundaries are the app's job.
- *User authority* (opt-in): `session(initData).client` / `asUser(token)` — every call
  is limited by that user's own IAM permissions and row scopes.

## Conventions

- **Adding a CLI command means adding one entry to `COMMANDS` in `src/cli/commands.ts`** —
  summary, args, flags and examples included. The same spec renders `erp help` and
  `erp help --json`; there is no separate help text to update. Unknown flags are rejected
  against that spec.
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
