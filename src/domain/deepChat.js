'use strict';
/**
 * Evaluación profunda en forma de conversación. Cada pregunta del cuestionario se
 * convierte en uno o varios mensajes cortos («pasos»). Lo que la persona escribe se
 * interpreta con reglas fijas (sin IA) y, al completar los pasos de una pregunta, se arma
 * el mismo formulario que enviarían las pantallas de siempre y se valida con
 * `questionnaire.parseSubmission`. Así los cálculos y las reglas no cambian.
 *
 * Saltos: si responde «no tengo» (deudas, ingresos extra, ahorros…), no se pregunta
 * nada más de ese tema.
 */
const money = require('../lib/money');
const chat4 = require('./free/chat4');

const PERIODS = [
  ['semanal', /\b(semana|semanal|por semana|a la semana)\b/],
  ['quincenal', /\b(quincena|quincenal)\b/],
  ['catorcenal', /\b(catorcena|catorcenal|cada 14 dias)\b/],
  ['bimestral', /\b(bimestre|bimestral|cada 2 meses|cada dos meses)\b/],
  ['trimestral', /\b(trimestre|trimestral|cada 3 meses|cada tres meses)\b/],
  ['semestral', /\b(semestre|semestral|cada 6 meses|cada seis meses)\b/],
  ['anual', /\b(ano|anual|al ano|por ano)\b/],
  ['mensual', /\b(mes|mensual|al mes|por mes|mensuales)\b/],
];
const PERIOD_LABEL = { semanal: 'Por semana', quincenal: 'Por quincena', catorcenal: 'Cada 14 días', mensual: 'Al mes', bimestral: 'Cada 2 meses', trimestral: 'Cada 3 meses', semestral: 'Cada 6 meses', anual: 'Al año' };

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const NO = /^(no\b|nop\b|nada\b|ninguno|ninguna|nadie|cero\b|0\b|jamas|nunca)/;
const YES = /^(si\b|sí\b|claro|por supuesto|obvio|sip\b|tengo\b|afirmativo|aja\b)/;
const DK = /\b(no se|no lo se|ni idea|no estoy segur[oa]|no sabria)\b/;

// «Probablemente», «creo que no», «a veces»: la gente no siempre contesta con un sí o un no.
const SOFT_NO = /^(creo que no|probablemente no|seguramente no|posiblemente no|lo dudo|para nada|dificil|negativo|tampoco|casi nunca|todavia no|aun no|por ahora no|ahora no)\b/;
const SOFT_YES = /^(probable|posible|seguramente|seguro|creo que si|yo creo|supongo|quiza|tal ?vez|a ?lo mejor|puede|podria|capaz|depende|a veces|de vez en cuando|algo\b|un poco|un poquito|poco\b|alguna|algun|ok\b|dale|obviamente|asi es|correcto|exacto|eso creo|en parte|mas o menos)/;
// Tras un «sí», la pregunta del monto dice de qué se habla: un «¿cuánto?» a secas parece repetido.
const FOLLOW = {
  ingresos_adicionales: '¿Cuánto recibes de esos otros ingresos?',
  gastos_anuales: '¿Cuánto suman al año esos gastos que pagas pocas veces?',
  ahorro_mensual: '¿Cuánto apartas para ahorrar?',
  ahorro_no_disponible: '¿Cuánto tienes en esos ahorros que no puedes retirar?',
  gasto_reducible: '¿Cuánto podrías dejar de gastar, más o menos?',
  ingreso_extra_posible: '¿Cuánto más podrías ganar con ese ingreso extra, más o menos?',
  bienes_vendibles: '¿Cuánto recibirías si vendieras esas cosas, más o menos?',
};
/** 'si' | 'no' | null */
function yesOrNo(n) {
  if (SOFT_NO.test(n)) return 'no';
  if (NO.test(n)) return 'no';
  if (YES.test(n) || SOFT_YES.test(n)) return 'si';
  return null;
}

function periodOf(t) {
  const n = norm(t);
  const hit = PERIODS.find(([, re]) => re.test(n));
  return hit ? hit[0] : null;
}
/** Cifra en el formato que espera `money.parseAmount` para esa moneda. */
function amountFor(text, currency) {
  // «No», «nada», «no tengo»: cero.
  if (DK.test(norm(text)) && !/\d/.test(text)) return null; // «no sé» no es cero
  const a = NO.test(norm(text)) && !/\d/.test(text) ? '0' : chat4.amount(text);
  if (a === null) return null;
  const sep = (money.CURRENCIES[currency] && money.CURRENCIES[currency].decimalSep) || '.';
  return sep === ',' ? a.replace('.', ',') : a;
}
const opts = (list) => (list || []).map((o) => ({ code: String(o.value), label: o.label }));
const lc = (s) => String(s || '').replace(/ \(.*\)$/, '').toLowerCase();

/**
 * Siguiente paso de la pregunta `q` según lo ya respondido en `body` (el formulario que se
 * va armando). Devuelve null cuando la pregunta está completa.
 * Paso: { id, text, help, chips, kind, apply(text) → { body } | { error } | { unknown: true } }
 */
function nextStep(q, body, currency) {
  const cfg = q.config || {};
  const set = (patch) => ({ body: { ...body, ...patch } });
  const unknownOk = (t) => q.allowUnknown && DK.test(norm(t));
  const amountStep = (id, text, key, extra = {}) => ({
    id,
    text,
    help: extra.help || null,
    chips: extra.chips || (q.allowUnknown ? ['No lo sé'] : []),
    kind: 'amount',
    apply: (t) => {
      if (unknownOk(t)) return { unknown: true };
      const a = amountFor(t, currency);
      if (a === null) return { error: q.allowUnknown ? 'Escribe una cifra aproximada, por ejemplo «2500». Si no la sabes, escribe «no lo sé».' : 'Escribe una cifra, por ejemplo «2500». Un aproximado está bien.' };
      // Sin decir cada cuánto, se toma como mensual (lo más común); «800 por semana» se respeta.
      return extra.withPeriod ? set({ [key]: a, period: periodOf(t) || extra.defaultPeriod || 'mensual' }) : set({ [key]: a });
    },
  });
  const yesNo = (id, text, help, key = 'has') => ({
    id,
    text,
    help,
    chips: q.allowUnknown ? ['Sí', 'No', 'No lo sé'] : ['Sí', 'No'],
    kind: 'yesno',
    apply: (t) => {
      const n = norm(t);
      if (unknownOk(t)) return { unknown: true };
      if (DK.test(n)) return { error: 'No hay problema. Responde lo más parecido a tu situación: ¿sería más bien un sí o un no?' };
      const yn = yesOrNo(n);
      if (yn === 'no') return set({ [key]: 'no' });
      // «Sí, 500 al mes» ya trae el monto.
      const a = amountFor(t, currency);
      if (yn === 'si' || (a && Number(a.replace(',', '.')) > 0)) return set({ [key]: 'si', ...(a && Number(a.replace(',', '.')) > 0 ? { amount: a, period: periodOf(t) || 'mensual' } : {}) });
      return { error: q.allowUnknown ? 'No estoy seguro de haberte entendido. ¿Sería más bien un sí o un no? También puedes escribir «no lo sé».' : 'No estoy seguro de haberte entendido. ¿Sería más bien un sí o un no?' };
    },
  });
  const pickOne = (id, text, help, list, key) => ({
    id,
    text,
    help,
    chips: list.map((o) => o.label),
    kind: 'choice',
    apply: (t) => {
      if (unknownOk(t)) return { unknown: true };
      const n = norm(t);
      const num = n.match(/^\d+/);
      const exact = list.find((o) => norm(o.label) === n) || (num && list.find((o) => o.code === num[0]));
      // «Sí» / «No» cuando las opciones empiezan así («Sí, es neta», «No, es bruta»).
      const startsWith = (word) => list.filter((o) => new RegExp(`^${word}(\\s|,|$)`).test(norm(o.label)));
      const word = DK.test(n) ? null : yesOrNo(n);
      const yn = word ? startsWith(word) : [];
      if (!exact && yn.length === 1 && n.split(' ').length <= 3) return set({ [key]: yn[0].code });
      // «15 clientes» cae en su rango.
      const cant = cfg.ranges && !exact && n.match(/^(?:unos |como |mas o menos )?(\d+)(?: clientes?)?(?: al mes)?$/);
      if (cant) return set({ [key]: cfg.ranges.find(([max]) => Number(cant[1]) <= max)[1] });
      const hit = exact || chat4.matchOptions(list, t)[0];
      if (!hit) return { error: 'No te entendí. Escríbelo con otras palabras o toca una opción.' };
      return set({ [key]: hit.code });
    },
  });
  const pickMany = (id, text, help, list, key, noneCode) => ({
    id,
    text,
    help,
    chips: list.map((o) => o.label),
    kind: 'multi',
    apply: (t) => {
      const n = norm(t);
      if (unknownOk(t)) return { unknown: true }; // «no lo sé» no es «ninguno»
      if (noneCode && NO.test(n) && n.split(' ').length <= 4) return set({ [key]: [noneCode] });
      let found = chat4.matchOptions(list.filter((o) => o.code !== noneCode), t);
      if (!found.length) {
        const none = noneCode && chat4.matchOptions(list.filter((o) => o.code === noneCode), t)[0];
        if (none) return set({ [key]: [noneCode] });
        return { error: 'No te entendí. Puedes nombrar varias, por ejemplo «tarjeta y préstamo personal».' };
      }
      const top = found[0].score;
      found = found.filter((x) => x.score >= Math.min(3, top));
      return set({ [key]: [...new Set(found.map((x) => x.code))] });
    },
  });

  switch (q.type) {
    case 'currency': {
      if (body.value) return null;
      const list = Object.entries(money.CURRENCIES).map(([code, c]) => ({ code, label: c.label }));
      const step = pickOne('value', q.prompt, q.help, list, 'value');
      const base = step.apply;
      step.apply = (t) => {
        const n = norm(t);
        const alias = /boliviano|\bbs\b/.test(n) ? 'BOB' : /\bsol(es)?\b|\bpen\b/.test(n) ? 'PEN' : /dolar|usd/.test(n) ? 'USD' : /euro/.test(n) ? 'EUR' : null;
        if (alias && money.CURRENCIES[alias]) return set({ value: alias });
        return base(t);
      };
      return step;
    }
    case 'single':
      return body.value ? null : pickOne('value', q.prompt, q.help, opts(q.options), 'value');
    case 'multi': {
      if (body.value) return null;
      const none = (cfg.exclusive || [])[0] || null;
      return pickMany('value', q.prompt, q.help || 'Puedes nombrar varias.', opts(q.options), 'value', none);
    }
    case 'integer': {
      if (body.value !== undefined) return null;
      return {
        id: 'value',
        text: q.prompt,
        help: q.help,
        chips: (cfg.choices || []).map((c) => c.label),
        kind: 'integer',
        apply: (t) => {
          const n = norm(t);
          if (NO.test(n) && !DK.test(n)) return set({ value: '0' });
          const ch = (cfg.choices || []).find((c) => norm(c.label) === n);
          if (ch) return set({ value: String(ch.value) });
          const words = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
          const m = n.match(/\d+/);
          const w = Object.entries(words).find(([k]) => new RegExp(`\\b${k}\\b`).test(n));
          if (m || w) return set({ value: String(m ? Number(m[0]) : w[1]) });
          return { error: 'Escribe un número, por ejemplo «2».' };
        },
      };
    }
    case 'percent': {
      if (body.value !== undefined) return null;
      const list = (cfg.choices || []).map((c) => ({ code: String(c.value), label: c.label }));
      return {
        id: 'value',
        text: q.prompt,
        help: q.help,
        chips: list.map((o) => o.label),
        kind: 'percent',
        apply: (t) => {
          if (unknownOk(t)) return { unknown: true };
          const n = norm(t);
          const pct = n.match(/(\d+(?:[.,]\d+)?)\s*%/);
          if (pct) return set({ value: pct[1].replace(',', '.') });
          const hit = list.find((o) => norm(o.label) === n) || chat4.matchOptions(list, t)[0];
          if (hit) return set({ value: hit.code });
          if (/^(no|nada|fijo)|no baja|es fijo/.test(n)) return set({ value: '0' });
          // Palabras frecuentes cuando no hay botones.
          const vague = [[/mas de la mitad|muchisimo/, '75'], [/mucho/, '50'], [/bastante/, '25'], [/un poco|poco/, '10']].find(([re]) => re.test(n));
          if (vague) return set({ value: vague[1] });
          const m = n.match(/^\d+(?:[.,]\d+)?$/);
          if (m) return set({ value: m[0].replace(',', '.') });
          return { error: 'No te entendí. Toca una opción o escribe un porcentaje, por ejemplo «20 %».' };
        },
      };
    }
    case 'money': {
      if (cfg.presence && !body.has) return yesNo('has', q.prompt, q.help);
      if (body.has === 'no' || body.amount !== undefined) return null;
      return amountStep('amount', cfg.presence ? FOLLOW[q.code] || cfg.presence_label || '¿Cuánto?' : q.prompt, 'amount', { help: cfg.presence ? null : q.help });
    }
    case 'money_flow': {
      const presence = require('./questionnaire').asksPresence(q);
      if (presence && !body.has) return yesNo('has', q.prompt, q.help);
      if (body.has === 'no') return null;
      if (body.amount === undefined) return amountStep('amount', presence ? FOLLOW[q.code] || cfg.presence_label || '¿Cuánto recibes y cada cuánto?' : q.prompt, 'amount', { withPeriod: true, help: presence ? 'Por ejemplo «500 al mes» o «200 por quincena».' : q.help || 'Por ejemplo «3000 al mes» o «800 por semana».' });
      if (!body.period) {
        const list = (cfg.periods || ['mensual']).map((p) => ({ code: p, label: PERIOD_LABEL[p] || p }));
        const step = pickOne('period', '¿Cada cuánto?', null, list, 'period');
        const base = step.apply;
        step.apply = (t) => (periodOf(t) ? set({ period: periodOf(t) }) : base(t));
        return step;
      }
      return null;
    }
    case 'breakdown': {
      const fields = cfg.fields.map((f) => ({ code: f.key, label: f.label }));
      if (!body.pick) {
        const opciones = cfg.none ? [...fields, { code: 'ninguno', label: cfg.none }] : fields;
        const step = pickMany('pick', cfg.pick ? q.prompt : '¿En qué gastas cada mes?', cfg.none ? q.help : 'Nombra en qué gastas cada mes, por ejemplo «vivienda, comida y transporte». Sin pagos de deudas.', opciones, 'pick', cfg.none ? 'ninguno' : null);
        const base = step.apply;
        step.apply = (t) => {
          const n = norm(t);
          if (cfg.none) {
            // Bienes: «casa y moto», «ninguno», «no lo sé».
            const r = base(t);
            if (r.unknown) return r;
            const propios = [[/casa|departamento|depa\b/, 'inmuebles'], [/terreno|lote/, 'terrenos'], [/auto|moto|carro|coche|camion|vehiculo/, 'vehiculos'], [/inversi|acciones|fondo/, 'inversiones'], [/negocio|empresa|tienda/, 'negocio'], [/equipo|herramienta|mercader|maquina|computadora/, 'equipos']].filter(([re, k]) => re.test(n) && fields.some((f) => f.code === k)).map(([, k]) => k);
            const elegidos = [...new Set([...(r.body ? r.body.pick : []), ...propios])];
            if (propios.length) return set({ pick: elegidos.filter((k) => k !== 'ninguno'), f: {} });
            return r.body ? set({ pick: elegidos, f: {} }) : { error: `No te entendí. Nombra lo que tengas, por ejemplo «casa y moto», o escribe «ninguno».` };
          }
          const extra = [
            [/comida|supermercado|mercado|aliment/, 'alimentacion'],
            [/alquiler|renta|casa|vivienda|anticretico/, 'vivienda'],
            [/luz|agua|internet|telefono|celular|gas\b/, 'servicios'],
            [/bus|micro|taxi|gasolina|transporte|pasaje/, 'transporte'],
            [/colegio|escuela|universidad|curso|educacion/, 'educacion'],
            [/medic|salud|doctor|farmacia/, 'salud'],
          ].filter(([re, k]) => re.test(n) && fields.some((f) => f.code === k)).map(([, k]) => k);
          const r = base(t);
          const picked = [...new Set([...(r.body ? r.body.pick : []), ...extra])];
          if (!picked.length) return r.error ? r : { error: 'No te entendí. Nombra tus gastos, por ejemplo «comida y alquiler».' };
          // Sin marcar = 0 (en la versión sin casillas también hay que mandarlo).
          return set({ pick: picked, f: cfg.pick ? {} : Object.fromEntries(fields.filter((x) => !picked.includes(x.code)).map((x) => [x.code, '0'])) });
        };
        return step;
      }
      if (body.pick.includes('ninguno')) return null;
      const f = body.f || {};
      const key = body.pick.find((k) => f[k] === undefined);
      if (!key) return null;
      const label = cfg.fields.find((x) => x.key === key).label;
      const step = amountStep(`f.${key}`, cfg.ask ? cfg.ask.replace('{campo}', lc(label)) : `¿Cuánto gastas al mes en ${lc(label)}?`, 'x');
      step.apply = (t) => {
        const a = amountFor(t, currency);
        if (a === null) return { error: 'No encontré un monto. Escribe solo la cifra, por ejemplo «800».' };
        return set({ f: { ...f, [key]: a } });
      };
      return step;
    }
    case 'debts': {
      const kinds = opts(cfg.kinds);
      if (!body.kinds) {
        if (body.hasDebt === undefined) {
          const s = yesNo('hasDebt', '¿Tienes deudas?', 'Préstamos, tarjetas, créditos o dinero que debas a alguien.', 'hasDebt');
          const base = s.apply;
          s.apply = (t) => {
            const r = base(t);
            if (r.body && r.body.hasDebt === 'no') return set({ hasDebt: 'no', kinds: ['ninguna'] });
            // «Sí, una tarjeta»: ya nombra el tipo.
            if (r.body && r.body.hasDebt === 'si') {
              const named = chat4.matchOptions(kinds, t).map((x) => x.code);
              return set({ hasDebt: 'si', ...(named.length ? { kinds: named, k: {} } : {}) });
            }
            return r;
          };
          return s;
        }
        const s = pickMany('kinds', '¿Qué deudas tienes?', 'Puedes nombrar varias, por ejemplo «tarjeta y préstamo personal».', kinds, 'kinds', null);
        const base = s.apply;
        s.apply = (t) => {
          const r = base(t);
          return r.body ? set({ kinds: r.body.kinds, k: {} }) : r;
        };
        return s;
      }
      if (body.kinds.includes('ninguna')) return null;
      const k = body.k || {};
      for (const kind of body.kinds) {
        const r = k[kind] || {};
        const label = (kinds.find((x) => x.code === kind) || { label: kind }).label;
        if (r.balance === undefined) {
          const s = amountStep(`k.${kind}.balance`, `¿Cuánto debes en total en ${lc(label)}?`, 'x', { help: 'El saldo que te falta pagar.' });
          s.apply = (t) => {
            const a = amountFor(t, currency);
            return a === null ? { error: 'No encontré un monto. Escribe solo la cifra, por ejemplo «5000».' } : set({ k: { ...k, [kind]: { ...r, balance: a } } });
          };
          return s;
        }
        if (r.payment === undefined) {
          const s = amountStep(`k.${kind}.payment`, `¿Y cuánto pagas al mes de ${lc(label)}?`, 'x', { help: 'Si hoy no pagas nada, escribe 0.' });
          s.apply = (t) => {
            const a = amountFor(t, currency);
            return a === null ? { error: 'No encontré un monto. Escribe solo la cifra, por ejemplo «400».' } : set({ k: { ...k, [kind]: { ...r, payment: a, ...(cfg.simple ? {} : { rate_unknown: '1' }) } } });
          };
          return s;
        }
        if (!cfg.simple) continue;
        const put = (patch) => set({ k: { ...k, [kind]: { ...r, ...patch } } });
        const noInterest = /sin interes|no (me )?cobra|no (tiene|pago|genera) interes|^(0|cero|nada|ninguno|no)( ?%)?$/;
        if (r.rate === undefined && r.rate_unknown === undefined) {
          return {
            id: `k.${kind}.rate`,
            text: `¿Qué interés te cobran en ${lc(label)}?`,
            help: 'Por ejemplo «24 % al año» o «2 % al mes». Está en tu contrato o estado de cuenta.',
            chips: ['No me cobran interés', 'No lo sé'],
            kind: 'text',
            apply: (t) => {
              const n = norm(t);
              if (DK.test(n)) return put({ rate_unknown: '1' });
              if (noInterest.test(n)) return put({ rate: '0', rate_period: 'anual' });
              const m = n.match(/(\d+(?:[.,]\d+)?)/);
              if (!m || Number(m[1].replace(',', '.')) > 500 || /-\s*\d/.test(n)) return { error: 'Escribe el interés en porcentaje, por ejemplo «24 % al año», o «no lo sé».' };
              const per = periodOf(t);
              if (per && per !== 'anual' && per !== 'mensual') return { error: 'Dímelo al mes o al año, por ejemplo «2 % al mes».' };
              return put({ rate: m[1].replace(',', '.'), ...(Number(m[1].replace(',', '.')) === 0 ? { rate_period: 'anual' } : per ? { rate_period: per } : {}) });
            },
          };
        }
        if (r.rate !== undefined && r.rate_period === undefined) {
          return {
            id: `k.${kind}.rate_period`,
            text: `¿Ese ${String(r.rate).replace('.', ',')} % es al mes o al año?`,
            help: null,
            chips: ['Al mes', 'Al año', 'No lo sé'],
            kind: 'choice',
            apply: (t) => {
              if (DK.test(norm(t))) {
                const { rate, ...rest } = r;
                return set({ k: { ...k, [kind]: { ...rest, rate_unknown: '1' } } });
              }
              const per = periodOf(t);
              return per === 'mensual' || per === 'anual' ? put({ rate_period: per }) : { error: 'Responde «al mes» o «al año».' };
            },
          };
        }
        if (r.term === undefined) {
          return {
            id: `k.${kind}.term`,
            text: `¿Cuánto tiempo te falta para terminar de pagar ${lc(label)}?`,
            help: 'Por ejemplo «18 meses» o «2 años». Si no tiene fecha, escribe «no lo sé».',
            chips: ['No lo sé'],
            kind: 'text',
            apply: (t) => {
              const n = norm(t);
              if (DK.test(n) || /no tiene (fecha|plazo)|sin (fecha|plazo)/.test(n)) return put({ term: '' });
              const a = n.match(/(\d+(?:[.,]\d+)?|\bun) ?anos?\b/);
              const me = n.match(/(\d+|\bun) ?mes(es)?\b/);
              const num = (x) => (x === 'un' ? 1 : Number(x.replace(',', '.')));
              let months = (a ? num(a[1]) * 12 : 0) + (me ? num(me[1]) : 0);
              if (!a && !me && /^\d+$/.test(n)) months = Number(n);
              if (a && /y medio/.test(n)) months += 6;
              months = Math.round(months);
              return months >= 1 && months <= 600 ? put({ term: String(months) }) : { error: 'Escribe cuántos meses te faltan, por ejemplo «18 meses», o «no lo sé».' };
            },
          };
        }
      }
      return null;
    }
    case 'goals': {
      const kinds = opts(cfg.kinds);
      const horizons = (cfg.horizons || []).map((h) => ({ code: String(h.value), label: h.label }));
      if (!body.kinds && !cfg.simple) {
        // Versión sin botones: la persona nombra sus metas con sus palabras.
        return {
          id: 'kinds',
          text: q.prompt,
          help: 'Por ejemplo «fondo para emergencias y comprar una moto». Si aún no tienes, escribe «ninguna».',
          chips: ['Aún no tengo metas'],
          kind: 'text',
          apply: (t) => {
            const n = norm(t);
            if (NO.test(n) || /aun no tengo/.test(n)) return set({ kinds: ['ninguna'] });
            const names = t.split(/,|;|\by\b|\be\b/i).map((x) => x.trim()).filter((x) => x.length >= 3).slice(0, cfg.maxRows || 5);
            if (!names.length) return { error: 'Escribe tu meta en pocas palabras.' };
            const gk = {};
            const ks = names.map((name, i) => {
              gk[`m${i}`] = { name: name.slice(0, 60) };
              return `m${i}`;
            });
            return set({ kinds: ks, gk });
          },
        };
      }
      if (!body.kinds) {
        const s = pickMany('kinds', q.prompt, 'Por ejemplo «fondo para emergencias y vivienda». Si aún no tienes, escribe «ninguna».', kinds.concat([{ code: 'ninguna', label: 'Aún no tengo metas' }]), 'kinds', 'ninguna');
        const base = s.apply;
        s.apply = (t) => {
          const r = base(t);
          return r.body ? set({ kinds: r.body.kinds, gk: {} }) : r;
        };
        return s;
      }
      if (body.kinds.includes('ninguna')) return null;
      const gk = body.gk || {};
      for (const kind of body.kinds) {
        const r = gk[kind] || {};
        const label = (kinds.find((x) => x.code === kind) || { label: kind }).label;
        const put = (patch) => set({ gk: { ...gk, [kind]: { ...r, ...patch } } });
        if (kind === 'otra' && !r.name) {
          return { id: `gk.${kind}.name`, text: '¿Cuál es esa otra meta?', help: 'En pocas palabras.', chips: [], kind: 'text', apply: (t) => (t.trim().length >= 3 ? put({ name: t.trim().slice(0, 60) }) : { error: 'Escribe en pocas palabras cuál es tu meta.' }) };
        }
        const name = r.name || (kind === 'otra' ? r.name : lc(label));
        if (r.target === undefined) {
          const s = amountStep(`gk.${kind}.target`, `¿Cuánto necesitas para ${name}?`, 'x');
          s.apply = (t) => {
            const a = amountFor(t, currency);
            return a === null ? { error: 'No encontré un monto. Escribe solo la cifra, por ejemplo «10000».' } : put({ target: a });
          };
          return s;
        }
        if (r.months === undefined && horizons.length) {
          const s = pickOne(`gk.${kind}.months`, '¿En cuánto tiempo te gustaría lograrlo?', null, horizons, 'x');
          s.apply = (t) => {
            const n = norm(t);
            const hit = horizons.find((h) => norm(h.label) === n) || chat4.matchOptions(horizons, t)[0];
            const m = n.match(/(\d+)\s*(mes|ano)/);
            if (hit) return put({ months: hit.code });
            if (m) {
              const months = m[2] === 'ano' ? Number(m[1]) * 12 : Number(m[1]);
              const best = horizons.filter((h) => Number(h.code) > 0).sort((a, b) => Math.abs(Number(a.code) - months) - Math.abs(Number(b.code) - months))[0];
              if (best) return put({ months: best.code });
            }
            if (DK.test(n)) return put({ months: '0' });
            return { error: 'Toca un plazo o escríbelo, por ejemplo «1 año».' };
          };
          return s;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Formulario final para `parseSubmission`: quita las claves internas de la conversación y,
 * si el cuestionario usa la versión de filas (sin botones), convierte deudas y metas a filas.
 */
function toSubmission(q, body) {
  const out = { ...body };
  delete out.hasDebt;
  const cfg = q.config || {};
  const label = (kind) => ((cfg.kinds || []).find((x) => String(x.value) === kind) || { label: kind }).label;
  if (q.type === 'debts' && !cfg.simple && out.kinds) {
    if (out.kinds.includes('ninguna')) return { none: '1' };
    return { d: out.kinds.map((kind) => ({ name: label(kind), kind, balance: (out.k || {})[kind].balance, payment: (out.k || {})[kind].payment, rate: '', rate_type: 'desconocido' })) };
  }
  if (q.type === 'goals' && !cfg.simple && out.kinds) {
    if (out.kinds.includes('ninguna')) return { none: '1' };
    return { g: out.kinds.map((kind) => { const r = (out.gk || {})[kind] || {}; return { name: r.name || label(kind), target: r.target, saved: '', months: r.months && r.months !== '0' ? r.months : '' }; }) };
  }
  return out;
}

module.exports = { nextStep, toSubmission, periodOf, amountFor };
