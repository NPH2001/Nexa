# Nexa

Trợ lý AI chạy trên máy tính cá nhân, tích hợp LiteLLM và MCP Atlassian.

Triển khai theo `Nexa_Tai_lieu_thiet_ke_va_trien_khai_MVP_v1.1.docx`. Comment trong mã nguồn
tham chiếu số mục của tài liệu (ví dụ `§10.2`) để đối chiếu được hai chiều.

> **Đọc trước khi làm gì khác:** [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) — mọi giả
> định đã dùng để viết code, và những gì còn phải chốt. Có 11 mục 🔴 BLOCKER cần trả lời trước
> khi chạy với hạ tầng thật.
>
> **Sai lệch so với thiết kế:** Nexa có kết nối OpenAI trực tiếp, trái với §6 (_"Nexa không kết
> nối trực tiếp provider"_). Đã được chấp nhận 2026-08-01 nhưng **cần ATTT duyệt trước khi phát
> hành** — xem OPEN-QUESTIONS mục F1.
>
> **Đi trước một mục đang chờ duyệt:** đính kèm ảnh trong Chat đã được bật 2026-09-01 theo yêu
> cầu, trong khi hợp đồng consent cho ảnh (mục I1) vẫn đang mở. Ảnh đã được gỡ EXIF/XMP và áp
> cùng cổng fail-closed như tài liệu, nhưng **cần ATTT xem lại trước khi phát hành** — xem
> OPEN-QUESTIONS mục J1. Phần ảnh của Không gian Nghiệp vụ thì vẫn dừng.
>
> Trạng thái so với Phụ lục C: [`docs/operations/pre-pilot-checklist.md`](docs/operations/pre-pilot-checklist.md) — **3/10 đạt**.

## Trạng thái

| Hạng mục                                 | Trạng thái                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Test                                     | **1108 unit/integration** + **33 E2E** được định nghĩa (31 Linux + 2 Windows-only) |
| Lint · typecheck                         | sạch                                                                               |
| Build (main/preload/renderer)            | chạy được                                                                          |
| Chạy app thật                            | ✅ trên Linux — `window-ready` sau 304 ms                                          |
| E2E desktop                              | ✅ 31 test Linux qua Playwright + Electron; 2 test DPAPI/startup dành cho Windows  |
| Đóng gói Windows                         | ⚠️ phải build trên Windows (job CI `build-windows`) — không cross-compile từ Linux |
| Xác minh DPAPI trên Windows              | **chưa** (OPEN-QUESTIONS C1)                                                       |
| Kết nối LiteLLM / Jira / Confluence thật | **chưa** — mới chạy với mock server (C2)                                           |
| Ký số bộ cài                             | **chưa có certificate** (C3)                                                       |

Startup log của lần chạy thật:

```
app-starting → master-key-created → local-db-opened (node:sqlite)
→ migration-applied v1 → profile-created → ipc-registered (35 channel)
→ window-ready (304 ms)
```

## Bắt đầu

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm verify     # lint + typecheck + test
pnpm dev        # chạy app ở chế độ phát triển
pnpm package:win # chạy trên Windows hoặc job CI build-windows
```

Yêu cầu **Node ≥ 22.12** (đáp ứng toolchain Vite/electron-vite và dùng `node:sqlite`). Electron
43 mang sẵn Node 24, và bộ cài **không chứa native module nào** — test và bản phát hành chạy
cùng một driver SQLite.
Xem [ADR 0003](docs/architecture/adr/0003-sqlite-driver-abstraction.md) (đã được chốt).

## Cấu trúc

```
nexa/
├─ apps/desktop/
│  ├─ src/main/       Electron main: IPC, secure storage, MCP, orchestration
│  ├─ src/preload/    Bridge IPC (2 KB, không có zod, không có Node)
│  └─ src/renderer/   React UI
├─ packages/
│  ├─ shared-types/            Type, Zod schema IPC, mã lỗi (Phụ lục B)
│  ├─ observability/           Logger + Redactor + request id  (EPIC-10)
│  ├─ security/                Mã hoá, secure storage, URL validator, payload hash (EPIC-02/11)
│  ├─ local-store/             SQLite, migration, repository, search, retention (EPIC-05)
│  ├─ llm-client/              Client OpenAI-compatible (LiteLLM + OpenAI) + SSE parser (EPIC-04)
│  ├─ mcp-client/              MCP JSON-RPC trên stdio (EPIC-07)
│  ├─ atlassian-mcp-manager/   Lifecycle MCP + danh mục tool + preview (EPIC-07)
│  ├─ connection-config/       Connection/model/settings service (EPIC-02/03)
│  ├─ daily-briefing/         Nhóm và xếp hạng bản tin công việc theo ngày — thuần, không DB/LLM/MCP
│  ├─ document-processor/      Office + PDF + ảnh, worker, chunking (EPIC-06)
│  ├─ agent-runtime/           Vòng lặp tool, confirmation guard, operation tracker (EPIC-08)
│  └─ ba-kit/                  Mô hình tài liệu BA, template, rulebook, dò trùng, phép chiếu
│                                (Markdown · Mermaid · ma trận · trang mã lỗi) — thuần, không DB/LLM
├─ docs/
│  ├─ OPEN-QUESTIONS.md        ⚠️ Câu hỏi cần review
│  ├─ RUNBOOK.md               Điều tra sự cố, đối chiếu request_id (§15.2)
│  ├─ design-doc-v1.1.md       Bản trích xuất tài liệu thiết kế (grep/diff được)
│  ├─ architecture/adr/        Quyết định kiến trúc
│  ├─ integration/             Hợp đồng LiteLLM · MCP · IPC · update (§9)
│  ├─ operations/              Phân phối IT · thu hồi bản lỗi · checklist trước pilot
│  └─ security/threat-model.md Threat model §11.3 + trường cấm log
├─ scripts/                    Trích xuất tài liệu .docx sang Markdown
├─ tests/
│  ├─ fixtures/                Mock MCP server
│  └─ support/                 Factory dùng chung cho test
└─ TASKLIST.md                 Kế hoạch triển khai theo epic
```

## Các bất biến bảo mật

Đây là những điều **phải** đúng. Mỗi mục có test khẳng định; đừng gỡ chúng khi refactor.

| Bất biến                                                                                             | Nguồn       | Test                                            |
| ---------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| Tài liệu KHÔNG gửi được tới model ngoài tổ chức khi chưa allowlist tường minh                        | F1          | `agent-runtime.test.ts`                         |
| API key/PAT không nằm dạng rõ trong SQLite, file config hay log                                      | §11.1       | `security.test.ts`, `connection-config.test.ts` |
| Renderer không đọc được secret, không gọi mạng, không chạm file system                               | §5.3, §11.3 | `ipc.test.ts`, E2E CSP, `connect-src 'none'`    |
| Đường dẫn file không bao giờ rời main process                                                        | §5.3        | `main.test.ts` → FileBroker                     |
| Tool write không chạy khi chưa xác nhận                                                              | §17.2-2     | `agent-runtime.test.ts`                         |
| Payload đổi sau preview ⇒ approval vô hiệu                                                           | §17.2-3     | `agent-runtime.test.ts`                         |
| Bấm xác nhận hai lần chỉ tạo một đối tượng                                                           | §17.2-4     | `agent-runtime.test.ts` + unique index          |
| Write timeout ⇒ `uncertain`, không tự retry                                                          | §17.2-5     | `agent-runtime.test.ts`                         |
| Nội dung hội thoại mã hoá, không đọc được bằng công cụ SQLite thường                                 | §21         | `local-store.test.ts`                           |
| Chỉ HTTPS, chặn URL nhúng credential, allowlist domain                                               | §11.2       | `security.test.ts`                              |
| Bản đóng gói dùng `nexa://`, không có đặc quyền `file://`, không chạy như Node và chỉ tải `app.asar` | §11.3       | Protocol boundary tests + Electron fuse gate    |

## Lệnh

| Lệnh                                     | Việc                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `pnpm verify`                            | lint + typecheck + test                        |
| `pnpm test`                              | test                                           |
| `pnpm test -- packages/agent-runtime`    | test một package                               |
| `pnpm test -- tests/performance.test.ts` | test hiệu năng, in số đo thật                  |
| `pnpm test:e2e`                          | E2E desktop — chạy Electron thật (cần display) |
| `pnpm typecheck`                         | `tsc --noEmit` toàn repo                       |
| `pnpm dev`                               | chạy app                                       |
| `pnpm build`                             | build main/preload/renderer                    |
| `pnpm package:win`                       | đóng gói NSIS + MSI                            |
| `pnpm package:dir`                       | đóng gói thư mục cho smoke test cục bộ         |

Các lệnh đóng gói là **root-only**: chạy từ workspace root để builder thu thập đúng các package
source-only và dependency đã hoist. CI thực thi cùng contract này; đóng gói riêng từ
`apps/desktop` không được hỗ trợ.

## Cấu hình vận hành

**Chính sách tổ chức** — `apps/desktop/resources/policy.json`, IT ghi đè lúc phân phối. Người
dùng không sửa được. Dùng để đặt allowlist domain, tắt hoàn toàn OpenAI trực tiếp bằng
`allowDirectOpenAi: false`, khoá feature flag, đặt trần retention và URL version manifest.

**Thu hẹp danh mục tool** — cờ `toolScoping`, mặc định **bật** (ADR 0009). Mỗi lượt chỉ gửi cho
model một trong sáu preset tool thay vì cả 98, giảm 36–82% token khối `tools` (98 tool ≈ 10.661
token mỗi vòng, nhân với `maxToolIterations`). Model tự xin danh mục đầy đủ bằng cách gọi
`nexa_mo_rong_tool`, nên thu hẹp không chặn được việc gì. Đây **không** phải cờ quyền: nó đổi cái
model *thấy*, không đổi cái được phép *chạy*. Tắt toàn tổ chức bằng `forcedFeatures` trong
`policy.json`:

```json
{ "forcedFeatures": { "toolScoping": false } }
```

**Định dạng file đính kèm** — openspec `add-multi-format-file-upload`.

| Nhóm         | Định dạng                                        | Cách đọc                                                          |
| ------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| Văn bản      | `.txt` `.md` `.csv` `.tsv` `.log`                | đoán encoding theo BOM, dự phòng windows-1258                     |
| PDF          | `.pdf`                                           | `pdfjs-dist`, cảnh báo bản scan; **không OCR**                     |
| Word         | `.docx` · `.doc`                                 | `mammoth` · piece table Word 97 viết trong repo                    |
| Excel        | `.xlsx` `.xlsm` · `.xls`                         | OOXML · BIFF8, cả hai viết trong repo; ô ngày ra ISO, không ra số  |
| PowerPoint   | `.pptx` `.pptm` · `.ppt`                         | OOXML · cây bản ghi PowerPoint 97                                  |
| Ảnh          | `.png` `.jpg` `.jpeg` `.webp` `.gif`             | gửi cho model thị giác, **đã gỡ EXIF/XMP** trước khi rời máy       |

Bộ đọc cho Office và ảnh **viết trong repo, không thêm dependency nào** — mọi byte ở đây đến từ
file không tin cậy, và mọi lối bung dữ liệu (inflate, chain sector, chuỗi bản ghi) đều có trần
tường minh. Xem `packages/document-processor/src/zip-reader.ts` và `cfb.ts`.

Ảnh cần model được đánh dấu **"Đọc được ảnh"** ở Cài đặt → Model. Mặc định tắt cho mọi model, kể
cả model đã cấu hình từ trước: LiteLLM không cho biết model nhận được phương thức nào, và đoán sai
nghĩa là gateway lặng lẽ bỏ ảnh đi rồi model trả lời trôi chảy về tấm ảnh nó chưa từng thấy. Ảnh
không vừa cửa sổ ngữ cảnh là **lỗi**, không phải một lần cắt bớt im lặng.

**Không gian Nghiệp vụ (BA)** — cờ `baWorkbench`, mặc định **tắt** (openspec `add-ba-workbench`).
Bật trong Cài đặt → Dữ liệu & quyền riêng tư. Khi bật, Nexa thêm một đích **Nghiệp vụ** gồm kho tri
thức nghiệp vụ đã xác nhận, tài liệu có cấu trúc, trang mã lỗi và bộ kiểm tra tài liệu, cùng ba tool
chat chỉ đọc `nexa_ba_tra_cuu_tri_thuc`, `nexa_ba_tong_hop_ma_loi` và `nexa_ba_kiem_tra_tai_lieu`.
Tri thức nghiệp vụ **luôn** ở lại trong tổ chức — không có tuỳ chọn chia sẻ ra provider ngoài cho
từng mục, khác với memory.

Bộ kiểm tra chạy một **rule pack có phiên bản** gồm các hàm thuần trên mô hình tài liệu: cùng tài
liệu và cùng phiên bản luật thì ra cùng tập phát hiện, mỗi lần chạy. Model không ra phán quyết —
nó chỉ được nhờ đề xuất câu chữ cho một phát hiện mà code đã sinh ra, và áp dụng là thao tác riêng
của người dùng cho từng chỗ. Báo cáo nêu rõ đã kiểm bộ luật nào, bao nhiêu luật, luật nào **chưa**
kiểm được và bao nhiêu mục còn cần soát đã bị loại; nó không bao giờ kết luận tài liệu đã đầy đủ.

Bộ mẫu tài liệu và chuẩn validate ship kèm bản cài ở `apps/desktop/resources/ba-templates.json` và
`ba-rulebook.json`; IT ghi đè hai file này lúc phân phối đúng như `policy.json`. Người dùng cuối
chọn mẫu chứ không sửa mẫu. File hỏng chỉ làm mất mẫu đó, không làm hỏng khởi động app.

Khoá toàn tổ chức bằng `forcedFeatures` trong `policy.json`:

```json
{ "forcedFeatures": { "baWorkbench": false } }
```

**MCP Atlassian** — package chưa được chốt (OPEN-QUESTIONS A4 🔴). Ghi đè để thử package khác:

```bash
NEXA_MCP_COMMAND=uvx NEXA_MCP_ARGS="mcp-atlassian" pnpm dev
```

## Điều tra sự cố

Xem [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Tóm tắt: mỗi lỗi kèm `request_id`, mỗi thao tác write kèm `operation_id`. Ghép ba nguồn — log
cục bộ (Cài đặt → Chẩn đoán → Xuất gói chẩn đoán), usage log LiteLLM, activity/audit Atlassian.
