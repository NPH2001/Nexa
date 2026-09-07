import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { app } from 'electron'
import {
  ERROR_CODES,
  IPC_SCHEMAS,
  NexaError,
  fail,
  ok,
  type Envelope,
  type IpcChannel,
} from '@nexa/shared-types'
import { SECURITY_EVENTS, newRequestId } from '@nexa/observability'
import { isImageKind, type ProcessedDocument } from '@nexa/document-processor'
import {
  auditFields,
  buildErrorCodePage,
  buildTraceabilityMatrix,
  evaluateTemplate,
  itemsOfType,
  mergeItemsInModel,
  renderMarkdown,
  renderMermaid,
  summarizeModel,
  analyzeSimilarity,
} from '@nexa/ba-kit'
import type { ChatController } from './chat-controller.js'
import type { NexaServices } from './services.js'
import { buildMcpManager } from './services.js'
import { exportDiagnostics } from './diagnostics.js'

/**
 * Đăng ký IPC.
 *
 * §5.3: "Validate toàn bộ input tại main process bằng schema."
 *
 * Cách thực thi: bảng handler dưới đây có kiểu `Record<IpcChannel, …>` — thiếu một channel là
 * lỗi biên dịch, và không channel nào vào được handler mà chưa qua `IPC_SCHEMAS[channel].parse`.
 * Không có đường vòng.
 */

type Handler<C extends IpcChannel> = (
  input: ReturnType<(typeof IPC_SCHEMAS)[C]['parse']>,
) => unknown | Promise<unknown>

type HandlerMap = { [C in IpcChannel]: Handler<C> }

export interface IpcContext {
  readonly services: NexaServices
  readonly chat: ChatController
  readonly getWindow: () => BrowserWindow | null
  readonly onMcpStatus: Parameters<typeof buildMcpManager>[1]
}

export function registerIpc(ctx: IpcContext): void {
  const handlers = buildHandlers(ctx)

  for (const channel of Object.keys(IPC_SCHEMAS) as IpcChannel[]) {
    ipcMain.handle(channel, async (_event, rawInput: unknown): Promise<Envelope<unknown>> => {
      const requestId = newRequestId()
      const schema = IPC_SCHEMAS[channel]

      const parsed = schema.safeParse(rawInput ?? {})
      if (!parsed.success) {
        // Ghi TÊN trường sai, không ghi giá trị — giá trị có thể là nội dung hoặc secret.
        ctx.services.logger.security(SECURITY_EVENTS.ipcValidationFailed, {
          channel,
          invalidFields: parsed.error.issues.map((i) => i.path.join('.')),
        })
        return fail(
          requestId,
          new NexaError(ERROR_CODES.VALIDATION_FAILED, { requestId, safeDetail: channel }),
        )
      }

      try {
        const handler = handlers[channel] as (input: unknown) => unknown
        const data = await handler(parsed.data)
        return ok(requestId, data, 'local')
      } catch (error) {
        const nexa = NexaError.wrap(error)
        ctx.services.logger.warn('ipc-handler-failed', {
          channel,
          requestId,
          errorCode: nexa.code,
        })
        return fail(requestId, nexa)
      }
    })
  }

  ctx.services.logger.info('ipc-registered', { channelCount: Object.keys(IPC_SCHEMAS).length })
}

function buildHandlers(ctx: IpcContext): HandlerMap {
  const { services, chat } = ctx
  let mcpRebuildInFlight = false

  const requireMemoryFactForCurrentProfile = (id: string) => {
    const fact = services.memory.get(id)
    if (fact === null || fact.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'memory fact not found for current profile',
      })
    }
    return fact
  }

  const requireCommitmentForCurrentProfile = (id: string) => {
    const commitment = services.commitments.get(id)
    if (commitment === null || commitment.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'commitment not found for current profile',
      })
    }
    return commitment
  }

  const requireCheckInForCurrentProfile = (id: string) => {
    const checkIn = services.checkInState.get(id)
    if (checkIn === null || checkIn.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'check-in suggestion not found for current profile',
      })
    }
    return checkIn
  }

  /**
   * Hàng rào cờ cho toàn bộ namespace `ba:*`.
   *
   * Renderer đã ẩn đích Nghiệp vụ khi cờ tắt, nhưng renderer là bên không đáng tin (§5.3): nó có
   * thể gọi thẳng channel. Đây mới là chỗ quyết định.
   */
  const requireBaWorkbench = (): void => {
    if (!services.settings.get().features.baWorkbench) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'ba workbench is disabled by settings or org policy',
      })
    }
  }

  const requireBaKnowledgeForCurrentProfile = (id: string) => {
    requireBaWorkbench()
    const item = services.baKnowledge.get(id)
    if (item === null || item.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'ba knowledge item not found for current profile',
      })
    }
    return item
  }

  const requireBaDocumentForCurrentProfile = (id: string) => {
    requireBaWorkbench()
    const document = services.baDocuments.get(id)
    if (document === null || document.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'ba document not found for current profile',
      })
    }
    return document
  }

  const requireBankChecklistForCurrentProfile = (id: string) => {
    requireBaWorkbench()
    const item = services.bankChecklists.get(id)
    if (item === null || item.profileId !== services.profileId) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
        safeDetail: 'bank checklist case not found for current profile',
      })
    }
    return item
  }

  /** Bỏ `profileId` trước khi ra renderer — renderer không cần và không được biết profile nào. */
  const toKnowledgeView = (item: ReturnType<typeof requireBaKnowledgeForCurrentProfile>) => {
    const { profileId: _profileId, ...view } = item
    return view
  }

  const toDocumentView = (document: ReturnType<typeof requireBaDocumentForCurrentProfile>) => {
    const { profileId: _profileId, ...view } = document
    return { ...view, needsReviewCount: services.baDocuments.countNeedsReview(document.id) }
  }

  /**
   * Đổi một `fileToken` do `file:pick` cấp thành text.
   *
   * Renderer không bao giờ gửi đường dẫn (§5.3) — nó gửi token, main tự tra ra descriptor. Token
   * được giải phóng ngay sau khi trích xuất, thành công hay không, đúng như đường tài liệu của chat.
   */
  /**
   * Chốt chặn cho các luồng CHỈ đọc văn bản trích xuất (Không gian Nghiệp vụ, hồ sơ chứng từ).
   *
   * Ảnh cho ra `text` rỗng và `chunks` rỗng, nên nếu để lọt thì model nhận một tài liệu trống
   * và trả về một kết quả trông vẫn hợp lý — không ai biết là nó chưa đọc gì cả. Đây là chỗ
   * duy nhất chặn được: `file:pick` chỉ lọc ở mức hộp thoại, mà renderer thì có thể bị chèn mã.
   *
   * Việc chặn này cũng chính là điều giữ cho phần ảnh của Không gian Nghiệp vụ đứng yên cho tới
   * khi hợp đồng consent được duyệt (OPEN-QUESTIONS I1).
   */
  const requireTextDocument = (document: ProcessedDocument): ProcessedDocument => {
    if (document.image !== undefined || isImageKind(document.kind)) {
      throw new NexaError(ERROR_CODES.DOCUMENT_REQUIRES_TEXT, {
        safeDetail: 'this workspace flow consumes extracted text; images have none',
      })
    }
    return document
  }

  const readPickedFileText = async (fileToken: string | undefined): Promise<string> => {
    if (fileToken === undefined) {
      throw new NexaError(ERROR_CODES.VALIDATION_FAILED, { safeDetail: 'missing file token' })
    }
    const tokens = [fileToken]
    try {
      const [document] = await services.documents.process(services.files.resolve(tokens))
      if (document === undefined) {
        throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
          safeDetail: 'no text could be extracted from the picked file',
        })
      }
      return requireTextDocument(document).text
    } finally {
      services.files.releaseAll(tokens)
    }
  }

  const recordLocalMutation = (input: {
    type: 'memory_mutation' | 'commitment_mutation'
    action: 'created' | 'updated' | 'archived' | 'restored' | 'deleted'
    subjectType: 'memory' | 'commitment'
    subjectId: string
  }): void => {
    services.activity.record({
      profileId: services.profileId,
      status: 'success',
      ...input,
    })
  }

  const changesMcpConnection = (type: string): boolean =>
    type === 'jira' || type === 'confluence' || type === 'mcpGateway'

  const assertMcpIdle = (): void => {
    if (mcpRebuildInFlight || services.mcp?.isLifecycleBusy === true) {
      throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
        safeDetail: 'cannot change MCP connection while its lifecycle is busy',
      })
    }
  }

  /** MCP phải dựng lại khi cấu hình kết nối đổi — credential và base URL đều nằm trong spec. */
  const rebuildMcp = async (): Promise<void> => {
    mcpRebuildInFlight = true
    const previous = services.mcp
    // Rút manager cũ khỏi service trước `await` đầu tiên: chat mới không thể giữ tham chiếu tới
    // transport đang dừng, còn mutex chặn một save/delete/restart thứ hai chạy chen vào.
    services.mcp = null
    try {
      await previous?.stop()
      services.mcp = buildMcpManager(services, ctx.onMcpStatus)
      if (services.mcp !== null) {
        try {
          await services.mcp.start()
        } catch {
          // Trạng thái lỗi đã được manager phát ra; không chặn việc lưu cấu hình.
        }
      }
    } finally {
      mcpRebuildInFlight = false
    }
  }

  return {
    // ── Connections ───────────────────────────────────────────────────────
    'connection:list': () => services.connections.list(),
    'connection:save': async (input) => {
      if (changesMcpConnection(input.type)) assertMcpIdle()
      const connection = services.connections.save(input)
      if (changesMcpConnection(input.type)) await rebuildMcp()
      return connection
    },
    'connection:test': (input) => services.connections.test(input.type),
    'connection:delete': async (input) => {
      if (changesMcpConnection(input.type)) assertMcpIdle()
      services.connections.delete(input.type)
      if (changesMcpConnection(input.type)) await rebuildMcp()
      return { deleted: true }
    },

    // ── ChatGPT managed account (Codex App Server) ───────────────────────
    'chatgpt:status': () => services.chatgpt.status(),
    'chatgpt:models': () => {
      if (!services.policy.allowDirectOpenAi) {
        throw new NexaError(ERROR_CODES.PROVIDER_DISABLED_BY_POLICY, {
          safeDetail: 'managed ChatGPT model catalog is disabled by organisation policy',
        })
      }
      return services.chatgpt.models()
    },
    'chatgpt:login': () => {
      if (!services.policy.allowDirectOpenAi) {
        throw new NexaError(ERROR_CODES.PROVIDER_DISABLED_BY_POLICY, {
          safeDetail: 'managed ChatGPT login is disabled by organisation policy',
        })
      }
      return services.chatgpt.login()
    },
    // Cho phép đăng xuất kể cả khi policy vừa đổi để người dùng luôn gỡ được phiên cũ.
    'chatgpt:logout': () => services.chatgpt.logout(),

    // ── Models ────────────────────────────────────────────────────────────
    'model:list': () => services.models.list(),
    'model:add': (input) => services.models.add(input),
    'model:remove': (input) => {
      services.models.remove(input.id)
      return { removed: true }
    },
    'model:setDefault': (input) => {
      services.models.setDefault(input.id)
      return { ok: true }
    },
    'model:verifyAll': (input) =>
      services.models.verifyAll(
        input.provider,
        services.connections.buildLlmClient(input.provider, services.settings.get().llmTimeoutMs),
      ),

    // ── Conversations ─────────────────────────────────────────────────────
    'conversation:list': (input) =>
      services.conversations.list(services.profileId, {
        includeArchived: input.includeArchived,
        limit: input.limit,
        offset: input.offset,
      }),
    'conversation:create': async (input) => {
      if (input.modelProvider === 'chatgpt' && !services.policy.allowDirectOpenAi) {
        throw new NexaError(ERROR_CODES.PROVIDER_DISABLED_BY_POLICY, {
          safeDetail: 'managed ChatGPT conversation creation is disabled by organisation policy',
        })
      }
      const model =
        input.modelId === null || input.modelProvider === null
          ? null
          : input.modelProvider === 'chatgpt'
            ? {
                ...(await services.chatgpt.resolveModel(input.modelId)),
                provider: 'chatgpt' as const,
              }
            : services.models.resolveForConversation(input.modelId, input.modelProvider)
      return services.conversations.create(
        services.profileId,
        input.title,
        model === null ? null : { modelId: model.modelId, provider: model.provider },
      )
    },
    'conversation:rename': (input) => {
      services.conversations.rename(input.id, input.title)
      return { ok: true }
    },
    'conversation:delete': (input) => {
      if (chat.isConversationActive(input.id)) {
        throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
          safeDetail: 'conversation has an active chat turn',
        })
      }
      services.conversations.delete(input.id)
      return { ok: true }
    },
    'conversation:archive': (input) => {
      services.conversations.archive(input.id)
      return { ok: true }
    },
    'conversation:search': (input) =>
      services.search.search(services.profileId, input.query, { limit: input.limit }),
    'message:list': (input) =>
      services.conversations.listMessages(input.conversationId, input.limit),
    'message:edit': (input) => {
      services.conversations.editMessage(input.id, input.content)
      return { ok: true }
    },
    'message:delete': (input) => {
      services.conversations.deleteMessage(input.id)
      return { ok: true }
    },

    // ── Memory ────────────────────────────────────────────────────────────
    'memory:list': (input) =>
      services.memory.list(services.profileId, { includeArchived: input.includeArchived }),
    'memory:create': (input) => {
      const fact = services.memory.create({
        profileId: services.profileId,
        content: input.content,
        kind: input.kind,
        scope: input.scope,
        sharingPolicy: input.sharingPolicy,
        sourceConversationId: input.sourceConversationId,
        // Tạo fact trong UI là một hành động xác nhận rõ ràng của người dùng. Main process
        // đóng dấu mặc định để renderer không phải là nguồn sự thật cho thời điểm xác nhận.
        lastConfirmedAt: input.lastConfirmedAt ?? new Date().toISOString(),
        expiresAt: input.expiresAt,
      })
      recordLocalMutation({
        type: 'memory_mutation',
        action: 'created',
        subjectType: 'memory',
        subjectId: fact.id,
      })
      return fact
    },
    'memory:update': (input) => {
      requireMemoryFactForCurrentProfile(input.id)
      const fact = services.memory.update(input.id, {
        content: input.content,
        kind: input.kind,
        scope: input.scope,
        sharingPolicy: input.sharingPolicy,
        sourceConversationId: input.sourceConversationId,
        lastConfirmedAt: input.lastConfirmedAt ?? new Date().toISOString(),
        expiresAt: input.expiresAt,
      })
      recordLocalMutation({
        type: 'memory_mutation',
        action: 'updated',
        subjectType: 'memory',
        subjectId: fact.id,
      })
      return fact
    },
    'memory:archive': (input) => {
      requireMemoryFactForCurrentProfile(input.id)
      services.memory.archive(input.id)
      recordLocalMutation({
        type: 'memory_mutation',
        action: 'archived',
        subjectType: 'memory',
        subjectId: input.id,
      })
      return { ok: true }
    },
    'memory:restore': (input) => {
      requireMemoryFactForCurrentProfile(input.id)
      services.memory.restore(input.id)
      recordLocalMutation({
        type: 'memory_mutation',
        action: 'restored',
        subjectType: 'memory',
        subjectId: input.id,
      })
      return { ok: true }
    },
    'memory:delete': (input) => {
      requireMemoryFactForCurrentProfile(input.id)
      services.memory.delete(input.id)
      recordLocalMutation({
        type: 'memory_mutation',
        action: 'deleted',
        subjectType: 'memory',
        subjectId: input.id,
      })
      return { ok: true }
    },

    // ── Commitments ───────────────────────────────────────────────────────
    'commitment:list': (input) =>
      services.commitments.list(services.profileId, {
        includeCompleted: input.includeCompleted,
      }),
    'commitment:create': (input) => {
      const commitment = services.commitments.create({
        profileId: services.profileId,
        title: input.title,
        nextAction: input.nextAction,
        status: input.status,
        dueAt: input.dueAt,
        checkInAt: input.checkInAt,
        sourceConversationId: input.sourceConversationId,
      })
      recordLocalMutation({
        type: 'commitment_mutation',
        action: 'created',
        subjectType: 'commitment',
        subjectId: commitment.id,
      })
      services.checkIns.reconcile()
      return commitment
    },
    'commitment:update': (input) => {
      requireCommitmentForCurrentProfile(input.id)
      const commitment = services.commitments.update(input.id, {
        title: input.title,
        nextAction: input.nextAction,
        status: input.status,
        dueAt: input.dueAt,
        checkInAt: input.checkInAt,
        sourceConversationId: input.sourceConversationId,
      })
      recordLocalMutation({
        type: 'commitment_mutation',
        action: 'updated',
        subjectType: 'commitment',
        subjectId: commitment.id,
      })
      services.checkIns.reconcile()
      return commitment
    },
    'commitment:delete': (input) => {
      requireCommitmentForCurrentProfile(input.id)
      services.commitments.delete(input.id)
      recordLocalMutation({
        type: 'commitment_mutation',
        action: 'deleted',
        subjectType: 'commitment',
        subjectId: input.id,
      })
      return { ok: true }
    },

    // ── Proactive check-ins ─────────────────────────────────────────────
    'checkin:list': () => services.checkIns.list(),
    'checkin:setEnabled': (input) => {
      services.settings.update({ proactiveCheckInsEnabled: input.enabled })
      services.checkIns.reconfigure()
      return services.checkIns.list()
    },
    'checkin:respond': (input) => {
      requireCheckInForCurrentProfile(input.id)
      return services.checkIns.respond(input.id, input.action, input.snoozeMinutes)
    },
    'checkin:unmute': (input) => {
      requireCommitmentForCurrentProfile(input.commitmentId)
      return { suggestion: services.checkIns.unmute(input.commitmentId) }
    },

    // ── Agent activity ──────────────────────────────────────────────────
    'activity:list': (input) =>
      services.activity
        .list(services.profileId, {
          type: input.type,
          status: input.status,
          actor: input.actor,
          limit: input.limit,
          offset: input.offset,
        })
        .map((event) => ({
          ...event,
          subjectLabel: resolveActivitySubjectLabel(services, event.subjectType, event.subjectId),
        })),

    // ── Bản tin công việc cá nhân ───────────────────────────────────────
    // Không nhận tham số: JQL do main dựng, và schema đã strip mọi thứ renderer gửi kèm.
    'briefing:get': () => services.briefing.get(),
    'briefing:refresh': () => services.briefing.refresh(),

    // ── BA workbench ────────────────────────────────────────────────────
    'ba:knowledge:list': (input) => {
      requireBaWorkbench()
      return services.baKnowledge
        .list(services.profileId, {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
        })
        .map(toKnowledgeView)
    },
    'ba:knowledge:create': (input) => {
      requireBaWorkbench()
      // Renderer tạo item thì luôn là người dùng gõ tay. `status` không nhận từ renderer: item
      // mới luôn là draft, chốt là một channel riêng.
      const item = services.baKnowledge.create({
        profileId: services.profileId,
        title: input.title,
        body: input.body,
        category: input.category,
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        sourceConversationId: input.sourceConversationId,
        createdBy: 'user',
      })
      return toKnowledgeView(item)
    },
    'ba:knowledge:update': (input) => {
      requireBaKnowledgeForCurrentProfile(input.id)
      return toKnowledgeView(
        services.baKnowledge.update(input.id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
        }),
      )
    },
    'ba:knowledge:confirm': (input) => {
      requireBaKnowledgeForCurrentProfile(input.id)
      return toKnowledgeView(services.baKnowledge.confirm(input.id))
    },
    'ba:knowledge:supersede': (input) => {
      requireBaKnowledgeForCurrentProfile(input.id)
      requireBaKnowledgeForCurrentProfile(input.replacementId)
      return toKnowledgeView(services.baKnowledge.supersede(input.id, input.replacementId))
    },
    'ba:knowledge:delete': (input) => {
      requireBaKnowledgeForCurrentProfile(input.id)
      services.baKnowledge.delete(input.id)
      return { ok: true }
    },
    'ba:knowledge:link': (input) => {
      requireBaKnowledgeForCurrentProfile(input.fromId)
      requireBaKnowledgeForCurrentProfile(input.toId)
      return services.baKnowledge.link(input.fromId, input.toId, input.kind)
    },
    'ba:knowledge:unlink': (input) => {
      requireBaWorkbench()
      services.baKnowledge.unlink(input.linkId)
      return { ok: true }
    },
    'ba:knowledge:stats': () => {
      requireBaWorkbench()
      return services.baKnowledge.stats(services.profileId)
    },
    'ba:document:list': () => {
      requireBaWorkbench()
      return services.baDocuments.list(services.profileId).map(toDocumentView)
    },
    'ba:document:create': (input) => {
      requireBaWorkbench()
      return toDocumentView(
        services.baDocuments.create({
          profileId: services.profileId,
          title: input.title,
          kind: input.kind,
          sourceConversationId: input.sourceConversationId,
        }),
      )
    },
    'ba:document:delete': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      services.baDocuments.delete(input.id)
      return { ok: true }
    },
    'ba:document:read': (input) => {
      const document = requireBaDocumentForCurrentProfile(input.id)
      const model = services.baDocuments.readModel(input.id)
      // Renderer nhận bản rút gọn, không nhận mô hình đầy đủ — xem `summarizeItem`.
      return {
        document: toDocumentView(document),
        items: summarizeModel(model.items),
        linkCount: model.links.length,
      }
    },
    'ba:document:extract': async (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      const text = input.text ?? (await readPickedFileText(input.fileToken))
      const result = await services.baExtraction.run(input.id, text)
      return {
        items: summarizeModel(result.model.items),
        nearDuplicates: result.nearDuplicates,
        potentialContradictions: result.potentialContradictions,
        mergedCount: result.mergedCount,
        needsReviewCount: result.needsReviewCount,
        sectionCount: result.sectionCount,
        cached: result.cached,
      }
    },
    'ba:document:errorCodes': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      return buildErrorCodePage(services.baDocuments.readModel(input.id))
    },

    'ba:template:list': () => {
      requireBaWorkbench()
      // Chỉ đọc: không có create/update/delete. Chuẩn của tổ chức do IT phân phối (D12).
      return {
        templates: services.baStandards.templates,
        rulebook:
          services.baStandards.rulebook === null
            ? null
            : {
                id: services.baStandards.rulebook.id,
                version: services.baStandards.rulebook.version,
                name: services.baStandards.rulebook.name,
              },
      }
    },
    'ba:checklist:templates': () => {
      requireBaWorkbench()
      return services.bankChecklistTemplates.map((template) => ({
        id: template.id,
        version: template.version,
        name: template.name,
        caseType: template.caseType,
        requirements: template.requirements.map((requirement) => ({
          id: requirement.id,
          label: requirement.label,
          acceptedDocumentTypes: requirement.acceptedDocumentTypes,
        })),
      }))
    },
    'ba:checklist:list': () => {
      requireBaWorkbench()
      return services.bankChecklists
        .list(services.profileId)
        .map(({ profileId: _, ...item }) => item)
    },
    'ba:checklist:create': (input) => {
      requireBaWorkbench()
      const template = services.bankChecklist.findTemplate(input.templateId)
      const item = services.bankChecklists.create({
        profileId: services.profileId,
        title: input.title,
        templateId: template.id,
        templateVersion: template.version,
      })
      services.activity.record({
        profileId: services.profileId,
        type: 'document_checklist_mutation',
        action: 'created',
        status: 'success',
        subjectType: 'document_checklist',
        subjectId: item.id,
      })
      const { profileId: _, ...view } = item
      return view
    },
    'ba:checklist:delete': (input) => {
      const item = requireBankChecklistForCurrentProfile(input.id)
      services.bankChecklists.delete(item.id)
      services.activity.record({
        profileId: services.profileId,
        type: 'document_checklist_mutation',
        action: 'deleted',
        status: 'success',
        subjectType: 'document_checklist',
        subjectId: item.id,
      })
      return { ok: true }
    },
    'ba:checklist:read': (input) => {
      const item = requireBankChecklistForCurrentProfile(input.id)
      const { profileId: _, ...view } = item
      const latest = services.bankChecklists.latestReview(item.id)
      return {
        item: view,
        documents: services.bankChecklists
          .listDocuments(item.id)
          .map(({ sourcePathHash: _sourcePathHash, ...document }) => document),
        latestReport: latest === null ? null : { reviewId: latest.id, ...latest.report },
      }
    },
    'ba:checklist:ingest': async (input) => {
      const item = requireBankChecklistForCurrentProfile(input.id)
      const tokens = [input.fileToken]
      try {
        const [document] = await services.documents.process(services.files.resolve(tokens))
        if (document === undefined) {
          throw new NexaError(ERROR_CODES.FILE_UNSUPPORTED, {
            safeDetail: 'no document could be extracted from the picked file',
          })
        }
        const output = await services.bankChecklist.extract(requireTextDocument(document))
        const evidence = services.bankChecklists.addDocument({
          caseId: item.id,
          fileName: document.fileName,
          sourcePathHash: document.sourcePathHash,
          output,
          suspectedScan: document.suspectedScan === true,
          truncated: document.truncated,
        })
        services.activity.record({
          profileId: services.profileId,
          type: 'document_checklist_mutation',
          action: 'updated',
          status: 'success',
          subjectType: 'document_checklist',
          subjectId: item.id,
        })
        const { sourcePathHash: _, ...view } = evidence
        return view
      } finally {
        services.files.releaseAll(tokens)
      }
    },
    'ba:checklist:review': (input) => {
      const item = requireBankChecklistForCurrentProfile(input.id)
      const result = services.bankChecklist.review(item.id)
      services.activity.record({
        profileId: services.profileId,
        type: 'document_checklist_mutation',
        action: 'completed',
        status: 'success',
        subjectType: 'document_checklist',
        subjectId: item.id,
      })
      return { reviewId: result.reviewId, ...result.report }
    },
    'ba:document:setTemplate': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      if (input.templateId === null) {
        return toDocumentView(
          services.baDocuments.update(input.id, { templateId: null, templateVersion: null }),
        )
      }
      const template = services.baStandards.templates.find((entry) => entry.id === input.templateId)
      if (template === undefined) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: `unknown ba template: ${input.templateId}`,
        })
      }
      // Ghi lại CẢ phiên bản: khi IT nâng chuẩn, tài liệu cũ vẫn nói được nó viết theo bản nào.
      return toDocumentView(
        services.baDocuments.update(input.id, {
          templateId: template.id,
          templateVersion: template.version,
        }),
      )
    },
    'ba:document:projections': (input) => {
      const document = requireBaDocumentForCurrentProfile(input.id)
      const model = services.baDocuments.readModel(input.id)
      const template = services.baStandards.templates.find(
        (entry) => entry.id === document.templateId,
      )
      const rulebook = services.baStandards.rulebook
      const similarity = analyzeSimilarity(model.items)
      const mermaid = renderMermaid(model)

      return {
        mermaid: {
          code: mermaid.code,
          isolatedSteps: mermaid.isolatedSteps,
          stepCount: mermaid.stepCount,
          edgeCount: mermaid.edgeCount,
        },
        matrix: buildTraceabilityMatrix(model),
        fieldAudits: rulebook === null ? [] : auditFields(itemsOfType(model, 'field'), rulebook),
        nearDuplicates: similarity.nearDuplicates,
        potentialContradictions: similarity.potentialContradictions,
        ...(template === undefined
          ? { template: null, markdown: null, missingRequired: [], unplacedCount: 0 }
          : {
              template: { id: template.id, version: template.version, name: template.name },
              markdown: renderMarkdown(model, template, { title: document.title }),
              missingRequired: evaluateTemplate(model, template).missingRequired,
              unplacedCount: evaluateTemplate(model, template).unplaced.length,
              // Người dùng phải biết tài liệu đang theo một bản mẫu cũ hơn bản hiện có.
              templateOutdated: document.templateVersion !== template.version,
            }),
      }
    },
    'ba:document:mergeItems': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      const model = services.baDocuments.readModel(input.id)
      const merged = mergeItemsInModel(model, input.keepItemId, input.dropItemId)
      if (!merged.merged) {
        throw new NexaError(ERROR_CODES.VALIDATION_FAILED, {
          safeDetail: merged.reason ?? 'items could not be merged',
        })
      }
      services.baDocuments.replaceModel(input.id, merged.model)
      return { items: summarizeModel(merged.model.items) }
    },
    'ba:document:review': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      return services.baReview.run(input.id)
    },
    'ba:document:reviewHistory': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      return services.baReview.history(input.id)
    },
    'ba:document:suggestWording': async (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      return services.baReview.suggestWording(input.id, {
        ruleId: input.ruleId,
        itemId: input.itemId,
      })
    },
    'ba:document:applyFinding': (input) => {
      requireBaDocumentForCurrentProfile(input.id)
      // Áp dụng là thao tác của NGƯỜI DÙNG, từng chỗ một (D2). Không có kênh áp dụng hàng loạt.
      return services.baReview.applyFinding({
        documentId: input.id,
        itemId: input.itemId,
        field: input.field,
        value: input.value,
      })
    },

    // ── Chat ──────────────────────────────────────────────────────────────
    'chat:send': (input) => chat.send(input),
    'chat:cancel': (input) => {
      chat.cancel(input.requestId)
      return { ok: true }
    },

    // ── Files ─────────────────────────────────────────────────────────────
    'file:pick': async (input) => {
      const window = ctx.getWindow()
      if (window === null) {
        throw new NexaError(ERROR_CODES.INTERNAL_ERROR, { safeDetail: 'no window' })
      }
      return services.files.pick(window, input.accept)
    },
    'file:release': (input) => {
      services.files.release(input.fileToken)
      return { ok: true }
    },

    // ── Tool confirmation ─────────────────────────────────────────────────
    'tool:approve': (input) => {
      chat.approve(input.operationId, input.payloadHash)
      return { ok: true }
    },
    'tool:cancel': (input) => {
      chat.cancelTool(input.operationId)
      return { ok: true }
    },
    'tool:lookupUncertain': async (input) => {
      const operation = services.tracker.get(input.operationId)
      const mcp = services.mcp
      if (operation === null || mcp === null) {
        throw new NexaError(ERROR_CODES.MCP_SERVER_UNAVAILABLE, {
          operationId: input.operationId,
        })
      }
      const definition = mcp.resolveCallable(operation.toolName)
      if (definition.lookupResult === undefined) {
        throw new NexaError(ERROR_CODES.TOOL_EXECUTION_UNCERTAIN, {
          operationId: input.operationId,
          safeDetail: 'tool has no lookup strategy',
        })
      }
      const result = await services.tracker.resolveUncertain(
        input.operationId,
        definition,
        definition.lookupResult,
        {
          actingAccount: services.connections.get('jira')?.username ?? 'unknown',
          readTool: async (name, toolInput) => {
            const readDefinition = mcp.resolveCallable(name)
            const validated = mcp.validateInput(readDefinition, toolInput)
            const outcome = await mcp.callTool(name, validated)
            try {
              return JSON.parse(outcome.rawText)
            } catch {
              return outcome.rawText
            }
          },
        },
      )
      if (
        result.status !== 'success' &&
        result.status !== 'failed' &&
        result.status !== 'uncertain'
      ) {
        throw new NexaError(ERROR_CODES.OPERATION_ALREADY_RUNNING, {
          operationId: input.operationId,
          safeDetail: 'operation is not ready for uncertain-result lookup',
        })
      }
      if (result.status === 'success' || result.status === 'failed') {
        services.conversations.updateToolCall(operation.toolCallRecordId, {
          operationStatus: result.status,
          ...(result.targetKey !== undefined ? { targetKey: result.targetKey } : {}),
          ...(result.targetUrl !== undefined ? { targetUrl: result.targetUrl } : {}),
        })
        services.guard.finishExecution(input.operationId, result.status)
      }
      services.activity.record({
        profileId: services.profileId,
        type: result.status === 'uncertain' ? 'uncertain_operation' : 'tool_result',
        action: 'resolved',
        status: result.status,
        subjectType: 'tool',
        subjectId: definition.name,
        operationId: input.operationId,
      })
      return result
    },
    /**
     * §16: thao tác write còn treo từ phiên trước phải hiện lại, nếu không người dùng sẽ
     * không bao giờ biết để đi tra cứu. Đọc từ DB chứ không từ OperationTracker trong RAM —
     * tracker mất sạch khi app đóng.
     */
    'tool:listUncertain': () => services.conversations.listUncertainOperations(services.profileId),

    'tool:list': () =>
      (services.mcp?.availableTools() ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel,
        targetSystem: t.targetSystem,
      })),

    // ── Settings & policy ─────────────────────────────────────────────────
    'settings:get': () => ({
      settings: services.settings.get(),
      lockedFeatures: services.settings.lockedFeatureNames(),
      // Đọc lại mỗi lần thay vì chụp một lần lúc khởi động: Cài đặt cần biết để vô hiệu hoá
      // công tắc kèm lý do, chứ không bật một tính năng mà nền tảng không chạy được. Kể cả khi
      // trả `true`, Nexa vẫn không hứa thông báo đã tới nơi — DND và focus assist nuốt toast
      // mà không báo lỗi nào.
      notificationsSupported: Notification.isSupported(),
    }),
    'settings:update': (input) => {
      const updated = services.settings.update(input)
      if (input.proactiveCheckInsEnabled !== undefined) services.checkIns.reconfigure()
      // Bản tin cache theo ngày, nên đổi cờ mà không dọn cache thì người dùng phải chờ sang hôm
      // sau mới thấy thay đổi — kể cả khi họ vừa tắt đoạn dẫn của model.
      if (
        input.dailyBriefingEnabled !== undefined ||
        input.dailyBriefingSummaryEnabled !== undefined ||
        input.features !== undefined
      ) {
        services.briefing.invalidate()
      }
      return updated
    },
    'policy:get': () => services.policy,

    // ── MCP ───────────────────────────────────────────────────────────────
    'mcp:status': () =>
      services.mcp?.statusSnapshot ?? {
        system: 'jira' as const,
        state: 'stopped' as const,
        toolCount: 0,
      },
    'mcp:restart': async () => {
      assertMcpIdle()
      await rebuildMcp()
      return services.mcp?.statusSnapshot ?? { system: 'jira' as const, state: 'stopped' as const }
    },

    // ── Diagnostics ───────────────────────────────────────────────────────
    'diagnostics:export': () => exportDiagnostics(services),
    'diagnostics:appInfo': () => ({
      version: app.getVersion(),
      electron: process.versions['electron'] ?? 'unknown',
      platform: process.platform,
      schemaVersion: services.store.schemaVersion,
      sqliteDriver: services.store.driverName,
      secureStorageBackend: services.security.backendName,
      secureStorageProductionGrade: services.security.isProductionGrade,
      logToDisk: services.fileSink !== null,
      approvalStats: services.audit.approvalStats(services.profileId),
    }),

    // ── Xoá dữ liệu (§11.1) ───────────────────────────────────────────────
    'data:purge': (input) => {
      services.store.purgeProfile(services.profileId)
      services.search.clear()
      if (input.alsoDeleteCredentials) services.security.purgeAllSecrets()
      services.logger.security(SECURITY_EVENTS.dataPurged, {
        includedCredentials: input.alsoDeleteCredentials,
      })
      return { purged: true }
    },
  }
}

function resolveActivitySubjectLabel(
  services: NexaServices,
  subjectType: 'memory' | 'commitment' | 'tool' | 'ba_document' | 'document_checklist' | null,
  subjectId: string | null,
): string {
  if (subjectType === null || subjectId === null) return 'Hoạt động hệ thống'
  if (subjectType === 'tool') return subjectId
  if (subjectType === 'memory') {
    const fact = services.memory.get(subjectId)
    return fact !== null && fact.profileId === services.profileId ? 'Nexa nhớ' : 'Memory đã xoá'
  }
  if (subjectType === 'ba_document') {
    const document = services.baDocuments.get(subjectId)
    return document !== null && document.profileId === services.profileId
      ? document.title
      : 'Tài liệu đã xoá'
  }
  if (subjectType === 'document_checklist') {
    const item = services.bankChecklists.get(subjectId)
    return item !== null && item.profileId === services.profileId
      ? item.title
      : 'Checklist chứng từ đã xoá'
  }

  const commitment = services.commitments.get(subjectId)
  return commitment !== null && commitment.profileId === services.profileId
    ? commitment.title
    : 'Cam kết đã xoá'
}
