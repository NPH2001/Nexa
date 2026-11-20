import { useState } from 'react'
import { PROVIDER_LABELS, RETENTION_CHOICES, isExternalProvider } from '@nexa/shared-types/renderer'
import type { AppSettings, ModelConfig } from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import type { Toast } from './Toasts.js'

export function DataPanel(props: {
  settings: AppSettings
  models: readonly ModelConfig[]
  lockedFeatures: readonly string[]
  notificationsSupported: boolean
  onChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const [purgeConfirm, setPurgeConfirm] = useState('')
  const externalModels = props.models.filter((m) => isExternalProvider(m.provider))

  const update = (patch: Partial<AppSettings>): void => {
    void (async () => {
      try {
        props.onChanged(await api.settings.update(patch))
      } catch (error) {
        props.onError(error, 'Không lưu được cài đặt.')
      }
    })()
  }

  const featureRows: { key: keyof AppSettings['features']; label: string; note?: string }[] = [
    { key: 'jiraRead', label: 'Đọc Jira' },
    { key: 'jiraSearch', label: 'Tìm kiếm Jira' },
    {
      key: 'jiraServiceDesk',
      label: 'Đọc Jira Service Management',
      note: 'Queue, request type',
    },
    { key: 'jiraCreate', label: 'Tạo Jira issue', note: 'Luôn cần bạn xác nhận' },
    { key: 'jiraComment', label: 'Bình luận Jira', note: 'Luôn cần bạn xác nhận' },
    {
      key: 'jiraLink',
      label: 'Tổ chức lại Jira',
      note: 'Watcher, liên kết issue, sprint',
    },
    {
      key: 'jiraUpdate',
      label: 'Cập nhật Jira issue',
      note: 'Rủi ro cao — luôn cần bạn xác nhận',
    },
    {
      key: 'jiraWorkflow',
      label: 'Chuyển trạng thái / project / xoá Jira issue',
      note: 'Rủi ro cao — bao gồm xoá vĩnh viễn, không thể hoàn tác, luôn cần bạn xác nhận',
    },
    { key: 'confluenceRead', label: 'Đọc Confluence' },
    { key: 'confluenceSearch', label: 'Tìm kiếm Confluence' },
    { key: 'confluenceWrite', label: 'Ghi Confluence', note: 'Tạo trang, comment' },
    {
      key: 'confluenceWriteHigh',
      label: 'Cập nhật/di chuyển/xoá trang Confluence',
      note: 'Rủi ro cao — bao gồm xoá vĩnh viễn, không thể hoàn tác, luôn cần bạn xác nhận',
    },
    { key: 'redmineRead', label: 'Đọc Redmine', note: 'Issue, dự án, log time, wiki' },
    {
      key: 'redmineWrite',
      label: 'Ghi Redmine',
      note: 'Tạo issue, ghi chú, log time, liên kết, watcher — luôn cần bạn xác nhận',
    },
    {
      key: 'redmineUpdate',
      label: 'Cập nhật Redmine issue',
      note: 'Rủi ro cao — đổi trạng thái, người được giao, hạn; luôn cần bạn xác nhận',
    },
    { key: 'xwikiRead', label: 'Đọc XWiki' },
    {
      key: 'xwikiWrite',
      label: 'Tạo/sửa/ghi đè trang XWiki',
      note: 'Rủi ro cao — có kiểm tra phiên bản trang, luôn cần bạn xác nhận',
    },
    { key: 'storeExtractedText', label: 'Lưu nội dung trích xuất từ file (đã mã hoá)' },
    { key: 'storeHistory', label: 'Lưu lịch sử hội thoại' },
  ]

  const baLocked = props.lockedFeatures.includes('baWorkbench')

  return (
    <>
      <section className="panel">
        <h2>Lưu giữ dữ liệu</h2>
        <label className="field">
          <span>Tự động xoá hội thoại sau</span>
          <select
            className="input"
            value={props.settings.historyRetentionDays}
            onChange={(e) => update({ historyRetentionDays: Number(e.target.value) })}
          >
            {/* Danh sách lấy từ shared-types để UI và validate ở main không lệch nhau. */}
            {RETENTION_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? 'Không tự xoá' : `${String(days)} ngày`}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Giữ log chẩn đoán</span>
          <select
            className="input"
            value={props.settings.logRetentionDays}
            onChange={(e) => update({ logRetentionDays: Number(e.target.value) })}
          >
            <option value={7}>7 ngày</option>
            <option value={14}>14 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </label>

        <label className="field">
          <span>Thời hạn xác nhận thao tác (giây)</span>
          <input
            className="input input-compact"
            type="number"
            min={15}
            max={900}
            value={props.settings.approvalTtlSeconds}
            onChange={(e) => update({ approvalTtlSeconds: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel">
        <h2>Cam kết và nhắc việc</h2>
        <p className="muted">
          Nexa chỉ đề xuất; cam kết chỉ được ghi sau khi bạn bấm Xác nhận trên bản xem trước.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.agentCommitmentToolsEnabled}
            onChange={(e) => update({ agentCommitmentToolsEnabled: e.target.checked })}
          />
          <span>
            Cho Nexa đề xuất tạo và cập nhật cam kết từ hội thoại
            <span className="muted small">
              {' '}
              — mặc định tắt. Bật rồi, Nexa vẫn không tự ghi, không đánh dấu hoàn thành và không xoá
              được cam kết nào.
            </span>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.commitmentContextEnabled}
            onChange={(e) => update({ commitmentContextEnabled: e.target.checked })}
          />
          <span>
            Cho Nexa biết bạn đang treo việc gì khi trả lời
            <span className="muted small">
              {' '}
              — gửi tên cam kết và bước tiếp theo tới model. Không áp dụng cho model của provider
              bên ngoài. Tắt đi thì cam kết vẫn hiện trong Mục tiêu và Hôm nay.
            </span>
          </span>
        </label>
      </section>

      <section className="panel">
        <h2>Thông báo hệ thống</h2>
        <p className="muted">
          Nhắc việc chỉ chạy khi Nexa đang mở — kể cả khi cửa sổ đang ẩn xuống khay hệ thống. Đóng
          Nexa là dừng hẳn: không có tiến trình nền nào nhắc thay.
        </p>
        {!props.notificationsSupported && (
          <p className="muted small" role="status">
            Hệ điều hành trên máy này không hỗ trợ thông báo, nên hai tuỳ chọn dưới đây bị vô hiệu
            hoá. Check-in vẫn hiện đầy đủ trên màn Hôm nay.
          </p>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.checkInOsNotificationsEnabled}
            disabled={!props.notificationsSupported}
            onChange={(e) => update({ checkInOsNotificationsEnabled: e.target.checked })}
          />
          <span>
            Gửi thông báo hệ thống khi có việc tới hạn
            <span className="muted small">
              {' '}
              — mặc định tắt, và cần bật cả nhắc việc ở trên. Nexa im lặng khi bạn đang mở sẵn cửa
              sổ. Chế độ Không làm phiền của hệ điều hành có thể chặn thông báo mà không báo lỗi,
              nên Hôm nay vẫn là nơi đầy đủ nhất.
            </span>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.notificationShowContent}
            disabled={
              !props.notificationsSupported || !props.settings.checkInOsNotificationsEnabled
            }
            onChange={(e) => update({ notificationShowContent: e.target.checked })}
          />
          <span>
            Cho thông báo nêu tên cam kết
            <span className="muted small">
              {' '}
              — mặc định tắt. <strong>Bật là chấp nhận tên việc hiện trên màn hình khoá</strong>,
              trong trung tâm thông báo của hệ điều hành, và trên một số cấu hình Windows còn được
              đồng bộ sang máy khác. Đó là vùng Nexa không mã hoá được. Tắt thì thông báo chỉ nói “2
              việc cần chú ý”.
            </span>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.minimizeToTrayEnabled}
            onChange={(e) => update({ minimizeToTrayEnabled: e.target.checked })}
          />
          <span>
            Thu nhỏ xuống khay hệ thống thay vì thanh taskbar
            <span className="muted small">
              {' '}
              — chỉ đổi hành vi khi bạn thu nhỏ. <strong>Đóng cửa sổ vẫn là thoát Nexa</strong>, và
              lúc đó không còn thông báo nào được gửi.
            </span>
          </span>
        </label>
      </section>

      <section className="panel">
        <h2>Bản tin công việc</h2>
        <p className="muted">
          Tổng hợp cam kết trong Nexa và việc được giao trên Jira lên đầu màn Hôm nay. Danh sách
          việc do máy tính ra, không do model quyết định. Chưa gồm lịch họp.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.dailyBriefingEnabled}
            onChange={(e) => update({ dailyBriefingEnabled: e.target.checked })}
          />
          <span>
            Hiện bản tin trên màn Hôm nay
            <span className="muted small">
              {' '}
              — đọc cam kết trên máy và gọi một truy vấn Jira chỉ đọc mỗi ngày. Không mở thêm quyền
              nào ngoài quyền Jira bạn đã cấp.
            </span>
          </span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.dailyBriefingSummaryEnabled}
            disabled={!props.settings.dailyBriefingEnabled}
            onChange={(e) => update({ dailyBriefingSummaryEnabled: e.target.checked })}
          />
          <span>
            Cho model viết một đoạn dẫn ngắn đầu bản tin
            <span className="muted small">
              {' '}
              — mặc định tắt. Đây là chỗ duy nhất nội dung công việc được gửi cho model, và không áp
              dụng với provider bên ngoài. Đoạn văn không thêm, bớt hay đổi hạn việc nào; tắt đi thì
              danh sách vẫn nguyên vẹn.
            </span>
          </span>
        </label>
      </section>

      <section className="panel">
        <h2>Công cụ Jira / Confluence</h2>
        <p className="muted">
          Mọi thao tác thay đổi dữ liệu đều hiển thị bản xem trước và cần bạn xác nhận, kể cả khi đã
          bật ở đây.
        </p>
        {featureRows.map((row) => {
          const locked = props.lockedFeatures.includes(row.key)
          return (
            <label key={row.key} className="checkbox">
              <input
                type="checkbox"
                checked={props.settings.features[row.key]}
                disabled={locked}
                onChange={(e) => update({ features: { [row.key]: e.target.checked } as never })}
              />
              <span>
                {row.label}
                {row.note !== undefined && <span className="muted small"> — {row.note}</span>}
                {locked && <span className="tag">bị khoá bởi chính sách tổ chức</span>}
              </span>
            </label>
          )
        })}
      </section>

      {/*
        Panel riêng, KHÔNG nằm trong danh sách cờ tool Jira/Confluence: cờ này mở một bề mặt sản
        phẩm (đích Nghiệp vụ + tool `nexa_ba_*`), không bật/tắt một nhóm tool Atlassian nào.
      */}
      <section className="panel">
        <h2>Không gian Nghiệp vụ (BA)</h2>
        <p className="muted">
          Kho tri thức nghiệp vụ đã xác nhận, tài liệu có cấu trúc và trang mã lỗi. Tri thức nghiệp
          vụ luôn ở lại trong tổ chức — không có tuỳ chọn gửi ra provider bên ngoài cho từng mục.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.settings.features.baWorkbench}
            disabled={baLocked}
            onChange={(e) => update({ features: { baWorkbench: e.target.checked } as never })}
          />
          <span>
            Bật không gian Nghiệp vụ
            {baLocked && <span className="tag">bị khoá bởi chính sách tổ chức</span>}
          </span>
        </label>
      </section>

      <section className="panel">
        <h2>Tài liệu và provider bên ngoài</h2>
        <p className="muted">
          Model chạy qua LiteLLM nội bộ được nhận tài liệu theo mặc định. Model của provider bên
          ngoài (OpenAI) thì <strong>không</strong> — phải được cho phép từng model một ở đây.
        </p>

        {externalModels.length === 0 ? (
          <p className="muted small">Chưa có model nào thuộc provider bên ngoài.</p>
        ) : (
          externalModels.map((model) => {
            const key = `${model.provider}:${model.modelId}`
            const allowed = props.settings.externalDocumentAllowedModels.includes(key)
            return (
              <label key={model.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...props.settings.externalDocumentAllowedModels, key]
                      : props.settings.externalDocumentAllowedModels.filter((k) => k !== key)
                    update({ externalDocumentAllowedModels: next })
                  }}
                />
                <span>
                  Cho phép gửi tài liệu tới <code>{model.modelId}</code>{' '}
                  <span className="external-tag">{PROVIDER_LABELS[model.provider]}</span>
                </span>
              </label>
            )
          })
        )}

        <p className="external-warning">
          ⚠ Bật một mục ở đây nghĩa là tài liệu nội bộ sẽ được gửi ra ngoài tổ chức, không qua
          LiteLLM, và không có usage log của tổ chức. Chỉ bật khi bộ phận an toàn thông tin đã cho
          phép.
        </p>
      </section>

      <section className="panel danger-zone">
        <h2>Xoá toàn bộ dữ liệu cục bộ</h2>
        <p className="muted">
          Xoá mọi hội thoại, cấu hình và thông tin đăng nhập đã lưu trên máy này. Không thể hoàn
          tác. Dữ liệu tại Jira, Confluence và log của LiteLLM không bị ảnh hưởng.
        </p>
        <label className="field">
          <span>
            Gõ chính xác <code>XOA TOAN BO DU LIEU</code> để xác nhận
          </span>
          <input
            className="input"
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-danger"
          disabled={purgeConfirm !== 'XOA TOAN BO DU LIEU'}
          onClick={() => {
            void (async () => {
              try {
                await api.data.purge(true)
                props.onToast({ kind: 'success', title: 'Đã xoá toàn bộ dữ liệu cục bộ.' })
                setPurgeConfirm('')
              } catch (error) {
                props.onError(error, 'Không xoá được dữ liệu.')
              }
            })()
          }}
        >
          Xoá tất cả
        </button>
      </section>
    </>
  )
}
