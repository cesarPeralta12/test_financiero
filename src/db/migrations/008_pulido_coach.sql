-- Día Uno · Coach v2 · S7 (pulido). Aditiva.
-- 1) Recurrentes que la persona rechazó («No, solo esta vez»): no se vuelven a proponer.
CREATE TABLE recurring_dismissed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, term)
);

-- 2) Recordatorios amables enviados (máximo 2 por semana y cuenta).
CREATE TABLE coach_reminders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_coach_reminders_user ON coach_reminders(user_id, created_at);

-- 3) Mejora continua del parser: frases que el Coach no entendió, ANONIMIZADAS (sin cuenta, sin números, sin correos).
CREATE TABLE parser_feedback (
  id INTEGER PRIMARY KEY,
  phrase TEXT NOT NULL UNIQUE,
  hits INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN ('nuevo', 'revisado', 'incorporado', 'descartado')),
  review_note TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX idx_parser_feedback_status ON parser_feedback(status, hits);
