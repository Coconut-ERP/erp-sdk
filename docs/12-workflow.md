# 12 — Workflow

[← Truy vấn SQL & dashboard](11-truy-van-sql-dashboard.md) · [Mục lục](README.md)

Workflow là **một file TypeScript chạy trên server ERP**: gửi email nhắc đơn quá
hạn mỗi sáng, đồng bộ sang hệ thống khác, tổng hợp số liệu cuối ngày. Nó tồn tại
để những việc đó không cần một service riêng — không deploy, không cron host,
không nơi cất secret.

Khác với mini app (một web app đầy đủ, có UI, xem [01](01-tong-quan.md)),
workflow là một script không giao diện, chạy theo lượt.

## 1. Mô hình

```
tạo (draft, version 1) ──► publish ──► version active
        ▲                                   │
        │ mỗi lần update → quay lại draft    ├─ chạy tay: POST /runs
        └────────────────────────────────────┼─ cron: server tự chạy
                                             └─ webhook: bên ngoài POST tới URL bí mật
```

- **Code** là một file, có `async function main(input)`. `input` là payload lúc
  chạy, giá trị `main` trả về được lưu trong kết quả run.
- **Version** là khoá lạc quan: mọi thay đổi (kể cả `publish`) đều tăng nó, và
  `update`/`publish`/`delete` phải gửi version hiện tại → sai thì 409.
- **Draft không chạy.** Sửa code xong mà quên `publish` thì run vẫn dùng bản cũ.
- **Run chạy dưới quyền của người gọi**, không phải quyền của người viết.

## 2. Trong script chạy có sẵn gì

Runner nạp sẵn, **không cần import**: `erp` (client SDK đã đăng nhập sẵn),
`_` (lodash), `moment`, `axios`, `input`.

Import theo tên được: `zod`, `decimal.js` (alias `decimal` — dùng cho **số
tiền**), `nodemailer` (`email`), `node-telegram-bot-api` (`telegram`),
`@slack/web-api` (`slack`), `yahoo-finance2` (`yfinance`), `ai` và các provider
`@ai-sdk/*`, cộng `lodash`/`moment`/`axios`/`erp-sdk` bản đầy đủ. Ngoài danh
sách đó — kể cả `node:fs`, `node:child_process` — thì không.

```ts
async function main(input) {
  const orders = await erp.object("Đơn hàng");
  const quaHan = await orders.records()
    .where("Trạng thái", "equals", "new")
    .where("Hạn giao", "less_than", moment().format("YYYY-MM-DD"))
    .fetchAll({ max: 500 });

  console.log(`Có ${quaHan.length} đơn quá hạn`);
  return { count: quaHan.length };
}
```

`console.log` được thu lại và trả về cùng kết quả run.

## 3. Tạo, sửa, publish từ SDK

```ts
const wf = await erp.workflows.create({
  name: "Nhắc đơn quá hạn",
  description: "Chạy 9h sáng mỗi ngày",
  code,                                   // chuỗi, phải có async function main
  trigger: { type: "cron", config: { schedule: "0 0 9 * * *", timezone: "Asia/Ho_Chi_Minh" } },
  env: { SMTP_PASSWORD: "…" },
});

await wf.publish();          // draft → active, dùng version hiện tại
wf.isPublished;              // true
```

Sửa rồi publish lại:

```ts
await wf.update({ code: codeMoi });   // version tự lấy từ handle, workflow về draft
await wf.publish();
```

Lấy lại về sau — theo **tên** hoặc id, giống `erp.object()`:

```ts
const wf = await erp.workflow("Nhắc đơn quá hạn");
wf.version; wf.status; wf.trigger; wf.code; wf.envNames;
await wf.refresh();
await erp.workflows.list({ limit: 50 });   // danh sách, không kèm code
await wf.delete();
```

### Trigger

Ba loại (`WORKFLOW_TRIGGER_TYPES`) — không có trigger theo sự kiện record:

| Trigger | Config |
| --- | --- |
| `{ type: "manual" }` | không cần gì; chỉ chạy khi có người gọi |
| `{ type: "cron", config: { schedule, timezone } }` | `schedule` **6 trường (có giây)** hoặc descriptor; `timezone` là tên IANA |
| `{ type: "webhook" }` | không cần gì; server cấp URL bí mật khi publish |

```
"0 0 9 * * *"      → 9:00 mỗi ngày        (giây phút giờ ngày tháng thứ)
"0 */15 * * * *"   → mỗi 15 phút
"@daily", "@every 1h"
"0 9 * * *"        → ✗ 5 trường, server từ chối
```

Sai trigger hoặc code thiếu `main()` → `WorkflowDefinitionError` ném ngay ở
client, chưa gửi request.

### Webhook

```ts
const wf = await erp.workflows.create({ name: "Nhận thanh toán", code, trigger: { type: "webhook" } });
await wf.publish();
wf.webhookUrl;                 // "https://…/api/v1/webhooks/<token>" — draft thì URL trả 404
```

SDK **chỉ đọc** `webhookUrl`, không xoay nó. URL lỡ lộ thì thu hồi bằng
`POST /workflows/{id}/webhook/rotate` từ phiên của người dùng (cần quyền
manage) — code đang cầm URL cũ không được tự cấp cho mình URL mới.

`webhookUrl` **là credential**, không phải một cái id: ai POST tới đó cũng khởi
động được một run, server không kiểm chữ ký và không biết bên gọi là ai. Đừng
log nó, và đổi trigger sang `manual`/`cron` là URL bị thu hồi.

`main(input)` nhận nguyên vẹn delivery, `body` là **chuỗi thô chưa parse** — đó
là điều kiện để verify được chữ ký (Stripe, GitHub… ký trên bytes gốc):

```ts
async function main(input) {
  // { source: "webhook", method, query, headers, body, receivedAt }
  const event = JSON.parse(input.body);
}
```

Thử trước khi publish bằng **cùng URL thêm `/test`**:

```bash
curl -X POST "$WEBHOOK_URL/test" -H "x-signature: $CHU_KY" -d '{"amount":1250.50}'
# → 202 { id: "hooktest-…", status: "ENQUEUED" }
```

`/test` chạy được cả khi workflow còn draft và ghi record được validate đủ rồi
rollback. Nó trả lời **giống hệt** URL thật — run id, không phải output — nên
log và kết quả đọc bằng `wf.waitForRun(id)` / `wf.getRun(id)`, tức là cần quyền
read trên workflow. Người cầm URL chỉ khởi động được, không đọc được.

Verify là việc của code trong workflow — server chỉ nhận request rồi xếp hàng,
trả `202` kèm run id chứ không chờ script chạy xong. Payload lớn hơn
`WORKFLOW_MAX_INPUT_BYTES` (mặc định 64KB) bị từ chối `413`. Run chạy bằng quyền
của **người publish**, y như cron.

### Thử code trước khi lưu

Hai lệnh dưới đây **không lưu gì** — không workflow, không draft, không run —
nên đừng tạo workflow chỉ để xem code chạy được không:

```ts
const report = await erp.workflows.check(code);
// → { valid: true }
// → { valid: false, error: { message: 'Expected ";"', line: 12, column: 8 } }

const t = await erp.workflows.testRun({ code, input: { date: "2026-08-29" } });
// → { ok, dryRun: true, result, logs, durationMs, error? }
```

`check` transpile rồi vứt đi: **code sai là một câu trả lời, không phải
exception** — nó chỉ throw khi chính request hỏng (thiếu quyền, hoặc runner
chết → 503). Nó bắt được lỗi cú pháp, thiếu `main()`, import ngoài registry
module, code quá lớn; nó **không** bắt được sai tên bảng/field hay lỗi logic —
đó là việc của `test-run`. Chạy `check` sau mỗi lần sửa: một round trip, không
tốn slot runner.

Với workflow đã tồn tại, `wf.testRun(code?, input?)` chạy code **dưới danh
nghĩa workflow đó** (xem `workflowId` bên dưới); không truyền `code` thì nó
diễn tập đúng code workflow đang giữ:

```ts
const wf = await erp.workflow("Nhắc đơn quá hạn");
const t = await wf.testRun(codeMoi, { date: "2026-08-29" });
if (!t.ok) console.error(t.error?.message, "dòng", t.error?.line, t.logs);
else await wf.update({ code: codeMoi }).then(() => wf.publish());
```

`testRun` chạy trong đúng runner thật nhưng SDK bên trong ở chế độ
`development`: mọi lệnh ghi record được validate rồi rollback (id trả về là id
giả, đừng dùng lại), `delete`/`restore`/link từ chối chạy, còn `createObject`/
`addField` và mọi thứ gửi ra ngoài (mail, bot, webhook) là **thật**. Tối đa
1 phút. `ok: false` là script lỗi trong khi request vẫn 200 (đọc
`error.message`/`error.line`); `503` là runner bận — gửi lại đúng code đó, đừng
viết lại script. Cần quyền `workflow:run:create`.

Khác `wf.run()`, `testRun` **không** bị chặn khi `ERP_ENV=development` — diễn
tập chính là mục đích của nó.

`workflowId` cho script mượn danh nghĩa của một workflow đã có: env đã lưu của
nó được giải mã đưa cho run, và các shared variable nó được cấp trả lời — đó là
điều kiện để test được script verify chữ ký hoặc gọi API bằng key. Cần quyền
**manage** trên workflow đó, đúng bằng quyền đã set env cho nó; env vẫn không
bao giờ trả về cho người gọi. Không truyền `workflowId` thì code không thuộc
workflow nào: `process.env` là `{}`, và request cũng không được gửi kèm env.

## 4. Env: nơi duy nhất cất secret

Script không có biến môi trường của máy chủ; mọi khoá (SMTP, bot token, API key
model) đi qua env của chính workflow, đọc trong script bằng `env.X` /
`process.env.X`.

```ts
await wf.setEnv({ SMTP_PASSWORD: "…", BOT_TOKEN: "…" });
wf.envNames;      // ["SMTP_PASSWORD", "BOT_TOKEN"] — giá trị luôn là "***"
```

Ba điều dễ mất dữ liệu nếu không nhớ:

1. **Thay nguyên map.** Tên nào không gửi là bị xoá.
2. **Giá trị không đọc lại được, bao giờ cũng vậy** — mã hoá lúc lưu, chỉ giải
   mã khi run bắt đầu. Muốn giữ một giá trị đang có thì gửi kèm sentinel
   `WORKFLOW_ENV_KEEP` (`"[KEEP]"`):
   ```ts
   await wf.setEnv({ SMTP_PASSWORD: WORKFLOW_ENV_KEEP, BOT_TOKEN: "token-mới" });
   ```
   Giữ một tên chưa từng có giá trị → 400.
3. Đổi env **không** tăng version, không đưa workflow về draft, không huỷ lịch
   cron; run kế tiếp tự lấy giá trị mới. Tối đa 50 entry, tên theo
   `[A-Za-z_][A-Za-z0-9_]*`.

## 4b. Shared variable: chỗ run này để lại cho run sau

Env là nơi cất **secret**; shared variable là nơi cất **trạng thái**: checkpoint,
con trỏ đồng bộ, id của thứ vừa xử lý. Chỉ chuỗi, đọc lại được nguyên văn, và
một biến có thể dùng chung cho nhiều workflow.

```ts
await erp.variables.create({
  key: "invoice.cursor",
  value: "2026-08-01",
  description: "Hoá đơn đã đồng bộ tới đâu",
  workflowIds: [wf.id, other.id],       // ai được đọc/ghi nó
});
```

Trong script thì chỉ có hai dòng đáng nhớ:

```ts
const since = (await erp.variables.value("invoice.cursor")) ?? "2026-01-01";
// … xử lý …
await erp.variables.set("invoice.cursor", moc_moi);
```

`value(key)` trả `undefined` khi chưa có gì để đọc — đúng cảnh run đầu tiên —
còn `get(key)` ném `UnknownWorkflowVariableError`.

Bốn điều quyết định cách dùng:

1. **`workflowIds` là toàn bộ mô hình quyền**, và không tách đọc với ghi:
   workflow nào được tin để đọc checkpoint của mình thì cũng được tin để dời nó.
   Danh sách rỗng = không run nào chạm tới. Mọi id phải là workflow **cùng
   workspace**; không có biến dùng chung giữa hai workspace.
2. **Trong run, danh sách đó thu hẹp quyền của chính người chạy.** Token của run
   nói rõ nó là workflow nào, nên script chỉ thấy biến workflow đó được cấp —
   key không được cấp trả 404 y như key không tồn tại.
3. **Run chỉ được đặt `value`.** Tạo, xoá, đổi `description` hay `workflowIds`
   là việc của người dùng qua session của họ; script gọi sẽ nhận 403.
4. **Ghi đè, không khoá lạc quan.** Ai ghi sau thắng — đúng thứ một checkpoint
   cần. Trần: key ≤ 128 ký tự theo `[A-Za-z][A-Za-z0-9_.-]*`, value ≤ 16 384 ký
   tự, ≤ 100 workflow một biến.

Ở `ERP_ENV=development` (test-run là chế độ này), **đọc vẫn chạy còn ghi bị từ
chối** bằng `DryRunUnsupportedError`: server không có dry run cho nó, mà một
lần diễn tập âm thầm dời con trỏ thật thì run thật sau đó sẽ bỏ sót dữ liệu.
Muốn dời thật thì `erp.variables.set(key, value, { dryRun: false })`.

## 5. Chạy và chờ kết quả

Run là **hàng đợi**: `run()` trả về ngay với `status: "ENQUEUED"`.

```ts
const started = await wf.run({ ngay: "2026-08-14" });   // input → main(input)
const done    = await wf.waitForRun(started.id, { timeoutMs: 60_000 });

// gộp hai bước
const done2 = await wf.runAndWait({ ngay: "2026-08-14" });

runResult(done);   // giá trị main() trả về
runLogs(done);     // các dòng console.log
```

Vòng đời: `ENQUEUED` → `PENDING` (đang chạy) → `SUCCESS` | `ERROR`.
`isRunFinished(status)` trả lời "xong chưa".

- `ERROR` → `waitForRun` ném `WorkflowRunFailedError`, `run.error` là đúng
  message script đã throw (kèm log). Muốn tự xử lý thì
  `{ throwOnError: false }`.
- Hết giờ chờ → `WorkflowRunTimeoutError`. **Run không bị huỷ** — nó vẫn chạy
  tiếp, quay lại đọc bằng `getRun(runId)`.

```ts
await wf.runs({ limit: 20 });          // lịch sử run, mới nhất trước
await wf.getRun(runId);
```

`run.output` là **chuỗi JSON** `{ workflowId, version, result, logs,
durationMs }` — `runOutput(run)` parse hộ, `runResult` / `runLogs` là lối tắt.

### Chế độ development chặn `run()`

Chạy một workflow là ghi dữ liệu thật, và server **không có dry run** cho nó.
Nên khi client đang ở `ERP_ENV=development`, `run()`/`runAndWait()` ném
`DryRunUnsupportedError` thay vì âm thầm chạy thật — giống `delete` (xem
[03 — Dữ liệu](03-du-lieu.md)).

```ts
await wf.run(input, { dryRun: false });   // vẫn muốn chạy thật
```

Ngược lại, mọi thao tác *định nghĩa* (create/update/publish/setEnv/delete) là
thay đổi cấu trúc — luôn chạy thật, kể cả ở development, đúng như
`createObject`. Muốn thử code an toàn thì cho **chính script** ghi ở chế độ dry
run, hoặc publish sang một workflow riêng để thử.

## 6. Chia sẻ và quyền

```ts
await wf.sharing();                       // { visibility, entries }
await wf.setSharing("restricted", [
  { subjectType: "user", subjectId: userId, access: "write" },
]);
```

Quyền IAM đi theo hai resource `workflow` (định nghĩa) và `workflow:run` (lượt
chạy), với action `create`/`read`/`update`/`delete` như mọi resource khác:
`workflow:read` để xem, `workflow:run:create` để khởi chạy. Xem key hiện tại có
gì bằng `npx erp whoami`, hoặc kiểm thẳng:

```bash
npx erp doctor --require workflow:read --require workflow:run:create
```

Bản thân script còn bị chặn bởi quyền của người gọi: một workflow ghi vào bảng
mà người bấm chạy không có `object:record:create` sẽ fail ngay trong run.

## 7. Bẫy hay gặp

| Triệu chứng | Nguyên nhân |
| --- | --- |
| Sửa code xong chạy vẫn ra kết quả cũ | Quên `publish()` — run luôn dùng bản active |
| 409 `Workflow version conflict` | Có người (hoặc chính bạn) vừa sửa; `await wf.refresh()` rồi thử lại |
| `Invalid cron schedule` với `"0 9 * * *"` | Thiếu trường giây — phải 6 trường |
| Secret biến mất sau khi thêm khoá mới | `setEnv` thay cả map; gửi kèm `"[KEEP]"` cho các tên cũ |
| Run `ERROR` mà `output` rỗng | Script throw — đọc `run.error`, không phải `runResult` |
| Run **ngay sau `publish()`** trả `ERROR` với message chung `"Workflow run failed"` | Lỗi phía runner (chưa thấy version vừa publish), không phải code sai — đợi vài giây rồi chạy lại; message do script throw ra bao giờ cũng cụ thể hơn thế |
| `run()` ném `DryRunUnsupportedError` | Đang `ERP_ENV=development` (§5) |
| `variables.set()` ném `DryRunUnsupportedError` | Cũng là development mode — ghi biến không có dry run (§4b); `{ dryRun: false }` nếu thật sự muốn ghi |
| Script đọc biến ra `undefined` dù UI thấy có | Workflow này không nằm trong `workflowIds` của biến (§4b) |

---

[← Truy vấn SQL & dashboard](11-truy-van-sql-dashboard.md) · [Mục lục](README.md)
