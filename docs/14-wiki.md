# 14 — Wiki & RAG

[← Tệp & thư mục](13-tep-va-thu-muc.md) · [Mục lục](README.md)

Wiki là **trí nhớ chung của workspace**: những gì đã kết luận, viết ra một lần
và liên kết lại với nhau, thay vì nằm rải trong chat và file. Mỗi workspace có
đúng một wiki.

Nó dựng theo mô hình wiki-cho-LLM: bốn loại trang, nguồn bất biến, wikilink
`[[slug]]`, catalog sinh theo yêu cầu, log append-only và một lần lint để soi
chỗ mục nát. Phần thêm vào là **RAG**: gắn tài liệu từ drive vào một trang,
server index nó, rồi `ask` trả về đúng những đoạn trả lời được câu hỏi.

```
nguồn (ingestSource / attachFile)
        │
        ▼
    trang (draft) ──publish──► trang workspace tin được
        │  [[link]] sang trang khác
        ▼
    catalog · search · lint      ask(slug, câu hỏi) ──► các đoạn trích + nguồn
```

## 1. Slug là địa chỉ, không phải tiêu đề

Slug sinh **một lần** lúc tạo trang, gấp dấu tiếng Việt về chữ cái gốc, và
**không đổi khi tiêu đề đổi**. Mọi lệnh sau đó đều gọi theo slug.

```ts
import { wikiSlug } from "erp-sdk";

wikiSlug("Chính sách tồn kho");   // "chinh-sach-ton-kho"
wikiSlug("Hoá đơn bán hàng");     // "hoa-don-ban-hang" — không phải "ho-n"
```

Trang đầu tiên chiếm được tên thì giữ slug đẹp; trang thứ hai trùng tên bị thêm
đuôi ngẫu nhiên — nên **slug do lệnh tạo trả về mới là cái để lưu**. Không nhớ
slug thì `wiki.search(text)`; gọi sai slug thì `UnknownWikiPageError`.

## 2. Bốn loại trang

| `type` | Viết về | Ví dụ |
| --- | --- | --- |
| `entity` | Một thực thể: khách hàng, nhà cung cấp, sản phẩm | "Nhà cung cấp Minh Long" |
| `concept` | Một khái niệm, chính sách, quy trình | "Chính sách tồn kho" |
| `comparison` | So sánh nhiều thứ cạnh nhau | "Kho Bình Dương vs Long An" |
| `query` | Kết quả một lần đi tìm hiểu, lưu lại | "Vì sao tồn kho nhóm A tăng Q2" |

`summary` là **một dòng** và là thứ duy nhất catalog hiển thị — viết cho người
lướt, không phải tóm tắt bài. `body` là Markdown, `[[slug]]` để liên kết.
`confidence` (`high`/`medium`/`low`) và `contested: true` là tín hiệu chất
lượng mà lint đọc.

```ts
const page = await erp.wiki.createPage({
  title: "Chính sách tồn kho",
  type: "concept",
  summary: "Mức tồn tối thiểu theo nhóm hàng và ai được duyệt vượt mức.",
  body: "Nhóm A giữ 30 ngày. Quy trình nhập xem [[quy-trinh-nhap-kho]].",
  tags: ["kho"],
  confidence: "medium",
  sourceIds: [source.id],
});
page.slug;      // "chinh-sach-ton-kho"
page.status;    // "draft" — luôn luôn
```

## 3. Viết rồi mới publish

**Mọi trang rơi vào `draft`**, kể cả mỗi lần sửa một trang đã publish — đổi thứ
workspace đang dựa vào thì phải có người quyết định lại.

```ts
await erp.wiki.updatePage(slug, { body, confidence: "high" });  // → về draft
await erp.wiki.publishPage(slug);    // cần wiki:manage
await erp.wiki.archivePage(slug);    // nghỉ hưu, link trỏ vào vẫn sống
await erp.wiki.deletePage(slug);     // link trỏ vào thành link gãy
```

`archive` gần như luôn là thứ bạn muốn thay vì `delete`: xoá trang không xoá
các link trỏ vào nó, chỉ biến chúng thành link gãy (và lint sẽ kêu).

Handle gói một trang lại cho gọn:

```ts
const p = await erp.wikiPage("chinh-sach-ton-kho");
p.brokenLinks;                      // ["quy-trinh-nhap-kho"] — trỏ vào chỗ trống
await p.update({ summary: "…" });
await p.publish();
```

## 4. Đọc wiki: catalog và search

```ts
const catalog = await erp.wiki.catalog();                 // gom theo type
const concepts = await erp.wiki.catalog({ type: "concept", status: "published" });
const matches = await erp.wiki.search("tồn kho", { limit: 10 });
const detail = await erp.wiki.page("chinh-sach-ton-kho"); // body + nguồn + link hai chiều
```

Catalog sinh theo từng request nên không bao giờ lệch với các trang — đây là
thứ nên đọc **đầu tiên** khi trả lời một câu hỏi từ wiki, trước khi search.
`tag` trong bộ lọc cũng được slug hoá, nên "Kho hàng" và `kho-hang` tìm ra một
thứ.

## 5. Hai loại nguồn — và chúng khác nhau

**Source** là văn bản nạp thẳng vào wiki, bất biến, để trang trích dẫn:

```ts
const source = await erp.wiki.ingestSource({
  kind: "note",            // article | paper | transcript | note
  title: "Biên bản họp kho 08/2026",
  body: text,
  sourceUrl: "https://…",  // tuỳ chọn
});
const { sources } = await erp.wiki.sources();
```

Sửa nội dung nghĩa là **nạp một source mới** — đó là điều làm một trích dẫn
đứng yên được.

**Attachment** là một tệp trên drive được sao vào wiki rồi index để hỏi:

```ts
const file = await erp.files.upload({ folderId, name: "quy-che-kho.pdf", content: pdf });
const attached = await erp.wiki.attachFile(slug, file.id);   // 202, index chạy nền
await erp.wiki.waitForIndex(attached.id);                    // pending → indexing → ready
await erp.wiki.detachFile(slug, attached.id);
```

> **Gắn tệp là mở tệp cho cả wiki.** Bản sao thuộc về wiki từ lúc đó: chia sẻ
> riêng của tệp gốc hết hiệu lực, ai đọc được wiki là hỏi được nội dung tài
> liệu. Người gắn thì phải tự đọc được tệp đó.

`indexStatus: "failed"` (kèm `indexError`) nghĩa là tài liệu đó `ask` sẽ không
bao giờ tìm thấy — hay gặp nhất là MIME sai vì đuôi tên lạ lúc upload.

## 6. RAG — `ask` trong phạm vi một trang

```ts
const passages = await erp.wiki.ask(
  "chinh-sach-ton-kho",
  "Nhóm A giữ tồn tối thiểu bao nhiêu ngày?",
  { limit: 5 },
);

for (const p of passages) {
  console.log(`${p.source} (trang ${p.pageNumber ?? "?"}): ${p.text}`);
  p.link;   // link quay lại đúng đoạn, để trích dẫn
}
```

Ba điều quyết định cách dùng nó:

- **Chỉ trong tài liệu đã gắn vào trang đó**, không đi xa hơn. Muốn hỏi rộng
  thì `search` catalog trước để chọn trang, rồi `ask` trong trang ấy.
- Khớp **cả theo nghĩa lẫn theo chữ**, nên câu hỏi viết như người hỏi được, mà
  mã số/tên riêng cũng không bị nghĩa hoá mất.
- Nó **truy hồi chứ không viết câu trả lời**: cái trả về là ngữ cảnh để đưa cho
  model, hoặc đoạn trích để người đọc. Muốn có câu trả lời thành văn thì tự
  ghép prompt — và trích nguồn bằng `p.source`/`p.link`.

`503` là indexer/model embedding không sẵn sàng, không phải trang không có gì.

## 7. Quy ước và lint

```ts
await erp.wiki.setSettings({
  domain: "Vận hành kho và mua hàng của công ty",
  conventions: "Mỗi trang ≥ 2 link ra. Số liệu phải có nguồn. Không đoán.",
  taxonomy: ["kho", "mua-hang", "nha-cung-cap"],
});

const report = await erp.wiki.lint();
report.findings;    // { kind, severity, subject, detail }
const { entries } = await erp.wiki.log();
```

`conventions` là house style mà mọi trang bị soi theo — đó là thứ khiến wiki do
nhiều người (và nhiều agent) viết vẫn đọc như một. `lint` soi link gãy, trang
mồ côi, trang `contested`, trang cũ, nguồn mỏng, tag ngoài taxonomy; nó cần
quyền `wiki:update` chứ không phải read, vì có ghi `lintedAt` và ghi log.

## 8. Quyền

| Việc | Quyền |
| --- | --- |
| Đọc catalog, trang, search, log, `ask` | `wiki:read` — sàn của mọi role |
| Tạo/sửa trang, nạp source, gắn tệp | `wiki:create` / `wiki:update` |
| `lint` | `wiki:update` (nó ghi log) |
| `publish`, đặt `conventions` | `wiki:manage` |

Role `maintainer` trở lên có đủ. Service account của mini app là `writer`:
**đọc được wiki, không viết được** — mini app trả lời bằng wiki thì được, tự
biên tập wiki thì phải cấp quyền riêng.

Wiki không có dry run trên server: ở `ERP_ENV=development` mọi thao tác trang
vẫn ghi thật (trang là định nghĩa, không phải record), trừ `deletePage` — không
hoàn tác được nên nó từ chối chạy trong lúc diễn tập.

## 9. Vòng làm việc, gói gọn

```
đọc catalog  →  đã có trang chưa?
      │                │ có → update (về draft) → publish
      │ chưa
      ▼
ingestSource / attachFile  →  createPage (≥ 2 link ra)  →  publish
      │
      ▼
lint định kỳ → sửa link gãy, trang mồ côi, tag ngoài taxonomy
```

Đừng tạo trang cho mọi thứ vừa đọc được: ngưỡng thường dùng là **được nhắc ở
≥ 2 nguồn, hoặc là trung tâm của một nguồn**. Wiki đầy trang một dòng thì
catalog thành nhiễu.

---

[← Tệp & thư mục](13-tep-va-thu-muc.md) · [Mục lục](README.md)
