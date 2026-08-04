# Working in this repo (for coding agents)

`erp-sdk` is the TypeScript SDK for the 1kk ERP backend. Mini apps use the ERP
as their engine: data lives in the workspace's object engine (objects → fields →
records), apps authenticate with a service-account API key (`erp_sk_…`), and
they learn *who* is using them through Telegram-style signed `initData`.

## Before writing code against a workspace

Object and field **display names are the addresses** of data — guessing them
fails at runtime. Read the real schema first:

```bash
npm run build            # the CLI lives at dist/cli.js
./dist/cli.js doctor     # env + connectivity + permissions → {ok, checks[]}
./dist/cli.js objects list
./dist/cli.js objects show "<Object>"
./dist/cli.js schema dump --out schema.json
```

Needs `ERP_BASE_URL` and `ERP_API_KEY` (or `--env-file .env`). Without
credentials, don't invent a schema — ask, or have the app provision its own with
`ensureObject`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/client.ts` | `createMiniApp`, `ErpClient` — permissions, objects, initData sessions |
| `src/objects.ts` | `ObjectHandle` (CRUD, schema, links), `RecordQuery` (filter/sort/paginate) |
| `src/frame.ts` | `DataFrame` — pandas-style analysis over fetched records |
| `src/webapp.ts` | Browser side of the initData bridge |
| `src/cli/` | The `erp` CLI: `args`/`values` (parsing), `commands` (registry), `index` (`runCli`), `main` (bin entry) |
| `skills/erp-miniapp/` | Skill shipped to agents — `erp skill install` copies it |
| `docs/` | Full Vietnamese guide, `docs/README.md` is the index |
| `examples/miniapp-leave-request/` | A complete, runnable mini app |

## Conventions

- Commands are declared in `COMMANDS` (`src/cli/commands.ts`); the same spec
  renders `erp help` and `erp help --json`. Adding a command means adding one
  entry there — summary, args, flags and examples included.
- CLI results go to stdout as JSON; notes and errors to stderr as
  `{"error":{…}}`. Exit codes: 0 ok, 1 runtime/API error, 2 usage error.
- Errors should carry the fix (`.known` fields, `.missing` permissions) rather
  than only a message.
- API keys are server-side only — never log them, never ship them to a browser,
  never write them into examples or tests.

## Checks

```bash
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsup → dist/ (ESM + CJS + d.ts + cli.js)
```
