# `erp` CLI — tham chiếu

Cài kèm gói `erp-sdk` (`npx erp …`, hoặc `erp` khi cài global).
Kết quả **luôn là JSON trên stdout**; ghi chú và lỗi là JSON trên stderr.
Exit code: `0` OK, `1` lỗi runtime/API, `2` sai cú pháp.

`erp help --json` trả toàn bộ command surface dạng máy đọc — dùng cái này thay
vì đoán tên lệnh.

## Kết nối

| Flag | Env | Ý nghĩa |
| --- | --- | --- |
| `--base-url <url>` | `ERP_BASE_URL` | Base URL của ERP (SDK tự thêm `/api/v1`) |
| `--api-key <erp_sk_…>` | `ERP_API_KEY` | Key của service account |
| `--token <jwt>` | `ERP_ACCESS_TOKEN` | Access token của user (thay cho key) |
| `--workspace <id>` | `ERP_WORKSPACE_ID` | Chỉ dùng kèm `--token` |
| `--env-file <path>` | — | Nạp KEY=VALUE từ file; env thật vẫn thắng |
| `--compact` | — | JSON một dòng |

## Lệnh

```
erp doctor [--require resource:action]…   env + kết nối + quyền → {ok, checks[]}
erp whoami                                danh tính + permission hiệu lực
erp perms list | perms check <resource> <action>

erp objects list [--fields]
erp objects show <object>
erp objects create <name> [--position n]
erp objects ensure <name> [--field "Name:type[:config]"]…
erp objects delete <object> --yes

erp fields types
erp fields add <object> <name> <type> [--config json] [--position n]
erp fields update <object> <field> [--name x] [--config json] [--position n] [--archive]

erp records query <object> [--where …]… [--sort …]… [--limit n] [--cursor c]
                           [--all] [--max n] [--total] [--select "A,B"] [--by name|key] [--raw]
erp records count <object> [--where …]…
erp records get <object> <id>
erp records create <object> [--data json] [--set "Field=value"]…
erp records update <object> <id> [--data json] [--set …]… [--version n]
erp records delete <object> <id> [--version n]
erp records restore <object> <id> --version n

erp links list <object> <id> <field> [--direction outgoing|incoming]
erp links add <object> <id> <field> <target-id> [--position n]
erp links remove <object> <id> <field> <target-id>

erp schema dump [--out file]
erp init [dir] [--name x] [--object x] [--sdk spec] [--force]
erp skill install [--dir path] [--force] | erp skill path
erp help [command] [--json]
```

## Cú pháp giá trị

**Filter** — `--where "Field:operator:value"`, hoặc `--where "Field=value"` (viết
tắt của `equals`). Toán tử: `equals`, `not_equals`, `contains`, `greater_than`,
`greater_than_or_equal`, `less_than`, `less_than_or_equal`, `is_empty`,
`is_not_empty` (hai cái cuối không cần value). Lặp `--where` = AND.

**Sort** — `--sort "Field:desc"` (mặc định `asc`), tối đa 3.

**Gán giá trị** — `--set "Field=value"` (lặp được) hoặc `--data '{"Field":…}'`.

**Ép kiểu**: chuỗi nào parse được thành JSON thì là JSON (`42` → number, `true` →
boolean, `null` → null), còn lại là string (`approved`, `2026-08-03`). Cần chính
xác kiểu (ví dụ chuỗi `"42"`) thì dùng `--data`.

**Field spec** cho `objects ensure` — `"Name:type"`, `"Name:type:{json config}"`,
hoặc viết tắt cho select: `"Trạng thái:single_select:pending,approved,rejected"`.

## Ví dụ

```bash
# Khám phá trước khi code
erp doctor --require object:record:create
erp schema dump --out schema.json

# Dựng bảng idempotent
erp objects ensure "Đơn xin nghỉ" \
  --field "Người xin nghỉ:single_select:{\"source\":\"workspace_users\"}" \
  --field "Lý do:long_text" \
  --field "Từ ngày:date" \
  --field "Trạng thái:single_select:pending,approved,rejected"

# Đọc dữ liệu
erp records query "Đơn xin nghỉ" --where "Trạng thái=pending" --sort "Từ ngày:desc" --limit 20
erp records query "Hóa đơn" --where "Tổng tiền:greater_than:1000000" --all --select "Khách hàng,Tổng tiền"
erp records count "Đơn xin nghỉ" --where "Trạng thái=pending"

# Ghi dữ liệu
erp records create "Đơn xin nghỉ" --set "Lý do=Việc gia đình" --set "Từ ngày=2026-08-03"
erp records update "Đơn xin nghỉ" <id> --set "Trạng thái=approved"

# Kết hợp với jq
erp records query "Hóa đơn" --all --compact | jq '.records | length'
```

## Lỗi

Lỗi in ra stderr dạng `{"error":{…}}` kèm `type` và gợi ý:

| `type` | Ý nghĩa |
| --- | --- |
| `UsageError` | Sai cú pháp/thiếu tham số (exit 2) |
| `MissingPermissionsError` | Key thiếu quyền — `.missing` liệt kê cặp resource:action |
| `UnknownObjectError` | Không có object đó — chạy `erp objects list` |
| `UnknownFieldError` | Không có field đó — `.known` liệt kê field hợp lệ |
| `ErpApiError` | Backend trả non-2xx — có `.status`, `.trace`, `.details` |
