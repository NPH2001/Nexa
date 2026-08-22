import { z } from 'zod'
import type { PreviewContext, ToolDefinition, ToolPreview } from '@nexa/shared-types'
import { asRecord, summarizeGeneric, toJsonSchema, truncateField } from './shared.js'
import { summarizeConfluencePage } from './confluence-shared.js'

/**
 * Mọi tool WRITE Confluence (§10.1/§10.2, §22.3).
 *
 * `confluenceWrite` = tạo nội dung mới hoặc thêm comment/label/attachment — không ghi đè gì đã
 * có. `confluenceWriteHigh` = ghi đè nội dung đã có hoặc đổi quyền truy cập (`update_page`,
 * `update_page_section`, `move_page`, `set_page_restrictions`) — rủi ro cao hơn hẳn. Cả hai mặc
 * định TẮT theo đúng khuyến nghị §22.3; người dùng phải tự bật. `delete_page`/`delete_attachment`
 * là DESTRUCTIVE — trước đây bị `AtlassianMcpManager` chặn cứng bất kể flag, kể từ 2026-08-22
 * (OPEN-QUESTIONS.md mục G1) chốt chặn đó đã gỡ, giờ chỉ còn kiểm soát bằng flag
 * `confluenceWriteHigh` + Confirmation Guard như mọi tool WRITE_HIGH khác.
 */
export function buildConfluenceWriteTools(confluenceBaseUrl: string): ToolDefinition[] {
  const confluence = confluenceBaseUrl

  return [
    // ── confluenceWrite ───────────────────────────────────────────────────
    {
      name: 'confluence_create_page',
      mcpToolName: 'confluence_create_page',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo một trang Confluence mới.',
      inputSchema: z.object({
        space_key: z.string().min(1).max(64),
        title: z.string().min(1).max(255),
        content: z.string().max(200_000).optional(),
        parent_id: z.string().max(64).optional(),
        content_format: z.enum(['markdown', 'wiki', 'storage', 'xhtml']).default('markdown'),
        emoji: z.string().max(16).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          space_key: { type: 'string', description: "Key của space, ví dụ 'DEV'" },
          title: { type: 'string' },
          content: { type: 'string', description: 'Nội dung trang, theo content_format' },
          parent_id: { type: 'string', description: 'ID trang cha (tuỳ chọn)' },
          content_format: {
            type: 'string',
            description: "'markdown' (mặc định), 'wiki', 'storage' hoặc 'xhtml'",
          },
          emoji: { type: 'string', description: 'Emoji hiển thị cạnh tiêu đề (tuỳ chọn)' },
        },
        ['space_key', 'title'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewCreatePage({
          toolName: 'confluence_create_page',
          ctx,
          spaceKey: (input as { space_key: string }).space_key,
          title: (input as { title: string }).title,
          content: (input as { content?: string }).content,
        }),
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_create_page_from_template',
      mcpToolName: 'confluence_create_page_from_template',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Tạo trang mới từ một template có sẵn (chỉ Confluence Cloud).',
      inputSchema: z.object({
        space_key: z.string().min(1).max(64),
        title: z.string().min(1).max(255),
        template_id: z.string().min(1).max(64),
        parent_id: z.string().max(64).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          space_key: { type: 'string' },
          title: { type: 'string' },
          template_id: { type: 'string' },
          parent_id: { type: 'string', description: 'ID trang cha (tuỳ chọn)' },
        },
        ['space_key', 'title', 'template_id'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewCreatePage({
          toolName: 'confluence_create_page_from_template',
          ctx,
          spaceKey: (input as { space_key: string }).space_key,
          title: (input as { title: string }).title,
          content: `(từ template ${(input as { template_id: string }).template_id})`,
        }),
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_copy_page',
      mcpToolName: 'confluence_copy_page',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Sao chép một trang sang vị trí mới.',
      inputSchema: z.object({
        source_page_id: z.string().min(1).max(64),
        destination_space_key: z.string().min(1).max(64),
        new_title: z.string().min(1).max(255),
        destination_parent_id: z.string().max(64).optional(),
        copy_attachments: z.boolean().default(true),
      }),
      jsonSchema: toJsonSchema(
        {
          source_page_id: { type: 'string' },
          destination_space_key: { type: 'string' },
          new_title: { type: 'string' },
          destination_parent_id: { type: 'string', description: 'ID trang cha ở đích (tuỳ chọn)' },
          copy_attachments: { type: 'boolean', description: 'Sao chép cả attachment (chỉ Cloud)' },
        },
        ['source_page_id', 'destination_space_key', 'new_title'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewCreatePage({
          toolName: 'confluence_copy_page',
          ctx,
          spaceKey: (input as { destination_space_key: string }).destination_space_key,
          title: (input as { new_title: string }).new_title,
          content: `(sao chép từ trang ${(input as { source_page_id: string }).source_page_id})`,
        }),
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_add_label',
      mcpToolName: 'confluence_add_label',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm nhãn (label) vào một trang, blog post hoặc attachment.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        name: z.string().min(1).max(64),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string', description: "ID nội dung; attachment dùng tiền tố 'att'" },
          name: { type: 'string', description: 'Tên nhãn (chữ thường, không dấu cách)' },
        },
        ['page_id', 'name'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_add_label',
          ctx,
          action: `Thêm nhãn "${(input as { name: string }).name}" vào ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Nhãn trên ${(input as { page_id: string }).page_id}`,
          after: (input as { name: string }).name,
          impactWarning:
            'Không có tool xoá nhãn trong danh mục hiện tại — muốn gỡ phải làm trực tiếp trên Confluence.',
          reversible: false,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_add_comment',
      mcpToolName: 'confluence_add_comment',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm bình luận vào một trang Confluence.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        body: z.string().min(1).max(32_000),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          body: { type: 'string', description: 'Nội dung, dạng Markdown' },
        },
        ['page_id', 'body'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_add_comment',
          ctx,
          action: `Thêm bình luận vào trang ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Bình luận trên trang ${(input as { page_id: string }).page_id}`,
          after: (input as { body: string }).body,
          impactWarning: 'Bình luận hiển thị công khai với mọi người có quyền xem trang.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_reply_to_comment',
      mcpToolName: 'confluence_reply_to_comment',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Trả lời một bình luận đã có trên trang.',
      inputSchema: z.object({
        comment_id: z.string().min(1).max(64),
        body: z.string().min(1).max(32_000),
      }),
      jsonSchema: toJsonSchema({ comment_id: { type: 'string' }, body: { type: 'string' } }, [
        'comment_id',
        'body',
      ]),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_reply_to_comment',
          ctx,
          action: `Trả lời bình luận #${(input as { comment_id: string }).comment_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Trả lời bình luận #${(input as { comment_id: string }).comment_id}`,
          after: (input as { body: string }).body,
          impactWarning: 'Trả lời hiển thị công khai với mọi người có quyền xem trang.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_add_inline_comment',
      mcpToolName: 'confluence_add_inline_comment',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Thêm bình luận gắn vào một đoạn text cụ thể trên trang.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        body: z.string().min(1).max(32_000),
        text_selection: z.string().min(1).max(2_000),
        text_selection_match_count: z.number().int().min(1).default(1),
        text_selection_match_index: z.number().int().min(0).default(0),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          body: { type: 'string' },
          text_selection: {
            type: 'string',
            description: 'Đoạn text chính xác để gắn bình luận vào',
          },
          text_selection_match_count: {
            type: 'number',
            description: 'Tổng số lần đoạn text xuất hiện trên trang',
          },
          text_selection_match_index: {
            type: 'number',
            description: 'Vị trí lần xuất hiện cần gắn (0 = lần đầu)',
          },
        },
        ['page_id', 'body', 'text_selection'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_add_inline_comment',
          ctx,
          action: `Thêm bình luận inline vào trang ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Bình luận inline trên trang ${(input as { page_id: string }).page_id}`,
          after: (input as { body: string }).body,
          impactWarning:
            'Nếu đoạn text được chọn xuất hiện nhiều lần và text_selection_match_index sai, bình luận có thể gắn nhầm vị trí.',
          reversible: true,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_upload_attachment',
      mcpToolName: 'confluence_upload_attachment',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Upload một file đính kèm vào trang hoặc blog post.',
      inputSchema: z.object({
        content_id: z.string().min(1).max(64),
        file_path: z.string().max(1_000).optional(),
        content_base64: z.string().max(20_000_000).optional(),
        filename: z.string().max(255).optional(),
        comment: z.string().max(2_000).optional(),
        minor_edit: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          content_id: { type: 'string' },
          file_path: {
            type: 'string',
            description: 'Đường dẫn file trên máy chạy MCP server (tuỳ chọn)',
          },
          content_base64: {
            type: 'string',
            description: 'Nội dung file mã hoá base64, dùng khi không có file_path (tuỳ chọn)',
          },
          filename: { type: 'string', description: 'Tên file — bắt buộc khi dùng content_base64' },
          comment: { type: 'string', description: 'Ghi chú cho attachment/phiên bản (tuỳ chọn)' },
          minor_edit: { type: 'boolean', description: 'Không gửi thông báo tới người theo dõi' },
        },
        ['content_id'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewUploadAttachment({
          toolName: 'confluence_upload_attachment',
          ctx,
          contentId: (input as { content_id: string }).content_id,
          label:
            (input as { filename?: string; file_path?: string }).filename ??
            (input as { filename?: string; file_path?: string }).file_path ??
            '(không rõ tên file)',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_upload_attachments',
      mcpToolName: 'confluence_upload_attachments',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_LOW',
      description: 'Upload nhiều file đính kèm vào một trang trong một lần gọi.',
      inputSchema: z.object({
        content_id: z.string().min(1).max(64),
        file_paths: z.string().min(1).max(4_000),
        comment: z.string().max(2_000).optional(),
        minor_edit: z.boolean().default(false),
      }),
      jsonSchema: toJsonSchema(
        {
          content_id: { type: 'string' },
          file_paths: {
            type: 'string',
            description: 'Danh sách đường dẫn file, phân tách bằng dấu phẩy',
          },
          comment: { type: 'string', description: 'Ghi chú áp dụng cho mọi file (tuỳ chọn)' },
          minor_edit: { type: 'boolean', description: 'Không gửi thông báo tới người theo dõi' },
        },
        ['content_id', 'file_paths'],
      ),
      requiredFeature: 'confluenceWrite',
      buildPreview: (input, ctx) =>
        previewUploadAttachment({
          toolName: 'confluence_upload_attachments',
          ctx,
          contentId: (input as { content_id: string }).content_id,
          label: (input as { file_paths: string }).file_paths,
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── confluenceWriteHigh ─────────────────────────────────────────────
    {
      name: 'confluence_update_page',
      mcpToolName: 'confluence_update_page',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_HIGH',
      description: 'Cập nhật một trang Confluence đã có (ghi đè tiêu đề/nội dung).',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        title: z.string().min(1).max(255),
        content: z.string().max(200_000).optional(),
        is_minor_edit: z.boolean().default(false),
        version_comment: z.string().max(2_000).optional(),
        parent_id: z.string().max(64).optional(),
        content_format: z.enum(['markdown', 'wiki', 'storage', 'xhtml']).default('markdown'),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string', description: 'Nội dung mới, theo content_format' },
          is_minor_edit: { type: 'boolean' },
          version_comment: { type: 'string' },
          parent_id: { type: 'string', description: 'Trang cha mới (tuỳ chọn)' },
          content_format: { type: 'string' },
        },
        ['page_id', 'title'],
      ),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) => previewUpdatePage(input as UpdatePageInput, ctx),
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_update_page_section',
      mcpToolName: 'confluence_update_page_section',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_HIGH',
      description: 'Cập nhật đúng một section (theo heading) của trang, giữ nguyên phần còn lại.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        heading_text: z.string().min(1).max(255),
        new_content: z.string().min(1).max(100_000),
        content_format: z.enum(['markdown', 'storage']).default('markdown'),
        is_minor_edit: z.boolean().default(false),
        version_comment: z.string().max(2_000).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          heading_text: {
            type: 'string',
            description:
              'Heading xác định section cần thay — phải khớp chính xác, phân biệt hoa/thường',
          },
          new_content: { type: 'string', description: 'Nội dung thay thế, KHÔNG gồm heading' },
          content_format: { type: 'string', description: "'markdown' (mặc định) hoặc 'storage'" },
          is_minor_edit: { type: 'boolean' },
          version_comment: { type: 'string' },
        },
        ['page_id', 'heading_text', 'new_content'],
      ),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_update_page_section',
          ctx,
          action: `Cập nhật section "${(input as { heading_text: string }).heading_text}" của trang ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Section "${(input as { heading_text: string }).heading_text}"`,
          after: truncatePreview((input as { new_content: string }).new_content),
          impactWarning:
            'Không đọc trước được nội dung cũ của section. Nếu heading không khớp chính xác, thao tác sẽ lỗi thay vì sửa nhầm chỗ khác.',
          reversible: false,
          riskLevel: 'WRITE_HIGH',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_move_page',
      mcpToolName: 'confluence_move_page',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_HIGH',
      description: 'Di chuyển một trang sang trang cha hoặc space khác.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        target_parent_id: z.string().max(64).optional(),
        target_space_key: z.string().max(64).optional(),
        position: z.enum(['append', 'above', 'below']).default('append'),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          target_parent_id: {
            type: 'string',
            description: 'Trang cha đích (bỏ trống + target_space_key = về root của space)',
          },
          target_space_key: {
            type: 'string',
            description: 'Space đích khi di chuyển sang space khác',
          },
          position: { type: 'string', description: "'append' (mặc định), 'above' hoặc 'below'" },
        },
        ['page_id'],
      ),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_move_page',
          ctx,
          action: `Di chuyển trang ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: `Vị trí của trang ${(input as { page_id: string }).page_id}`,
          after:
            (input as { target_space_key?: string }).target_space_key ??
            (input as { target_parent_id?: string }).target_parent_id ??
            '(gốc space hiện tại)',
          impactWarning:
            'Link tương đối trong trang con (nếu có) vẫn giữ nguyên, nhưng cấu trúc điều hướng của space sẽ đổi.',
          reversible: false,
          riskLevel: 'WRITE_HIGH',
        }),
      summarizeResult: (raw) => summarizeConfluencePage(raw, confluence),
    },
    {
      name: 'confluence_set_page_restrictions',
      mcpToolName: 'confluence_set_page_restrictions',
      targetSystem: 'confluence',
      riskLevel: 'WRITE_HIGH',
      description: 'Đặt giới hạn quyền xem/sửa của trang — thay thế toàn bộ giới hạn hiện có.',
      inputSchema: z.object({
        page_id: z.string().min(1).max(64),
        read_users: z.array(z.string()).max(200).optional(),
        read_groups: z.array(z.string()).max(200).optional(),
        edit_users: z.array(z.string()).max(200).optional(),
        edit_groups: z.array(z.string()).max(200).optional(),
      }),
      jsonSchema: toJsonSchema(
        {
          page_id: { type: 'string' },
          read_users: {
            type: 'array',
            items: { type: 'string' },
            description: 'Account ID/username được xem (rỗng = không giới hạn)',
          },
          read_groups: { type: 'array', items: { type: 'string' }, description: 'Group được xem' },
          edit_users: {
            type: 'array',
            items: { type: 'string' },
            description: 'Account ID/username được sửa',
          },
          edit_groups: { type: 'array', items: { type: 'string' }, description: 'Group được sửa' },
        },
        ['page_id'],
      ),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) => previewSetPageRestrictions(input as SetRestrictionsInput, ctx),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },

    // ── DESTRUCTIVE — luôn bị chặn ở AtlassianMcpManager, không phụ thuộc flag ──
    {
      name: 'confluence_delete_page',
      mcpToolName: 'confluence_delete_page',
      targetSystem: 'confluence',
      riskLevel: 'DESTRUCTIVE',
      description:
        'Xoá vĩnh viễn một trang Confluence. Không thể hoàn tác — luôn cần xác nhận qua preview.',
      inputSchema: z.object({ page_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ page_id: { type: 'string' } }, ['page_id']),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_delete_page',
          ctx,
          action: `Xoá vĩnh viễn trang ${(input as { page_id: string }).page_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: (input as { page_id: string }).page_id,
          after: 'đã xoá vĩnh viễn',
          impactWarning: 'Không thể hoàn tác. Trang con (nếu có) cũng bị ảnh hưởng.',
          reversible: false,
          riskLevel: 'DESTRUCTIVE',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
    {
      name: 'confluence_delete_attachment',
      mcpToolName: 'confluence_delete_attachment',
      targetSystem: 'confluence',
      riskLevel: 'DESTRUCTIVE',
      description:
        'Xoá vĩnh viễn một attachment. Không thể hoàn tác — luôn cần xác nhận qua preview.',
      inputSchema: z.object({ attachment_id: z.string().min(1).max(64) }),
      jsonSchema: toJsonSchema({ attachment_id: { type: 'string' } }, ['attachment_id']),
      requiredFeature: 'confluenceWriteHigh',
      buildPreview: (input, ctx) =>
        previewSimpleAction({
          toolName: 'confluence_delete_attachment',
          ctx,
          action: `Xoá vĩnh viễn attachment ${(input as { attachment_id: string }).attachment_id}`,
          fields: asRecord(input) ?? {},
          changeLabel: (input as { attachment_id: string }).attachment_id,
          after: 'đã xoá vĩnh viễn',
          impactWarning: 'Không thể hoàn tác. Mọi phiên bản của attachment này đều bị xoá.',
          reversible: false,
          riskLevel: 'DESTRUCTIVE',
        }),
      summarizeResult: (raw) => summarizeGeneric(raw),
    },
  ]
}

// ── Preview builders ────────────────────────────────────────────────────

interface UpdatePageInput {
  page_id: string
  title: string
  content?: string
}
interface SetRestrictionsInput {
  page_id: string
  read_users?: readonly string[]
  read_groups?: readonly string[]
  edit_users?: readonly string[]
  edit_groups?: readonly string[]
}

function previewCreatePage(opts: {
  toolName: string
  ctx: PreviewContext
  spaceKey: string
  title: string
  content?: string
}): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'confluence',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: `Tạo trang "${opts.title}" trong space ${opts.spaceKey}`,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: [
      { label: 'Space', value: opts.spaceKey },
      { label: 'Tiêu đề', value: opts.title },
      ...(opts.content === undefined || opts.content === ''
        ? []
        : [truncateField('Nội dung', opts.content)]),
    ],
    changes: [{ field: `Trang mới trong space ${opts.spaceKey}`, before: null, after: opts.title }],
    impactWarning: 'Trang mới hiển thị ngay cho mọi người có quyền xem space.',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

function previewUploadAttachment(opts: {
  toolName: string
  ctx: PreviewContext
  contentId: string
  label: string
}): Promise<ToolPreview> {
  return Promise.resolve({
    toolName: opts.toolName,
    targetSystem: 'confluence',
    targetSystemUrl: opts.ctx.targetSystemUrl,
    action: `Upload "${opts.label}" vào nội dung ${opts.contentId}`,
    actingAccount: opts.ctx.actingAccount,
    payloadFields: [
      { label: 'Nội dung đích', value: opts.contentId },
      { label: 'File', value: opts.label },
    ],
    changes: [{ field: `Attachment trên ${opts.contentId}`, before: null, after: opts.label }],
    impactWarning:
      'Nếu đã có file cùng tên, một phiên bản mới sẽ được tạo (không mất phiên bản cũ).',
    reversible: false,
    riskLevel: 'WRITE_LOW',
  })
}

async function previewUpdatePage(
  input: UpdatePageInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let beforeTitle: string | null = null
  try {
    const raw = await ctx.readTool('confluence_get_page', {
      page_id: input.page_id,
      include_metadata: true,
      convert_to_markdown: true,
    })
    const record = asRecord(raw)
    beforeTitle =
      record === null ? null : typeof record['title'] === 'string' ? record['title'] : null
  } catch {
    beforeTitle = null
  }

  return {
    toolName: 'confluence_update_page',
    targetSystem: 'confluence',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Cập nhật trang ${input.page_id}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Trang', value: input.page_id },
      { label: 'Tiêu đề mới', value: input.title },
      ...(input.content === undefined || input.content === ''
        ? []
        : [truncateField('Nội dung mới', input.content)]),
    ],
    changes: [
      { field: 'Tiêu đề', before: beforeTitle, after: input.title },
      ...(input.content === undefined
        ? []
        : [
            {
              field: 'Nội dung',
              before: null,
              after: '(nội dung mới sẽ ghi đè toàn bộ nội dung hiện tại)',
            },
          ]),
    ],
    impactWarning:
      beforeTitle === null
        ? 'Không đọc được trang hiện tại — không hiển thị được tiêu đề cũ. Kiểm tra kỹ trước khi xác nhận.'
        : 'Nội dung cũ sẽ bị ghi đè. Confluence giữ lịch sử phiên bản nhưng Nexa không tự hoàn tác được.',
    reversible: false,
    riskLevel: 'WRITE_HIGH',
    beforeValuesMayBeStale: true,
  }
}

async function previewSetPageRestrictions(
  input: SetRestrictionsInput,
  ctx: PreviewContext,
): Promise<ToolPreview> {
  let before: Record<string, unknown> | null = null
  try {
    const raw = await ctx.readTool('confluence_get_page_restrictions', { page_id: input.page_id })
    before = asRecord(raw)
  } catch {
    before = null
  }

  const afterSummary = [
    `Xem: ${describeList(input.read_users)} / nhóm ${describeList(input.read_groups)}`,
    `Sửa: ${describeList(input.edit_users)} / nhóm ${describeList(input.edit_groups)}`,
  ].join('; ')

  return {
    toolName: 'confluence_set_page_restrictions',
    targetSystem: 'confluence',
    targetSystemUrl: ctx.targetSystemUrl,
    action: `Đặt giới hạn quyền cho trang ${input.page_id}`,
    actingAccount: ctx.actingAccount,
    payloadFields: [
      { label: 'Trang', value: input.page_id },
      { label: 'Giới hạn mới', value: afterSummary },
    ],
    changes: [
      {
        field: 'Giới hạn quyền',
        before: before === null ? null : JSON.stringify(before),
        after: afterSummary,
      },
    ],
    impactWarning:
      'Đây thay thế TOÀN BỘ giới hạn hiện có, không phải cộng thêm. Bỏ trống mọi trường sẽ xoá hết giới hạn — ai có quyền xem space cũng xem/sửa được trang.',
    reversible: true,
    riskLevel: 'WRITE_HIGH',
    beforeValuesMayBeStale: true,
  }
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
    targetSystem: 'confluence',
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

function describeList(items: readonly string[] | undefined): string {
  if (items === undefined) return '(giữ nguyên/không đổi)'
  if (items.length === 0) return '(không giới hạn)'
  return items.join(', ')
}

function truncatePreview(text: string, max = 500): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function stringifyMaybe(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}
