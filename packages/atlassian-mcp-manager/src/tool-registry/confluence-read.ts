import { z } from 'zod'
import type { ToolDefinition } from '@nexa/shared-types'
import { summarizeGeneric, toJsonSchema } from './shared.js'
import { summarizeConfluencePage } from './confluence-shared.js'

/**
 * Mọi tool READ Confluence (§10.1). Gộp chung dưới `confluenceRead`/`confluenceSearch` như quy
 * ước sẵn có — không tách thêm flag vì (khác Jira Service Management) không có nhóm tool nào ở
 * đây thuộc một tính năng phụ hẳn mà tổ chức có thể không dùng tới.
 */
export function buildConfluenceReadTools(confluenceBaseUrl: string): ToolDefinition[] {
  const confluence = confluenceBaseUrl

  return [
    {
      name: 'confluence_search',
      mcpToolName: 'confluence_search',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Tìm trang Confluence bằng từ khoá thường hoặc câu truy vấn CQL.',
      inputSchema: z.object({
        query: z.string().min(1).max(2_000),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      jsonSchema: toJsonSchema(
        {
          query: {
            type: 'string',
            description: 'Từ khoá tìm kiếm, hoặc một câu CQL như `type = page AND space = DOC`',
          },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
        },
        ['query'],
      ),
      requiredFeature: 'confluenceSearch',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page',
      mcpToolName: 'confluence_get_page',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Đọc nội dung một trang Confluence theo id.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ page_id: { type: 'string', description: 'Id của trang' } }, [
        'page_id',
      ]),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_get_page_children',
      mcpToolName: 'confluence_get_page_children',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy các trang con và folder của một trang Confluence.',
      inputSchema: z.object({
        parent_id: z.string().min(1).max(64),
        expand: z.string().max(255).default('version'),
        limit: z.number().int().min(1).max(50).default(25),
        include_content: z.boolean().default(false),
        convert_to_markdown: z.boolean().default(true),
        start: z.number().int().min(0).default(0),
        include_folders: z.boolean().default(true),
      }),
      jsonSchema: toJsonSchema(
        {
          parent_id: { type: 'string', description: 'ID trang cha' },
          expand: { type: 'string', description: "Field cần expand, ví dụ 'version'" },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
          include_content: { type: 'boolean', description: 'Kèm nội dung trang' },
          convert_to_markdown: { type: 'boolean', description: 'Chuyển nội dung sang markdown' },
          start: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          include_folders: { type: 'boolean', description: 'Kèm cả folder con' },
        },
        ['parent_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_space_page_tree',
      mcpToolName: 'confluence_get_space_page_tree',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy cây phân cấp trang trong một space, dạng danh sách phẳng.',
      inputSchema: z.object({
        space_key: z.string().min(1).max(64),
        limit: z.number().int().min(1).max(1_000).default(100),
      }),
      jsonSchema: toJsonSchema(
        {
          space_key: { type: 'string' },
          limit: { type: 'number', description: 'Số trang tối đa cần lấy' },
        },
        ['space_key'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_comments',
      mcpToolName: 'confluence_get_comments',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy danh sách bình luận của một trang.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ page_id: { type: 'string' } }, ['page_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_labels',
      mcpToolName: 'confluence_get_labels',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy nhãn (label) của một trang, blog post hoặc attachment.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema(
        { page_id: { type: 'string', description: "ID nội dung; attachment dùng tiền tố 'att'" } },
        ['page_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_inline_comments',
      mcpToolName: 'confluence_get_inline_comments',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy các bình luận inline (gắn vào đoạn văn bản cụ thể) của một trang.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ page_id: { type: 'string' } }, ['page_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_search_user',
      mcpToolName: 'confluence_search_user',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Tìm người dùng Confluence bằng CQL (Cloud) hoặc theo group member (Server/DC).',
      inputSchema: z.object({
        query: z.string().min(1).max(1_000),
        limit: z.number().int().min(1).max(50).default(10),
        group_name: z.string().max(255).default('confluence-users'),
      }),
      jsonSchema: toJsonSchema(
        {
          query: {
            type: 'string',
            description: 'Câu CQL tìm người dùng, ví dụ user.fullname ~ "Nguyen Van A"',
          },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–50)' },
          group_name: { type: 'string', description: 'Group cần tìm trong (chỉ Server/DC)' },
        },
        ['query'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_history',
      mcpToolName: 'confluence_get_page_history',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy nội dung một phiên bản lịch sử cụ thể của trang.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        version: z.number().int().min(1),
        convert_to_markdown: z.boolean().default(true),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          version: { type: 'number', description: 'Số phiên bản cần lấy' },
          convert_to_markdown: { type: 'boolean', description: 'Chuyển nội dung sang markdown' },
        },
        ['page_id', 'version'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_diff',
      mcpToolName: 'confluence_get_page_diff',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'So sánh hai phiên bản của một trang, trả về unified diff.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        from_version: z.number().int().min(1),
        to_version: z.number().int().min(1),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          from_version: { type: 'number', description: 'Phiên bản gốc' },
          to_version: { type: 'number', description: 'Phiên bản đích' },
        },
        ['page_id', 'from_version', 'to_version'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_views',
      mcpToolName: 'confluence_get_page_views',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy thống kê lượt xem của một trang (chỉ Confluence Cloud).',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        include_title: z.boolean().default(true),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          include_title: { type: 'boolean', description: 'Kèm tiêu đề trang trong kết quả' },
        },
        ['page_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_attachments',
      mcpToolName: 'confluence_get_attachments',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Liệt kê attachment của một trang hoặc blog post.',
      inputSchema: z.object({
        content_id: z.string().min(1).max(64),
        start: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        filename: z.string().max(255).optional(),
        media_type: z.string().max(255).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          content_id: { type: 'string' },
          start: { type: 'number', description: 'Vị trí bắt đầu phân trang' },
          limit: { type: 'number', description: 'Số kết quả tối đa (1–100)' },
          filename: { type: 'string', description: 'Lọc theo tên file chính xác' },
          media_type: { type: 'string', description: 'Lọc theo MIME type' },
        },
        ['content_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_download_attachment',
      mcpToolName: 'confluence_download_attachment',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Tải một attachment (mã hoá base64, tối đa 50 MB).',
      inputSchema: z.object({ attachment_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema(
        { attachment_id: { type: 'string', description: "ID attachment, ví dụ 'att123456789'" } },
        ['attachment_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_download_content_attachments',
      mcpToolName: 'confluence_download_content_attachments',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Tải toàn bộ attachment của một trang hoặc blog post.',
      inputSchema: z.object({ content_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ content_id: { type: 'string' } }, ['content_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_images',
      mcpToolName: 'confluence_get_page_images',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy các ảnh đính kèm của một trang để model xem trực tiếp.',
      inputSchema: z.object({ content_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ content_id: { type: 'string' } }, ['content_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_list_page_templates',
      mcpToolName: 'confluence_list_page_templates',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Liệt kê template trang Confluence (chỉ Confluence Cloud).',
      inputSchema: z.object({
        space_key: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(200).default(25),
      }),
      jsonSchema: toJsonSchema(
        {
          space_key: { type: 'string', description: 'Bỏ trống để lấy template toàn site' },
          limit: { type: 'number', description: 'Số template tối đa' },
        },
        [],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_template',
      mcpToolName: 'confluence_get_page_template',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy nội dung một template trang theo ID (chỉ Confluence Cloud).',
      inputSchema: z.object({ template_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ template_id: { type: 'string' } }, ['template_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_page_restrictions',
      mcpToolName: 'confluence_get_page_restrictions',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy giới hạn quyền xem/sửa hiện tại của một trang.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ page_id: { type: 'string' } }, ['page_id']),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_check_content_permissions',
      mcpToolName: 'confluence_check_content_permissions',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description:
        'Kiểm tra một người dùng/nhóm có quyền thực hiện một hành động trên nội dung không (chỉ Cloud).',
      inputSchema: z.object({
        content_id: z.string().min(1).max(64),
        user_identifier: z.string().min(1).max(255),
        operation: z.string().min(1).max(64),
        subject_type: z.enum(['user', 'group']).default('user'),
      }),
      jsonSchema: toJsonSchema(
        {
          content_id: { type: 'string' },
          user_identifier: { type: 'string', description: 'Account ID người dùng, hoặc group ID' },
          operation: {
            type: 'string',
            description: "Ví dụ: 'read', 'update', 'delete', 'administer'",
          },
          subject_type: { type: 'string', description: "'user' hoặc 'group'" },
        },
        ['content_id', 'user_identifier', 'operation'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_get_space_permissions',
      mcpToolName: 'confluence_get_space_permissions',
      targetSystem: 'confluence',
      riskLevel: 'READ',
      description: 'Lấy quyền của một space, dùng để rà soát ai có quyền truy cập (chỉ Cloud).',
      inputSchema: z.object({
        space_id: z.string().min(1).max(64),
        limit: z.number().int().min(1).default(25),
        cursor: z.string().max(500).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          space_id: { type: 'string', description: 'ID số của space (không phải space key)' },
          limit: { type: 'number', description: 'Số mục tối đa' },
          cursor: { type: 'string', description: 'Con trỏ phân trang từ lần gọi trước' },
        },
        ['space_id'],
      ),
      requiredFeature: 'confluenceRead',
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
  ]
}
