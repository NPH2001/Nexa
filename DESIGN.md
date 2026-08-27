# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-27
- Primary product surfaces: desktop Home/Today, Chat, Memory, Goals/Commitments, Agent Activity, Settings and confirmation flows.
- Evidence reviewed: `README.md`, `docs/design-doc-v1.1.md`, `docs/OPEN-QUESTIONS.md`, `docs/security/threat-model.md`, `docs/operations/pre-pilot-checklist.md`, `openspec/changes/add-memory/*`, Electron renderer components, `styles.css`, Playwright E2E tests and architecture ADRs.
- Visual evidence: no screenshots, Figma files, Storybook stories or visual-regression baselines are checked into the repository; the current implementation is the visual baseline.

## Brand

- Personality: a quiet, capable and discreet companion for focused work. Warm without pretending to be human; direct without sounding mechanical.
- Trust signals: visible data destination, explicit memory scope, inspectable activity, honest uncertainty, reversible choices and precise confirmation before side effects.
- Avoid: mascot-led personality, performative intimacy, emotional dependency, surveillance language, hidden background work, opaque confidence scores, decorative AI gradients and admin-console density in everyday flows.

## Product goals

- Goals: help users resume work quickly, retain useful context with consent, convert conversations into progress, suggest timely next steps and act only within explicit authority.
- Non-goals: therapy or crisis care, covert monitoring, autonomous destructive actions, screen control, automatic memory extraction, cross-device memory sync and a broad connector marketplace in companion v1.
- Success signals: first useful outcome within three minutes; a returning user can resume an active goal in one click; every stored memory is inspectable/editable/deletable; no unconfirmed memory writes; no side effect without a valid approval; proactive suggestions can always be dismissed, snoozed or disabled.

## Personas and jobs

- Primary personas: Vietnamese knowledge workers who use documents, Jira and Confluence and want continuity across focused work sessions.
- Secondary personas: security, IT and operations staff who need clear policy, diagnostics and data-boundary evidence.
- User jobs: capture context, understand information, continue an unfinished outcome, prepare or perform a bounded action, remember stable preferences and recover safely when a tool result is uncertain.
- Key contexts of use: focused desktop work, short return visits between meetings, document review, project follow-up and incident/error recovery.

## Information architecture

- Primary navigation target: Today, Conversations, Goals, Memory, Activity and Settings. Ship incrementally; do not expose an empty destination before its core flow works.
- Core routes/screens: Home/Today resume surface; conversation workspace; goal/commitment detail; memory ledger; agent activity timeline; connections/models/data settings.
- Content hierarchy: current focus and next action first, supporting context second, technical model/tool details on demand, diagnostics last.
- Current implementation note: the app exposes Today, Chat and Settings. Memory v1 lives inside Settings. Commitment Engine v1 adds Goals as a first-class destination. Proactive Check-in + Agent Activity add an opt-in, in-app-only suggestion loop and the first-class Activity destination; neither surface may imply that Nexa remains active after its process exits.

## Design principles

- Remember with permission: Nexa never silently persists a personal fact. Memory shows source, scope, sharing policy and last confirmation.
- Suggest with a reason: proactive cards say why they appear now and provide Do, Later and Do not ask again controls.
- Act within a boundary: read, suggest and act are distinct agency levels. Existing approval, payload binding and uncertain-result behavior remain invariant.
- Continuity over chatter: optimize for resuming goals and commitments, not conversation count or message volume.
- Legibility over magic: expose what Nexa knows, what it is doing, where data goes and what remains uncertain.
- Tradeoffs: accept small consent friction and bounded context use in exchange for privacy, correction and long-term trust.

## Visual language

- Color: retain semantic success/warning/danger colors and a restrained neutral base. Accent color marks selection and primary action, not decoration. Light/dark theming is a future decision; current dark mode remains supported.
- Typography: use a Windows-native, highly legible hierarchy initially (`Segoe UI Variable` with safe fallbacks); avoid a new font dependency until brand assets are approved.
- Spacing/layout rhythm: 4 px base rhythm, compact desktop workbench, generous separation between context, action and audit information.
- Shape/radius/elevation: 6–8 px radii, borders before shadows, no cards nested inside cards. Use panels only for real tools, repeated records and modals.
- Motion: short state transitions that explain progress; respect reduced motion; no ambient or decorative motion.
- Imagery/iconography: familiar platform or existing icon-set symbols with tooltips. No decorative illustration is required for the workbench.

## Components

- Existing components to reuse: Sidebar, ChatView, Settings tabs/panels, ConfirmationDialog, DestructiveActionDialog, UncertainBanner, Toasts and semantic form/button styles.
- New/changed components: MemoryPanel, TodayView and GoalPanel are implemented. ProactiveCheckInService, TodayCheckInCard and AgentActivityTimeline are the next implementation slice; WorkingMemoryStrip remains a later phase.
- GoalPanel contract: commitments are user-created records with a concise outcome, one next action, lifecycle status, optional due/check-in time and optional source conversation. Nexa never promotes a memory fact or chat statement into a commitment without explicit confirmation.
- Commitment lifecycle: `active`, `blocked`, `paused` and `completed`. Completing is reversible; permanent deletion remains a separate destructive action with confirmation.
- Today ordering: overdue check-ins and due dates first, then active work by recency. Every surfaced commitment explains urgency through its status/date instead of an opaque score.
- Proactive check-in contract: global opt-in is off by default. While the app process is alive, due/check-in timestamps may create one idempotent suggestion per commitment. Do/Later/Dismiss/Do not remind again only mutate local suggestion state; Do opens the source conversation or Goals and never sends a message, edits a commitment or runs a tool.
- Activity timeline contract: user-visible events are append-only structured metadata for suggestion, memory mutation, commitment mutation, tool preview, confirmation, tool result and uncertain operation. Timeline rows contain enums, timestamps and identifiers only; no raw payload, memory content, commitment next action, target URL or secret is stored for the timeline.
- Variants and states: every data component covers loading, empty, error, success, disabled and policy-locked states; commitments additionally cover active, blocked, paused, completed, overdue and due-soon; memory additionally covers active, archived, internal-only, external-allowed and expired.
- Token/component ownership: CSS variables in `apps/desktop/src/renderer/styles.css` own visual tokens; shared domain/IPC types own state vocabulary; renderer components must not invent parallel status strings.

## Accessibility

- Target standard: WCAG 2.2 AA for renderer surfaces.
- Keyboard/focus behavior: all flows complete without a pointer; tabs use arrow/Home/End navigation; dialogs trap and restore focus; destructive and external-sharing choices require an explicit control.
- Contrast/readability: semantic state is never color-only; long content wraps; technical identifiers remain selectable and use monospace only where useful.
- Screen-reader semantics: meaningful headings, labels, live regions for async status and explicit descriptions for scope, sharing and irreversible actions.
- Reduced motion and sensory considerations: honor `prefers-reduced-motion`; avoid flashing, pulsing status and surprise audio.

## Responsive behavior

- Supported breakpoints/devices: Windows desktop first; application window from 520 x 520 through wide desktop, with 1280 x 860 as the default.
- Layout adaptations: below 760 px collapse multi-column surfaces and allow horizontal settings tabs; below 620 px stack navigation and content while keeping primary actions visible.
- Touch/hover differences: hover may reveal secondary actions on desktop, but the same controls must remain keyboard reachable and visible on touch-sized layouts.

## Interaction states

- Loading: show the object being loaded and keep unrelated navigation usable.
- Empty: explain the user outcome and offer one primary next action; avoid generic “start typing” copy when a contextual action is available.
- Error: preserve user input, show a plain-language cause, request/operation identifier when useful and one recovery action.
- Success: confirm the resulting state or object, not merely that a request completed.
- Disabled: explain the prerequisite or policy owner; do not silently disable.
- Offline/slow network: distinguish local availability from provider/MCP availability; memory management and local history remain usable.
- Background boundary: check-in scheduling only runs while the Nexa process is alive and opt-in is enabled. Closing the app on Windows/Linux stops it; notification OS/background delivery is future work and must not be implied in copy.

## Content voice

- Tone: natural Vietnamese, calm, concise and respectful. Lead with the outcome.
- Terminology: use `Nexa nhớ`, `gợi ý`, `hành động`, `chờ bạn xác nhận`, `chỉ dùng nội bộ` and `cho phép gửi ra ngoài tổ chức`; avoid anthropomorphic claims such as feelings or consciousness.
- Microcopy rules: name the destination and consequence before consent; uncertainty is explicit; buttons use concrete verbs; do not imply that archived memory is deleted.

## Implementation constraints

- Framework/styling system: Electron, React and repository-native CSS; no new UI or state dependency without an explicit decision.
- Design-token constraints: extend the existing CSS variables and semantic classes; do not introduce a second token system.
- Performance constraints: preserve the existing startup and memory budgets; local memory retrieval is bounded and must not trigger an additional LLM call.
- Compatibility constraints: renderer remains untrusted, has no direct network/filesystem/secret access, and all inputs cross validated IPC.
- Privacy constraints: memory is encrypted at rest, manually confirmed, bounded in context, scoped to a conversation or globally, and internal-only by default. External-provider sharing is explicit per fact and filtered again immediately before model invocation.
- Activity/check-in constraints: global preference stays in encrypted profile settings; check-in operational rows contain no duplicated sensitive content; all timeline/check-in IPC is bound to the current profile in main. Existing confirmation, payload binding, tool authorization and uncertain-operation recovery remain unchanged.
- Test/screenshot expectations: targeted unit/integration tests, full `pnpm verify`, Electron E2E for critical memory flows, and Playwright screenshots at default and narrow desktop widths for major new surfaces.

## Open questions

- [ ] Product owner: should Memory become first-class navigation after v1, or remain inside Settings now that Today/Goals are available? Impact: information architecture and frequency of review.
- [ ] Security owner: should organization policy be able to disable external sharing for all memory facts? Impact: policy schema and enterprise rollout.
- [ ] Product owner: which Calendar and Tasks connector should companion v2 support first? Impact: Today/proactivity implementation.
- [ ] Design owner: approve a light-mode palette and branded type/icon direction before the larger visual refresh. Impact: visual identity, not memory correctness.
- [ ] Operations owner: define opt-in product metrics that do not collect conversation or memory content. Impact: ability to measure companion usefulness without weakening local-first privacy.
