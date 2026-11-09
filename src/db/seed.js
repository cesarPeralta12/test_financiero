'use strict';
// Datos iniciales: cuestionarios v1, reglas v1, productos, textos y cuenta de
// administración. Sin información personal real. Es idempotente.
const db = require('./index');
const config = require('../config');
const { migrate } = require('./migrate');
const { hashPassword } = require('../lib/security');
const { FREE, DEEP, RULES, PRODUCTS, CONTENTS } = require('./content-v1');

function seedQuestionnaire(kind, def) {
  if (db.value('SELECT COUNT(*) FROM questionnaires WHERE kind = ?', kind) > 0) return false;
  const now = db.now();
  const q = db.run(
    "INSERT INTO questionnaires (kind, version, status, title, notes, created_at, published_at) VALUES (?, 1, 'publicado', ?, ?, ?, ?)",
    kind,
    def.title,
    def.notes,
    now,
    now
  );
  def.questions.forEach((item, i) => {
    db.run(
      `INSERT INTO questions (questionnaire_id, position, code, section, type, prompt, help, options_json, config_json, required, allow_unknown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      q.lastId,
      i + 1,
      item.code,
      item.section,
      item.type,
      item.prompt,
      item.help || null,
      db.json(item.options || null),
      db.json(item.config || {}),
      item.required === false ? 0 : 1,
      item.allowUnknown ? 1 : 0
    );
  });
  return true;
}

/**
 * Publica la versión 2 del test gratuito (tono de juego y opciones con imagen) si
 * solo existe la v1. Conserva códigos, tipos y valores; si alguien ya publicó otra
 * versión desde el panel, no hace nada.
 */
function upgradeFreeToV2() {
  const { FREE_V2 } = require('./content-v2');
  const maxV = db.value("SELECT MAX(version) FROM questionnaires WHERE kind = 'gratuito'");
  if (maxV !== 1) return false;
  const v1 = db.one("SELECT * FROM questionnaires WHERE kind = 'gratuito' AND version = 1 AND status = 'publicado'");
  if (!v1) return false;
  const now = db.now();
  const q = db.run(
    "INSERT INTO questionnaires (kind, version, status, title, notes, created_at, published_at) VALUES ('gratuito', 2, 'publicado', ?, ?, ?, ?)",
    FREE_V2.title,
    FREE_V2.notes,
    now,
    now
  );
  for (const old of db.all('SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY position', v1.id)) {
    const o = FREE_V2.questions[old.code] || {};
    let options = old.options_json;
    if (o.options) {
      const prev = JSON.parse(old.options_json || '[]');
      if (prev.length !== o.options.length || prev.some((p, i) => p.value !== o.options[i].value)) {
        throw new Error(`Las opciones de ${old.code} en la v2 no coinciden con la v1.`);
      }
      options = JSON.stringify(o.options);
    }
    const config = { ...JSON.parse(old.config_json || '{}'), ...(['single', 'multi', 'currency'].includes(old.type) ? { tiles: true } : {}) };
    db.run(
      `INSERT INTO questions (questionnaire_id, position, code, section, type, prompt, help, options_json, config_json, required, allow_unknown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      q.lastId,
      old.position,
      old.code,
      old.section,
      old.type,
      o.prompt || old.prompt,
      o.help !== undefined ? o.help : old.help,
      options,
      JSON.stringify(config),
      old.required,
      old.allow_unknown
    );
  }
  db.run("UPDATE questionnaires SET status = 'retirado' WHERE id = ?", v1.id);
  return true;
}

function seed({ quiet = false } = {}) {
  migrate({ quiet: true });
  const log = (m) => !quiet && console.log(m);
  db.tx(() => {
    if (seedQuestionnaire('gratuito', FREE)) log('Cuestionario gratuito v1 publicado.');
    if (seedQuestionnaire('profundo', DEEP)) log('Cuestionario profundo v1 publicado.');
    if (upgradeFreeToV2()) log('Test gratuito v2 (versión de juego) publicado.');

    if (!db.value("SELECT COUNT(*) FROM rule_sets WHERE kind = 'diagnostico'")) {
      db.run(
        "INSERT INTO rule_sets (kind, version, status, rules_json, notes, created_at, published_at) VALUES ('diagnostico', 1, 'publicado', ?, ?, ?, ?)",
        JSON.stringify(RULES, null, 2),
        'Umbrales iniciales propuestos. Pendientes de validación por el responsable de contenido financiero.',
        db.now(),
        db.now()
      );
      log('Reglas de diagnóstico v1 publicadas.');
    }

    for (const p of PRODUCTS) {
      if (db.one('SELECT id FROM products WHERE code = ?', p.code)) continue;
      const days = Math.max(...p.grants.map((g) => g.days || 0));
      db.run(
        `INSERT INTO products (code, name, summary, includes_json, grants_json, price_cents, currency, access_days, conditions, gateway_ref, active, sort, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        p.code,
        p.name,
        p.summary,
        JSON.stringify(p.includes),
        JSON.stringify(p.grants),
        p.price_cents,
        p.currency,
        days,
        'Pago único, sin renovación automática. Los reembolsos se gestionan a través de la pasarela de pago.',
        `sandbox_${p.code}`,
        p.sort,
        db.now()
      );
      log(`Producto ${p.name} creado.`);
    }

    for (const c of CONTENTS) {
      if (db.one('SELECT id FROM contents WHERE key = ?', c.key)) continue;
      db.run(
        "INSERT INTO contents (key, version, status, title, body, created_at, published_at) VALUES (?, 1, 'publicado', ?, ?, ?, ?)",
        c.key,
        c.title,
        c.body,
        db.now(),
        db.now()
      );
    }

    const email = config.admin.email || (config.isProd ? '' : 'admin@diauno.test');
    const password = config.admin.password || (config.isProd ? '' : null);
    if (email && !db.one('SELECT id FROM users WHERE email = ?', email)) {
      if (!password) {
        log('Sin ADMIN_PASSWORD: no se creó la cuenta de administración. Defínela en .env y vuelve a ejecutar «npm run seed».');
      } else {
        db.run(
          "INSERT INTO users (email, password_hash, name, role, email_verified_at, created_at, updated_at) VALUES (?, ?, 'Administración', 'admin', ?, ?, ?)",
          email,
          hashPassword(password),
          db.now(),
          db.now(),
          db.now()
        );
        log(`Cuenta de administración creada: ${email}`);
      }
    }
  });
}

module.exports = { seed };

if (require.main === module) {
  seed();
  db.close();
}
