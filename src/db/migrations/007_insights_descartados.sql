-- Día Uno · Coach v2 (S4): observaciones que la persona descartó (docs/coach-v2/05 §3.7).
-- Una observación descartada no reaparece en 7 días salvo que cambie de severidad; las de severidad
-- «alerta» no se pueden silenciar más de 24 horas.
CREATE TABLE insight_dismissals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, insight_id)
);
