-- PROPUESTA de migración para el Coach v2. No está aplicada al proyecto.
-- Probada contra las migraciones 001 a 004 con node:sqlite (ver herramientas/probar-migracion.js).

-- 1) Movimientos: subcategoría, nota normalizada y borrado suave (para «Deshacer» y «Editar» sin perder datos)
ALTER TABLE movements ADD COLUMN subcategory TEXT;
ALTER TABLE movements ADD COLUMN note_norm TEXT;
ALTER TABLE movements ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_movements_user_note ON movements(user_id, note_norm);
CREATE INDEX idx_movements_user_alive ON movements(user_id, date) WHERE deleted_at IS NULL;

-- 2) Recurrentes y plantillas rápidas
CREATE TABLE recurring_movements (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto', 'pago_deuda', 'ahorro')),
  category TEXT NOT NULL,
  subcategory TEXT,
  amount TEXT NOT NULL,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_suggested_month TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_recurring_user ON recurring_movements(user_id, active);

CREATE TABLE quick_templates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto')),
  category TEXT NOT NULL,
  subcategory TEXT,
  amount TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, label)
);

-- 3) Aprendizaje por cuenta: palabra o nota -> categoría elegida por la persona
CREATE TABLE category_hints (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  hits INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, term, kind)
);

-- 4) Caché de respuestas de IA (misma pregunta normalizada + mismos hechos)
CREATE TABLE coach_response_cache (
  cache_key TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_coach_cache_exp ON coach_response_cache(expires_at);

-- 5) Mensajes del Coach: origen y trazabilidad
ALTER TABLE messages ADD COLUMN origin TEXT CHECK (origin IN ('boton', 'regla', 'plantilla', 'cache', 'ia'));
ALTER TABLE messages ADD COLUMN intent TEXT;
ALTER TABLE messages ADD COLUMN variant_id TEXT;
ALTER TABLE messages ADD COLUMN confidence REAL;
ALTER TABLE messages ADD COLUMN catalog_version TEXT;
ALTER TABLE messages ADD COLUMN payload_json TEXT;

-- 6) Preferencias del Coach por cuenta (sonido, movimiento, tono, recordatorios)
ALTER TABLE users ADD COLUMN coach_prefs_json TEXT;

-- 7) ai_runs: más propósitos y columnas de caché. SQLite no permite cambiar un CHECK: se reconstruye la tabla.
CREATE TABLE ai_runs_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('plan', 'coach', 'coach_clasificar', 'coach_extraer', 'coach_redactar', 'coach_consejo', 'coach_resumen', 'free_result')),
  task TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'limite')),
  error_code TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
INSERT INTO ai_runs_new (id, user_id, purpose, provider, model, prompt_version, input_json, output_text, status, error_code, input_tokens, output_tokens, cost_micros, latency_ms, created_at)
  SELECT id, user_id, purpose, provider, model, prompt_version, input_json, output_text, status, error_code, input_tokens, output_tokens, cost_micros, latency_ms, created_at FROM ai_runs;
DROP TABLE ai_runs;
ALTER TABLE ai_runs_new RENAME TO ai_runs;
CREATE INDEX idx_ai_runs_period ON ai_runs(created_at);
CREATE INDEX idx_ai_runs_user ON ai_runs(user_id, purpose, created_at);
CREATE INDEX idx_ai_runs_task ON ai_runs(task, created_at);
