import { z } from 'zod'
import type { ToolDefinition } from '@nexa/shared-types'
import { toJsonSchema } from './shared.js'
import {
  DEFAULT_ISSUE_FIELDS,
  ISSUE_KEY_PATTERN,
  PROJECT_KEY_PATTERN,
  summarizeJiraIssue,
  summarizeJiraSearch,
} from './jira-shared.js'
import { summarizeGeneric } from './shared.js'

/**
 * Mọi tool READ Jira (§10.1 — chạy khi kết nối đã kiểm tra, không cần xác nhận).
 *
 * Chia flag theo phạm vi: `jiraRead` cho tool đọc MỘT đối tượng (issue/user/field), `jiraSearch`
 * cho tool liệt kê/tìm NHIỀU đối tượng (project/board/sprint…), `jiraServiceDesk` cho nhóm JSM
 * (queue/request type) — tách riêng vì không phải tổ chức nào cũng dùng Service Management và
 * dữ liệu request có thể nhạy cảm hơn issue nội bộ (xem settings.ts).
 *
 * Phần lớn dùng `summarizeGeneric` (rút gọn JSON nguyên văn, không đoán hình dạng) — bespoke
 * parser như `summarizeJiraIssue`/`summarizeConfluencePage` chỉ đáng công cho tool được gọi rất
 * thường xuyên; với 30+ tool ít dùng hơn, model tự đọc JSON thô vẫn tốt hơn là đoán sai hình dạng.
 */
export function buildJiraReadTools(jiraBaseUrl: string): ToolDefinition[] {
  const jira = jiraBaseUrl

  return [
    {
      name: 'jira_get_issue',
      mcpToolName: 'jira_get_issue',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Đọc chi tiết một Jira issue theo key, ví dụ PRJ-123.',
      inputSchema: z.object({
        issue_key: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[A-Z][A-Z0-9_]*-\d+$/, 'phải có dạng ABC-123'),
      }),
      jsonSchema: toJsonSchema(
        { issue_key: { type: 'string', description: 'Key của issue, ví dụ PRJ-123' } },
        ['issue_key'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeJiraIssue(raw, jira),
    },
    {
      name: 'jira_search',
      mcpToolName: 'jira_search',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tìm Jira issue bằng câu truy vấn JQL.',
      inputSchema: z.object({
        jql: z.string().min(1).max(2_000),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      jsonSchema: toJsonSchema(
        {
          jql: { type: 'string', description: 'Câu JQL' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['jql'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeJiraSearch(raw, jira),
    },
    {
      name: 'jira_get_user_profile',
      mcpToolName: 'jira_get_user_profile',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Đọc hồ sơ một người dùng Jira (email, username, account ID hoặc key).',
      inputSchema: z.object({ user_identifier: z.string().min(1).max(255) }),
      jsonSchema: toJsonSchema(
        {
          user_identifier: {
            type: 'string',
            description: 'Định danh người dùng: email, username, account ID hoặc key',
          },
        },
        ['user_identifier'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_search_assignable_users',
      mcpToolName: 'jira_search_assignable_users',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description:
        'Tìm người dùng có thể được gán vào một project hoặc issue cụ thể, theo tên/email.',
      inputSchema: z.object({
        query: z.string().min(1).max(255),
        project_key: z.string().max(32).optional(),
        issue_key: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(1_000).default(20),
      }),
      jsonSchema: toJsonSchema(
        {
          query: { type: 'string', description: 'Tên hiển thị / username / email cần tìm' },
          project_key: {
            type: 'string',
            description: 'Giới hạn tìm trong một project (cần nếu không có issue_key)',
          },
          issue_key: {
            type: 'string',
            description: 'Giới hạn tìm trong phạm vi một issue (cần nếu không có project_key)',
          },
          limit: { type: 'number', description: 'Số kết quả tối đa' },
        },
        ['query'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_watchers',
      mcpToolName: 'jira_get_issue_watchers',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy danh sách người theo dõi (watcher) của một Jira issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema(
        { issue_key: { type: 'string', description: "Key issue, ví dụ 'PROJ-123'" } },
        ['issue_key'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_search_fields',
      mcpToolName: 'jira_search_fields',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tìm field Jira (kể cả custom field) theo từ khoá.',
      inputSchema: z.object({
        keyword: z.string().max(255).default(''),
        limit: z.number().int().min(1).default(10),
        refresh: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          keyword: {
            type: 'string',
            description: 'Từ khoá tìm gần đúng; để trống để liệt kê field đầu tiên',
          },
          limit: { type: 'number', description: 'Số kết quả tối đa' },
          refresh: { type: 'boolean', description: 'Buộc tải lại danh sách field' },
        },
        [],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_field_options',
      mcpToolName: 'jira_get_field_options',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các giá trị hợp lệ của một custom field (select, radio, checkbox…).',
      inputSchema: z.object({
        field_id: z.string().min(1).max(64),
        context_id: z.string().max(64).optional(),
        project_key: z.string().max(32).optional(),
        issue_type: z.string().max(64).optional(),
        contains: z.string().max(255).optional(),
        return_limit: z.number().int().min(1).optional(),
        values_only: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          field_id: { type: 'string', description: "ID custom field, ví dụ 'customfield_10001'" },
          context_id: { type: 'string', description: 'Context ID (chỉ Cloud)' },
          project_key: { type: 'string', description: 'Project key (cần cho Server/DC)' },
          issue_type: { type: 'string', description: 'Tên issue type (cần cho Server/DC)' },
          contains: {
            type: 'string',
            description: 'Lọc theo chuỗi con, không phân biệt hoa thường',
          },
          return_limit: { type: 'number', description: 'Số kết quả tối đa sau khi lọc' },
          values_only: { type: 'boolean', description: 'Chỉ trả về danh sách giá trị (gọn hơn)' },
        },
        ['field_id'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_issues',
      mcpToolName: 'jira_get_project_issues',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy toàn bộ issue của một project Jira.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        limit: z.number().int().min(1).max(50).default(10),
        start_at: z.number().int().min(0).default(0),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string', description: "Project key, ví dụ 'PROJ'" },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
        },
        ['project_key'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeJiraSearch(raw, jira),
    },
    {
      name: 'jira_get_transitions',
      mcpToolName: 'jira_get_transitions',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy danh sách các bước chuyển trạng thái khả dụng của một issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_worklog',
      mcpToolName: 'jira_get_worklog',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các mục ghi nhận thời gian (worklog) của một issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_download_attachments',
      mcpToolName: 'jira_download_attachments',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tải nội dung các file đính kèm của một issue (mã hoá base64).',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_images',
      mcpToolName: 'jira_get_issue_images',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các ảnh đính kèm của một issue để model xem trực tiếp.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_agile_boards',
      mcpToolName: 'jira_get_agile_boards',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tìm board Agile theo tên, project key hoặc loại board.',
      inputSchema: z.object({
        board_name: z.string().max(255).optional(),
        project_key: z.string().max(32).optional(),
        board_type: z.string().max(32).optional(),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      jsonSchema: toJsonSchema(
        {
          board_name: { type: 'string', description: 'Tên board, hỗ trợ tìm gần đúng' },
          project_key: { type: 'string', description: 'Project key' },
          board_type: { type: 'string', description: "'scrum' hoặc 'kanban'" },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        [],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_board_issues',
      mcpToolName: 'jira_get_board_issues',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy issue thuộc một board, lọc thêm bằng JQL.',
      inputSchema: z.object({
        board_id: z.string().min(1).max(32),
        jql: z.string().min(1).max(2_000),
        fields: z.string().max(500).default(DEFAULT_ISSUE_FIELDS),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
        expand: z.string().max(255).default('version'),
      }),
      jsonSchema: toJsonSchema(
        {
          board_id: { type: 'string', description: "ID của board, ví dụ '1001'" },
          jql: { type: 'string', description: 'Câu JQL để lọc issue trên board' },
          fields: {
            type: 'string',
            description: 'Danh sách field cần trả về, phân tách bằng dấu phẩy',
          },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
          expand: { type: 'string', description: "Field cần expand, ví dụ 'changelog'" },
        },
        ['board_id', 'jql'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeJiraSearch(raw, jira),
    },
    {
      name: 'jira_get_sprints_from_board',
      mcpToolName: 'jira_get_sprints_from_board',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: "Lấy sprint của một board, lọc theo trạng thái ('active', 'future', 'closed').",
      inputSchema: z.object({
        board_id: z.string().min(1).max(32),
        state: z.string().max(32).optional(),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      jsonSchema: toJsonSchema(
        {
          board_id: { type: 'string', description: "ID của board, ví dụ '1000'" },
          state: {
            type: 'string',
            description: "'active', 'future' hoặc 'closed'; bỏ trống để lấy tất cả",
          },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['board_id'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_sprint_issues',
      mcpToolName: 'jira_get_sprint_issues',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy issue thuộc một sprint.',
      inputSchema: z.object({
        sprint_id: z.string().min(1).max(32),
        fields: z.string().max(500).default(DEFAULT_ISSUE_FIELDS),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      jsonSchema: toJsonSchema(
        {
          sprint_id: { type: 'string', description: "ID của sprint, ví dụ '10001'" },
          fields: { type: 'string', description: 'Danh sách field cần trả về' },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['sprint_id'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeJiraSearch(raw, jira),
    },
    {
      name: 'jira_get_link_types',
      mcpToolName: 'jira_get_link_types',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: "Lấy các loại liên kết issue khả dụng (ví dụ 'Blocks', 'Relates to').",
      inputSchema: z.object({ name_filter: z.string().max(64).optional() }),
      jsonSchema: toJsonSchema(
        {
          name_filter: { type: 'string', description: 'Lọc theo tên, không phân biệt hoa thường' },
        },
        [],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_batch_get_changelogs',
      mcpToolName: 'jira_batch_get_changelogs',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy lịch sử thay đổi (changelog) của nhiều issue cùng lúc (chỉ Jira Cloud).',
      inputSchema: z.object({
        issue_ids_or_keys: z.string().min(1).max(2_000),
        fields: z.string().max(500).optional(),
        limit: z.number().int().default(-1),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_ids_or_keys: {
            type: 'string',
            description: 'Danh sách key/ID issue, phân tách bằng dấu phẩy',
          },
          fields: {
            type: 'string',
            description: 'Lọc changelog theo field, phân tách bằng dấu phẩy',
          },
          limit: { type: 'number', description: 'Số changelog tối đa mỗi issue (-1 = tất cả)' },
        },
        ['issue_ids_or_keys'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_issue_types',
      mcpToolName: 'jira_get_project_issue_types',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các loại issue (Bug, Task, Story…) khả dụng trong một project.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ project_key: { type: 'string' } }, ['project_key']),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_create_fields',
      mcpToolName: 'jira_get_create_fields',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các field (bắt buộc và tuỳ chọn) khi tạo issue của một loại cụ thể.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        issue_type_id: z.string().min(1).max(32),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string' },
          issue_type_id: {
            type: 'string',
            description: 'ID issue type, lấy từ jira_get_project_issue_types',
          },
        },
        ['project_key', 'issue_type_id'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_versions',
      mcpToolName: 'jira_get_project_versions',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các fix version của một project.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ project_key: { type: 'string' } }, ['project_key']),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_components',
      mcpToolName: 'jira_get_project_components',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các component của một project.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ project_key: { type: 'string' } }, ['project_key']),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_all_projects',
      mcpToolName: 'jira_get_all_projects',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy toàn bộ project Jira mà người dùng hiện tại truy cập được.',
      inputSchema: z.object({ include_archived: z.boolean().default(false) }),
      jsonSchema: toJsonSchema(
        { include_archived: { type: 'boolean', description: 'Bao gồm cả project đã lưu trữ' } },
        [],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_search_projects',
      mcpToolName: 'jira_search_projects',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Tìm project Jira theo tên hoặc tiền tố key.',
      inputSchema: z.object({
        query: z.string().min(1).max(255),
        max_results: z.number().int().min(1).max(50).default(20),
        current_project_ids: z.string().max(500).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          query: { type: 'string', description: 'Tên hoặc tiền tố key cần tìm' },
          max_results: { type: 'number', description: 'Số kết quả tối đa' },
          current_project_ids: {
            type: 'string',
            description: 'ID project cần loại khỏi kết quả, phân tách bằng dấu phẩy',
          },
        },
        ['query'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_fields',
      mcpToolName: 'jira_get_project_fields',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các field mà issue trong một project có thể mang, gộp từ mọi loại issue.',
      inputSchema: z.object({ project_key: z.string().min(1).max(32) }),
      jsonSchema: toJsonSchema({ project_key: { type: 'string' } }, ['project_key']),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_proforma_forms',
      mcpToolName: 'jira_get_issue_proforma_forms',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy danh sách ProForma form gắn với một issue.',
      inputSchema: z.object({ issue_key: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ issue_key: { type: 'string' } }, ['issue_key']),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_proforma_form_details',
      mcpToolName: 'jira_get_proforma_form_details',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy chi tiết một ProForma form, bao gồm cấu trúc câu hỏi.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64),
        form_id: z.string().min(1).max(64),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          form_id: { type: 'string', description: 'UUID của form' },
        },
        ['issue_key', 'form_id'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_dates',
      mcpToolName: 'jira_get_issue_dates',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy thông tin ngày và lịch sử chuyển trạng thái của một issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        include_status_changes: z.boolean().default(true),
        include_status_summary: z.boolean().default(true),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          include_status_changes: { type: 'boolean', description: 'Kèm lịch sử đổi trạng thái' },
          include_status_summary: {
            type: 'boolean',
            description: 'Kèm tổng thời gian ở mỗi trạng thái',
          },
        },
        ['issue_key'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_sla',
      mcpToolName: 'jira_get_issue_sla',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description:
        'Tính các chỉ số SLA (cycle time, lead time, thời gian ở mỗi trạng thái…) của một issue.',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64).regex(ISSUE_KEY_PATTERN),
        metrics: z.string().max(255).optional(),
        working_hours_only: z.boolean().optional(),
        include_raw_dates: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          metrics: {
            type: 'string',
            description: 'Danh sách metric cần tính, phân tách bằng dấu phẩy',
          },
          working_hours_only: { type: 'boolean', description: 'Chỉ tính trong giờ làm việc' },
          include_raw_dates: { type: 'boolean', description: 'Kèm giá trị ngày thô trong kết quả' },
        },
        ['issue_key'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issue_development_info',
      mcpToolName: 'jira_get_issue_development_info',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description:
        'Lấy thông tin PR/branch/commit liên kết với một issue (Bitbucket, GitHub, GitLab…).',
      inputSchema: z.object({
        issue_key: z.string().min(1).max(64),
        application_type: z.string().max(64).optional(),
        data_type: z.string().max(64).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_key: { type: 'string' },
          application_type: {
            type: 'string',
            description: "Lọc theo hệ quản lý mã nguồn, ví dụ 'GitHub'",
          },
          data_type: {
            type: 'string',
            description: "Lọc theo loại dữ liệu: 'pullrequest', 'branch'…",
          },
        },
        ['issue_key'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_issues_development_info',
      mcpToolName: 'jira_get_issues_development_info',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy thông tin PR/branch/commit cho nhiều issue cùng lúc.',
      inputSchema: z.object({
        issue_keys: z.string().min(1).max(2_000),
        application_type: z.string().max(64).optional(),
        data_type: z.string().max(64).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          issue_keys: {
            type: 'string',
            description: 'Danh sách key issue, phân tách bằng dấu phẩy',
          },
          application_type: { type: 'string' },
          data_type: { type: 'string' },
        },
        ['issue_keys'],
      ),
      requiredFeature: 'jiraRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_project_epic_hierarchy',
      mcpToolName: 'jira_get_project_epic_hierarchy',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Nhóm các Epic của một project theo issue cha (kể cả cha ở project khác).',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        max_epics: z.number().int().min(1).max(500).default(200),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string' },
          max_epics: { type: 'number', description: 'Số Epic tối đa cần lấy (1–500)' },
        },
        ['project_key'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_cross_project_dependencies',
      mcpToolName: 'jira_get_cross_project_dependencies',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description:
        'Tìm mọi liên kết issue của một project trỏ sang project khác, nhóm theo project đích.',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
        max_issues: z.number().int().min(1).max(500).default(200),
      }),
      jsonSchema: toJsonSchema(
        {
          project_key: { type: 'string' },
          max_issues: { type: 'number', description: 'Số issue tối đa cần quét (1–500)' },
        },
        ['project_key'],
      ),
      requiredFeature: 'jiraSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── Jira Service Management (JSM) — cờ riêng, mặc định tắt ────────────
    {
      name: 'jira_get_service_desk_for_project',
      mcpToolName: 'jira_get_service_desk_for_project',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy Service Desk gắn với một project (chỉ Server/Data Center).',
      inputSchema: z.object({
        project_key: z.string().min(1).max(32).regex(PROJECT_KEY_PATTERN),
      }),
      jsonSchema: toJsonSchema({ project_key: { type: 'string' } }, ['project_key']),
      requiredFeature: 'jiraServiceDesk',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_service_desk_queues',
      mcpToolName: 'jira_get_service_desk_queues',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các queue của một Service Desk (chỉ Server/Data Center).',
      inputSchema: z.object({
        service_desk_id: z.string().min(1).max(32),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(50),
      }),
      jsonSchema: toJsonSchema(
        {
          service_desk_id: { type: 'string', description: "ID service desk, ví dụ '4'" },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['service_desk_id'],
      ),
      requiredFeature: 'jiraServiceDesk',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_queue_issues',
      mcpToolName: 'jira_get_queue_issues',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy issue trong một queue của Service Desk (chỉ Server/Data Center).',
      inputSchema: z.object({
        service_desk_id: z.string().min(1).max(32),
        queue_id: z.string().min(1).max(32),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).default(50),
      }),
      jsonSchema: toJsonSchema(
        {
          service_desk_id: { type: 'string' },
          queue_id: { type: 'string', description: "ID queue, ví dụ '47'" },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa' },
        },
        ['service_desk_id', 'queue_id'],
      ),
      requiredFeature: 'jiraServiceDesk',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_request_types',
      mcpToolName: 'jira_get_request_types',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy các request type của một Service Desk (Jira Service Management).',
      inputSchema: z.object({
        service_desk_id: z.string().min(1).max(32),
        start_at: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(50),
      }),
      jsonSchema: toJsonSchema(
        {
          service_desk_id: { type: 'string' },
          start_at: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['service_desk_id'],
      ),
      requiredFeature: 'jiraServiceDesk',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'jira_get_request_type_fields',
      mcpToolName: 'jira_get_request_type_fields',
      targetSystem: 'jira',
      riskLevel: 'READ',
      description: 'Lấy định nghĩa field của một request type trong Jira Service Management.',
      inputSchema: z.object({
        service_desk_id: z.string().min(1).max(32),
        request_type_id: z.string().min(1).max(32),
      }),
      jsonSchema: toJsonSchema(
        {
          service_desk_id: { type: 'string' },
          request_type_id: { type: 'string', description: "ID request type, ví dụ '23'" },
        },
        ['service_desk_id', 'request_type_id'],
      ),
      requiredFeature: 'jiraServiceDesk',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
  ]
}
