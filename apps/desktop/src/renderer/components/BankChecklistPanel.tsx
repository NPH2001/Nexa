import { useCallback, useEffect, useState } from 'react'
import type {
  BankChecklistCaseView,
  BankChecklistReportView,
  BankChecklistTemplateView,
  BankDocumentEvidenceView,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { DestructiveActionDialog } from './DestructiveActionDialog.js'
import type { Toast } from './Toasts.js'
import {
  CHECKLIST_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  checklistStatusClass,
  summarizeBankChecklist,
} from './bank-checklist-ui.js'

interface CaseDetail {
  readonly item: BankChecklistCaseView
  readonly documents: BankDocumentEvidenceView[]
  readonly latestReport: BankChecklistReportView | null
}

export function BankChecklistPanel(props: {
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError } = props
  const [templates, setTemplates] = useState<BankChecklistTemplateView[]>([])
  const [cases, setCases] = useState<BankChecklistCaseView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextCases, nextTemplates] = await Promise.all([
        api.ba.checklists.list(),
        api.ba.checklists.templates(),
      ])
      setCases(nextCases)
      setTemplates(nextTemplates)
      setTemplateId((current) => current || nextTemplates[0]?.id || '')
    } catch (error) {
      onError(error, 'Không tải được hồ sơ kiểm chứng từ.')
    } finally {
      setLoading(false)
    }
  }, [onError])

  const open = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true)
      try {
        setDetail(await api.ba.checklists.read(id))
        setActiveId(id)
      } catch (error) {
        onError(error, 'Không mở được hồ sơ kiểm chứng từ.')
      } finally {
        setBusy(false)
      }
    },
    [onError],
  )

  useEffect(() => {
    void load()
  }, [load])

  const create = (): void => {
    if (title.trim() === '' || templateId === '') return
    void (async () => {
      setBusy(true)
      try {
        const created = await api.ba.checklists.create(title.trim(), templateId)
        setTitle('')
        await load()
        await open(created.id)
        props.onToast({ kind: 'info', title: 'Đã tạo hồ sơ kiểm chứng từ.' })
      } catch (error) {
        onError(error, 'Không tạo được hồ sơ kiểm chứng từ.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const ingest = (): void => {
    if (activeId === null) return
    void (async () => {
      setBusy(true)
      try {
        // Hồ sơ chứng từ chỉ đọc văn bản trích xuất — ảnh chưa dùng được ở đây (I1).
        const picked = await api.files.pick('text')
        let completed = 0
        for (const file of picked) {
          try {
            await api.ba.checklists.ingest(activeId, file.token)
            completed += 1
          } catch (error) {
            onError(error, `Không trích xuất được ${file.fileName}.`)
          }
        }
        await Promise.all([load(), open(activeId)])
        if (completed > 0) {
          props.onToast({
            kind: 'info',
            title: `Đã thêm ${String(completed)} chứng từ.`,
          })
        }
      } catch (error) {
        onError(error, 'Không chọn được chứng từ.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const review = (): void => {
    if (activeId === null) return
    void (async () => {
      setBusy(true)
      try {
        const report = await api.ba.checklists.review(activeId)
        setDetail((current) => (current === null ? current : { ...current, latestReport: report }))
        await load()
        props.onToast({ kind: 'info', title: 'Đã chạy checklist bằng rule pack cục bộ.' })
      } catch (error) {
        onError(error, 'Không chạy được checklist.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const remove = (): void => {
    if (activeId === null) return
    void (async () => {
      setBusy(true)
      try {
        await api.ba.checklists.remove(activeId)
        setDetail(null)
        setActiveId(null)
        setConfirmDelete(false)
        await load()
        props.onToast({ kind: 'info', title: 'Đã xoá hồ sơ kiểm chứng từ.' })
      } catch (error) {
        onError(error, 'Không xoá được hồ sơ kiểm chứng từ.')
      } finally {
        setBusy(false)
      }
    })()
  }

  if (loading && cases.length === 0) return <p className="muted">Đang tải hồ sơ…</p>

  return (
    <div className="checklist-workspace">
      <div className="checklist-sidebar">
        <form
          className="ba-form checklist-create"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <input
            className="input"
            value={title}
            maxLength={200}
            placeholder="Tên hồ sơ — ví dụ: KYC Nguyễn Văn A"
            aria-label="Tên hồ sơ"
            onChange={(event) => setTitle(event.target.value)}
          />
          <select
            className="input"
            value={templateId}
            aria-label="Mẫu checklist"
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((template) => (
              <option key={`${template.id}@${template.version}`} value={template.id}>
                {template.name} · v{template.version}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || title.trim() === '' || templateId === ''}
          >
            Tạo hồ sơ
          </button>
        </form>

        {templates.length === 0 && (
          <p className="muted small">Chưa có mẫu checklist do IT phát hành.</p>
        )}
        <ul className="ba-list" aria-label="Danh sách hồ sơ">
          {cases.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`ba-card checklist-case ${activeId === item.id ? 'active' : ''}`}
                onClick={() => void open(item.id)}
              >
                <span className="ba-title">{item.title}</span>
                <span className="muted small">
                  {item.documentCount} chứng từ · v{item.templateVersion} ·{' '}
                  {item.status === 'reviewed' ? 'đã chạy checklist' : 'bản nháp'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="checklist-detail">
        {detail === null ? (
          <div className="today-empty">
            <p>Chọn một hồ sơ hoặc tạo hồ sơ mới để bắt đầu.</p>
          </div>
        ) : (
          <>
            <div className="checklist-heading">
              <div>
                <h3>{detail.item.title}</h3>
                <p className="muted small">
                  Mẫu {detail.item.templateId} · v{detail.item.templateVersion}
                </p>
              </div>
              <div className="row-actions">
                <button type="button" className="btn" disabled={busy} onClick={ingest}>
                  Thêm chứng từ
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Xoá hồ sơ
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={review}>
                  Chạy checklist
                </button>
              </div>
            </div>
            <p className="muted small">
              AI chỉ phân loại và trích xuất trường. Trạng thái dưới đây do rule pack cục bộ tính;
              “đạt” không phải phê duyệt hồ sơ.
            </p>

            <h4>Chứng từ đã nhận</h4>
            {detail.documents.length === 0 ? (
              <p className="muted">Chưa có chứng từ. Chọn TXT, Markdown, PDF có text hoặc DOCX.</p>
            ) : (
              <ul className="ba-list">
                {detail.documents.map((document) => (
                  <li key={document.id} className="ba-card">
                    <div className="ba-card-main">
                      <span className="ba-title">{document.fileName}</span>
                      <span className="muted small">
                        {DOCUMENT_TYPE_LABELS[document.documentType]} · {document.fields.length}{' '}
                        trường
                      </span>
                    </div>
                    {(document.needsReview || document.truncated || document.suspectedScan) && (
                      <span className="tag tag-warning">Cần người kiểm tra</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {detail.latestReport !== null && (
              <section aria-labelledby="checklist-result-heading">
                <div className="checklist-heading">
                  <div>
                    <h4 id="checklist-result-heading">Kết quả checklist</h4>
                    <p className="muted small">
                      {summarizeBankChecklist(detail.latestReport)} · rule pack v
                      {detail.latestReport.rulePackVersion}
                    </p>
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="table checklist-table">
                    <thead>
                      <tr>
                        <th>Hạng mục</th>
                        <th>Trạng thái</th>
                        <th>Bằng chứng và xử lý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.latestReport.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.label}</strong>
                            <div className="muted small">{item.ruleId}</div>
                          </td>
                          <td>
                            <span className={`tag ${checklistStatusClass(item.status)}`}>
                              {CHECKLIST_STATUS_LABELS[item.status]}
                            </span>
                          </td>
                          <td>
                            <div>{item.message}</div>
                            <div className="muted small">Xử lý: {item.fix}</div>
                            {item.evidence.length > 0 && (
                              <ul className="checklist-evidence">
                                {item.evidence.map((evidence, index) => (
                                  <li key={`${evidence.documentId}-${String(index)}`}>
                                    {evidence.fileName}
                                    {evidence.fieldKey === undefined
                                      ? ''
                                      : ` · ${evidence.fieldKey}: ${evidence.value ?? '—'}`}
                                    {evidence.sourceLabel === undefined
                                      ? ''
                                      : ` · ${evidence.sourceLabel}`}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {confirmDelete && (
              <DestructiveActionDialog
                title="Xoá hồ sơ kiểm chứng từ?"
                description={`“${detail.item.title}”, các trường đã trích xuất và lịch sử checklist sẽ bị xoá khỏi máy này.`}
                confirmLabel="Xoá hồ sơ"
                busy={busy}
                onConfirm={remove}
                onCancel={() => setConfirmDelete(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
