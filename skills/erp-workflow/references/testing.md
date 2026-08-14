# Kiểm code workflow trước khi nó thành workflow

Hai endpoint dưới đây **không lưu gì**: không workflow, không run, không version.
Chúng là chỗ sửa lỗi — tạo một workflow chỉ để xem code có chạy không là để lại
rác cho người khác dọn, và nếu trigger là cron thì publish còn khởi động lịch.

Cả hai chưa có method riêng trong SDK, nhưng `erp.http` là public nên gọi thẳng
được, vẫn qua đúng auth và vẫn bóc envelope `{success, data}`:

```ts
import { createMiniApp, ErpApiError } from "erp-sdk";

const erp = await createMiniApp({
  baseUrl: process.env.ERP_BASE_URL,
  apiKey: process.env.ERP_API_KEY,
  permissions: [{ resource: "workflow:run", action: "create" }],
});

const code = await readFile("nhac-don-qua-han.ts", "utf8");
```

## 1. `POST /workflows/check` — transpile, không chạy

```ts
try {
  await erp.http.request("POST", "/workflows/check", { body: { code } });
  // → { valid: true }
} catch (e) {
  if (e instanceof ErpApiError) console.error(e.message);
  // "Workflow code is invalid: Expected ";" (line 12, column 8)"
  // "Workflow code is invalid: Module "node:fs" is not available to workflows — available modules: …"
  // "Workflow code must define "async function main()""
}
```

Rẻ và nhanh. Chạy sau mỗi lần sửa, trước khi tốn một test-run.

Nó bắt được: cú pháp TS, thiếu `main`, module ngoài registry, code > 128KB. Nó
**không** bắt được: tên object/field sai, lỗi logic, quyền thiếu — đó là việc
của test-run.

## 2. `POST /workflows/test-run` — chạy thật trong runner thật

```ts
interface TestRun {
  ok: boolean;
  dryRun: true;
  result: unknown;
  logs: string[];
  durationMs: number;
  error?: { message: string; line?: number; column?: number; timeout?: boolean };
}

const t = await erp.http.request<TestRun>("POST", "/workflows/test-run", {
  body: { code, input: { ngay: "2026-08-14" } },
});

if (!t.ok) {
  console.error(t.error?.message, "dòng", t.error?.line, t.error?.column);
  console.error(t.logs.join("\n"));
}
```

- `ok: false` là **script hỏng**, request vẫn 200. Đọc `error.message`,
  `error.line`, `logs` → sửa → chạy lại. `error.timeout: true` nghĩa là chạm
  trần.
- **503 `Workflow runner is busy`** là runner quá tải, **không phải** code sai:
  chờ vài giây rồi gửi lại đúng code đó, đừng viết lại script.
- Trần **1 phút** cứng cho test-run (dù admin có nới `WORKFLOW_RUN_TIMEOUT`).
- Cần quyền `workflow:run:create` — cùng quyền để chạy một workflow thật.
- Chạy dưới **token của chính bạn**: script chỉ với tới đúng những gì key hiện
  tại với tới. Đọc ra 0 dòng thì kiểm `npx erp whoami` trước khi nghi filter.

### Cái gì được rehearse, cái gì là thật

Test-run luôn đặt SDK ở `development`, nên:

| Thao tác trong script | Trong test-run |
| --- | --- |
| `create`, `createMany`, `update`, bulk update theo filter | **Dry run**: server validate đủ (field, unique, version, id relation, rule, computed) rồi **rollback**. Id trả về là **id giả**, không được dùng tiếp |
| `delete`, `restore`, `createLink`, `deleteLink`, chạy workflow khác | **Từ chối** — ném `DryRunUnsupportedError` chứ không giả vờ |
| `createObject`, `addField`, `ensureObject` | **Thật** — cấu trúc bảng không có dry run |
| Mail, Telegram, Slack, webhook, mọi HTTP ra ngoài | **Thật** — gửi là gửi |
| Đọc (`fetch`, `count`, `erp.sql`) | Thật, chỉ đọc |

Relation viết **như một field của record** thì được rehearse cùng record;
`createLink`/`deleteLink` thì không — script dựa vào link call chỉ chứng minh
được sau khi đã là workflow đã lưu.

### Env: không có

Code chưa lưu thì chưa thuộc workflow nào, nên không có env để cấp và request
cũng **không nhận** env. Trong test-run `process.env` là `{}`. Vì vậy script cần
secret nên viết theo kiểu thoát sớm:

```ts
if (!process.env.BOT_TOKEN) return { skipped: "thiếu env BOT_TOKEN" };
```

để test-run vẫn chứng minh được phần logic, và phần gửi đi được chứng minh sau —
bằng một run thật, nhỏ nhất có thể (một người nhận, một dòng).

## 3. Sau khi `ok: true`: lưu, publish

Đây là lúc dùng SDK (chi tiết ở skill **`erp-data`**, `references/workflows.md`):

```ts
const wf = await erp.workflows.create({
  name: "Nhắc đơn quá hạn",
  description: "Cron 9h sáng",
  code,
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
});
await wf.publish();            // draft KHÔNG chạy, cron chưa được đăng ký
```

Ba luật của vòng đời, sai một cái là mất buổi debug:

1. **Mọi `update` đưa workflow về `draft` và gỡ cron.** Sửa xong phải
   `publish()` lại, nếu không run vẫn dùng bản active cũ.
2. **`version` là khoá lạc quan**, mọi mutation (kể cả `publish`) đều +1. Gửi
   sai → 409 `Workflow version conflict` → `await wf.refresh()` rồi thử lại.
3. **`setEnv` thay cả map**: tên nào không gửi là mất. Giữ giá trị cũ bằng
   sentinel `WORKFLOW_ENV_KEEP` (`"[KEEP]"`). Đổi env **không** bump version,
   không đưa về draft, không huỷ cron.

## 4. Đọc kết quả một run thật

```ts
const run = await wf.runAndWait({ ngay: "2026-08-14" });
runResult(run);   // giá trị main() trả về
runLogs(run);     // console.log
```

- `wf.run()` bị chặn khi client ở `ERP_ENV=development` (`DryRunUnsupportedError`)
  — chạy workflow là ghi thật, server không có dry run cho nó. Cố ý:
  `wf.run(input, { dryRun: false })`.
- Hết giờ chờ → `WorkflowRunTimeoutError`, **run không bị huỷ**, đọc tiếp bằng
  `wf.getRun(runId)`.
- Run **ngay sau `publish()`** thỉnh thoảng ERROR với message chung
  `"Workflow run failed"`: runner chưa thấy version mới. Đợi vài giây, chạy lại.
- Run ERROR **không có logs** — chỉ vài dòng cuối nhét trong `error`.

## Thứ tự làm việc, gọn lại

```
sửa file  →  check  →  test-run (input thật)  →  ok?
                ↑          ↓ không                 ↓ có
                └──── đọc error.line/logs      hỏi người dùng
                                                   ↓
                                    create → publish → run thật nhỏ nhất
```

Không bao giờ nhảy cóc từ "viết xong" sang "create + publish": một cron đã
publish là thứ tự chạy trên dữ liệu thật, mỗi ngày, dưới quyền của người publish.
