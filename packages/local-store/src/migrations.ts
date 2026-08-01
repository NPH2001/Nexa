/**
 * Migration có version và rollback strategy (§13.1).
 *
 * Quy tắc bất di bất dịch:
 *  - Migration đã phát hành thì KHÔNG được sửa. Muốn đổi thì thêm bản mới.
 *  - Mỗi migration chạy trong một transaction; lỗi ⇒ rollback nguyên vẹn (§22.1 "SQLite/khóa
 *    bị hỏng → Migration an toàn").
 *  - `down` chỉ dùng khi người dùng cài lại bản cũ hơn. Nó có thể MẤT DỮ LIỆU, nên
 *    `MigrationRunner` không bao giờ tự chạy — phải gọi tay từ công cụ chẩn đoán.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: string
  readonly down: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: `
      -- §8.1: một profile theo tài khoản OS. Tài liệu gọi là windows_sid;
      -- đổi tên để chạy được trên máy dev không phải Windows (OPEN-QUESTIONS B5).
      CREATE TABLE profiles (
        id             TEXT PRIMARY KEY,
        os_account_id  TEXT NOT NULL UNIQUE,
        display_name   TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE conversations (
        id                TEXT PRIMARY KEY,
        profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title_ciphertext  TEXT NOT NULL,
        model_id          TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        archived_at       TEXT
      );
      CREATE INDEX idx_conversations_profile_updated
        ON conversations(profile_id, archived_at, updated_at DESC);

      -- seq là thứ tự tuyệt đối trong hội thoại. created_at không đủ: hai message có thể
      -- rơi vào cùng một mili-giây khi tool chạy nhanh.
      CREATE TABLE messages (
        id                        TEXT PRIMARY KEY,
        conversation_id           TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq                       INTEGER NOT NULL,
        role                      TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
        content_ciphertext        TEXT NOT NULL,
        status                    TEXT NOT NULL,
        error_code                TEXT,
        request_id                TEXT,
        truncated_context_count   INTEGER NOT NULL DEFAULT 0,
        created_at                TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_messages_conv_seq ON messages(conversation_id, seq);
      CREATE INDEX idx_messages_created ON messages(created_at);

      -- §8.1: KHÔNG lưu bản sao file. file_name cũng mã hoá vì tên file thường lộ nội dung
      -- ("BaoCao_Luong_T7.xlsx").
      CREATE TABLE attachments (
        id                        TEXT PRIMARY KEY,
        message_id                TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        file_name_ciphertext      TEXT NOT NULL,
        file_type                 TEXT NOT NULL,
        file_size                 INTEGER NOT NULL,
        source_path_hash          TEXT NOT NULL,
        extracted_text_ciphertext TEXT,
        extracted_chars           INTEGER NOT NULL DEFAULT 0,
        page_count                INTEGER,
        suspected_scan            INTEGER NOT NULL DEFAULT 0,
        created_at                TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_message ON attachments(message_id);

      -- §8.1 tool_calls: theo dõi lifecycle tool. §10.3: operation_id + payload_hash.
      CREATE TABLE tool_calls (
        id                        TEXT PRIMARY KEY,
        message_id                TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        tool_name                 TEXT NOT NULL,
        risk_level                TEXT NOT NULL,
        preview_ciphertext        TEXT,
        approval_status           TEXT NOT NULL,
        operation_status          TEXT NOT NULL,
        result_summary_ciphertext TEXT,
        operation_id              TEXT,
        payload_hash              TEXT,
        target_key                TEXT,
        target_url                TEXT,
        error_code                TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL
      );
      CREATE INDEX idx_tool_calls_message ON tool_calls(message_id);
      -- Một operation_id chỉ được tồn tại một lần: đây là chốt chặn cuối cùng chống
      -- double-submit ở tầng dữ liệu (§17.2 kịch bản 4).
      CREATE UNIQUE INDEX idx_tool_calls_operation ON tool_calls(operation_id)
        WHERE operation_id IS NOT NULL;

      -- §8.1 connections: metadata thôi, KHÔNG chứa API key/PAT dạng rõ.
      CREATE TABLE connections (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type           TEXT NOT NULL CHECK (type IN ('litellm','jira','confluence')),
        base_url       TEXT NOT NULL,
        username       TEXT,
        enabled        INTEGER NOT NULL DEFAULT 1,
        last_test_json TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_connections_profile_type ON connections(profile_id, type);

      -- §8.1 credential_refs: CHỈ tham chiếu tới secure storage, không phải giá trị.
      CREATE TABLE credential_refs (
        connection_id      TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        secret_kind        TEXT NOT NULL,
        secure_storage_key TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        PRIMARY KEY (connection_id, secret_kind)
      );

      CREATE TABLE models (
        id                    TEXT PRIMARY KEY,
        profile_id            TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        model_id              TEXT NOT NULL,
        display_name          TEXT NOT NULL,
        is_default            INTEGER NOT NULL DEFAULT 0,
        verified              INTEGER NOT NULL DEFAULT 0,
        context_window_tokens INTEGER NOT NULL DEFAULT 128000,
        created_at            TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_models_profile_model ON models(profile_id, model_id);

      -- §8.1 settings: "cấu hình cá nhân không phải secret" — vẫn mã hoá vì nó chứa
      -- danh sách model và allowlist, đủ để suy ra hạ tầng nội bộ.
      CREATE TABLE settings (
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        key              TEXT NOT NULL,
        value_ciphertext TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (profile_id, key)
      );

      -- §8.1 local_audit: "Không ghi key, PAT, prompt hoặc payload nghiệp vụ đầy đủ."
      -- Vì thế bảng này chỉ có cột định danh và trạng thái — cố ý không có cột free text.
      CREATE TABLE local_audit (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        event_type   TEXT NOT NULL,
        request_id   TEXT,
        operation_id TEXT,
        status       TEXT NOT NULL,
        error_code   TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_local_audit_created ON local_audit(created_at DESC);
      CREATE INDEX idx_local_audit_operation ON local_audit(operation_id);
    `,
    down: `
      DROP TABLE IF EXISTS local_audit;
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS models;
      DROP TABLE IF EXISTS credential_refs;
      DROP TABLE IF EXISTS connections;
      DROP TABLE IF EXISTS tool_calls;
      DROP TABLE IF EXISTS attachments;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS profiles;
    `,
  },

  {
    version: 2,
    name: 'llm-provider-per-model',
    /**
     * Thêm provider cho model và cho hội thoại, và mở CHECK constraint của `connections`.
     *
     * Trước v2, mọi model đều đi qua LiteLLM nên không cần ghi provider. Từ khi có kết nối
     * OpenAI trực tiếp (OPEN-QUESTIONS F1), cùng một `model_id` có thể tồn tại ở hai provider,
     * và một hội thoại mở lại phải biết gửi đi đâu.
     *
     * Phần khó nằm ở `connections`: v1 đặt `CHECK (type IN ('litellm','jira','confluence'))`,
     * và SQLite KHÔNG cho sửa CHECK bằng ALTER TABLE. Phải dựng lại bảng.
     *
     * Khi dựng lại, thứ tự DROP là quan trọng: `credential_refs` tham chiếu `connections(id)`
     * với ON DELETE CASCADE, nên `DROP TABLE connections` khi bật `foreign_keys` sẽ XOÁ SẠCH
     * credential_refs. Vì vậy phải sao lưu cả hai bảng và drop bảng con TRƯỚC.
     *
     * Mất `credential_refs` không làm mất secret (secret nằm trong secure storage), nhưng nó
     * làm mọi kết nối hiện ra là "chưa có credential" và người dùng phải nhập lại toàn bộ
     * API key và PAT. Đó là lý do đoạn này viết dài dòng thay vì gọn.
     *
     * Backfill 'litellm' cho dữ liệu cũ: đó là provider duy nhất tồn tại trước v2, nên đây là
     * suy luận chắc chắn đúng, không phải phỏng đoán.
     */
    up: `
      -- ── models: thêm provider ───────────────────────────────────────────
      ALTER TABLE models ADD COLUMN provider TEXT NOT NULL DEFAULT 'litellm';
      ALTER TABLE conversations ADD COLUMN model_provider TEXT;

      -- Hội thoại đã có model thì model đó chắc chắn là của LiteLLM.
      UPDATE conversations SET model_provider = 'litellm' WHERE model_id IS NOT NULL;

      -- Khoá duy nhất phải gồm provider: 'gpt-4o' qua LiteLLM và 'gpt-4o' qua OpenAI là hai
      -- lựa chọn khác nhau, với đường đi dữ liệu khác nhau.
      DROP INDEX IF EXISTS idx_models_profile_model;
      CREATE UNIQUE INDEX idx_models_profile_provider_model
        ON models(profile_id, provider, model_id);

      -- ── connections: dựng lại để mở CHECK constraint ────────────────────
      CREATE TABLE _mig2_connections AS SELECT * FROM connections;
      CREATE TABLE _mig2_credential_refs AS SELECT * FROM credential_refs;

      -- Drop bảng CON trước để không kích hoạt ON DELETE CASCADE.
      DROP TABLE credential_refs;
      DROP TABLE connections;

      CREATE TABLE connections (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type           TEXT NOT NULL CHECK (type IN ('litellm','openai','jira','confluence')),
        base_url       TEXT NOT NULL,
        username       TEXT,
        enabled        INTEGER NOT NULL DEFAULT 1,
        last_test_json TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_connections_profile_type ON connections(profile_id, type);

      CREATE TABLE credential_refs (
        connection_id      TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        secret_kind        TEXT NOT NULL,
        secure_storage_key TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        PRIMARY KEY (connection_id, secret_kind)
      );

      INSERT INTO connections
        (id, profile_id, type, base_url, username, enabled, last_test_json, created_at, updated_at)
        SELECT id, profile_id, type, base_url, username, enabled, last_test_json, created_at, updated_at
        FROM _mig2_connections;

      INSERT INTO credential_refs (connection_id, secret_kind, secure_storage_key, created_at)
        SELECT connection_id, secret_kind, secure_storage_key, created_at
        FROM _mig2_credential_refs;

      DROP TABLE _mig2_connections;
      DROP TABLE _mig2_credential_refs;
    `,
    /**
     * Quay về v1 sẽ MẤT thông tin provider. Nếu còn model nào thuộc provider ngoài, việc dựng
     * lại unique index cũ sẽ thất bại và transaction rollback — đúng ý đồ: mất thông tin
     * provider là mất khả năng biết dữ liệu đã đi đâu.
     */
    down: `
      DELETE FROM connections WHERE type = 'openai';

      DROP INDEX IF EXISTS idx_models_profile_provider_model;
      CREATE UNIQUE INDEX idx_models_profile_model ON models(profile_id, model_id);
      ALTER TABLE models DROP COLUMN provider;
      ALTER TABLE conversations DROP COLUMN model_provider;
    `,
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

