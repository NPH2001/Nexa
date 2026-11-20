import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  ChatGptModel,
  Connection,
  ModelConfig,
  OrgPolicy,
} from '@nexa/shared-types/renderer'
import { api } from '../bridge.js'
import { MemoryPanel } from './MemoryPanel.js'
import { ThemeSwitch } from './ThemeSwitch.js'
import type { Toast } from './Toasts.js'
import {
  CONNECTION_STATUS_LABELS,
  SETTINGS_GROUPS,
  connectionStatusOf,
  nextSettingsTab,
  onboardingSteps,
  type SettingsTab as Tab,
} from './settings-groups-ui.js'
import { ChatGptAccountPanel } from './ChatGptAccountPanel.js'
import { ConnectionForm } from './ConnectionForm.js'
import { DataPanel } from './DataPanel.js'
import { DiagnosticsPanel } from './DiagnosticsPanel.js'
import { ModelsPanel } from './ModelsPanel.js'

export function SettingsView(props: {
  initialTab?: 'litellm' | 'memory' | 'data'
  /** Có model ChatGPT dùng được: khi đó không cần hướng dẫn kết nối AI lần đầu. */
  hasChatGptModels: boolean
  models: readonly ModelConfig[]
  settings: AppSettings | null
  policy: OrgPolicy | null
  onModelsChanged: (models: ModelConfig[]) => void
  onChatGptModelsChanged: (models: ChatGptModel[]) => void
  onSettingsChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
  onToast: (toast: Omit<Toast, 'id'>) => void
}): React.JSX.Element {
  const { onError, onSettingsChanged } = props
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'litellm')
  const [connections, setConnections] = useState<Connection[]>([])
  const [lockedFeatures, setLockedFeatures] = useState<string[]>([])
  // Mặc định `true` để chưa tải xong thì công tắc không nhấp nháy sang trạng thái "không hỗ
  // trợ" — một lời khẳng định sai về nền tảng còn tệ hơn một khoảnh khắc chưa biết.
  const [notificationsSupported, setNotificationsSupported] = useState(true)
  const openAiAllowed = props.policy?.allowDirectOpenAi === true

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [conns, settingsResult] = await Promise.all([
        api.connections.list(),
        api.settings.get(),
      ])
      setConnections(conns)
      setLockedFeatures(settingsResult.lockedFeatures)
      setNotificationsSupported(settingsResult.notificationsSupported)
      onSettingsChanged(settingsResult.settings)
    } catch (error) {
      onError(error, 'Không tải được cấu hình.')
    }
  }, [onError, onSettingsChanged])

  useEffect(() => {
    void reload()
  }, [reload])

  const moveTab = (current: Tab, key: string): boolean => {
    const next = nextSettingsTab(current, key)
    if (next === null) return false
    setTab(next)
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus())
    return true
  }

  const onboarding = onboardingSteps(connections, props.hasChatGptModels)

  return (
    <div className="settings">
      {/*
        Danh sách dọc theo nhóm. Vẫn là một tablist (không phải bốn): phím mũi tên đi liền qua
        mọi mục. Tiêu đề nhóm ẩn khỏi cây trợ năng để tablist chỉ chứa tab; tên nhóm được đọc
        kèm từng tab qua `aria-describedby`.
      */}
      <div
        className="settings-nav"
        role="tablist"
        aria-label="Nhóm cài đặt"
        aria-orientation="vertical"
      >
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.id} className="settings-nav-group">
            <span
              id={`settings-group-${group.id}`}
              className="settings-nav-heading"
              aria-hidden="true"
            >
              {group.label}
            </span>
            {group.tabs.map((t) => {
              const status = connectionStatusOf(t.id, connections)
              return (
                <button
                  key={t.id}
                  id={`settings-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`settings-panel-${t.id}`}
                  aria-describedby={`settings-group-${group.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={`tab ${tab === t.id ? 'active' : ''}`}
                  title={status === null ? undefined : CONNECTION_STATUS_LABELS[status]}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(event) => {
                    if (moveTab(t.id, event.key)) event.preventDefault()
                  }}
                >
                  {t.label}
                  {status !== null && (
                    <span className={`status-dot status-${status}`} aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div
        id={`settings-panel-${tab}`}
        className="settings-body"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
      >
        {onboarding !== null && (tab === 'litellm' || tab === 'openai') && (
          <section className="panel onboarding" aria-labelledby="onboarding-title">
            <h2 id="onboarding-title">Bắt đầu với Nexa</h2>
            <p className="muted">
              Nexa cần một nhà cung cấp AI trước khi trò chuyện được. Chỉ mất hai bước:
            </p>
            <ol className="onboarding-steps">
              <li className={onboarding.saved ? 'done' : 'current'}>
                <strong>Chọn nhà cung cấp AI và lưu.</strong>{' '}
                <span className="muted">
                  LiteLLM là cổng nội bộ của tổ chức (nên dùng). OpenAI gửi dữ liệu ra ngoài tổ
                  chức.
                </span>
              </li>
              <li className={onboarding.saved ? 'current' : ''}>
                <strong>Bấm “Kiểm tra kết nối”.</strong>{' '}
                <span className="muted">
                  Lưu chỉ ghi cấu hình vào máy; kiểm tra mới gọi tới server thật.
                </span>
              </li>
            </ol>
          </section>
        )}
        {tab === 'litellm' && (
          <ConnectionForm
            type="litellm"
            title="Kết nối LiteLLM"
            description="Endpoint và API key do quản trị LiteLLM cấp cho bạn. Key được lưu bằng kho bảo mật của Windows và không bao giờ hiển thị lại."
            urlLabel="Endpoint (https://…)"
            secretLabel="API key"
            requiresUsername={false}
            connection={connections.find((c) => c.type === 'litellm') ?? null}
            onChanged={reload}
            onRemoved={() =>
              setConnections((current) => current.filter((c) => c.type !== 'litellm'))
            }
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'openai' && (
          <>
            <ChatGptAccountPanel
              disabledReason={
                openAiAllowed
                  ? undefined
                  : 'Đăng nhập ChatGPT đã bị chính sách của tổ chức vô hiệu hoá. Bạn vẫn có thể đăng xuất một phiên cũ khỏi máy.'
              }
              onModelsChanged={props.onChatGptModelsChanged}
              onError={props.onError}
              onToast={props.onToast}
            />
            <ConnectionForm
              type="openai"
              title="Kết nối bằng OpenAI API key"
              description="Cấu hình này tách biệt với tài khoản ChatGPT ở trên. Nexa gọi TRỰC TIẾP api.openai.com và usage được tính theo tài khoản API, không dùng quyền lợi ChatGPT Plus."
              urlLabel="Endpoint"
              secretLabel="OpenAI API key"
              requiresUsername={false}
              defaultBaseUrl="https://api.openai.com"
              externalWarning="Đây là dịch vụ bên ngoài tổ chức. Không dán dữ liệu nhạy cảm vào hội thoại dùng model OpenAI, và việc đính kèm tài liệu bị CHẶN theo mặc định."
              disabledReason={
                openAiAllowed
                  ? undefined
                  : 'Kết nối OpenAI trực tiếp đã bị chính sách của tổ chức vô hiệu hoá. Bạn vẫn có thể xoá cấu hình cũ khỏi máy.'
              }
              connection={connections.find((c) => c.type === 'openai') ?? null}
              onChanged={reload}
              onRemoved={() =>
                setConnections((current) => current.filter((c) => c.type !== 'openai'))
              }
              onError={props.onError}
              onToast={props.onToast}
            />
          </>
        )}

        {tab === 'jira' && (
          <ConnectionForm
            type="jira"
            title="Kết nối Jira"
            description="Nexa gọi Jira bằng chính tài khoản và Personal Access Token của bạn. Quyền thao tác đúng bằng quyền tài khoản bạn."
            urlLabel="Jira URL (https://…)"
            secretLabel="Personal Access Token"
            requiresUsername
            connection={connections.find((c) => c.type === 'jira') ?? null}
            onChanged={reload}
            onRemoved={() => setConnections((current) => current.filter((c) => c.type !== 'jira'))}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'confluence' && (
          <ConnectionForm
            type="confluence"
            title="Kết nối Confluence"
            description="Cấu hình tách biệt với Jira. Nếu tổ chức dùng chung một tài khoản, hãy nhập lại cùng giá trị."
            urlLabel="Confluence URL (https://…)"
            secretLabel="Personal Access Token"
            requiresUsername
            connection={connections.find((c) => c.type === 'confluence') ?? null}
            onChanged={reload}
            onRemoved={() =>
              setConnections((current) => current.filter((c) => c.type !== 'confluence'))
            }
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'mcpGateway' && (
          <>
            <ConnectionForm
              type="mcpGateway"
              title="MCP Gateway (Jira/Confluence qua HTTP remote)"
              description="Chỉ cấu hình mục này nếu tổ chức bạn KHÔNG chạy mcp-atlassian cục bộ mà cung cấp một gateway HTTP có sẵn (ví dụ MCP gateway của LiteLLM). Khi bật, Nexa gọi thẳng gateway này thay vì tự khởi chạy tiến trình mcp-atlassian trên máy — URL Jira/Confluence và Personal Access Token vẫn nhập ở hai tab Jira/Confluence như bình thường."
              urlLabel="Gateway URL (https://…)"
              secretLabel="Bearer token"
              requiresUsername={false}
              connection={connections.find((c) => c.type === 'mcpGateway') ?? null}
              onChanged={reload}
              onRemoved={() =>
                setConnections((current) => current.filter((c) => c.type !== 'mcpGateway'))
              }
              onError={props.onError}
              onToast={props.onToast}
            />
            {props.settings !== null && (
              <GatewayTlsPanel
                settings={props.settings}
                onChanged={props.onSettingsChanged}
                onError={props.onError}
              />
            )}
          </>
        )}

        {tab === 'redmine' && (
          <>
            {(() => {
              const gateway = connections.find((c) => c.type === 'mcpGateway')
              const gatewayReady =
                gateway !== undefined && gateway.enabled && gateway.hasCredential
              return gatewayReady ? null : (
                <p className="external-warning" role="note">
                  ⚠ Redmine đi qua MCP Gateway của tổ chức, nhưng MCP Gateway chưa được bật hoặc
                  chưa có bearer token.{' '}
                  <button type="button" className="btn" onClick={() => setTab('mcpGateway')}>
                    Mở cài đặt MCP Gateway
                  </button>
                </p>
              )
            })()}
            <ConnectionForm
              type="redmine"
              title="Kết nối Redmine"
              description="Nexa gọi Redmine qua MCP Gateway (dùng chung URL và bearer token ở tab MCP Gateway), bằng API key của chính bạn — quyền thao tác đúng bằng quyền tài khoản Redmine của bạn. Lấy API key ở Redmine → Tài khoản của tôi → API access key. Mọi thao tác ghi đều phải qua bước xem trước và xác nhận; Nexa không xoá được gì trên Redmine."
              urlLabel="Redmine URL (https://…) — dùng để mở link issue"
              secretLabel="Redmine API key"
              requiresUsername={false}
              connection={connections.find((c) => c.type === 'redmine') ?? null}
              onChanged={reload}
              onRemoved={() =>
                setConnections((current) => current.filter((c) => c.type !== 'redmine'))
              }
              onError={props.onError}
              onToast={props.onToast}
            />
          </>
        )}

        {tab === 'xwiki' && (
          <ConnectionForm
            type="xwiki"
            title="Kết nối XWiki"
            description="Nexa gọi thẳng endpoint MCP của XWiki bằng token của bạn. Ghi hoặc sửa trang luôn phải qua bước xem trước và xác nhận; Nexa khoá theo phiên bản trang, nên nếu ai đó sửa trang trong lúc bạn đang xem trước, XWiki sẽ từ chối thay vì ghi đè."
            urlLabel="Endpoint MCP của XWiki (https://…/rest/wikis/xwiki/…/mcp)"
            secretLabel="Bearer token XWiki"
            requiresUsername={false}
            connection={connections.find((c) => c.type === 'xwiki') ?? null}
            onChanged={reload}
            onRemoved={() => setConnections((current) => current.filter((c) => c.type !== 'xwiki'))}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'models' && (
          <ModelsPanel
            models={props.models}
            allowDirectOpenAi={openAiAllowed}
            onChanged={props.onModelsChanged}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'memory' && <MemoryPanel onError={props.onError} onToast={props.onToast} />}

        {tab === 'data' && props.settings !== null && (
          <DataPanel
            settings={props.settings}
            models={props.models}
            lockedFeatures={lockedFeatures}
            notificationsSupported={notificationsSupported}
            onChanged={props.onSettingsChanged}
            onError={props.onError}
            onToast={props.onToast}
          />
        )}

        {tab === 'appearance' && props.settings !== null && (
          <AppearancePanel
            settings={props.settings}
            onChanged={props.onSettingsChanged}
            onError={props.onError}
          />
        )}

        {tab === 'about' && <DiagnosticsPanel onError={props.onError} onToast={props.onToast} />}
      </div>
    </div>
  )
}

// ── MCP Gateway: xác thực TLS chặng gateway → Jira/Confluence ─────────────

/**
 * Ô tích duy nhất bật được `mcpGatewaySkipAtlassianTlsVerify` (ADR-0008).
 *
 * Đặt ở tab MCP Gateway chứ không ở tab "Dữ liệu & quyền riêng tư" cùng các feature flag khác:
 * đây không phải một tuỳ chọn về quyền riêng tư mà là một thuộc tính của chính transport gateway,
 * và người đi tìm nó sẽ tìm ở đúng chỗ họ vừa nhập URL gateway.
 *
 * Nội dung cảnh báo cố ý nói rõ ba điều — chặng nào bị ảnh hưởng, chặng nào KHÔNG, và cách sửa
 * đúng — để người bật biết mình đang đánh đổi cái gì, thay vì chỉ thấy một chữ "không an toàn".
 */
function GatewayTlsPanel(props: {
  settings: AppSettings
  onChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const skipping = props.settings.mcpGatewaySkipAtlassianTlsVerify

  const toggle = (checked: boolean): void => {
    void (async () => {
      try {
        props.onChanged(await api.settings.update({ mcpGatewaySkipAtlassianTlsVerify: checked }))
      } catch (error) {
        props.onError(error, 'Không lưu được cài đặt.')
      }
    })()
  }

  return (
    <section className="panel">
      <h2>Xác thực chứng chỉ TLS</h2>
      <p className="muted">
        Nexa gọi gateway luôn bằng HTTPS có xác thực chứng chỉ, và điều đó không tắt được. Tuỳ chọn
        dưới đây chỉ áp dụng cho chặng tiếp theo: từ gateway tới Jira/Confluence.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={skipping} onChange={(e) => toggle(e.target.checked)} />
        <span>
          Bỏ qua xác thực chứng chỉ ở chặng gateway → Jira/Confluence
          <span className="muted small"> — mặc định tắt</span>
        </span>
      </label>
      <p className="muted small">
        Chỉ bật nếu Jira/Confluence của tổ chức dùng chứng chỉ do CA nội bộ ký mà gateway chưa tin
        cậy. Dấu hiệu: mọi công cụ Jira/Confluence đều báo lỗi đăng nhập dù PAT còn hiệu lực.
      </p>
      {skipping && (
        <p className="warning-inline">
          Đang bật. Trên chặng gateway → Jira/Confluence, Nexa không còn kiểm tra chứng chỉ, nên một
          máy chen giữa trong mạng nội bộ có thể đọc được Personal Access Token của bạn. Cách sửa
          đúng là để đội hạ tầng cài CA nội bộ vào gateway rồi tắt tuỳ chọn này.
        </p>
      )}
    </section>
  )
}

// ── Giao diện ─────────────────────────────────────────────────────────────

function AppearancePanel(props: {
  settings: AppSettings
  onChanged: (settings: AppSettings) => void
  onError: (error: unknown, fallback: string) => void
}): React.JSX.Element {
  const { onChanged, onError } = props
  return (
    <section className="panel">
      <h2>Màu giao diện</h2>
      <p className="muted">
        “Theo hệ thống” dùng cài đặt sáng/tối của Windows và tự đổi theo khi Windows đổi. Lựa chọn
        này chỉ áp dụng cho Nexa trên máy này.
      </p>
      <ThemeSwitch
        value={props.settings.theme}
        onChange={(theme) => {
          if (theme === props.settings.theme) return
          void (async () => {
            try {
              onChanged(await api.settings.update({ theme }))
            } catch (error) {
              onError(error, 'Không lưu được màu giao diện.')
            }
          })()
        }}
      />
    </section>
  )
}
