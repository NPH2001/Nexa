# Kế hoạch phản biện source code và giao diện Nexa

Ngày lập: 2026-08-23  
Chế độ: review-only, chưa sửa source sản phẩm

## 1. Kết quả cần đạt

Tạo một báo cáo phản biện có thể dùng trực tiếp để quyết định phát hành và lập backlog sửa chữa. Mỗi phát hiện phải có: mã finding, mức P0-P3, bằng chứng `file:line` hoặc log tái hiện, tác động người dùng/kỹ thuật, độ tin cậy, cách kiểm chứng, khuyến nghị và tiêu chí đóng.

Cuộc review dừng khi:

- Toàn bộ luồng quan trọng đã được rà soát: khởi động, cấu hình kết nối/model, chat/stream/cancel, file, tìm kiếm/lịch sử, tool read/write/destructive, confirmation, uncertain operation, diagnostics và xoá dữ liệu.
- Mọi P0/P1 đều có bước tái hiện hoặc bằng chứng tĩnh đủ mạnh; không gộp suy đoán vào lỗi đã xác nhận.
- UI được đối chiếu với WCAG 2.2 AA, WAI-ARIA APG, keyboard/screen reader, zoom/reflow, high contrast và các trạng thái loading/error/empty/success.
- Có backlog ưu tiên theo dependency, effort và rủi ro; có danh sách quyết định bắt buộc từ Product/ATTT/IT.
- Báo cáo nêu rõ phần nào chưa kiểm chứng được trên Windows hoặc hệ thống LiteLLM/Jira/Confluence thật.

## 2. Phạm vi và chuẩn đối chiếu

### Trong phạm vi

- Kiến trúc Electron main/preload/renderer, IPC, service composition và package boundaries.
- Tính đúng đắn của async state, streaming, error handling, persistence, policy và security controls.
- Supply chain, CI, test strategy, coverage, performance budget và release readiness.
- Information architecture, visual hierarchy, consistency, accessibility và UX của toàn bộ renderer.
- Mức khớp giữa implementation, design doc, threat model, OPEN-QUESTIONS và pre-pilot checklist.

### Ngoài phạm vi của vòng lập kế hoạch này

- Không sửa code, không đổi dependency, không thay đổi policy production và không phát hành bản build.
- Không tuyên bố đạt WCAG chỉ từ automated scan; phải kết hợp kiểm thử tự động và thủ công.
- Không tự chốt các quyết định thuộc Product/ATTT/IT như bật OpenAI trực tiếp, full 98 tools, domain allowlist, ký số hay MCP package thật.

### Baseline chuẩn chính thức, cập nhật ngày 2026-08-23

- WCAG 2.2 là W3C Recommendation và W3C khuyến nghị dùng bản hiện hành; mục tiêu đề xuất cho Nexa là Level AA: https://www.w3.org/TR/WCAG22/
- Các ngưỡng kiểm tra trọng yếu: contrast text thường tối thiểu 4.5:1, target tối thiểu 24x24 CSS px hoặc đáp ứng ngoại lệ spacing, focus phải nhìn thấy, nội dung phải reflow tương đương viewport 320 CSS px: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html, https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html, https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- Modal phải đưa focus vào trong, giữ vòng Tab/Shift+Tab, đóng bằng Escape và trả focus về trigger: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Electron coi accessibility tương tự ứng dụng HTML và khuyến nghị security checklist gồm context isolation, sandbox, CSP, giới hạn navigation/window và validate IPC sender: https://www.electronjs.org/docs/latest/tutorial/accessibility, https://www.electronjs.org/docs/latest/tutorial/security

## 3. Thang ưu tiên

| Mức | Định nghĩa                                                                                      | SLA đề xuất                                               |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P0  | Chặn phát hành/pilot, CI gate đỏ, nguy cơ lộ dữ liệu hoặc mất dữ liệu không thể phục hồi        | Xử lý hoặc có quyết định chấp nhận rủi ro trước mọi pilot |
| P1  | Luồng chính có thể sai, race condition, destructive UX thiếu bảo vệ, hoặc accessibility blocker | Đóng trước pilot hoặc giới hạn tính năng bằng policy      |
| P2  | Nợ kiến trúc/test, responsive/consistency/performance chưa đạt nhưng có workaround              | Lập sprint gần nhất với owner và tiêu chí đo              |
| P3  | Polish, copy, vi sai nhỏ, cải thiện không chặn nghiệp vụ                                        | Gom theo theme sau P0-P2                                  |

## 4. Tín hiệu đã xác nhận trước khi review sâu

| Mã sơ bộ          | Mức | Phát hiện                                                                                                                                                                                   | Bằng chứng                                                                                                                                                                                                                    |
| ----------------- | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BASE-SEC-01       |  P0 | `pnpm audit --audit-level high` hiện báo 23 lỗ hổng trong chuỗi dev/build, gồm 2 critical và 13 high; `--prod` sạch. CI đang chạy full audit nên security gate có khả năng đỏ.              | `.github/workflows/ci.yml:37-64`; `package.json:27-39`; `apps/desktop/package.json:28-35`; log audit ngày 2026-08-23                                                                                                          |
| BASE-E2E-01       |  P0 | E2E Linux chạy được 11/13 nhưng 2 test fail vì locator `getByText` trùng giữa sidebar, heading và message sau auto-title. Đây là lỗi test/gate đã xác nhận, chưa phải lỗi hành vi app.      | `tests/e2e/app.e2e.ts:132-157`, `tests/e2e/app.e2e.ts:297-308`; log Playwright ngày 2026-08-23                                                                                                                                |
| BASE-REL-01       |  P0 | Project mới đạt 3/10 điều kiện pre-pilot; chưa ký số, chưa test hệ thống thật, chưa đo RAM Windows và chưa UAT.                                                                             | `docs/operations/pre-pilot-checklist.md:5-19`, `:50-65`, `:68-74`                                                                                                                                                             |
| BASE-GOV-01       |  P0 | Implementation có hai sai lệch rủi ro cao so với thiết kế: gọi OpenAI trực tiếp và bật mặc định toàn bộ 98 tool, gồm thao tác xoá vĩnh viễn chỉ còn một lớp confirmation.                   | `docs/OPEN-QUESTIONS.md:569-609`, `:633-691`; `docs/design-doc-v1.1.md:764-772`; `docs/security/threat-model.md:48`                                                                                                           |
| BASE-STATE-01     |  P1 | Tải message và search không có request identity/cancel guard; response cũ có thể ghi đè state mới. `chat-done` còn reload conversation từ event mà không kiểm tra conversation đang mở.     | `apps/desktop/src/renderer/App.tsx:76-85`, `:134-148`, `:201-204`; `apps/desktop/src/renderer/components/Sidebar.tsx:34-49`                                                                                                   |
| BASE-A11Y-01      |  P1 | Confirmation modal có role/label nhưng chưa có initial focus, focus trap, Escape và restore focus; chưa chứng minh background inert.                                                        | `apps/desktop/src/renderer/components/ConfirmationDialog.tsx:24-43`, `:143-163`                                                                                                                                               |
| BASE-FUNC-01      |  P1 | Nút mở rộng preview bị nghi là no-op: registry chỉ giữ chuỗi đã cắt, còn UI chỉ đổi `expandedField` và ẩn nút, không có full value để hiển thị.                                             | `packages/atlassian-mcp-manager/src/tool-registry/shared.ts:17-24`; `apps/desktop/src/renderer/components/ConfirmationDialog.tsx:76-96`                                                                                       |
| BASE-UX-01        |  P1 | Xoá hội thoại, tin nhắn, model và connection chạy ngay, không có confirm hay undo; tác động và kỳ vọng người dùng cần review theo từng mức dữ liệu.                                         | `apps/desktop/src/renderer/App.tsx:264-273`, `:326-339`; `apps/desktop/src/renderer/components/ChatView.tsx:367-375`; `apps/desktop/src/renderer/components/SettingsView.tsx:262-275`, `:493-504`                             |
| BASE-A11Y-02      |  P1 | Action sửa/xoá chỉ hiện khi hover; focus bàn phím không làm action hiện. Sidebar có cùng pattern.                                                                                           | `apps/desktop/src/renderer/styles.css:253-258`, `:366-373`                                                                                                                                                                    |
| BASE-A11Y-03      |  P2 | Search và nhiều input quản lý model dựa vào placeholder/title thay vì label; nhóm tab không công bố trạng thái chọn theo tab semantics.                                                     | `apps/desktop/src/renderer/components/Sidebar.tsx:59-65`; `apps/desktop/src/renderer/components/SettingsView.tsx:58-71`, `:384-417`                                                                                           |
| BASE-LAYOUT-01    |  P2 | Window khoá `minWidth: 940`, layout có sidebar cố định 288 px và không có media query/reflow/high-contrast/reduced-motion rule.                                                             | `apps/desktop/src/main/window.ts:55-60`; `apps/desktop/src/renderer/styles.css:6-20`, `:66-70`, `:519-548`; không có `@media` trong stylesheet                                                                                |
| BASE-TEST-01      |  P2 | Coverage tổng 73.16% nhưng main process chỉ 17.27%; `chat-controller`, `ipc`, `services`, `diagnostics` đang 0% theo V8. Renderer bị loại hoàn toàn và không có component/a11y/visual test. | `vitest.config.ts:21-31`; coverage log ngày 2026-08-23                                                                                                                                                                        |
| BASE-MAINT-01     |  P2 | UI đang tập trung trách nhiệm lớn trong `SettingsView` 909 dòng, `ChatView` 525 dòng, `App` 404 dòng và một stylesheet 846 dòng; cần đo coupling trước khi đề xuất tách.                    | `apps/desktop/src/renderer/components/SettingsView.tsx:1`, `apps/desktop/src/renderer/components/ChatView.tsx:1`, `apps/desktop/src/renderer/App.tsx:1`, `apps/desktop/src/renderer/styles.css:1`; số dòng đo ngày 2026-08-23 |
| BASE-TOOLCHAIN-01 |  P2 | Khai báo Node engine `>=20.19` không khớp README/CI dùng Node 22.5+/24 cho `node:sqlite`; dễ tạo môi trường cài được nhưng chạy sai.                                                        | `package.json:7-10`; `README.md:50-52`; `.github/workflows/ci.yml:12-15`                                                                                                                                                      |
| BASE-DOC-01       |  P2 | Tài liệu trạng thái đã lệch: README nói 317 unit/integration + 12 E2E, baseline hiện là 351 test và 15 E2E khai báo; pre-pilot và OPEN-QUESTIONS cũng có mốc cũ.                            | `README.md:20-30`; `docs/OPEN-QUESTIONS.md:7`; test discovery ngày 2026-08-23                                                                                                                                                 |

Các mục trên là đầu vào ưu tiên, không thay thế cuộc review đầy đủ. Với finding dựa trên đọc code nhưng chưa tái hiện, báo cáo phải gắn nhãn `hypothesis` cho tới khi có test hoặc trace.

## 5. Kế hoạch thực hiện

### Giai đoạn 0 — Đóng băng baseline và ma trận bằng chứng

1. Ghi phiên bản Node/pnpm/Electron/React/Playwright/Vitest, commit SHA và trạng thái worktree.
2. Chạy `pnpm verify`, `pnpm build`, `pnpm test:coverage`, `pnpm audit --audit-level high`, `pnpm audit --prod --audit-level high`.
3. Chạy E2E Linux với `ELECTRON_RUN_AS_NODE` được bỏ khỏi env; chạy lane Windows cho DPAPI/startup. Không coi test skip là pass.
4. Lưu bundle size renderer/main/preload và số liệu performance hiện có làm mốc, đối chiếu `docs/design-doc-v1.1.md:732-744`.
5. Tạo evidence matrix: requirement/design doc -> implementation -> test -> trạng thái `proven/partial/missing/contradicted`.

Tiêu chí hoàn tất: mọi lệnh có exit code, timestamp và log; mọi failure được phân loại là product bug, test bug, environment bug hoặc release blocker.

### Giai đoạn 1 — Phản biện kiến trúc và tính đúng đắn source

1. Vẽ dependency map cho renderer -> preload -> IPC -> services -> repositories/LLM/MCP, kiểm tra không có đường vượt trust boundary. Bắt đầu từ `apps/desktop/src/main/services.ts:85`, `apps/desktop/src/preload/index.ts:19-61`, `packages/shared-types/src/channels.ts:9` và `apps/desktop/src/main/ipc.ts:45`.
2. Review ownership và coupling của các hotspot: `services.ts`, `ipc.ts`, `chat-controller.ts`, `agent-runtime.ts`, `App.tsx`, `SettingsView.tsx`, `ChatView.tsx`. Chỉ đề xuất tách khi chứng minh được trách nhiệm chồng chéo, test khó hoặc thay đổi dễ lan.
3. Lập state-transition table cho boot, select/search conversation, send/stream/cancel, tool approval/expiry/uncertain và settings save. Dùng delayed/out-of-order promises để tái hiện race ở `App.tsx:76-85`, `:134-148`, `:201-204` và `Sidebar.tsx:34-49`.
4. Review error propagation và user recovery: mọi lỗi phải có trạng thái UI, retryability/hint/request_id phù hợp; không nuốt lỗi quan trọng bằng `.catch(() => undefined)` nếu người dùng cần biết.
5. Review data lifecycle: edit/delete/purge, retention, attachment token release, migration forward compatibility và search decrypt-and-scan ceiling.
6. Review package/toolchain contract: Node engine, CI runtime, Electron-bundled Node, dependency lifecycle và bundle budget.

Tiêu chí hoàn tất: có sơ đồ dependency, state machine cho 6 luồng quan trọng, và test tái hiện cho mọi P0/P1 logic finding.

### Giai đoạn 2 — Phản biện security, policy và release readiness

1. Đối chiếu Electron security checklist với `window.ts`, preload, IPC validation, CSP, permission handlers, navigation/window-open và external URL sanitizer. Các control hiện có ở `apps/desktop/src/main/window.ts:25-38`, `:63-74`, `:81-99`, `:110-158` phải có test tương ứng.
2. Kiểm tra tính nhất quán của domain allowlist: `window.ts:157` đang fail-open khi danh sách rỗng, trong khi threat model thừa nhận đây là rủi ro tại `docs/security/threat-model.md:114`.
3. Threat-model lại ba lane có blast radius lớn: OpenAI direct (`OPEN-QUESTIONS F1/F2`), HTTP MCP/TLS skip, và full 98 Atlassian tools (`G1`). Với destructive tools, đánh giá single confirmation, copy cảnh báo, preview completeness, least privilege và policy override.
4. Triage 23 advisory theo reachability: runtime, packaged artifact, build/CI-only, dev-server-only. Không nâng dependency mù; mỗi upgrade phải có compatibility matrix Electron/Vite/Vitest/Playwright/electron-builder và regression gate.
5. Đối chiếu signing, update manifest, rollback, CODEOWNERS thật, branch protection, pentest và pre-pilot checklist. Không gắn nhãn release-ready khi P0 governance còn mở.
6. Tạo decision log riêng cho câu hỏi cần Product/ATTT/IT; nêu default an toàn nếu chưa có quyết định nhưng không tự thay policy.

Tiêu chí hoàn tất: tất cả mục trong threat model có bằng chứng code + test hoặc gap rõ; mọi advisory có disposition; mọi release blocker có owner và quyết định cần thiết.

### Giai đoạn 3 — Heuristic review UI/UX theo luồng nghiệp vụ

1. Kiểm tra từng màn hình ở các trạng thái `initial/loading/empty/content/saving/success/error/disabled/offline/expired/uncertain`.
2. Chat: khả năng đọc hội thoại dài, scroll ownership khi streaming, model/provider context, file policy, cancel, error recovery, edit/delete và trạng thái tool call.
3. Sidebar/search: debounce/cancel/stale result, active/current semantics, rename bằng bàn phím, truncated search, empty result và destructive action.
4. Settings: information architecture của 8 tab, độ dài copy, form validation, saving feedback, dangerous TLS option, feature flags, model table và data purge.
5. Confirmation: hierarchy của action/account/target/payload/diff/impact/reversibility/TTL; kiểm tra preview không che mất dữ liệu quyết định và destructive action nổi bật hơn WRITE_HIGH.
6. Toast/banner/status: mức khẩn cấp, thời lượng, copy được request_id, không che control, không biến mất trước khi screen reader đọc xong.
7. Visual consistency: typography scale, spacing, control height, icon language, badge semantics, table density, color states và design token coverage. Không chấm theo sở thích; mỗi finding phải liên hệ tới usability, consistency hoặc accessibility.

Tiêu chí hoàn tất: mỗi critical journey có annotated screenshot và issue list; mọi issue có viewport/state cụ thể và expected behavior.

### Giai đoạn 4 — Accessibility và responsive audit

1. Keyboard-only walkthrough: logical tab order, visible focus, không có keyboard trap, mọi hover-only action truy cập được, Enter/Space/Escape hoạt động đúng.
2. Modal APG test: initial focus, focus trap, Escape, inert background, least-destructive default focus và focus return.
3. Accessible name/role/value: label cho search/composer/model inputs, tab state, active conversation, MCP status, live regions, countdown và error association.
4. Screen reader smoke test trên Windows với Narrator; kiểm tra chat streaming không spam announcement và status/error được công bố đúng mức.
5. Visual checks: contrast text/non-text/focus; 200%/400% zoom; reflow; window resize; target size; text spacing; forced-colors/high contrast; reduced motion.
6. Automated scan trên mọi state chính, nhưng manual keyboard/screen-reader evidence vẫn bắt buộc.

Tiêu chí hoàn tất: không còn accessibility P0/P1 chưa được ghi nhận; mỗi WCAG failure có success criterion, evidence, impact và remediation acceptance test.

### Giai đoạn 5 — Test strategy và khả năng bảo trì

1. Sửa baseline E2E locator theo semantic scope trong backlog, rồi yêu cầu toàn bộ test Linux/Windows xanh trước mọi thay đổi lớn.
2. Bổ sung test shape cho renderer: state/race tests, keyboard/focus tests, modal behavior, destructive-action guard, settings feedback và external-provider warnings.
3. Đặt coverage threshold theo risk, không theo số tổng: ưu tiên `chat-controller`, `ipc`, `services`, window boundary và renderer critical flows; tránh tăng phần trăm bằng test trivial.
4. Thêm visual regression cho các state chuẩn ở ít nhất ba kích thước cửa sổ và Windows high contrast.
5. Thêm bundle budget và dependency audit gate có policy ngoại lệ minh bạch, expiry date và owner.
6. Chỉ đề xuất refactor component sau khi regression tests khoá hành vi hiện tại; ưu tiên tách theo feature/state ownership thay vì tách file cơ học.

Tiêu chí hoàn tất: test matrix ánh xạ 1:1 tới P0/P1 risks; gate CI không còn đỏ vì locator/advisory chưa disposition; coverage của critical paths có ngưỡng được thống nhất.

### Giai đoạn 6 — Báo cáo, phản biện và backlog sửa chữa

1. Xuất báo cáo findings theo thứ tự P0 -> P3, mỗi finding dùng template cố định.
2. Tách `confirmed defect`, `design/policy conflict`, `test gap`, `operational blocker` và `improvement`; không trộn thành một danh sách chung.
3. Lập remediation waves:
   - Wave A: CI/release/security governance và data-loss/destructive risks.
   - Wave B: async correctness, modal/accessibility blockers, misleading UI.
   - Wave C: renderer tests, responsive/high-contrast, settings/chat ergonomics.
   - Wave D: component decomposition, visual polish và documentation drift.
4. Review chéo báo cáo với Product, ATTT và IT cho đúng phần trách nhiệm; engineering chỉ đóng những finding kỹ thuật đã có bằng chứng.
5. Sau khi backlog được duyệt, chuyển sang goal execution riêng; kế hoạch này không tự triển khai sửa chữa.

Tiêu chí hoàn tất: 100% P0/P1 có owner, acceptance test và dependency; các quyết định không thuộc engineering có người quyết định và deadline; residual risk được ghi rõ.

## 6. Test matrix bắt buộc

| Nhóm        | Tối thiểu phải chứng minh                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | State reducers/guards, URL/policy validation, preview completeness, error mapping, retention/purge                                             |
| Integration | Renderer bridge -> IPC -> service, connection/model settings, chat controller, tool approval/expiry/uncertain                                  |
| E2E Linux   | 13 test app hiện có + race switching/search + keyboard/modal + delete guard + external-provider warning                                        |
| E2E Windows | DPAPI persistence/cross-account manual check, startup, packaging, zoom/high contrast/Narrator smoke                                            |
| Visual      | Chat empty/content/stream/error, settings tabs/forms/danger zone, confirmation WRITE_LOW/HIGH/DESTRUCTIVE, toast/banner                        |
| Security    | Full audit disposition, secret scan, CSP/navigation/IPC sender, external URL, signing/update/rollback, pentest scope                           |
| Performance | Startup < 5s; Windows idle < 500 MB, chat < 800 MB theo `docs/operations/pre-pilot-checklist.md:50-65`; bundle and long-history/search budgets |

## 7. Acceptance criteria của backlog sửa chữa sau review

- `pnpm verify`, build, full audit policy và E2E Linux/Windows đều xanh; không dùng skip/retry để che deterministic failure.
- Không còn P0; mọi P1 đã đóng hoặc bị feature flag/policy tắt với quyết định chấp nhận rủi ro có thời hạn.
- Renderer critical journeys có automated tests; modal và destructive actions có keyboard/focus/recovery tests.
- Không còn action chỉ nhìn thấy bằng hover; mọi input có accessible name; selected/current state được công bố.
- Confirmation preview không có control giả/no-op và không mất dữ liệu cần thiết để người dùng quyết định.
- Không có stale async response làm sai conversation/search/settings state.
- UI đáp ứng WCAG 2.2 AA trong phạm vi app ở contrast, keyboard, focus, name/role/value, status message, target size và reflow; các ngoại lệ phải được ghi rõ.
- Pre-pilot checklist, README, OPEN-QUESTIONS và threat model phản ánh cùng một trạng thái release.

## 8. Rủi ro của chính cuộc review và cách giảm thiểu

| Rủi ro                                                             | Giảm thiểu                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Test mock tạo cảm giác an toàn giả                                 | Gắn nhãn mock/real; bắt buộc contract/UAT với LiteLLM, Jira, Confluence thật trước pilot |
| Automated accessibility scan bỏ sót keyboard/screen reader         | Luôn có manual walkthrough và Windows Narrator evidence                                  |
| Refactor lớn làm mất bất biến bảo mật                              | Khoá hành vi bằng regression tests trước; review riêng security boundary                 |
| Advisory build-only bị thổi phồng hoặc runtime advisory bị xem nhẹ | Triage reachability và packaged-artifact contents; ghi rõ exposure                       |
| Product policy conflict bị engineering tự quyết                    | Decision log, owner Product/ATTT/IT, không đổi default khi chưa có authority             |
| Screenshot review chỉ chấm thẩm mỹ                                 | Buộc mỗi UI finding gắn với task success, consistency, WCAG hoặc measurable usability    |

## 9. Ước lượng và thứ tự triển khai review

- 0.5 ngày: baseline, evidence matrix, toolchain/audit disposition sơ bộ.
- 1.5 ngày: architecture, async state, data lifecycle và core code review.
- 1 ngày: security/policy/release readiness.
- 1.5 ngày: heuristic UI/UX, keyboard, accessibility, responsive và visual evidence.
- 0.5-1 ngày: test-gap analysis, report, severity calibration và remediation waves.

Tổng ước lượng: 5-5.5 ngày reviewer tập trung, chưa tính thời gian chờ hệ thống thật, Windows manual validation và quyết định Product/ATTT/IT.
