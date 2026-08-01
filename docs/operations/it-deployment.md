# Phân phối Nexa cho đội IT

Hiện thực T-12-16. Dành cho đội IT/endpoint management triển khai Nexa cho nhân viên.

> Nexa hiện **chỉ hỗ trợ Windows 10/11 64-bit** (§12.1). Bộ cài cho macOS/Linux không tồn tại.

## Bộ cài được build ở đâu

**Trên Windows, không phải Linux.** Job `build-windows` trong CI (`windows-latest`) là nơi duy nhất
sinh ra artifact phát hành.

Đã thử build từ Linux: ra được thư mục `win-unpacked` nhưng bước tạo NSIS cuối cần công cụ
Windows (rcedit để nhúng icon và version info). Cài wine chỉ để lách chỗ này là thêm một biến
số vào đường phát hành mà không được lợi gì — CI đã có runner Windows.

Hệ quả với máy phát triển Linux: `pnpm build` và `pnpm test:e2e` chạy được, `pnpm package:win`
thì không. Đó là bình thường.

## Chọn gói

| Gói | Khi nào dùng | Quyền | Ghi chú |
|---|---|---|---|
| **NSIS** (`Nexa-Setup-x.y.z.exe`) | Người dùng tự cài | Không cần admin — per-user | Đáp ứng §21 *"cài và gỡ không cần quyền admin"* |
| **MSI** (`Nexa-x.y.z.msi`) | Triển khai tập trung qua Intune/SCCM/GPO | **Cần admin** — per-machine | |

Hai mục tiêu này mâu thuẫn nhẹ và đó là chủ ý — xem `docs/OPEN-QUESTIONS.md` mục D3.
**Đừng trộn hai kiểu trên cùng một máy**: người dùng đã tự cài NSIS rồi lại nhận MSI sẽ có hai
bản Nexa, hai lối tắt, và hai thư mục dữ liệu.

## Cài im lặng

```powershell
# MSI — triển khai tập trung
msiexec /i Nexa-1.0.0.msi /qn /norestart

# NSIS — nếu vẫn muốn đẩy bản per-user
Nexa-Setup-1.0.0.exe /S
```

## Trước khi triển khai: kiểm chứng gói

Bắt buộc theo §18.2 — làm **trước** khi đẩy cho bất kỳ ai.

```powershell
# 1. Checksum khớp với release
Get-FileHash Nexa-1.0.0.msi -Algorithm SHA256

# 2. Chữ ký số hợp lệ
Get-AuthenticodeSignature Nexa-1.0.0.msi | Format-List Status, SignerCertificate
```

`Status` phải là `Valid`. Nếu là `NotSigned` thì **dừng lại** — bản đó chưa được ký và không
được phát hành (xem `docs/OPEN-QUESTIONS.md` C3).

## Chính sách tổ chức — `policy.json`

Đây là cơ chế duy nhất để IT áp cấu hình mà người dùng không sửa được.

Đặt tại: `<thư mục cài đặt>\resources\policy.json`

```jsonc
{
  // §11.2 — allowlist domain. RỖNG NGHĨA LÀ KHÔNG GIỚI HẠN.
  // Đây là biện pháp giảm thiểu chính cho rủi ro "người dùng nhập URL giả, PAT bay sai đích".
  // Đề nghị ATTT bắt buộc điền — xem OPEN-QUESTIONS D2.
  // Nếu bật kết nối OpenAI trực tiếp (OPEN-QUESTIONS F1) thì phải thêm api.openai.com —
  // nếu không, kết nối đó sẽ bị chặn bởi chính allowlist này.
  "allowedDomains": ["*.corp.local", "api.openai.com"],

  // Feature flag người dùng không được đổi.
  "lockedFeatures": ["confluenceWrite", "jiraUpdate"],

  // Ghi đè cứng, thắng cả cấu hình người dùng.
  "forcedFeatures": {
    "confluenceWrite": false,
    "jiraUpdate": false,
    "autoUpdate": false
  },

  // Trần retention. Người dùng đặt cao hơn sẽ bị kéo xuống mức này.
  "maxHistoryRetentionDays": 180,

  // Bỏ trống nếu IT tự phân phối bản cập nhật (khuyến nghị cho MVP).
  "updateManifestUrl": "https://updates.corp.local/nexa/manifest.json"
}
```

File hỏng hoặc thiếu ⇒ Nexa dùng mặc định và ghi `org-policy-invalid-using-defaults` vào log.
**Nó không chặn khởi động** — cấu hình sai không được biến thành sự cố ngừng việc.

## Những gì Nexa KHÔNG cần

Hữu ích khi làm hồ sơ phê duyệt phần mềm:

- **Không cần quyền admin** để chạy (chỉ NSIS install là per-user)
- **Không cần GPU**
- **Không mở port nào** — MCP dùng stdio, không phải localhost HTTP (ADR 0004)
- **Renderer bị CSP chặn hoàn toàn khỏi mạng** — mọi lời gọi ra ngoài đi từ main process.
- Đích kết nối: LiteLLM, Jira, Confluence nội bộ, (tuỳ chọn) máy chủ cập nhật, và **(tuỳ chọn)
  `api.openai.com`** nếu tổ chức bật kết nối OpenAI trực tiếp.

  ⚠️ **Kết nối OpenAI đưa dữ liệu ra ngoài tổ chức** và không có usage log của tổ chức. Đây là
  sai lệch có chủ ý so với §6 của tài liệu thiết kế, cần ATTT duyệt — xem
  `docs/OPEN-QUESTIONS.md` mục F1. Tài liệu đính kèm bị **chặn theo mặc định** với model ngoài.
- **Không có telemetry tập trung** (§11.2)

## Những gì Nexa cần trên máy trạm

| Thứ | Bắt buộc | Ghi chú |
|---|---|---|
| Windows 10/11 64-bit | ✔ | |
| RAM 8 GB | ✔ | Khuyến nghị 16 GB (§12.1) |
| Trống 2 GB | ✔ | Khuyến nghị 5 GB |
| Truy cập mạng tới LiteLLM | ✔ | |
| Truy cập mạng tới Jira/Confluence | — | Chỉ khi dùng tính năng Atlassian |
| **Runtime MCP Atlassian** | — | ⚠️ Package chưa được chốt — xem OPEN-QUESTIONS A4 |

**A4 là việc còn treo và nó ảnh hưởng trực tiếp tới IT**: nếu MCP server là một package Python
chạy qua `uvx`, thì máy trạm cần Python/uv. Chốt xong A4 thì phần này phải được cập nhật.

## Dữ liệu người dùng

| Đường dẫn | Nội dung |
|---|---|
| `%APPDATA%\Nexa\nexa.db` | Hội thoại — **đã mã hoá** bằng khoá gắn tài khoản Windows |
| `%APPDATA%\Nexa\secure\credentials.bin` | API key và PAT — bảo vệ bằng DPAPI |
| `%APPDATA%\Nexa\logs\` | Log chẩn đoán đã che thông tin nhạy cảm, giữ 14 ngày |

**Gỡ cài đặt KHÔNG xoá dữ liệu này** (`deleteAppDataOnUninstall: false`). Hội thoại là tài sản
của người dùng; việc xoá để họ tự quyết qua Cài đặt → Dữ liệu → Xoá toàn bộ.

**Dữ liệu không di chuyển được giữa các tài khoản Windows.** Khoá gắn với DPAPI CurrentUser,
nên copy thư mục sang máy khác hay tài khoản khác thì credential không mở được. Đây là thiết kế
đúng ý §8.2, nhưng cần nói trước với người dùng khi họ đổi máy: **phải nhập lại API key và PAT**.

## Sao lưu

Nếu chính sách sao lưu profile của tổ chức có gộp `%APPDATA%`, hãy biết rằng bản sao lưu đó
**không phục hồi được sang máy/tài khoản khác** vì lý do trên. §8.2 nói sao lưu chỉ được hỗ trợ
"khi có chính sách và cơ chế mã hoá phù hợp" — hiện Nexa chưa có cơ chế export/import có khoá.

## Cập nhật

Khuyến nghị cho MVP: **để `autoUpdate: false` và IT tự phân phối**. Lý do: nhân viên không cần
quyền để tự cập nhật, và IT kiểm soát được phiên bản đang chạy trong tổ chức.

Nếu bật auto-update, xem `docs/integration/README.md` mục 4 để biết định dạng manifest.

Khi cần thu hồi một bản đã phát hành: `docs/operations/release-recall.md`.
