import { useCallback, useEffect, useState } from 'react'
import type {
  BaDocumentView,
  BaFindingView,
  BaProjectionsView,
  BaReviewReportView,
  BaTemplateCatalogView,
  BaErrorCodePageView,
  BaItemSummaryView,
  BaKnowledgeCategoryName,
  BaKnowledgeStatsView,
  BaKnowledgeView,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'
import {
  ITEM_TYPE_LABELS,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_STATUS_LABELS,
  REVIEW_SCOPE_NOTE,
  describeRulePackChange,
  describeSkippedRules,
  describeTemplateState,
  fieldsMissingValidation,
  filterKnowledge,
  formatUsage,
  groupFindings,
  groupItems,
  summarizeErrorPage,
  summarizeFieldAudits,
  summarizeMatrix,
  summarizeReview,
  type KnowledgeFilter,
} from './ba-ui.js'

/**
 * Đích **Nghiệp vụ** — bề mặt BA duy nhất (openspec `add-ba-workbench` D9).
 *
 * Giai đoạn 1 có hai tab: Tri thức và Tài liệu. Không có gì của BA rò sang Chat, Hôm nay hay
 * Mục tiêu — ranh giới UI là một trong sáu ranh giới giữ tính năng BA nằm gọn một chỗ.
 */

type Tab = 'knowledge' | 'documents' | 'templates'

const CATEGORY_OPTIONS: readonly BaKnowledgeCategoryName[] = [
  'domain',
  'rule',
  'term',
  'constraint',
  'decision',
]

interface KnowledgeDraft {
  readonly title: string
  readonly body: string
  readonly category: BaKnowledgeCategoryName
}

const emptyDraft = (): KnowledgeDraft => ({ title: '', body: '', category: 'rule' })

export function BaWorkbenchView(props: {
  enabled: boolean
  onOpenSettings: () => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('knowledge')

  if (!props.enabled) {
    return (
      <section className="panel" aria-labelledby="ba-heading">
        <h2 id="ba-heading">Nghiệp vụ</h2>
        {/* Trạng thái disabled phải nêu rõ cờ nào đang tắt và ai bật được — không im lặng khoá. */}
        <p className="muted">
          Không gian Nghiệp vụ đang tắt. Bật cờ <strong>Business Analyst workbench</strong> trong
          Cài đặt → Tính năng. Nếu tổ chức đã khoá cờ này bằng chính sách, bạn cần liên hệ IT.
        </p>
        <button type="button" className="btn" onClick={props.onOpenSettings}>
          Mở cài đặt tính năng
        </button>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="ba-heading">
      <h2 id="ba-heading">Nghiệp vụ</h2>

      <div className="tabs" role="tablist" aria-label="Khu vực nghiệp vụ">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'knowledge'}
          className={`tab ${tab === 'knowledge' ? 'active' : ''}`}
          onClick={() => setTab('knowledge')}
        >
          Tri thức
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'documents'}
          className={`tab ${tab === 'documents' ? 'active' : ''}`}
          onClick={() => setTab('documents')}
        >
          Tài liệu
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'templates'}
          className={`tab ${tab === 'templates' ? 'active' : ''}`}
          onClick={() => setTab('templates')}
        >
          Mẫu
        </button>
      </div>

      {tab === 'knowledge' ? (
        <KnowledgeTab onError={props.onError} onToast={props.onToast} />
      ) : tab === 'documents' ? (
        <DocumentsTab onError={props.onError} onToast={props.onToast} />
      ) : (
        <TemplatesTab onError={props.onError} />
      )}
    </section>
  )
}

function KnowledgeTab(props: {
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [items, setItems] = useState<BaKnowledgeView[]>([])
  const [stats, setStats] = useState<BaKnowledgeStatsView | null>(null)
  const [filter, setFilter] = useState<KnowledgeFilter>({ status: 'all', category: 'all' })
  const [draft, setDraft] = useState<KnowledgeDraft>(() => emptyDraft())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BaKnowledgeView | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, overview] = await Promise.all([api.ba.knowledge.list(), api.ba.knowledge.stats()])
      setItems(list)
      setStats(overview)
      setLoadError(false)
    } catch (error) {
      setLoadError(true)
      onError(error, 'Không tải được kho tri thức.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = filterKnowledge(items, filter)
  const canSave = draft.title.trim() !== '' && draft.body.trim() !== ''

  const runAction = (id: string, action: () => Promise<unknown>, fallback: string): void => {
    void (async () => {
      setBusyId(id)
      try {
        await action()
        await refresh()
      } catch (error) {
        onError(error, fallback)
      } finally {
        setBusyId(null)
      }
    })()
  }

  return (
    <>
      {stats !== null && (
        <div className="ba-stats" aria-label="Tổng quan kho tri thức">
          <span>
            {stats.total.confirmed} đã xác nhận · {stats.total.draft} chờ xác nhận ·{' '}
            {stats.total.outdated} đã thay thế
          </span>
          {stats.conflictPairs > 0 && (
            <span className="tag tag-warning">{stats.conflictPairs} cặp mâu thuẫn</span>
          )}
          {stats.unusedConfirmed > 0 && (
            <span className="muted small">
              {stats.unusedConfirmed} mục đã xác nhận nhưng chưa dùng lần nào
            </span>
          )}
        </div>
      )}

      <form
        className="ba-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSave) return
          runAction(
            'new',
            async () => {
              await api.ba.knowledge.create({
                title: draft.title.trim(),
                body: draft.body.trim(),
                category: draft.category,
              })
              setDraft(emptyDraft())
              props.onToast({ kind: 'info', title: 'Đã thêm mục chờ xác nhận.' })
            },
            'Không thêm được tri thức.',
          )
        }}
      >
        <input
          className="input"
          aria-label="Tiêu đề tri thức"
          placeholder="Tiêu đề — ví dụ: Ngưỡng miễn phí giao hàng"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <textarea
          className="input"
          aria-label="Nội dung tri thức"
          placeholder="Nội dung nghiệp vụ, viết đúng như tổ chức đã chốt"
          rows={2}
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
        <select
          className="input"
          aria-label="Nhóm tri thức"
          value={draft.category}
          onChange={(event) =>
            setDraft({ ...draft, category: event.target.value as BaKnowledgeCategoryName })
          }
        >
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {KNOWLEDGE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={!canSave || busyId === 'new'}>
          Thêm
        </button>
      </form>
      <p className="muted small">
        Mục mới luôn ở trạng thái chờ xác nhận. Chỉ mục <strong>đã xác nhận</strong> mới được đưa
        vào ngữ cảnh trả lời và dùng để đối chiếu tài liệu.
      </p>

      <div className="ba-form">
        <select
          className="input"
          aria-label="Lọc theo trạng thái"
          value={filter.status}
          onChange={(event) =>
            setFilter({ ...filter, status: event.target.value as KnowledgeFilter['status'] })
          }
        >
          <option value="all">Mọi trạng thái</option>
          {Object.entries(KNOWLEDGE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Lọc theo nhóm"
          value={filter.category}
          onChange={(event) =>
            setFilter({ ...filter, category: event.target.value as KnowledgeFilter['category'] })
          }
        >
          <option value="all">Mọi nhóm</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {KNOWLEDGE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="muted">Đang tải kho tri thức…</p>}
      {loadError && !loading && (
        <p className="muted">
          Không tải được kho tri thức.{' '}
          <button type="button" className="btn btn-small" onClick={() => void refresh()}>
            Thử lại
          </button>
        </p>
      )}
      {!loading && !loadError && visible.length === 0 && (
        <p className="muted">
          Chưa có mục nào khớp bộ lọc. Ghi lại một quy tắc nghiệp vụ vừa được chốt để bắt đầu.
        </p>
      )}

      <ul className="ba-list">
        {visible.map((item) => (
          <li key={item.id} className="ba-card">
            <div className="ba-card-main">
              <span className="ba-title">{item.title}</span>
              <span className="muted small">
                {KNOWLEDGE_CATEGORY_LABELS[item.category]} ·{' '}
                {KNOWLEDGE_STATUS_LABELS[item.status]} · {formatUsage(item)}
              </span>
              <p className="ba-body">{item.body}</p>
            </div>
            <div className="row-actions">
              {item.status === 'draft' && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busyId === item.id}
                  onClick={() =>
                    runAction(
                      item.id,
                      () => api.ba.knowledge.confirm(item.id),
                      'Không xác nhận được mục này.',
                    )
                  }
                >
                  Xác nhận
                </button>
              )}
              <button
                type="button"
                className="btn btn-small btn-danger"
                disabled={busyId === item.id}
                onClick={() => setDeleteTarget(item)}
              >
                Xoá
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deleteTarget !== null && (
        <DestructiveActionDialog
          title="Xoá mục tri thức?"
          description={`“${deleteTarget.title}” sẽ bị xoá khỏi máy này. Muốn giữ lịch sử quyết định thì hãy tạo bản thay thế thay vì xoá.`}
          confirmLabel="Xoá mục"
          busy={busyId === deleteTarget.id}
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            runAction(target.id, () => api.ba.knowledge.remove(target.id), 'Không xoá được mục.')
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}

function DocumentsTab(props: {
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [documents, setDocuments] = useState<BaDocumentView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [items, setItems] = useState<BaItemSummaryView[]>([])
  const [errorPage, setErrorPage] = useState<BaErrorCodePageView | null>(null)
  const [projections, setProjections] = useState<BaProjectionsView | null>(null)
  const [report, setReport] = useState<BaReviewReportView | null>(null)
  const [catalog, setCatalog] = useState<BaTemplateCatalogView | null>(null)
  const [title, setTitle] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, templates] = await Promise.all([
        api.ba.documents.list(),
        api.ba.templates.list(),
      ])
      setDocuments(list)
      setCatalog(templates)
      setLoadError(false)
    } catch (error) {
      setLoadError(true)
      onError(error, 'Không tải được danh sách tài liệu.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = (id: string): void => {
    void (async () => {
      setBusy(true)
      try {
        const [read, page, projected] = await Promise.all([
          api.ba.documents.read(id),
          api.ba.documents.errorCodes(id),
          api.ba.documents.projections(id),
        ])
        setActiveId(id)
        setItems(read.items)
        setErrorPage(page)
        setProjections(projected)
        // Báo cáo cũ của tài liệu khác không được đứng lại trên màn hình tài liệu mới.
        setReport(null)
      } catch (error) {
        onError(error, 'Không mở được tài liệu.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const mergePair = (keepId: string, dropId: string): void => {
    if (activeId === null) return
    void (async () => {
      setBusy(true)
      try {
        await api.ba.documents.mergeItems(activeId, keepId, dropId)
        props.onToast({ kind: 'info', title: 'Đã gộp hai mục.' })
        open(activeId)
      } catch (error) {
        onError(error, 'Không gộp được hai mục.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const runReview = (): void => {
    if (activeId === null) return
    void (async () => {
      setBusy(true)
      try {
        setReport(await api.ba.documents.review(activeId))
      } catch (error) {
        onError(error, 'Không chạy được bộ luật kiểm tra.')
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * Áp dụng là thao tác riêng cho TỪNG finding (D2).
   *
   * Sau khi áp dụng, danh sách item được nạp lại nhưng báo cáo thì KHÔNG tự chạy lại: một báo cáo
   * tự làm mới sau mỗi lần sửa sẽ khiến người dùng thấy các phát hiện lặng lẽ biến mất, và mất
   * luôn cảm giác mình đang xử lý một danh sách hữu hạn. Chạy lại là một cú bấm có ý thức.
   */
  const applyFinding = (finding: BaFindingView, field: string, value: string): void => {
    const itemId = finding.itemId
    if (activeId === null || itemId === null) return
    void (async () => {
      setBusy(true)
      try {
        const result = await api.ba.documents.applyFinding(activeId, itemId, field, value)
        setItems(result.items)
        props.onToast({ kind: 'info', title: 'Đã áp dụng cho một mục. Chạy lại kiểm tra để soát lại.' })
      } catch (error) {
        onError(error, 'Không áp dụng được gợi ý cho mục này.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const activeDocument = documents.find((entry) => entry.id === activeId) ?? null
  const templateState = projections === null ? null : describeTemplateState(projections)

  const grouped = groupItems(items)

  return (
    <>
      <form
        className="ba-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() === '') return
          void (async () => {
            setBusy(true)
            try {
              const created = await api.ba.documents.create({ title: title.trim(), kind: 'us' })
              setTitle('')
              await refresh()
              open(created.id)
            } catch (error) {
              onError(error, 'Không tạo được tài liệu.')
            } finally {
              setBusy(false)
            }
          })()
        }}
      >
        <input
          className="input"
          aria-label="Tên tài liệu"
          placeholder="Tên tài liệu — ví dụ: US-01 Đặt đơn"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || title.trim() === ''}>
          Tạo tài liệu
        </button>
      </form>

      {loading && <p className="muted">Đang tải tài liệu…</p>}
      {loadError && !loading && (
        <p className="muted">
          Không tải được danh sách tài liệu.{' '}
          <button type="button" className="btn btn-small" onClick={() => void refresh()}>
            Thử lại
          </button>
        </p>
      )}
      {!loading && !loadError && documents.length === 0 && (
        <p className="muted">
          Chưa có tài liệu nào. Tạo một tài liệu rồi dán nội dung US vào để Nexa dựng mô hình có
          cấu trúc và trang mã lỗi.
        </p>
      )}

      <ul className="ba-list">
        {documents.map((document) => (
          <li key={document.id} className={`ba-card ${document.id === activeId ? 'active' : ''}`}>
            <button type="button" className="ba-card-main" onClick={() => open(document.id)}>
              <span className="ba-title">{document.title}</span>
              <span className="muted small">
                {document.needsReviewCount > 0
                  ? `${document.needsReviewCount} mục cần soát`
                  : 'Không có mục cần soát'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {activeId !== null && (
        <>
          <h3>Mẫu tài liệu</h3>
          <div className="ba-form">
            <select
              className="input"
              aria-label="Mẫu tài liệu"
              value={activeDocument?.templateId ?? ''}
              disabled={busy || (catalog?.templates.length ?? 0) === 0}
              onChange={(event) => {
                const next = event.target.value === '' ? null : event.target.value
                void (async () => {
                  setBusy(true)
                  try {
                    await api.ba.documents.setTemplate(activeId, next)
                    await refresh()
                    open(activeId)
                  } catch (error) {
                    onError(error, 'Không đổi được mẫu tài liệu.')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              <option value="">Chưa chọn mẫu</option>
              {(catalog?.templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} (phiên bản {template.version})
                </option>
              ))}
            </select>
          </div>
          {templateState !== null && (
            <p className={templateState.tone === 'warning' ? 'error-inline' : 'muted'}>
              {templateState.text}
            </p>
          )}
          {(catalog?.templates.length ?? 0) === 0 && (
            <p className="muted small">
              Bản cài này chưa có mẫu nào — liên hệ IT nếu tổ chức đã ban hành mẫu chuẩn.
            </p>
          )}

          <h3>Nội dung nguồn</h3>
          <textarea
            className="input"
            aria-label="Nội dung tài liệu nguồn"
            rows={6}
            placeholder="Dán nội dung US vào đây rồi bấm Trích xuất."
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || sourceText.trim() === ''}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const result = await api.ba.documents.extract(activeId, { text: sourceText })
                  props.onToast({
                    kind: 'info',
                    title: result.cached
                      ? 'Nội dung không đổi — dùng lại kết quả đã trích xuất.'
                      : `Đã trích xuất ${String(result.items.length)} mục từ ${String(result.sectionCount)} phần.`,
                  })
                  open(activeId)
                  await refresh()
                } catch (error) {
                  onError(error, 'Không trích xuất được tài liệu.')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? 'Đang trích xuất…' : 'Trích xuất'}
          </button>

          {grouped.needsReview.length > 0 && (
            <section aria-label="Mục cần người soát">
              <h3>Cần bạn soát ({grouped.needsReview.length})</h3>
              <p className="muted small">
                Nexa không chắc các mục này. Chúng không được dùng làm căn cứ trong tổng hợp mã lỗi.
              </p>
              <ul className="ba-list">
                {grouped.needsReview.map((item) => (
                  <li key={item.id} className="ba-card">
                    <span className="ba-title">{item.title}</span>
                    <span className="muted small">{ITEM_TYPE_LABELS[item.itemType]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {grouped.groups.map((group) => (
            <section key={group.itemType} aria-label={group.label}>
              <h3>
                {group.label} ({group.items.length})
              </h3>
              <ul className="ba-list">
                {group.items.map((item) => (
                  <li key={item.id} className="ba-card">
                    <span className="ba-title">{item.title}</span>
                    {item.detail !== '' && <span className="muted small">{item.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {errorPage !== null && <ErrorCodePage page={errorPage} />}

          <ReviewPanel
            report={report}
            busy={busy}
            documentId={activeId ?? ''}
            onRun={runReview}
            onApply={applyFinding}
            onError={onError}
          />

          {projections !== null && (
            <ProjectionsPanel
              projections={projections}
              busy={busy}
              onMerge={mergePair}
              onCopyMermaid={() => {
                void navigator.clipboard
                  .writeText(projections.mermaid.code)
                  .then(() => props.onToast({ kind: 'info', title: 'Đã chép mã sơ đồ.' }))
                  .catch(() => onError(null, 'Không chép được mã sơ đồ.'))
              }}
              onCopyMarkdown={() => {
                if (projections.markdown === null) return
                void navigator.clipboard
                  .writeText(projections.markdown)
                  .then(() => props.onToast({ kind: 'info', title: 'Đã chép bản Markdown.' }))
                  .catch(() => onError(null, 'Không chép được bản Markdown.'))
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function ErrorCodePage(props: { page: BaErrorCodePageView }): React.JSX.Element {
  const headline = summarizeErrorPage(props.page)
  return (
    <section aria-label="Trang mã lỗi">
      <h3>Trang mã lỗi</h3>
      <p className={headline.tone === 'warning' ? 'error-inline' : 'muted'}>
        {headline.text}
      </p>

      {props.page.declared.length > 0 && (
        <table className="table">
          <caption className="muted small">Mã lỗi đã khai báo</caption>
          <thead>
            <tr>
              <th scope="col">Mã</th>
              <th scope="col">Thông điệp</th>
              <th scope="col">Được dùng ở</th>
            </tr>
          </thead>
          <tbody>
            {props.page.declared.map((entry) => (
              <tr key={entry.itemId}>
                <td>
                  <code>{entry.code}</code>
                </td>
                <td>{entry.message}</td>
                <td className="muted small">
                  {entry.referencedBy.length === 0
                    ? 'Chưa luồng nào dùng'
                    : `${String(entry.referencedBy.length)} nơi`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {props.page.undeclared.length > 0 && (
        <>
          <h4>Được nhắc trong luồng nhưng chưa khai báo</h4>
          <ul className="ba-list">
            {props.page.undeclared.map((entry) => (
              <li key={entry.code} className="ba-card">
                <code>{entry.code}</code>
                <span className="muted small">
                  {String(entry.referencedBy.length)} nơi tham chiếu
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {props.page.inconsistent.length > 0 && (
        <>
          <h4>Một mã, hai thông điệp</h4>
          <ul className="ba-list">
            {props.page.inconsistent.map((entry) => (
              <li key={entry.code} className="ba-card">
                <code>{entry.code}</code>
                <span className="muted small">
                  {entry.variants.map((variant) => variant.message).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * Tab **Mẫu** — chỉ để xem, không có editor (D12).
 *
 * Bộ mẫu do IT phân phối cùng bản cài. Cho người dùng cuối sửa được thì mỗi máy sẽ có một "chuẩn"
 * riêng, và lúc đó nó thôi là chuẩn.
 */
function TemplatesTab(props: {
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { onError } = props
  const [catalog, setCatalog] = useState<BaTemplateCatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setCatalog(await api.ba.templates.list())
      setLoadError(false)
    } catch (error) {
      setLoadError(true)
      onError(error, 'Không tải được bộ mẫu.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <p className="muted">Đang tải bộ mẫu…</p>
  if (loadError || catalog === null) {
    return (
      <p className="muted">
        Không tải được bộ mẫu.{' '}
        <button type="button" className="btn btn-small" onClick={() => void refresh()}>
          Thử lại
        </button>
      </p>
    )
  }

  return (
    <>
      <p className="muted small">
        Bộ mẫu và chuẩn validate do tổ chức phân phối cùng bản cài. Bạn chọn mẫu cho từng tài liệu;
        muốn đổi nội dung mẫu thì liên hệ IT.
      </p>

      {catalog.rulebook !== null && (
        <p className="muted small">
          Chuẩn validate đang dùng: <strong>{catalog.rulebook.name}</strong> phiên bản{' '}
          {catalog.rulebook.version}.
        </p>
      )}

      {catalog.templates.length === 0 ? (
        <p className="muted">
          Bản cài này chưa có mẫu nào. Tài liệu vẫn dùng được, chỉ là chưa xuất được bản theo mẫu.
        </p>
      ) : (
        <ul className="ba-list">
          {catalog.templates.map((template) => (
            <li key={template.id} className="ba-card">
              <div className="ba-card-main">
                <span className="ba-title">
                  {template.name}{' '}
                  <span className="tag">phiên bản {template.version}</span>
                </span>
                {template.description !== undefined && (
                  <span className="muted small">{template.description}</span>
                )}
                <p className="ba-body">
                  {template.sections
                    .map((section) => `${section.title}${section.required ? ' *' : ''}`)
                    .join(' · ')}
                </p>
                <span className="muted small">* là mục bắt buộc</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Bốn phép chiếu chỉ-đọc của một tài liệu: bản Markdown, sơ đồ, ma trận truy vết và đối chiếu
 * validate — cộng danh sách cặp nghi trùng để người dùng quyết định gộp.
 *
 * Mọi số liệu ở đây đều nói **đã đối chiếu được gì**, không nói tài liệu đúng hay sai. Đó là ranh
 * giới giữa "kiểm tra được" và "chấm điểm", và G2 nằm hẳn ở phía kiểm tra được.
 */
function ProjectionsPanel(props: {
  projections: BaProjectionsView
  busy: boolean
  onMerge: (keepId: string, dropId: string) => void
  onCopyMermaid: () => void
  onCopyMarkdown: () => void
}): React.JSX.Element {
  const { projections } = props
  const matrixHeadline = summarizeMatrix(projections.matrix)
  const fieldHeadline = summarizeFieldAudits(projections.fieldAudits)
  const missingValidation = fieldsMissingValidation(projections.fieldAudits)

  return (
    <>
      {projections.markdown !== null && (
        <section aria-label="Bản tài liệu theo mẫu">
          <h3>Bản theo mẫu</h3>
          <button type="button" className="btn btn-small" onClick={props.onCopyMarkdown}>
            Chép bản Markdown
          </button>
          <pre className="ba-code">{projections.markdown}</pre>
        </section>
      )}

      <section aria-label="Sơ đồ luồng">
        <h3>Sơ đồ luồng</h3>
        {projections.mermaid.stepCount === 0 ? (
          <p className="muted">
            Tài liệu chưa có bước luồng nào. Trích xuất phần mô tả luồng để Nexa dựng sơ đồ.
          </p>
        ) : (
          <>
            <p className="muted small">
              {projections.mermaid.stepCount} bước · {projections.mermaid.edgeCount} nhánh
              {projections.mermaid.isolatedSteps.length > 0
                ? ` · ${String(projections.mermaid.isolatedSteps.length)} bước chưa nối vào luồng nào`
                : ''}
            </p>
            <button type="button" className="btn btn-small" onClick={props.onCopyMermaid}>
              Chép mã sơ đồ (Mermaid)
            </button>
            <pre className="ba-code">{projections.mermaid.code}</pre>
          </>
        )}
      </section>

      <section aria-label="Ma trận truy vết">
        <h3>Bước luồng ↔ Use case</h3>
        <p className={matrixHeadline.tone === 'warning' ? 'error-inline' : 'muted'}>
          {matrixHeadline.text}
        </p>
        {projections.matrix.steps.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Bước</th>
                <th scope="col">Được use case phủ</th>
              </tr>
            </thead>
            <tbody>
              {projections.matrix.steps.map((step) => (
                <tr key={step.id}>
                  <td>{step.label}</td>
                  <td className={step.coveredBy.length === 0 ? 'error-inline' : 'muted small'}>
                    {step.coveredBy.length === 0 ? 'Chưa được phủ' : step.coveredBy.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Đối chiếu validate">
        <h3>Validate theo chuẩn tổ chức</h3>
        <p className={fieldHeadline.tone === 'warning' ? 'error-inline' : 'muted'}>
          {fieldHeadline.text}
        </p>
        {missingValidation.length > 0 && (
          <ul className="ba-list">
            {missingValidation.map((audit) => (
              <li key={audit.fieldId} className="ba-card">
                <div className="ba-card-main">
                  <span className="ba-title">
                    {audit.fieldName} <span className="tag">{audit.fieldType}</span>
                  </span>
                  <span className="muted small">
                    Còn thiếu: {audit.missing.map((rule) => rule.label).join(' · ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {projections.nearDuplicates.length > 0 && (
        <section aria-label="Cặp nghi trùng">
          <h3>Nghi trùng ({projections.nearDuplicates.length})</h3>
          <p className="muted small">
            Nexa chỉ gợi ý. Bạn chọn giữ mục nào — không có gì bị gộp tự động.
          </p>
          <ul className="ba-list">
            {projections.nearDuplicates.map((pair) => (
              <li key={`${pair.a}|${pair.b}`} className="ba-card">
                <div className="ba-card-main">
                  <span className="ba-title">
                    {pair.a} ↔ {pair.b}
                  </span>
                  <span className="muted small">
                    Giống nhau {Math.round(pair.similarity * 100)}%
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={props.busy}
                    onClick={() => props.onMerge(pair.a, pair.b)}
                  >
                    Giữ {pair.a}
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={props.busy}
                    onClick={() => props.onMerge(pair.b, pair.a)}
                  >
                    Giữ {pair.b}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {projections.potentialContradictions.length > 0 && (
        <section aria-label="Cặp nghi mâu thuẫn">
          <h3>Nghi mâu thuẫn ({projections.potentialContradictions.length})</h3>
          {/* Cố ý KHÔNG có nút gộp: hai mệnh đề lệch nhau ở phủ định là ngược nghĩa, không phải trùng. */}
          <p className="muted small">
            Hai mục dưới đây dùng gần cùng từ ngữ nhưng lệch nhau ở phủ định. Đây là nghi ngờ mâu
            thuẫn, không phải trùng lặp — nên không có tuỳ chọn gộp.
          </p>
          <ul className="ba-list">
            {projections.potentialContradictions.map((pair) => (
              <li key={`${pair.a}|${pair.b}`} className="ba-card">
                <span className="ba-title">
                  {pair.a} ↔ {pair.b}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/**
 * Báo cáo review (openspec `add-ba-workbench` D2, ADR 0010).
 *
 * Bố cục ở đây là một quyết định, không phải trang trí. Ba thứ luôn hiện, kể cả khi không có phát
 * hiện nào:
 *
 *   1. **Đã kiểm bộ luật nào, phiên bản nào, bao nhiêu luật** — để con số "đạt" có đơn vị.
 *   2. **Câu nói thẳng giới hạn** (`REVIEW_SCOPE_NOTE`) — bộ luật kiểm cấu trúc và đối chiếu KB;
 *      nó không biết một yêu cầu chưa ai nghĩ tới.
 *   3. **Luật nào chưa kiểm được và vì sao** — một luật chưa chạy không bao giờ được nhìn giống
 *      một luật đã đạt.
 *
 * Và một thứ không bao giờ xuất hiện: chữ "đầy đủ" cho toàn tài liệu.
 */
function ReviewPanel(props: {
  report: BaReviewReportView | null
  busy: boolean
  documentId: string
  onRun: () => void
  onApply: (finding: BaFindingView, field: string, value: string) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { report } = props
  const headline = report === null ? null : summarizeReview(report)
  const skipped = report === null ? null : describeSkippedRules(report)
  const packChange = report === null ? null : describeRulePackChange(report)

  return (
    <section aria-label="Kiểm tra tài liệu">
      <h3>Kiểm tra tài liệu</h3>
      <button type="button" className="btn btn-primary" disabled={props.busy} onClick={props.onRun}>
        {props.busy ? 'Đang kiểm…' : report === null ? 'Chạy kiểm tra' : 'Chạy lại kiểm tra'}
      </button>

      {report === null ? (
        <p className="muted small">
          Bộ luật chạy hoàn toàn trên máy bạn và cho cùng một kết quả mỗi lần chạy trên cùng tài
          liệu. Không có bước nào hỏi ý kiến model.
        </p>
      ) : (
        <>
          <p className={headline?.tone === 'warning' ? 'error-inline' : 'muted'}>{headline?.text}</p>
          <p className="muted small">{REVIEW_SCOPE_NOTE}</p>
          {packChange !== null && <p className="error-inline">{packChange}</p>}
          {skipped !== null && <p className="muted small">{skipped}</p>}

          {groupFindings(report).map((group) => (
            <section key={group.severity} aria-label={group.label}>
              <h4>
                {group.label} ({group.findings.length})
              </h4>
              <ul className="ba-list">
                {group.findings.map((finding) => (
                  <FindingCard
                    key={`${finding.ruleId}|${finding.itemId ?? ''}|${finding.message}`}
                    finding={finding}
                    busy={props.busy}
                    documentId={props.documentId}
                    onApply={props.onApply}
                    onError={props.onError}
                  />
                ))}
              </ul>
            </section>
          ))}

          <details>
            <summary className="muted small">Đã kiểm những luật nào ({report.rules.length})</summary>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Luật</th>
                  <th scope="col">Kiểm gì</th>
                  <th scope="col">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {report.rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <code>{rule.id}</code>
                    </td>
                    <td>{rule.description}</td>
                    <td className={rule.status === 'passed' ? 'muted small' : 'error-inline'}>
                      {rule.status === 'passed'
                        ? 'Đạt'
                        : rule.status === 'skipped'
                          ? 'Chưa kiểm được'
                          : `${String(rule.findingCount)} phát hiện`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  )
}

/**
 * Một phát hiện, và hai thao tác tách rời trên nó.
 *
 * Xin gợi ý câu chữ và áp dụng là **hai lần bấm khác nhau**, và ô soạn thảo giữ nguyên quyền sửa
 * của người dùng ở giữa. Gộp chúng thành một nút "sửa giúp tôi" là biến review thành tự sửa tài
 * liệu — điều D2 nói không.
 */
function FindingCard(props: {
  finding: BaFindingView
  busy: boolean
  documentId: string
  onApply: (finding: BaFindingView, field: string, value: string) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { finding } = props
  const [draft, setDraft] = useState('')
  const [field, setField] = useState('')
  const [asking, setAsking] = useState(false)

  const askForWording = (): void => {
    void (async () => {
      setAsking(true)
      try {
        const result = await api.ba.documents.suggestWording(
          props.documentId,
          finding.ruleId,
          finding.itemId,
        )
        setDraft(result.suggestion)
      } catch (error) {
        props.onError(error, 'Không lấy được gợi ý câu chữ cho phát hiện này.')
      } finally {
        setAsking(false)
      }
    })()
  }

  return (
    <li className="ba-card">
      <div className="ba-card-main">
        <span className="ba-title">
          <span className="tag">{finding.ruleId}</span> {finding.message}
        </span>
        <span className="muted small">Cách sửa: {finding.fix}</span>
        {finding.evidence.length > 0 && (
          <span className="muted small">Căn cứ: {finding.evidence.join(', ')}</span>
        )}

        {finding.itemId !== null && (
          <>
            <div className="ba-form">
              <select
                className="input"
                aria-label={`Ô cần sửa cho ${finding.ruleId}`}
                value={field}
                onChange={(event) => setField(event.target.value)}
              >
                <option value="">Chọn ô cần sửa</option>
                {PATCHABLE_FIELD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-small"
                disabled={props.busy || asking}
                onClick={askForWording}
              >
                {asking ? 'Đang hỏi…' : 'Gợi ý câu chữ'}
              </button>
            </div>
            <textarea
              className="input"
              aria-label={`Câu chữ thay thế cho ${finding.ruleId}`}
              rows={2}
              placeholder="Câu chữ bạn muốn đưa vào tài liệu."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-small"
              disabled={props.busy || field === '' || draft.trim() === ''}
              onClick={() => props.onApply(finding, field, draft.trim())}
            >
              Áp dụng cho mục này
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * Các ô sửa được, đúng bằng danh sách mà `ba-kit` cho phép.
 *
 * Người dùng chọn ô chứ không để hệ thống đoán: một finding `R-UC-01` có thể nói về actor hoặc về
 * điều kiện trước, và đoán sai nghĩa là ghi đè nhầm một ô đang đúng.
 */
const PATCHABLE_FIELD_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'name', label: 'Tên' },
  { value: 'label', label: 'Nhãn bước' },
  { value: 'actor', label: 'Actor' },
  { value: 'role', label: 'Role được phép' },
  { value: 'precondition', label: 'Điều kiện trước' },
  { value: 'postcondition', label: 'Điều kiện sau' },
  { value: 'statement', label: 'Nội dung quy tắc' },
  { value: 'message', label: 'Thông điệp mã lỗi' },
  { value: 'meaning', label: 'Ý nghĩa mã lỗi' },
  { value: 'description', label: 'Mô tả' },
  { value: 'noAlternateReason', label: 'Lý do không có luồng thay thế' },
  { value: 'noValidationReason', label: 'Lý do miễn kiểm tra' },
]
