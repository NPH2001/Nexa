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
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0
