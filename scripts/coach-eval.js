'use strict';
// Evaluación del Coach v2 sobre el banco de casos (docs/coach-v2/10).
//   npm run coach:eval            → reglas + IA simulada (adaptador local, base en memoria, sin red ni costo)
//   npm run coach:eval -- --real  → IA real de Anthropic (necesita ANTHROPIC_API_KEY; cuesta dinero, pocas decenas de centavos)
// Mide: % de casos que resuelven las reglas sin IA, y de los dudosos, cuántos acierta la IA barata (clasificar)
// con su costo y tokens. El adaptador local es un simulador: sus cifras NO sustituyen una evaluación real.
const real = process.argv.includes('--real');
process.env.APP_ENV = process.env.APP_ENV || 'testing';
process.env.DATABASE_PATH = ':memory:';
if (!real) process.env.AI_PROVIDER = 'local';
else if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error('Falta OPENAI_API_KEY (o ANTHROPIC_API_KEY) para --real.');
  process.exit(1);
}

const db = require('../src/db');
db.open(':memory:');
require('../src/db/seed').seed({ quiet: true });
const { setSetting } = require('../src/lib/services');
const { parsear } = require('../src/domain/coach/parser');
const router = require('../src/domain/coach/ia/router');
const metricas = require('../src/domain/coach/ia/metricas');
const doc = require('../src/domain/coach/data/casos-parser.json');

const { fecha_referencia: hoy, moneda_cuenta: moneda } = doc.contexto;

(async () => {
  setSetting('coach_v2_ia_automatica', true);
  setSetting('ai_coach_daily_auto_limit', 100000);
  const uid = db.run("INSERT INTO users (email, password_hash, role, created_at, updated_at) VALUES ('eval@diauno.test', 'x', 'usuario', ?, ?)", db.now(), db.now()).lastInsertRowid;

  let reglasOk = 0;
  const dudosos = [];
  for (const c of doc.casos) {
    const r = parsear(c.texto, { hoy, moneda });
    const dudoso = r.respuesta === 'no_entendi' || r.respuesta === 'ia_ofrecer';
    if (!dudoso) reglasOk++;
    else dudosos.push(c);
  }
  console.log(`Casos: ${doc.casos.length} · resueltos por reglas sin IA: ${reglasOk} (${((reglasOk / doc.casos.length) * 100).toFixed(1)} %) · dudosos: ${dudosos.length}`);

  let aciertos = 0;
  let evaluados = 0;
  for (const c of dudosos) {
    const k = await router.ejecutar({ userId: uid, tarea: 'clasificar', texto: c.texto, hoy });
    evaluados++;
    if (k.ok && k.datos.intencion === c.intencion) aciertos++;
  }
  if (evaluados) console.log(`IA barata sobre los dudosos: ${aciertos}/${evaluados} intenciones correctas (${((aciertos / evaluados) * 100).toFixed(1)} %)`);

  const m = metricas.resumen(1);
  for (const t of m.tareas) {
    const porLlamada = t.llamadas ? t.costo / t.llamadas / 1e6 : 0;
    console.log(`${t.tarea}: ${t.llamadas} llamadas · ${t.entrada} tokens de entrada · ${t.salida} de salida · caché ${t.cache_lectura}/${t.cache_escritura} · ${porLlamada.toFixed(6)} USD por llamada`);
  }
  console.log(`Aciertos de caché de prompt: ${m.cache.tasa === null ? '—' : (m.cache.tasa * 100).toFixed(1) + ' %'}`);
  if (!real) console.log('Nota: modo simulado. Para medir calidad y costo reales, ejecuta con --real y una clave de Anthropic.');
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
