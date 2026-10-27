-- CampusConnect schema. PostgreSQL 13 or newer (uses built-in gen_random_uuid()).
-- Safe to run more than once. Apply with:  npm run db:init

CREATE TABLE IF NOT EXISTS users (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(254) NOT NULL,
  display_name  varchar(80)  NOT NULL,
  password_hash text         NOT NULL,
  role          varchar(16)  NOT NULL DEFAULT 'student',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_role_valid      CHECK (role IN ('student', 'lecturer'))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- Refresh tokens are stored hashed (SHA-256). A "family" is the chain of tokens
-- produced by rotating one login session; reuse of an old token revokes the family.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  token_hash  char(64)    NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_key   ON refresh_tokens (token_hash);
CREATE INDEX        IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX        IF NOT EXISTS refresh_tokens_user_idx   ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(80)  NOT NULL,
  description  varchar(300) NOT NULL DEFAULT '',
  invite_code  varchar(11)  NOT NULL,
  created_by   uuid         NOT NULL REFERENCES users (id),
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_invite_key ON conversations (invite_code);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            varchar(16) NOT NULL DEFAULT 'member',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT members_role_valid CHECK (role IN ('owner', 'member'))
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members (user_id);

-- seq is a database-assigned, strictly increasing number. Clients remember the
-- highest seq they have seen per conversation and ask for "everything after it"
-- when they reconnect.
-- (conversation_id, ...) is intentionally not part of the uniqueness rule for
-- client_message_id: the pair (sender_id, client_message_id) is what makes a
-- retried send idempotent.
CREATE TABLE IF NOT EXISTS messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigint      GENERATED ALWAYS AS IDENTITY,
  conversation_id   uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id         uuid        NOT NULL REFERENCES users (id),
  client_message_id uuid        NOT NULL,
  body              text        NOT NULL,
  origin_node       varchar(16) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_body_length CHECK (char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT messages_sender_client_key UNIQUE (sender_id, client_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_seq_key          ON messages (seq);
CREATE INDEX        IF NOT EXISTS messages_conversation_seq ON messages (conversation_id, seq DESC);
