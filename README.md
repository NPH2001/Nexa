# Nexa

Trợ lý AI chạy trên máy tính cá nhân, tích hợp LiteLLM và MCP Atlassian.

Triển khai theo `Nexa_Tai_lieu_thiet_ke_va_trien_khai_MVP_v1.1.docx`. Comment trong mã nguồn
tham chiếu số mục của tài liệu (ví dụ `§10.2`) để đối chiếu được hai chiều.

> **Đọc trước khi làm gì khác:** [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) — mọi giả
> định đã dùng để viết code, và những gì còn phải chốt. Có 6 mục 🔴 BLOCKER cần trả lời trước
> khi chạy với hạ tầng thật.
>
> **Sai lệch so với thiết kế:** Nexa có kết nối OpenAI trực tiếp, trái với §6 (*"Nexa không kết
> nối trực tiếp provider"*). Đã được chấp nhận 2026-08-01 nhưng **cần ATTT duyệt trước khi phát
> hành** — xem OPEN-QUESTIONS mục F1.
>
> Trạng thái so với Phụ lục C: [`docs/operations/pre-pilot-checklist.md`](docs/operations/pre-pilot-checklist.md) — **3/10 đạt**.

## Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Test | **317 unit/integration** + **12 E2E** (Electron thật) |
| Lint · typecheck | sạch |
| Build (main/preload/renderer) | chạy được |
| Chạy app thật | ✅ trên Linux — `window-ready` sau 304 ms |
| E2E desktop | ✅ 8 test qua Playwright + Electron |
| Đóng gói Windows | ⚠️ phải build trên Windows (job CI `build-windows`) — không cross-compile từ Linux |
| Xác minh DPAPI trên Windows | **chưa** (OPEN-QUESTIONS C1) |
| Kết nối LiteLLM / Jira / Confluence thật | **chưa** — mới chạy với mock server (C2) |
| Ký số bộ cài | **chưa có certificate** (C3) |

Startup log của lần chạy thật:

```
app-starting → master-key-created → local-db-opened (node:sqlite)
→ migration-applied v1 → profile-created → ipc-registered (33 channel)
→ window-ready (304 ms)
```

## Bắt đầu

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm verify     # lint + typecheck + test
pnpm dev        # chạy app ở chế độ phát triển
pnpm package:win
```

Yêu cầu **Node ≥ 22.5** (dùng `node:sqlite`). Electron 43 mang sẵn Node 24, và bộ cài **không
chứa native module nào** — test và bản phát hành chạy cùng một driver SQLite.
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
│  ├─ document-processor/      TXT/PDF/DOCX, worker, chunking (EPIC-06)
│  └─ agent-runtime/           Vòng lặp tool, confirmation guard, operation tracker (EPIC-08)
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

| Bất biến | Nguồn | Test |
|---|---|---|
| Tài liệu KHÔNG gửi được tới model ngoài tổ chức khi chưa allowlist tường minh | F1 | `agent-runtime.test.ts` |
| API key/PAT không nằm dạng rõ trong SQLite, file config hay log | §11.1 | `security.test.ts`, `connection-config.test.ts` |
| Renderer không đọc được secret, không gọi mạng, không chạm file system | §5.3, §11.3 | `main.test.ts`, CSP `connect-src 'none'` |
| Đường dẫn file không bao giờ rời main process | §5.3 | `main.test.ts` → FileBroker |
| Tool write không chạy khi chưa xác nhận | §17.2-2 | `agent-runtime.test.ts` |
| Payload đổi sau preview ⇒ approval vô hiệu | §17.2-3 | `agent-runtime.test.ts` |
| Bấm xác nhận hai lần chỉ tạo một đối tượng | §17.2-4 | `agent-runtime.test.ts` + unique index |
| Write timeout ⇒ `uncertain`, không tự retry | §17.2-5 | `agent-runtime.test.ts` |
| Nội dung hội thoại mã hoá, không đọc được bằng công cụ SQLite thường | §21 | `local-store.test.ts` |
| Chỉ HTTPS, chặn URL nhúng credential, allowlist domain | §11.2 | `security.test.ts` |

## Lệnh

| Lệnh | Việc |
|---|---|
| `pnpm verify` | lint + typecheck + test |
| `pnpm test` | test |
| `pnpm test -- packages/agent-runtime` | test một package |
| `pnpm test -- tests/performance.test.ts` | test hiệu năng, in số đo thật |
| `pnpm test:e2e` | E2E desktop — chạy Electron thật (cần display) |
| `pnpm typecheck` | `tsc --noEmit` toàn repo |
| `pnpm dev` | chạy app |
| `pnpm build` | build main/preload/renderer |
| `pnpm package:win` | đóng gói NSIS + MSI |

## Cấu hình vận hành

**Chính sách tổ chức** — `apps/desktop/resources/policy.json`, IT ghi đè lúc phân phối. Người
dùng không sửa được. Dùng để đặt allowlist domain, khoá feature flag, đặt trần retention và URL
version manifest.

**MCP Atlassian** — package chưa được chốt (OPEN-QUESTIONS A4 🔴). Ghi đè để thử package khác:

```bash
NEXA_MCP_COMMAND=uvx NEXA_MCP_ARGS="mcp-atlassian" pnpm dev
```

## Điều tra sự cố

Xem [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Tóm tắt: mỗi lỗi kèm `request_id`, mỗi thao tác write kèm `operation_id`. Ghép ba nguồn — log
cục bộ (Cài đặt → Chẩn đoán → Xuất gói chẩn đoán), usage log LiteLLM, activity/audit Atlassian.
