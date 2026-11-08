-- Día Uno · esquema inicial
-- Grupos: Identidad, Evaluación, Comercial, Planificación, Seguimiento, Operación.
-- Importes monetarios de usuario: TEXT con decimal exacto (p. ej. '1250.50').
-- Precios de producto: INTEGER en centavos.
-- Fechas: TEXT ISO 8601 en UTC; fechas de calendario: 'YYYY-MM-DD'.

-- ───────────── Identidad ─────────────
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('usuario', 'admin')),
  base_currency TEXT,
  email_verified_at TEXT,
  ai_monthly_limit INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE anonymous_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  linked_at TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer_host TEXT,
  landing_path TEXT
);
CREATE INDEX idx_anon_linked ON anonymous_sessions(linked_user_id, last_seen_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- sha256 del token de la cookie
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon_id TEXT REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verificar', 'recuperar')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE contents (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('borrador', 'publicado', 'retirado')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (key, version)
);

CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('datos_financieros', 'condiciones')),
  content_key TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  accepted_at TEXT NOT NULL
);
CREATE INDEX idx_consents_owner ON consents(user_id, anon_id);

-- ───────────── Evaluación ─────────────
CREATE TABLE questionnaires (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gratuito', 'profundo')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('borrador', 'publicado', 'retirado')),
  title TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (kind, version)
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  code TEXT NOT NULL,
  section TEXT NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  help TEXT,
  options_json TEXT,
  config_json TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  allow_unknown INTEGER NOT NULL DEFAULT 0,
  UNIQUE (questionnaire_id, position),
  UNIQUE (questionnaire_id, code)
);

CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gratuito', 'profundo')),
  questionnaire_id INTEGER NOT NULL REFERENCES questionnaires(id),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon_id TEXT REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('en_curso', 'finalizada')),
  current_position INTEGER NOT NULL DEFAULT 1,
  base_currency TEXT,
  warnings_ack_json TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_eval_user ON evaluations(user_id, kind, status);
CREATE INDEX idx_eval_anon ON evaluations(anon_id, kind, status);

CREATE TABLE answers (
  id INTEGER PRIMARY KEY,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  code TEXT NOT NULL,
  value_json TEXT,
  is_unknown INTEGER NOT NULL DEFAULT 0,
  is_skipped INTEGER NOT NULL DEFAULT 0,
  from_previous INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (evaluation_id, question_id)
);

CREATE TABLE rule_sets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('diagnostico')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('borrador', 'publicado', 'retirado')),
  rules_json TEXT NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (kind, version)
);

CREATE TABLE free_results (
  id INTEGER PRIMARY KEY,
  evaluation_id INTEGER NOT NULL UNIQUE REFERENCES evaluations(id) ON DELETE CASCADE,
  rule_set_id INTEGER NOT NULL REFERENCES rule_sets(id),
  calc_version TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ───────────── Comercial ─────────────
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  includes_json TEXT NOT NULL,
  grants_json TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL,
  access_days INTEGER,
  conditions TEXT NOT NULL,
  gateway_ref TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  grants_json TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  access_days INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'pagada', 'fallida', 'cancelada', 'reembolsada')),
  gateway TEXT NOT NULL,
  gateway_session_id TEXT,
  gateway_payment_id TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  refunded_at TEXT
);
CREATE INDEX idx_orders_user ON orders(user_id, status);

CREATE TABLE payment_events (
  id INTEGER PRIMARY KEY,
  gateway TEXT NOT NULL,
  event_id TEXT,
  type TEXT,
  order_ref TEXT,
  amount_cents INTEGER,
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('procesado', 'duplicado', 'rechazado', 'ignorado')),
  reason TEXT,
  received_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_payment_events_unique ON payment_events(gateway, event_id) WHERE status IN ('procesado', 'ignorado');
CREATE INDEX idx_payment_events_status ON payment_events(status, received_at);

CREATE TABLE entitlements (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code IN ('evaluacion_profunda', 'plan_maestro', 'acompanamiento')),
  source TEXT NOT NULL CHECK (source IN ('compra', 'manual')),
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT
);
CREATE UNIQUE INDEX idx_entitlement_order_code ON entitlements(order_id, code) WHERE order_id IS NOT NULL;
CREATE INDEX idx_entitlements_user ON entitlements(user_id, code);

-- Simulación del lado del proveedor (solo pasarela de pruebas).
CREATE TABLE sandbox_checkouts (
  id TEXT PRIMARY KEY,
  order_ref TEXT NOT NULL,
  product_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('abierta', 'aprobada', 'rechazada', 'cancelada', 'reembolsada')),
  payment_id TEXT,
  return_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sandbox_deliveries (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'entregado', 'fallido')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_response TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ───────────── Planificación ─────────────
CREATE TABLE diagnoses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  rule_set_id INTEGER NOT NULL REFERENCES rule_sets(id),
  calc_version TEXT NOT NULL,
  questionnaire_id INTEGER NOT NULL REFERENCES questionnaires(id),
  snapshot_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_diagnoses_user ON diagnoses(user_id, created_at);

CREATE TABLE plan_versions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diagnosis_id INTEGER NOT NULL REFERENCES diagnoses(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('en_cola', 'generando', 'completo', 'fallido')),
  start_date TEXT NOT NULL,
  content_json TEXT,
  narrative_json TEXT,
  ai_run_id INTEGER,
  error_message TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  request_reason TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, version_number)
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reserva', 'meta')),
  target_amount TEXT NOT NULL,
  initial_saved TEXT NOT NULL DEFAULT '0',
  target_months INTEGER,
  status TEXT NOT NULL CHECK (status IN ('activa', 'alcanzada', 'archivada')),
  source TEXT NOT NULL DEFAULT 'usuario',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_version_id INTEGER REFERENCES plan_versions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  reason TEXT,
  done_criteria TEXT,
  indicator TEXT,
  day_offset INTEGER,
  due_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'completada', 'pospuesta')),
  postponed_until TEXT,
  completed_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('plan', 'coach', 'usuario')),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_user ON tasks(user_id, archived, status);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE milestones (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_version_id INTEGER REFERENCES plan_versions(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  title TEXT NOT NULL,
  condition TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'alcanzado')),
  reached_at TEXT,
  created_at TEXT NOT NULL
);

-- ───────────── Seguimiento ─────────────
CREATE TABLE debts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  rate TEXT,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('nominal_anual', 'efectiva_anual', 'mensual', 'desconocido')),
  payment TEXT NOT NULL,
  fees TEXT,
  status TEXT NOT NULL CHECK (status IN ('activa', 'pagada')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE debt_balances (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_debt_balances ON debt_balances(debt_id, date);

CREATE TABLE movements (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto', 'pago_deuda', 'ahorro', 'retiro_ahorro', 'transferencia')),
  category TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  note TEXT,
  debt_id INTEGER REFERENCES debts(id) ON DELETE SET NULL,
  goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  to_goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'usuario',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_movements_user_date ON movements(user_id, date);

CREATE TABLE budget_lines (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto', 'pago_deuda', 'ahorro')),
  category TEXT NOT NULL,
  amount TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, month, kind, category)
);

CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_source TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  calc_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ───────────── Operación ─────────────
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('usuario', 'coach', 'sistema')),
  kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'hipotetico', 'propuesta', 'aviso', 'error')),
  content TEXT NOT NULL,
  data_json TEXT,
  proposal_json TEXT,
  proposal_status TEXT CHECK (proposal_status IN ('pendiente', 'confirmada', 'descartada')),
  ai_run_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE ai_runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('plan', 'coach')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'limite')),
  error_code TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_runs_period ON ai_runs(created_at);
CREATE INDEX idx_ai_runs_user ON ai_runs(user_id, purpose, created_at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'procesando', 'completado', 'fallido')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at TEXT NOT NULL,
  locked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_jobs_pending ON jobs(status, run_at);

CREATE TABLE emails (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'enviado', 'fallido')),
  transport TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- Eventos de embudo: sin importes, respuestas ni conversaciones.
CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  anon_id TEXT,
  user_id INTEGER,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_analytics_name ON analytics_events(name, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE privacy_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exportar', 'eliminar')),
  status TEXT NOT NULL CHECK (status IN ('pendiente', 'completada', 'rechazada')),
  note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
