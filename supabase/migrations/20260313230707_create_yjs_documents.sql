-- Y.js document state: binary CRDT state for real-time collaboration
CREATE TABLE yjs_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id          TEXT UNIQUE NOT NULL,
  state             BYTEA,
  state_vector      BYTEA,
  version           INTEGER NOT NULL DEFAULT 0,
  last_modified_by  TEXT,
  connected_clients INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER yjs_documents_updated_at
  BEFORE UPDATE ON yjs_documents
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
