import { z } from 'zod'
import type {
  LookupContext,
  PreviewContext,
  ToolDefinition,
  ToolPreview,
  UncertainLookupResult,
} from '@nexa/shared-types'
import {
  asRecord,
  escapeJql,
  formatJqlDate,
  summarizeGeneric,
  toJsonSchema,
  truncateField,
} from './shared.js'
import { ISSUE_KEY_PATTERN, PROJECT_KEY_PATTERN, summarizeJiraIssue } from './jira-shared.js'

// ── Kiểu input dùng trong preview builder ─────────────────────────────────

interface JiraCreateInput {
  project_key: string
  summary: string
  description: string
  issue_type: string
}
interface JiraUpdateInput {
  issue_key: string
  fields: Record<string, string | number | boolean>
}
interface JiraCommentInput {
  issue_key: string
  comment: string
}

/**
 * Mọi tool WRITE Jira (§10.1/§10.2). Nhóm flag theo BẢN CHẤT hành động, không phải theo tool:
 *  - `jiraCreate`: tạo bản ghi mới, không đụng dữ liệu đã có (issue, sprint, version, JSM request).
 *  - `jiraComment`: thêm/sửa nội dung văn bản trên một issue đã có (comment, worklog, form answer).
 *  - `jiraLink`: tổ chức lại quan hệ — watcher, liên kết issue/epic, thành viên sprint. Không tạo
 *    nội dung, không sửa field.
 *  - `jiraUpdate` (WRITE_HIGH): sửa field của một bản ghi đã tồn tại.
 *  - `jiraWorkflow` (WRITE_HIGH): đổi trạng thái/di chuyển project/xoá quan hệ — tác dụng phụ khó
 *    lường hơn một field update thường (quy tắc workflow, thông báo, đổi issue key).
 *  - `DESTRUCTIVE` (`jira_delete_issue`): trước đây luôn bị `AtlassianMcpManager` chặn cứng,
 *    không phụ thuộc flag; kể từ 2026-08-22 (OPEN-QUESTIONS.md mục G1) chốt chặn đó đã gỡ, giờ
 *    chỉ còn kiểm soát bằng flag `jiraWorkflow` + Confirmation Guard như mọi tool WRITE_HIGH khác.
 *    thuộc feature flag nào (xem availableTools()/resolveCallable trong manager.ts).
 */
export function buildJiraWriteTools(jiraBaseUrl: string): ToolDefinition[] {
  const jira = jiraBaseUrl

  return [
    // ── jiraCreate ──────────────────────────────────────────────────────
    {
      name: 'jira_create_issue',
      mcpToolName: 'jira_create_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description:
        'Tạo một Jira issue mới. Thao tác này thay đổi dữ liệu và cần người dùng xác nhận.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32),
        summary: z.string().min(1).max(255),
        description: z.string().max(32_000).default(''),
        issue_type: z.string().min(1).max(64).default('Task'),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string', description: 'Mã dự án, ví dụ PRJ' },
          summary: { type: 'string', description: 'Tiêu đề issue' },
          description: { type: 'string', description: 'Mô tả chi tiết' },
          issue_type: { type: 'string', description: 'Loại issue: Task, Bug, Story…' },
        },
        ['project_key', 'summary', 'issue_type'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) => previewCreateIssue(input as JiraCreateInput, ctx),
      lookupResult: (input, ctx) => lookupCreatedIssue(input as JiraCreateInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_batch_create_issues',
      mcpToolName: 'jira_batch_create_issues',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo nhiều Jira issue trong một lần gọi.',
      inputSchema: z.object({
        issues: z.string().min(1).max(32_000),
        validate_only: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          issues: {
            type: 'string',
            description:
              'Chuỗi JSON mảng object issue, mỗi object gồm project_key, summary, issue_type (bắt buộc) và description/assignee/components (tuỳ chọn)',
          },
          validate_only: { type: 'boolean', description: 'Chỉ kiểm tra hợp lệ, không tạo thật' },
        },
        ['issues'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) =>
        previewBatchCreateIssues(input as { issues: string; validate_only: boolean }, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_create_sprint',
      mcpToolName: 'jira_create_sprint',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo sprint mới cho một board.',
      inputSchema: z.object({
        board_id: z.string().min(1).max(32),
        name: z.string().min(1).max(255),
        start_date: z.string().min(1).max(64),
        end_date: z.string().min(1).max(64),
        goal: z.string().max(2_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          board_id: { type: 'string', description: "ID board, ví dụ '1000'" },
          name: { type: 'string', description: "Tên sprint, ví dụ 'Sprint 1'" },
          start_date: { type: 'string', description: 'Thời điểm bắt đầu (ISO 8601)' },
          end_date: { type: 'string', description: 'Thời điểm kết thúc (ISO 8601)' },
          goal: { type: 'string', description: 'Mục tiêu sprint (tuỳ chọn)' },
        },
        ['board_id', 'name', 'start_date', 'end_date'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) =>
        previewSimpleCreate({
          toolName: 'jira_create_sprint',
          ctx,
          action: `Tạo sprint "${(input as { name: string }).name}" trên board ${(input as { board_id: string }).board_id}`,
          fields: recordFields(input),
          newLabel: `Sprint mới trên board ${(input as { board_id: string }).board_id}`,
          newValue: (input as { name: string }).name,
          impactWarning: 'Sprint mới sẽ hiển thị trên board ngay khi tạo.',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_create_version',
      mcpToolName: 'jira_create_version',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo fix version mới cho một project.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        name: z.string().min(1).max(255),
        start_date: z.string().max(32).optional(),
        release_date: z.string().max(32).optional(),
        description: z.string().max(2_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string' },
          name: { type: 'string', description: 'Tên version' },
          start_date: { type: 'string', description: 'Ngày bắt đầu (YYYY-MM-DD)' },
          release_date: { type: 'string', description: 'Ngày phát hành (YYYY-MM-DD)' },
          description: { type: 'string' },
        },
        ['project_key', 'name'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) =>
        previewSimpleCreate({
          toolName: 'jira_create_version',
          ctx,
          action: `Tạo fix version "${(input as { name: string }).name}" trong project ${(input as { project_key: string }).project_key}`,
          fields: recordFields(input),
          newLabel: `Version mới trong project ${(input as { project_key: string }).project_key}`,
          newValue: (input as { name: string }).name,
          impactWarning: 'Version mới có thể được gắn vào issue ngay khi tạo.',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_batch_create_versions',
      mcpToolName: 'jira_batch_create_versions',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo nhiều fix version trong một project cùng lúc.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        versions: z.string().min(1).max(32_000),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string' },
          versions: {
            type: 'string',
            description:
              'Chuỗi JSON mảng object version, mỗi object gồm name (bắt buộc) và startDate/releaseDate/description (tuỳ chọn)',
          },
        },
        ['project_key', 'versions'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) =>
        previewBatchCreateFromJsonArray({
          toolName: 'jira_batch_create_versions',
          ctx,
          jsonText: (input as { versions: string }).versions,
          action: `Tạo nhiều fix version trong project ${(input as { project_key: string }).project_key}`,
          nameField: 'name',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_create_customer_request',
      mcpToolName: 'jira_create_customer_request',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo một yêu cầu khách hàng (customer request) trong Jira Service Management.',
      inputSchema: z.object({
        service_desk_id: z.string().min(1).max(32),
        request_type_id: z.string().min(1).max(32),
        request_field_values: z.string().min(1).max(32_000),
        raise_on_behalf_of: z.string().max(255).optional(),
        request_participants: z.string().max(2_000).optional(),
        attachments: z.string().max(32_000).optional(),
        strict_on_behalf: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          service_desk_id: { type: 'string' },
          request_type_id: { type: 'string' },
          request_field_values: {
            type: 'string',
            description:
              'Chuỗi JSON các field theo ID, ví dụ \'{"summary": "...", "description": "..."}\'',
          },
          raise_on_behalf_of: {
            type: 'string',
            description: 'Định danh người dùng cần tạo hộ (tuỳ chọn)',
          },
          request_participants: {
            type: 'string',
            description: 'Danh sách người tham gia, phân tách bằng dấu phẩy',
          },
          attachments: {
            type: 'string',
            description: 'Chuỗi JSON mảng file đính kèm base64 (tuỳ chọn)',
          },
          strict_on_behalf: {
            type: 'boolean',
            description: 'Thất bại ngay nếu không tạo hộ được, thay vì tự thử lại',
          },
        },
        ['service_desk_id', 'request_type_id', 'request_field_values'],
      ),
      requiredFeature: 'jiraCreate',
      buildPreview: (input, ctx) =>
        previewCreateCustomerRequest(input as CustomerRequestInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── jiraComment ───────────────────────────────────────────────────────
    {
      name: 'jira_add_comment',
      mcpToolName: 'jira_add_comment',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm bình luận vào một Jira issue. Cần người dùng xác nhận.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64),
        comment: z.string().min(1).max(32_000),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' }, comment: { type: 'string' } }, [
        'issue_key',
        'comment',
      ]),
      requiredFeature: 'jiraComment',
      buildPreview: (input, ctx) => previewAddComment(input as JiraCommentInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_edit_comment',
      mcpToolName: 'jira_edit_comment',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Sửa một bình luận đã có trên Jira issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        comment_id: z.string().min(1).max(32),
        body: z.string().min(1).max(32_000),
        visibility: z.string().max(1_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          comment_id: { type: 'string', description: 'ID bình luận cần sửa' },
          body: { type: 'string', description: 'Nội dung mới, dạng Markdown' },
          visibility: { type: 'string', description: 'Chuỗi JSON giới hạn hiển thị (tuỳ chọn)' },
        },
        ['issue_key', 'comment_id', 'body'],
      ),
      requiredFeature: 'jiraComment',
      buildPreview: (input, ctx) => previewEditComment(input as EditCommentInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_add_worklog',
      mcpToolName: 'jira_add_worklog',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Ghi nhận thời gian làm việc (worklog) vào một Jira issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        time_spent: z.string().min(1).max(32),
        comment: z.string().max(32_000).optional(),
        started: z.string().max(64).optional(),
        original_estimate: z.string().max(32).optional(),
        remaining_estimate: z.string().max(32).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          time_spent: { type: 'string', description: "Thời gian, ví dụ '1h 30m', '1d', '4h'" },
          comment: { type: 'string', description: 'Ghi chú cho worklog (tuỳ chọn)' },
          started: {
            type: 'string',
            description: 'Thời điểm bắt đầu, ISO 8601 (tuỳ chọn, mặc định là hiện tại)',
          },
          original_estimate: { type: 'string', description: 'Ước lượng ban đầu mới (tuỳ chọn)' },
          remaining_estimate: { type: 'string', description: 'Ước lượng còn lại mới (tuỳ chọn)' },
        },
        ['issue_key', 'time_spent'],
      ),
      requiredFeature: 'jiraComment',
      buildPreview: (input, ctx) => previewAddWorklog(input as AddWorklogInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_update_proforma_form_answers',
      mcpToolName: 'jira_update_proforma_form_answers',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Cập nhật câu trả lời của một ProForma form trên issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64),
        form_id: z.string().min(1).max(64),
        answers: z.array(z.record(z.unknown())).min(1),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          form_id: { type: 'string', description: 'UUID của form' },
          answers: {
            type: 'array',
            description:
              'Mảng object { questionId, type, value } — xem jira_get_proforma_form_details để biết questionId',
            items: { type: 'object' },
          },
        },
        ['issue_key', 'form_id', 'answers'],
      ),
      requiredFeature: 'jiraComment',
      buildPreview: (input, ctx) => previewUpdateFormAnswers(input as UpdateFormAnswersInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── jiraLink ────────────────────────────────────────────────────────
    {
      name: 'jira_add_watcher',
      mcpToolName: 'jira_add_watcher',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm một người dùng vào danh sách theo dõi (watcher) của issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        user_identifier: z.string().min(1).max(255),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          user_identifier: {
            type: 'string',
            description: 'Account ID (Cloud) hoặc username (Server/DC)',
          },
        },
        ['issue_key', 'user_identifier'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_add_watcher',
          ctx,
          action: `Thêm ${(input as { user_identifier: string }).user_identifier} vào danh sách theo dõi ${(input as { issue_key: string }).issue_key}`,
          fields: recordFields(input),
          changeLabel: `Watcher trên ${(input as { issue_key: string }).issue_key}`,
          after: (input as { user_identifier: string }).user_identifier,
          impactWarning: 'Người này sẽ nhận thông báo khi issue có thay đổi.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_remove_watcher',
      mcpToolName: 'jira_remove_watcher',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Bỏ một người dùng khỏi danh sách theo dõi của issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        username: z.string().max(255).optional(),
        account_id: z.string().max(255).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          username: { type: 'string', description: 'Username cần bỏ (Server/DC)' },
          account_id: { type: 'string', description: 'Account ID cần bỏ (Cloud)' },
        },
        ['issue_key'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_remove_watcher',
          ctx,
          action: `Bỏ theo dõi khỏi ${(input as { issue_key: string }).issue_key}`,
          fields: recordFields(input),
          changeLabel: `Watcher trên ${(input as { issue_key: string }).issue_key}`,
          after: 'đã bỏ',
          impactWarning: 'Người này sẽ không còn nhận thông báo từ issue.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_assign_issue',
      mcpToolName: 'jira_assign_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Gán (hoặc bỏ gán) một Jira issue cho người dùng.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        assignee: z.string().max(255).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          assignee: {
            type: 'string',
            description:
              'Định danh người được gán (email/tên/account ID). Bỏ trống hoặc để rỗng để bỏ gán.',
          },
        },
        ['issue_key'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) => previewAssignIssue(input as AssignIssueInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_link_to_epic',
      mcpToolName: 'jira_link_to_epic',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Gắn một issue vào Epic.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        epic_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' }, epic_key: { type: 'string' } }, [
        'issue_key',
        'epic_key',
      ]),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_link_to_epic',
          ctx,
          action: `Gắn ${(input as { issue_key: string }).issue_key} vào epic ${(input as { epic_key: string }).epic_key}`,
          fields: recordFields(input),
          changeLabel: `Epic của ${(input as { issue_key: string }).issue_key}`,
          after: (input as { epic_key: string }).epic_key,
          impactWarning: 'Có thể ghi đè epic hiện tại (nếu có) của issue.',
          reversible: false,
        }),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_create_issue_link',
      mcpToolName: 'jira_create_issue_link',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: "Tạo liên kết giữa hai issue (ví dụ 'Blocks', 'Relates to').",
      inputSchema: z.object({
        link_type: z.string().min(1).max(64),
        inward_issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        outward_issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        comment: z.string().max(32_000).optional(),
        comment_visibility: z.string().max(1_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          link_type: { type: 'string', description: "Loại liên kết, ví dụ 'Blocks', 'Duplicate'" },
          inward_issue_key: { type: 'string' },
          outward_issue_key: { type: 'string' },
          comment: { type: 'string', description: 'Bình luận kèm theo (tuỳ chọn)' },
          comment_visibility: {
            type: 'string',
            description: 'Chuỗi JSON giới hạn hiển thị bình luận (tuỳ chọn)',
          },
        },
        ['link_type', 'inward_issue_key', 'outward_issue_key'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) => previewCreateIssueLink(input as CreateIssueLinkInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_create_remote_issue_link',
      mcpToolName: 'jira_create_remote_issue_link',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm một liên kết ngoài (web/Confluence) vào issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        url: z.string().min(1).max(2_000),
        title: z.string().min(1).max(255),
        summary: z.string().max(2_000).optional(),
        relationship: z.string().max(255).optional(),
        icon_url: z.string().max(2_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          url: { type: 'string', description: 'URL cần liên kết tới' },
          title: { type: 'string', description: 'Tên hiển thị của liên kết' },
          summary: { type: 'string', description: 'Mô tả liên kết (tuỳ chọn)' },
          relationship: {
            type: 'string',
            description: "Quan hệ, ví dụ 'documentation' (tuỳ chọn)",
          },
          icon_url: { type: 'string', description: 'URL icon 16x16 (tuỳ chọn)' },
        },
        ['issue_key', 'url', 'title'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_create_remote_issue_link',
          ctx,
          action: `Thêm liên kết ngoài "${(input as { title: string }).title}" vào ${(input as { issue_key: string }).issue_key}`,
          fields: recordFields(input),
          changeLabel: `Liên kết ngoài trên ${(input as { issue_key: string }).issue_key}`,
          after: (input as { url: string }).url,
          impactWarning:
            'Liên kết sẽ hiển thị trong mục "Links" của issue, ai có quyền xem issue đều thấy được.',
          reversible: false,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_add_issues_to_sprint',
      mcpToolName: 'jira_add_issues_to_sprint',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm nhiều issue vào một sprint.',
      inputSchema: z.object({
        sprint_id: z.string().min(1).max(32),
        issue_keys: z.string().min(1).max(2_000),
      }),
      jsonSchema: toJsonSchema(
        {
          sprint_id: { type: 'string' },
          issue_keys: { type: 'string', description: "Danh sách key issue, ví dụ 'PROJ-1,PROJ-2'" },
        },
        ['sprint_id', 'issue_keys'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_add_issues_to_sprint',
          ctx,
          action: `Thêm issue ${(input as { issue_keys: string }).issue_keys} vào sprint ${(input as { sprint_id: string }).sprint_id}`,
          fields: recordFields(input),
          changeLabel: `Sprint của ${(input as { issue_keys: string }).issue_keys}`,
          after: (input as { sprint_id: string }).sprint_id,
          impactWarning: 'Issue sẽ xuất hiện trên board của sprint này.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_move_issues_to_backlog',
      mcpToolName: 'jira_move_issues_to_backlog',
      targetSystem: 'jira',
      riskLevel: 'WRITE_LOW',
      description: 'Đưa nhiều issue về backlog, bỏ khỏi sprint hiện tại.',
      inputSchema: z.object({ issue_keys: z.string().min(1).max(2_000) }),
      jsonSchema: toJsonSchema(
        {
          issue_keys: { type: 'string', description: "Danh sách key issue, ví dụ 'PROJ-1,PROJ-2'" },
        },
        ['issue_keys'],
      ),
      requiredFeature: 'jiraLink',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_move_issues_to_backlog',
          ctx,
          action: `Đưa ${(input as { issue_keys: string }).issue_keys} về backlog`,
          fields: recordFields(input),
          changeLabel: 'Sprint',
          after: 'backlog (không thuộc sprint nào)',
          impactWarning: 'Issue sẽ bị bỏ khỏi sprint hiện tại, kể cả sprint đang active.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── jiraUpdate (WRITE_HIGH) ─────────────────────────────────────────
    {
      name: 'jira_update_issue',
      mcpToolName: 'jira_update_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description:
        'Cập nhật các trường của một Jira issue đang tồn tại. Cần người dùng xác nhận chi tiết.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64),
        fields: z.record(z.union([z.string(), z.number(), z.boolean()])),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          fields: { type: 'object', description: 'Các trường cần đổi và giá trị mới' },
        },
        ['issue_key', 'fields'],
      ),
      requiredFeature: 'jiraUpdate',
      buildPreview: (input, ctx) => previewUpdateIssue(input as JiraUpdateInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_update_sprint',
      mcpToolName: 'jira_update_sprint',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description: 'Cập nhật tên, trạng thái, ngày hoặc mục tiêu của một sprint.',
      inputSchema: z.object({
        sprint_id: z.string().min(1).max(32),
        name: z.string().max(255).optional(),
        state: z.enum(['future', 'active', 'closed']).optional(),
        start_date: z.string().max(64).optional(),
        end_date: z.string().max(64).optional(),
        goal: z.string().max(2_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          sprint_id: { type: 'string' },
          name: { type: 'string' },
          state: { type: 'string', description: "'future', 'active' hoặc 'closed'" },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          goal: { type: 'string' },
        },
        ['sprint_id'],
      ),
      requiredFeature: 'jiraUpdate',
      buildPreview: (input, ctx) =>
        previewUpdateWithoutBefore({
          toolName: 'jira_update_sprint',
          ctx,
          action: `Cập nhật sprint ${(input as { sprint_id: string }).sprint_id}`,
          idLabel: 'Sprint',
          idValue: (input as { sprint_id: string }).sprint_id,
          fields: omitKeys(input as Record<string, unknown>, ['sprint_id']),
          impactWarning:
            'Không đọc trước được giá trị hiện tại của sprint (không có tool đọc một sprint đơn lẻ). Đổi "state" sang closed sẽ ảnh hưởng tới board.',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_update_version',
      mcpToolName: 'jira_update_version',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description:
        'Cập nhật một fix version đã tồn tại (tên, ngày, trạng thái archived/released…).',
      inputSchema: z.object({
        version_id: z.string().min(1).max(32),
        name: z.string().max(255).optional(),
        description: z.string().max(2_000).optional(),
        start_date: z.string().max(32).optional(),
        release_date: z.string().max(32).optional(),
        archived: z.boolean().optional(),
        released: z.boolean().optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          version_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          start_date: { type: 'string' },
          release_date: { type: 'string' },
          archived: { type: 'boolean' },
          released: { type: 'boolean' },
        },
        ['version_id'],
      ),
      requiredFeature: 'jiraUpdate',
      buildPreview: (input, ctx) =>
        previewUpdateWithoutBefore({
          toolName: 'jira_update_version',
          ctx,
          action: `Cập nhật version ${(input as { version_id: string }).version_id}`,
          idLabel: 'Version',
          idValue: (input as { version_id: string }).version_id,
          fields: omitKeys(input as Record<string, unknown>, ['version_id']),
          impactWarning:
            'Đánh dấu "released" có thể thay đổi cách issue gắn version này hiển thị trong báo cáo release.',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── jiraWorkflow (WRITE_HIGH) ───────────────────────────────────────
    {
      name: 'jira_transition_issue',
      mcpToolName: 'jira_transition_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description: 'Chuyển một Jira issue sang trạng thái khác.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        transition_id: z.string().min(1).max(32),
        fields: z.string().max(4_000).optional(),
        comment: z.string().max(32_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          transition_id: {
            type: 'string',
            description: 'ID transition — dùng jira_get_transitions để lấy danh sách hợp lệ',
          },
          fields: {
            type: 'string',
            description: 'Chuỗi JSON field cần set kèm transition, ví dụ resolution (tuỳ chọn)',
          },
          comment: { type: 'string', description: 'Bình luận kèm theo transition (tuỳ chọn)' },
        },
        ['issue_key', 'transition_id'],
      ),
      requiredFeature: 'jiraWorkflow',
      buildPreview: (input, ctx) => previewTransitionIssue(input as TransitionInput, ctx),
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_move_issue',
      mcpToolName: 'jira_move_issue',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description: 'Chuyển một issue sang project khác (chỉ Jira Cloud). Issue có thể đổi key.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        target_project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema(
        { issue_key: { type: 'string' }, target_project_key: { type: 'string' } },
        ['issue_key', 'target_project_key'],
      ),
      requiredFeature: 'jiraWorkflow',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_move_issue',
          ctx,
          action: `Chuyển ${(input as { issue_key: string }).issue_key} sang project ${(input as { target_project_key: string }).target_project_key}`,
          fields: recordFields(input),
          changeLabel: `Project của ${(input as { issue_key: string }).issue_key}`,
          after: (input as { target_project_key: string }).target_project_key,
          impactWarning:
            'Issue có thể được cấp key mới trong project đích — link/bookmark cũ theo key hiện tại sẽ không còn dùng được.',
          reversible: false,
          riskLevel: 'WRITE_HIGH',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_remove_issue_link',
      mcpToolName: 'jira_remove_issue_link',
      targetSystem: 'jira',
      riskLevel: 'WRITE_HIGH',
      description: 'Xoá một liên kết giữa hai issue.',
      inputSchema: z.object({ link_id: z.string().min(1).max(32) }),
      jsonSchema: toJsonSchema({ link_id: { type: 'string' } }, ['link_id']),
      requiredFeature: 'jiraWorkflow',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_remove_issue_link',
          ctx,
          action: `Xoá liên kết #${(input as { link_id: string }).link_id}`,
          fields: recordFields(input),
          changeLabel: 'Liên kết issue',
          after: 'đã xoá',
          impactWarning:
            'Không có cách hoàn tác trực tiếp — muốn khôi phục phải tạo lại liên kết bằng jira_create_issue_link.',
          reversible: false,
          riskLevel: 'WRITE_HIGH',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── DESTRUCTIVE — luôn bị chặn ở AtlassianMcpManager, không phụ thuộc flag ──
    {
      name: 'jira_delete_issue',
      mcpToolName: 'jira_delete_issue',
      targetSystem: 'jira',
      riskLevel: 'DESTRUCTIVE',
      description:
        'Xoá vĩnh viễn một Jira issue. Không thể hoàn tác — luôn cần xác nhận qua preview.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraWorkflow',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'jira_delete_issue',
          ctx,
          action: `Xoá vĩnh viễn ${(input as { issue_key: string }).issue_key}`,
          fields: recordFields(input),
          changeLabel: (input as { issue_key: string }).issue_key,
          after: 'đã xoá vĩnh viễn',
          impactWarning:
            'Không thể hoàn tác. Toàn bộ comment, worklog, attachment của issue cũng mất theo.',
          reversible: false,
          riskLevel: 'DESTRUCTIVE',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
  ]
}

// ── Preview builders ────────────────────────────────────────────────────

interface CustomerRequestInput {
  service_desk_id: string
  request_type_id: string
  request_field_values: string
}
interface EditCommentInput {
  issue_key: string
  comment_id: string
  body: string
}
interface AddWorklogInput {
  issue_key: string
  time_spent: string
  comment?: string
}
interface UpdateFormAnswersInput {
  issue_key: string
  form_id: string
  answers: readonly Record<string, unknown>[]
}
interface AssignIssueInput {
  issue_key: string
  assignee?: string
}
interface CreateIssueLinkInput {
  link_type: string
  inward_issue_key: string
  outward_issue_key: string
}
interface TransitionInput {
  issue_key: string
  transition_id: string
  comment?: string
}

function previewCreateIssue(input: JiraCreateInput, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira_create_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Tạo issue mới loại "${input.issue_type}" trong dự án ${input.project_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Dự án', value: input.project_key },
      { label: 'Loại issue', value: input.issue_type },
      { label: 'Tiêu đề', value: input.summary },
      ...(input.description === '' ? [] : [truncateField('Mô tả', input.description)]),
    ],
    changes: [
      { field: 'Issue mới trong dự án ' + input.project_key, before: null, after: input.summary },
    ],
    impactWarning:
      'Issue sẽ xuất hiện ngay trong dự án và có thể gửi thông báo tới các thành viên đang theo dõi.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewAddComment(input: JiraCommentInput, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira_add_comment',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Thêm bình luận vào ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      truncateField('Nội dung bình luận', input.comment),
    ],
    changes: [{ field: `Bình luận trên ${input.issue_key}`, before: null, after: input.comment }],
    impactWarning: 'Bình luận hiển thị công khai với mọi người có quyền xem issue.',
    reversible: true,
    riskLevel: 'WRITE_LOW',
  })
}

/**
 * §10.2 mục 5 yêu cầu hiện "trường sẽ bị thay đổi". Với update thì phải biết giá trị CŨ,
 * nên ta đọc issue trước.
 *
 * Đánh đổi (docs/OPEN-QUESTIONS.md B4): tốn thêm một lời gọi API, và giá trị có thể đổi giữa
 * lúc preview và lúc thực thi. Nếu đọc trước thất bại, preview vẫn phải dựng được — chỉ là
 * không có cột "trước", và ta đánh dấu `beforeValuesMayBeStale` để UI nói rõ.
 */
async function previewUpdateIssue(
  input: JiraUpdateInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let current: Record<string, unknown> | null = null
  try {
    const raw = await ctx.readTool('jira_get_issue', { issue_key: input.issue_key })
    current = asRecord(raw)
  } catch {
    current = null
  }

  const changes = Object.entries(input.fields).map(([field, after]) => ({
    field,
    before: current === null ? null : stringifyMaybe(current[field]),
    after: String(after),
  }))

  return {
    toolName: 'jira_update_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Cập nhật ${String(changes.length)} trường của ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [{ label: 'Issue', value: input.issue_key }],
    changes,
    impactWarning:
      current === null
        ? 'Không đọc được giá trị hiện tại của issue, nên không hiển thị được phần "trước khi đổi". Hãy kiểm tra kỹ trước khi xác nhận.'
        : 'Giá trị cũ sẽ bị ghi đè. Jira giữ lịch sử thay đổi nhưng Nexa không tự hoàn tác được.',
    reversible: false,
    riskLevel: 'WRITE_HIGH',
    beforeValuesMayBeStale: true,
  }
}

async function previewEditComment(
  input: EditCommentInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let before: string | null = null
  try {
    const raw = await ctx.readTool('jira_get_issue', {
      issue_key: input.issue_key,
      comment_limit: 50,
    })
    const record = asRecord(raw)
    const comments = record === null ? null : record['comments']
    if (Array.isArray(comments)) {
      const match = comments
        .map((c) => asRecord(c))
        .find((c) => c !== null && String(c['id'] ?? '') === input.comment_id)
      before = match === undefined || match === null ? null : stringifyMaybe(match['body'])
    }
  } catch {
    before = null
  }

  return {
    toolName: 'jira_edit_comment',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Sửa bình luận #${input.comment_id} trên ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      { label: 'ID bình luận', value: input.comment_id },
      truncateField('Nội dung mới', input.body),
    ],
    changes: [{ field: `Bình luận #${input.comment_id}`, before, after: input.body }],
    impactWarning:
      before === null
        ? 'Không tìm được nội dung cũ của bình luận trong 50 bình luận gần nhất — có thể bình luận cũ hơn hoặc đã bị lọc.'
        : 'Nội dung cũ sẽ bị ghi đè và hiển thị công khai với mọi người có quyền xem issue.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
    beforeValuesMayBeStale: true,
  }
}

function previewAddWorklog(input: AddWorklogInput, ctx: PreviewContext): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira_add_worklog',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Ghi worklog ${input.time_spent} vào ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      { label: 'Thời gian', value: input.time_spent },
      ...(input.comment === undefined || input.comment === ''
        ? []
        : [truncateField('Ghi chú', input.comment)]),
    ],
    changes: [
      { field: `Worklog mới trên ${input.issue_key}`, before: null, after: input.time_spent },
    ],
    impactWarning:
      'Có thể ảnh hưởng tới ước lượng thời gian còn lại của issue. Không có tool xoá worklog trong danh mục hiện tại.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewUpdateFormAnswers(
  input: UpdateFormAnswersInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira_update_proforma_form_answers',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Cập nhật ${String(input.answers.length)} câu trả lời của form trên ${input.issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      { label: 'Form', value: input.form_id },
    ],
    changes: input.answers.map((a) => ({
      field: `Câu hỏi ${String(a['questionId'] ?? '?')}`,
      before: null,
      after: stringifyMaybe(a['value']) ?? '',
    })),
    impactWarning: 'Không đọc trước được câu trả lời hiện tại của form.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

async function previewAssignIssue(
  input: AssignIssueInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let before: string | null = null
  try {
    const raw = await ctx.readTool('jira_get_issue', { issue_key: input.issue_key })
    const record = asRecord(raw)
    before = record === null ? null : stringifyMaybe(record['assignee'])
  } catch {
    before = null
  }

  const after = input.assignee === undefined || input.assignee === '' ? 'bỏ gán' : input.assignee

  return {
    toolName: 'jira_assign_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action:
      input.assignee === undefined || input.assignee === ''
        ? `Bỏ gán người phụ trách của ${input.issue_key}`
        : `Gán ${input.issue_key} cho ${input.assignee}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      { label: 'Người được gán', value: after },
    ],
    changes: [{ field: 'Người phụ trách', before, after }],
    impactWarning: 'Người được gán mới có thể nhận thông báo về issue.',
    reversible: true,
    riskLevel: 'WRITE_LOW',
    beforeValuesMayBeStale: true,
  }
}

function previewCreateIssueLink(
  input: CreateIssueLinkInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: 'jira_create_issue_link',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Tạo liên kết "${input.link_type}" giữa ${input.inward_issue_key} và ${input.outward_issue_key}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Loại liên kết', value: input.link_type },
      { label: 'Issue nguồn', value: input.inward_issue_key },
      { label: 'Issue đích', value: input.outward_issue_key },
    ],
    changes: [
      {
        field: `Liên kết giữa ${input.inward_issue_key} và ${input.outward_issue_key}`,
        before: null,
        after: input.link_type,
      },
    ],
    impactWarning:
      'Muốn gỡ liên kết sau này cần tìm đúng link_id (qua jira_get_issue) rồi gọi jira_remove_issue_link.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

async function previewTransitionIssue(
  input: TransitionInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let beforeStatus: string | null = null
  let transitionName: string | null = null

  try {
    const raw = await ctx.readTool('jira_get_issue', { issue_key: input.issue_key })
    const record = asRecord(raw)
    beforeStatus = record === null ? null : stringifyMaybe(record['status'])
  } catch {
    beforeStatus = null
  }

  try {
    const raw = await ctx.readTool('jira_get_transitions', { issue_key: input.issue_key })
    const record = asRecord(raw)
    const transitions = record === null ? null : record['transitions']
    if (Array.isArray(transitions)) {
      const match = transitions
        .map((t) => asRecord(t))
        .find((t) => t !== null && String(t['id'] ?? '') === input.transition_id)
      transitionName =
        match === undefined || match === null
          ? null
          : stringifyMaybe(asRecord(match['to'])?.['name'] ?? match['name'])
    }
  } catch {
    transitionName = null
  }

  const afterLabel = transitionName ?? `transition #${input.transition_id}`

  return {
    toolName: 'jira_transition_issue',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Chuyển trạng thái ${input.issue_key} sang "${afterLabel}"`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Issue', value: input.issue_key },
      { label: 'Transition', value: afterLabel },
      ...(input.comment === undefined || input.comment === ''
        ? []
        : [truncateField('Bình luận kèm theo', input.comment)]),
    ],
    changes: [{ field: 'Trạng thái', before: beforeStatus, after: afterLabel }],
    impactWarning:
      'Đổi trạng thái có thể kích hoạt quy tắc workflow (thông báo, tự động gán, webhook) mà Nexa không kiểm soát được.',
    reversible: false,
    riskLevel: 'WRITE_HIGH',
    beforeValuesMayBeStale: true,
  }
}

function previewUpdateWithoutBefore(opts: {
  toolName: string
  ctx: PreviewContext
  action: string
  idLabel: string
  idValue: string
  fields: Record<string, unknown>
  impactWarning: string
}): Promise<ToolPreview> {
  const changedFields = Object.entries(opts.fields).filter(([, v]) => v !== undefined)
  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'jira',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: opts.action,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: [
      { label: opts.idLabel, value: opts.idValue },
      ...changedFields.map(([k, v]) => ({ label: k, value: stringifyMaybe(v) ?? '' })),
    ],
    changes: changedFields.map(([field, after]) => ({
      field,
      before: null,
      after: stringifyMaybe(after) ?? '',
    })),
    impactWarning: opts.impactWarning,
    reversible: false,
    riskLevel: 'WRITE_HIGH',
  })
}

function previewSimpleCreate(opts: {
  toolName: string
  ctx: PreviewContext
  action: string
  fields: Record<string, unknown>
  newLabel: string
  newValue: string
  impactWarning: string
}): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'jira',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: opts.action,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: Object.entries(opts.fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ({ label: k, value: stringifyMaybe(v) ?? '' })),
    changes: [{ field: opts.newLabel, before: null, after: opts.newValue }],
    impactWarning: opts.impactWarning,
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewSimpleAction(opts: {
  toolName: string
  ctx: PreviewContext
  action: string
  fields: Record<string, unknown>
  changeLabel: string
  after: string
  impactWarning: string
  reversible: boolean
  riskLevel?: 'WRITE_LOW' | 'WRITE_HIGH' | 'DESTRUCTIVE'
}): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'jira',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: opts.action,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: Object.entries(opts.fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ({ label: k, value: stringifyMaybe(v) ?? '' })),
    changes: [{ field: opts.changeLabel, before: null, after: opts.after }],
    impactWarning: opts.impactWarning,
    reversible: opts.reversible,
    riskLevel: opts.riskLevel ?? 'WRITE_LOW',
  })
}

function previewBatchCreateIssues(
  input: { issues: string; validate_only: boolean },
  ctx: PreviewContext,
): Promise<ToolPreview> {
  return previewBatchCreateFromJsonArray({
    toolName: 'jira_batch_create_issues',
    ctx,
    jsonText: input.issues,
    action: input.validate_only ? 'Kiểm tra hợp lệ nhiều issue (chưa tạo thật)' : 'Tạo nhiều issue',
    nameField: 'summary',
  })
}

function previewBatchCreateFromJsonArray(opts: {
  toolName: string
  ctx: PreviewContext
  jsonText: string
  action: string
  nameField: string
}): Promise<ToolPreview> {
  const items = tryParseJsonArray(opts.jsonText)

  if (items === null) {
    return Promise.resolve({
      toolName: opts.toolName,
      targetSystem: 'jira',
      targetSystemUrl: opts.ctx.targetSystemUrl,
      action: opts.action,
      actingAccount: opts.ctx.actingAccount,
      payloadFields: [truncateField('Dữ liệu (JSON thô)', opts.jsonText)],
      changes: [
        {
          field: 'Bản ghi mới',
          before: null,
          after: 'không đọc được cấu trúc JSON — xem dữ liệu thô',
        },
      ],
      impactWarning:
        'Không parse được nội dung JSON để hiện chi tiết từng bản ghi. Kiểm tra kỹ trước khi xác nhận.',
      reversible: false,
      riskLevel: 'WRITE_LOW',
    })
  }

  const names = items.map((item) => {
    const record = asRecord(item)
    return record === null
      ? '(không đọc được)'
      : (stringifyMaybe(record[opts.nameField]) ?? '(không có tên)')
  })

  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'jira',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: `${opts.action} (${String(items.length)} bản ghi)`,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: names.map((n, i) => ({ label: `#${String(i + 1)}`, value: n })),
    changes: names.map((n) => ({ field: 'Bản ghi mới', before: null, after: n })),
    impactWarning: 'Mọi bản ghi hợp lệ trong danh sách sẽ được tạo trong một lần gọi.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewCreateCustomerRequest(
  input: CustomerRequestInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  const fields = tryParseJsonObject(input.request_field_values)
  const summary = fields === null ? null : stringifyMaybe(fields['summary'])

  return Promise.resolve({
    toolName: 'jira_create_customer_request',
    targetSystem: 'jira',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Tạo yêu cầu khách hàng trên service desk ${input.service_desk_id}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Service desk', value: input.service_desk_id },
      { label: 'Request type', value: input.request_type_id },
      ...(fields === null
        ? [truncateField('Nội dung (JSON thô)', input.request_field_values)]
        : Object.entries(fields).map(([k, v]) => truncateField(k, stringifyMaybe(v) ?? ''))),
    ],
    changes: [
      {
        field: `Request mới trên service desk ${input.service_desk_id}`,
        before: null,
        after: summary ?? '(không có summary)',
      },
    ],
    impactWarning: 'Request có thể gửi thông báo cho khách hàng và agent liên quan.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

// ── Lookup cho trạng thái uncertain (§16, OPEN-QUESTIONS B9) ──────────────

async function lookupCreatedIssue(
  input: JiraCreateInput,
  ctx: LookupContext,
): Promise<UncertainLookupResult> {
  const since = new Date(new Date(ctx.startedAt).getTime() - 5 * 60_000)
  const jql =
    `project = "${escapeJql(input.project_key)}" ` +
    `AND summary ~ "${escapeJql(input.summary)}" ` +
    `AND reporter = "${escapeJql(ctx.actingAccount)}" ` +
    `AND created >= "${formatJqlDate(since)}"`

  try {
    const raw = await ctx.readTool('jira_search', { jql, limit: 10 })
    const record = asRecord(raw)
    const issues = record === null ? [] : record['issues']
    if (!Array.isArray(issues)) return { matches: [], inconclusive: true }

    return {
      matches: issues.flatMap((entry) => {
        const issue = asRecord(entry)
        if (issue === null) return []
        return [
          {
            key: String(issue['key'] ?? ''),
            url: String(issue['url'] ?? ''),
            summary: String(issue['summary'] ?? ''),
          },
        ]
      }),
      inconclusive: false,
    }
  } catch {
    return { matches: [], inconclusive: true }
  }
}

// ── Tiện ích riêng của các preview builder trên ───────────────────────────

function recordFields(input: unknown): Record<string, unknown> {
  return asRecord(input) ?? {}
}

function omitKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (!keys.includes(k)) result[k] = v
  }
  return result
}

function stringifyMaybe(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function tryParseJsonArray(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}
