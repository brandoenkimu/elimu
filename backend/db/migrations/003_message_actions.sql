-- Replies, deleting messages, and emoji reactions.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES messages (id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by  uuid REFERENCES users (id);

-- A deleted message keeps its row (so replies and ordering still work) but loses its text.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_length;
ALTER TABLE messages ADD CONSTRAINT messages_body_length
  CHECK (deleted_at IS NOT NULL OR char_length(body) BETWEEN 1 AND 2000);

CREATE INDEX IF NOT EXISTS messages_reply_idx ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id uuid        NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON message_reactions (message_id);
