-- Día Uno · Coach v2 (S1): importes ordenables y claves de idempotencia.
-- amount_cents es una columna GENERADA a partir del importe en texto: no cambia ningún dato ni código
-- existente y permite ordenar y filtrar numéricamente (los importes siguen guardándose como texto exacto).
ALTER TABLE movements ADD COLUMN amount_cents INTEGER GENERATED ALWAYS AS (CAST(ROUND(CAST(amount AS REAL) * 100) AS INTEGER)) VIRTUAL;
CREATE INDEX idx_movements_user_cents ON movements(user_id, amount_cents) WHERE deleted_at IS NULL;

-- Una escritura repetida con la misma clave devuelve la misma respuesta (retención 24 h).
CREATE TABLE idempotency_keys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);
