CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE transcriptions (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title             VARCHAR(255) NOT NULL,
    raw_text          TEXT         NOT NULL,
    corrected_text    TEXT,
    language          VARCHAR(16),
    duration_sec      DOUBLE PRECISION,
    source            VARCHAR(16)  NOT NULL,
    correction_status VARCHAR(16)  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_transcriptions_user_created ON transcriptions (user_id, created_at DESC);
