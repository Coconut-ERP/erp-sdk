# Runtime của workflow — hợp đồng đầy đủ

Runner biên dịch code bằng esbuild (`loader: "ts"`, `format: "cjs"`,
`target: "node20"`) rồi gọi nó trong một `AsyncFunction` với danh sách tham số
cố định. Mọi ràng buộc dưới đây đến từ đó.

## Entry point

Trước khi transpile, runner kiểm tra source có khai báo `main` hay không bằng
regex. Những dạng sau đều được nhận:

```ts
async function main(input) { … }            // nên dùng dạng này
const main = async (input) => { … }
export async function main(input) { … }
```

Không có `main` → `Workflow code must define "async function main()"` (400 lúc
lưu, hoặc `ok: false` lúc test-run).

`main` nhận `input` **và** `input` cũng là global — hai đường vào cùng một giá
trị. Không truyền gì thì nó là `{}`, không phải `undefined`.

Giá trị trả về đi thẳng qua `JSON.stringify`:

- `undefined` → `null`.
- Không serialize được (`Map`, `Set`, `Date` lồng trong class, circular) → mất
  dữ liệu hoặc lỗi. Trả object/array thuần.
- Quá 256KB → `Workflow result is too large`, run thành ERROR.

## Global runner bơm vào

| Tên | Là gì |
| --- | --- |
| `erp` | `new ErpClient(...)` đã trỏ đúng workspace, dùng token của actor. **Không phải `createMiniApp`** — không có preflight quyền, gọi tới đâu lỗi tới đó |
| `_` | lodash |
| `moment` | moment.js |
| `axios` | axios |
| `input` | payload của trigger |
| `env` | map env của workflow (chuỗi). Test-run: `{}` |
| `process` | **bản giả đóng băng**: `{ env, argv: [], platform, version }` |
| `console` | `log/info/warn/error/debug/table/trace` → `output.logs` |

Trước khi code chạy, runner *bịt* runtime: `process.env` thật bị xoá,
`process.binding`, `dlopen`, `getBuiltinModule`, `report`, `mainModule`, `kill`
bị gỡ; `process.stdout.write`/`stderr.write` bị thay bằng bộ thu log. Nghĩa là
không có cách nào đọc biến môi trường của máy chủ, và không có đường vòng ra
module hệ thống.

`fetch`, `URL`, `crypto`, `Buffer`, `setTimeout`… vẫn là global của Node 20.

## Import: registry cố định

```ts
// đúng: specifier là chuỗi literal, ở top level
import { z } from "zod";
import Decimal from "decimal";           // alias của decimal.js
import nodemailer from "email";
import { generateText } from "ai";       // ES-only → import theo tên
import { openai } from "@ai-sdk/openai";
```

| Canonical | Alias |
| --- | --- |
| `erp-sdk`, `lodash`, `moment`, `axios`, `zod`, `nodemailer`, `node-telegram-bot-api`, `@slack/web-api`, `yahoo-finance2`, `decimal.js`, `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | `decimal` → `decimal.js`, `email` → `nodemailer`, `telegram` → `node-telegram-bot-api`, `slack` → `@slack/web-api`, `yfinance`/`yahoo-finance` → `yahoo-finance2` |

Bốn luật đi kèm:

1. **Specifier phải là literal.** `require(tenBien)` không bị bắt lúc lưu nhưng
   ném lúc chạy; `import()` động của module ES ném
   `must be imported with a literal specifier`.
2. **Import không dùng bị compiler loại bỏ** trước khi kiểm registry → khai báo
   `import fs from "node:fs"` rồi không dùng thì *không* báo lỗi, nhưng cũng
   không có `fs`.
3. `ai` và `@ai-sdk/*` là ES-only: **named import**, đừng default import.
4. Mọi thứ khác → `Module "x" is not available to workflows — available
   modules: …` (400 lúc lưu, không phải lúc chạy).

## Log

`console.*` gom vào `output.logs`, mỗi dòng có tiền tố cấp độ (`log: `,
`error: `…). Trần 64KB cho cả run; vượt thì chèn `log: … output truncated` và
**bỏ hết phần sau**.

Run **ERROR không có `output`** — logs biến mất, chỉ còn ~3 dòng cuối bị nhét
vào `error` dạng `<lỗi> [<log>]`. Muốn debug được run hỏng thì tự gom vào giá
trị trả về:

```ts
async function main() {
  const trace = [];
  try {
    trace.push("bắt đầu");
    …
    return { ok: true, trace };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), trace };   // trả, đừng throw
  }
}
```

## Giới hạn và biến môi trường điều khiển chúng

| Hạng mục | Trần | Biến |
| --- | --- | --- |
| Code | 128KB | `WORKFLOW_MAX_CODE_BYTES` |
| Input | 64KB JSON | — |
| Result | 256KB | `RUNNER_MAX_RESULT_BYTES` |
| Logs | 64KB | `RUNNER_MAX_LOG_BYTES` |
| Thời gian 1 run | 60s mặc định, trần kỹ thuật 15 phút | `WORKFLOW_RUN_TIMEOUT` |
| Run song song | 4/runner | `RUNNER_MAX_CONCURRENCY` |
| Env entry | 50, tên `[A-Za-z_][A-Za-z0-9_]*` | — |
| Tên / mô tả | 255 / 2000 ký tự | — |

## Thông điệp lỗi hay gặp trong `run.error`

| Message | Nghĩa |
| --- | --- |
| `<lỗi JS> [<log>]` | code ném exception |
| `Workflow code timed out after <N>ms` | vượt timeout |
| `workflow run was interrupted and is not retried` | worker chết/deploy giữa run — **không chạy lại**, phần đã ghi vẫn còn |
| `Workflow actor lacks workflow:run:create` | actor bị thu hồi quyền (hay gặp với cron cũ) |
| `Workflow actor is not active` | actor bị vô hiệu hoá / rời workspace |
| `Workflow result is too large` | `main()` trả > 256KB |
| `Workflow runner is busy` | runner quá tải — thử lại |
| `Workflow run failed` | lỗi hạ tầng đã bị che; lỗi do script luôn cụ thể hơn thế |

Lỗi lúc **lưu** (400) thì khác hẳn: `Workflow code is required` / `is too large`
/ `is invalid: <message> (line N, column M)` / `Module "…" is not available` /
`Invalid cron schedule` / `Invalid cron timezone` /
`Manual trigger config must be empty`.

Server **không** kiểm tra tên object/field trong code — tên sai chỉ lộ ra lúc
chạy, dưới dạng `UnknownObjectError`/`UnknownFieldError` từ SDK. Đó là lý do
`test-run` không phải tuỳ chọn.

## Trigger

```jsonc
{ "type": "manual" }                       // config phải rỗng, gửi thừa key → 400

{ "type": "cron", "config": {
    "schedule": "0 0 8 * * *",             // 6 trường: giây phút giờ ngày tháng thứ
    "timezone": "Asia/Ho_Chi_Minh",        // IANA, bắt buộc
    "automaticBackfill": false             // chạy bù kỳ bỏ lỡ khi downtime
} }
```

- Descriptor `@daily`, `@every 1h` hợp lệ. `"0 9 * * *"` (5 trường) thì không.
- `config` của cron **không nhận key lạ**.
- Schedule chỉ được đăng ký **khi publish**, và bị gỡ khi update/delete.
- Run theo lịch nhận `input = { source: "cron", scheduledAt: "<RFC3339>" }` —
  code nên chịu được cả input này lẫn input thủ công.
- Tick của schedule cũ trả `SUCCESS` với `{ skipped: true, reason }`
  (`workflow schedule is stale` / `workflow no longer exists`) rồi tự gỡ.

## Quyền

Run chạy dưới quyền **live** của actor: người bấm `POST /runs`, hoặc người
publish với cron. Không có service account, không nâng quyền được. Mất quyền
giữa chừng → run ERROR ngay lần tick sau.

Hai resource IAM: `workflow` (định nghĩa) và `workflow:run` (lượt chạy) với
`create/read/update/delete`. `check` và `test-run` đòi `workflow:run:create`.

ACL riêng của workflow (`visibility: workspace | restricted`): `read` = thấy,
`write` = **được bấm chạy**, `manage` = sửa/publish/xoá/share. Cron **không** đi
qua ACL.
