-- Test gratuito de 25 preguntas con variantes (catálogo FREE_25_V2_ES), anotaciones
-- (ANN_V1_ES) y resultado (RESULT_FREE_V1_ES). El catálogo es inmutable y vive en el
-- código (src/domain/free/catalog.js); aquí solo se guardan sesiones, respuestas,
-- eventos de anotación, claves de idempotencia y resultados.

CREATE TABLE ft_sessions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'es',
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  token_hash TEXT,
  currency TEXT,
  route TEXT,
  status TEXT NOT NULL CHECK (status IN ('en_curso', 'completada')),
  revision INTEGER NOT NULL DEFAULT 0,
  completed_revision INTEGER,
  annotation_version TEXT NOT NULL,
  issued_annotation_count INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_ft_sessions_user ON ft_sessions(user_id, status);
CREATE INDEX idx_ft_sessions_anon ON ft_sessions(anon_id, status);

CREATE TABLE ft_answers (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ft_sessions(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  value_json TEXT,
  response_status TEXT NOT NULL CHECK (response_status IN ('answered', 'unknown', 'declined')),
  context_hash TEXT NOT NULL,
  answer_revision INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  answered_at TEXT NOT NULL,
  deactivated_at TEXT
);
-- Una sola respuesta activa por sesión y slot; el historial inactivo se conserva.
CREATE UNIQUE INDEX ux_ft_answers_active ON ft_answers(session_id, slot_id) WHERE active = 1;
CREATE INDEX idx_ft_answers_session ON ft_answers(session_id, slot_id);

CREATE TABLE ft_annotation_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ft_sessions(id) ON DELETE CASCADE,
  annotation_version TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  after_slot TEXT NOT NULL,
  target_slot TEXT NOT NULL,
  answer_revision INTEGER NOT NULL,
  text_snapshot TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  invalidated_at TEXT,
  shown_at TEXT
);
CREATE INDEX idx_ft_events_session ON ft_annotation_events(session_id);

CREATE TABLE ft_idempotency (
  session_id TEXT NOT NULL REFERENCES ft_sessions(id) ON DELETE CASCADE,
  idem_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, idem_key)
);

CREATE TABLE ft_results (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ft_sessions(id) ON DELETE CASCADE,
  answer_revision INTEGER NOT NULL,
  rules_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  narrative_source TEXT NOT NULL CHECK (narrative_source IN ('ai', 'template')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, answer_revision, rules_version)
);
