'use strict';
// Capa de juego: XP, niveles, rachas y logros. Todo se deriva de la actividad ya
// guardada (no hay tablas nuevas). El XP premia acciones, nunca el dinero que
// alguien tiene: no es una calificación financiera ni crediticia.
const db = require('../db');

// XP por acción (con topes para evitar inflar el contador repitiendo acciones).
const XP = {
  test: 100,
  cuenta: 50,
  correo: 20,
  evaluacion: 250,
  plan: 150,
  tarea: 40,
  movimiento: 5,
  presupuesto: 30,
  meta: 20,
  metaAlcanzada: 150,
  saldoDeuda: 15,
  escenario: 15,
  coach: 3,
  hito: 60,
};

const LEVELS = [
  [0, 'Explorador'],
  [150, 'Aprendiz'],
  [400, 'Organizador'],
  [800, 'Estratega'],
  [1300, 'Constructor'],
  [2000, 'Disciplinado'],
  [2900, 'Imparable'],
  [4000, 'Maestro'],
  [5400, 'Leyenda'],
  [7200, 'Leyenda Día Uno'],
];

const ACHIEVEMENTS = [
  { code: 'primer_paso', icon: 'flag', title: 'Primer paso', desc: 'Termina el test gratuito.' },
  { code: 'jugador', icon: 'user', title: 'Jugador registrado', desc: 'Crea tu cuenta y guarda tu partida.' },
  { code: 'radiografia', icon: 'scan', title: 'Radiografía', desc: 'Completa la evaluación profunda.' },
  { code: 'dia_uno', icon: 'calendar', title: 'Día Uno', desc: 'Genera tu Plan Maestro.' },
  { code: 'primera_mision', icon: 'check', title: 'Primera misión', desc: 'Completa tu primera tarea.' },
  { code: 'cinco_misiones', icon: 'stack', title: 'En marcha', desc: 'Completa 5 tareas.' },
  { code: 'diez_misiones', icon: 'rocket', title: 'Velocidad crucero', desc: 'Completa 10 tareas.' },
  { code: 'presupuesto', icon: 'grid', title: 'Arquitecto', desc: 'Arma tu primer presupuesto mensual.' },
  { code: 'registro_10', icon: 'list', title: 'Ojo de halcón', desc: 'Registra 10 movimientos.' },
  { code: 'ahorrador', icon: 'piggy', title: 'Ahorrador', desc: 'Registra tu primer aporte a ahorro.' },
  { code: 'cazadeudas', icon: 'sword', title: 'Cazadeudas', desc: 'Actualiza el saldo de una deuda y bájalo.' },
  { code: 'estratega', icon: 'chart', title: 'Estratega', desc: 'Guarda un escenario del simulador.' },
  { code: 'conversador', icon: 'chat', title: 'Buen diálogo', desc: 'Envía 5 mensajes al coach.' },
  { code: 'racha_3', icon: 'flame', title: 'Encendido', desc: 'Mantén una racha de 3 días.' },
  { code: 'racha_7', icon: 'flame', title: 'Semana perfecta', desc: 'Mantén una racha de 7 días.' },
  { code: 'meta_cumplida', icon: 'trophy', title: 'Meta cumplida', desc: 'Alcanza una de tus metas.' },
  { code: 'hito', icon: 'star', title: 'Hito del año', desc: 'Marca un hito como alcanzado.' },
];

function v(sql, ...p) {
  return Number(db.value(sql, ...p) || 0);
}

function streak(userId) {
  const rows = db.all(
    `SELECT DISTINCT substr(d, 1, 10) AS day FROM (
       SELECT created_at AS d FROM task_events WHERE user_id = ? AND from_status IS NOT NULL
       UNION ALL SELECT created_at FROM movements WHERE user_id = ?
       UNION ALL SELECT m.created_at FROM messages m WHERE m.user_id = ? AND m.role = 'usuario'
       UNION ALL SELECT a.updated_at FROM answers a JOIN evaluations e ON e.id = a.evaluation_id WHERE e.user_id = ?
       UNION ALL SELECT updated_at FROM budget_lines WHERE user_id = ?
     ) ORDER BY day DESC`,
    userId,
    userId,
    userId,
    userId,
    userId
  ).map((r) => r.day);
  if (!rows.length) return { days: 0, activeToday: false };
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (rows[0] !== today && rows[0] !== yesterday) return { days: 0, activeToday: false };
  let days = 1;
  let cur = new Date(rows[0] + 'T12:00:00Z');
  for (let i = 1; i < rows.length; i++) {
    cur = new Date(cur.getTime() - 86400000);
    if (rows[i] === cur.toISOString().slice(0, 10)) days++;
    else break;
  }
  return { days, activeToday: rows[0] === today };
}

function levelFor(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i][0]) idx = i;
  const [from, name] = LEVELS[idx];
  const next = LEVELS[idx + 1] ? LEVELS[idx + 1][0] : null;
  return {
    level: idx + 1,
    name,
    from,
    next,
    progress: next ? (xp - from) / (next - from) : 1,
    toNext: next ? next - xp : 0,
  };
}

/** Perfil de juego de una cuenta. */
function profile(userId) {
  const c = {
    tests: v("SELECT COUNT(*) FROM evaluations WHERE user_id = ? AND kind = 'gratuito' AND status = 'finalizada'", userId),
    verified: v('SELECT COUNT(*) FROM users WHERE id = ? AND email_verified_at IS NOT NULL', userId),
    diagnoses: v('SELECT COUNT(*) FROM diagnoses WHERE user_id = ?', userId),
    plans: v("SELECT COUNT(*) FROM plan_versions WHERE user_id = ? AND status = 'completo'", userId),
    tasks: v("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completada'", userId),
    movements: v('SELECT COUNT(*) FROM movements WHERE user_id = ?', userId),
    savings: v("SELECT COUNT(*) FROM movements WHERE user_id = ? AND kind = 'ahorro'", userId),
    budgets: v('SELECT COUNT(DISTINCT month) FROM budget_lines WHERE user_id = ?', userId),
    goals: v("SELECT COUNT(*) FROM goals WHERE user_id = ? AND source <> 'plan'", userId),
    goalsReached: v("SELECT COUNT(*) FROM goals WHERE user_id = ? AND status = 'alcanzada'", userId),
    debtUpdates: v("SELECT COUNT(*) FROM debt_balances WHERE user_id = ? AND note = 'Saldo actualizado'", userId),
    scenarios: v('SELECT COUNT(*) FROM scenarios WHERE user_id = ?', userId),
    coach: v("SELECT COUNT(*) FROM messages WHERE user_id = ? AND role = 'usuario'", userId),
    milestones: v("SELECT COUNT(*) FROM milestones WHERE user_id = ? AND status = 'alcanzado'", userId),
  };
  const debtDown = db.value(
    `SELECT 1 FROM debt_balances b WHERE b.user_id = ? AND b.note = 'Saldo actualizado'
       AND CAST(b.balance AS REAL) < (SELECT CAST(p.balance AS REAL) FROM debt_balances p WHERE p.debt_id = b.debt_id AND p.id < b.id ORDER BY p.id DESC LIMIT 1) LIMIT 1`,
    userId
  );
  const st = streak(userId);
  const breakdown = [
    ['Test gratuito', Math.min(c.tests, 1) * XP.test],
    ['Cuenta creada', XP.cuenta],
    ['Correo verificado', c.verified * XP.correo],
    ['Evaluaciones profundas', Math.min(c.diagnoses, 3) * XP.evaluacion],
    ['Planes generados', Math.min(c.plans, 3) * XP.plan],
    ['Tareas completadas', c.tasks * XP.tarea],
    ['Movimientos registrados', Math.min(c.movements, 300) * XP.movimiento],
    ['Presupuestos mensuales', c.budgets * XP.presupuesto],
    ['Metas creadas', Math.min(c.goals, 10) * XP.meta],
    ['Metas alcanzadas', c.goalsReached * XP.metaAlcanzada],
    ['Saldos de deuda actualizados', Math.min(c.debtUpdates, 60) * XP.saldoDeuda],
    ['Escenarios guardados', Math.min(c.scenarios, 20) * XP.escenario],
    ['Mensajes al coach', Math.min(c.coach, 100) * XP.coach],
    ['Hitos alcanzados', c.milestones * XP.hito],
  ];
  const xp = breakdown.reduce((a, [, n]) => a + n, 0);
  const unlocked = {
    primer_paso: c.tests > 0,
    jugador: true,
    radiografia: c.diagnoses > 0,
    dia_uno: c.plans > 0,
    primera_mision: c.tasks >= 1,
    cinco_misiones: c.tasks >= 5,
    diez_misiones: c.tasks >= 10,
    presupuesto: c.budgets > 0,
    registro_10: c.movements >= 10,
    ahorrador: c.savings > 0,
    cazadeudas: Boolean(debtDown),
    estratega: c.scenarios > 0,
    conversador: c.coach >= 5,
    racha_3: st.days >= 3,
    racha_7: st.days >= 7,
    meta_cumplida: c.goalsReached > 0,
    hito: c.milestones > 0,
  };
  const achievements = ACHIEVEMENTS.map((a) => ({ ...a, unlocked: Boolean(unlocked[a.code]) }));
  return {
    xp,
    ...levelFor(xp),
    streak: st.days,
    activeToday: st.activeToday,
    achievements,
    unlockedCount: achievements.filter((a) => a.unlocked).length,
    breakdown: breakdown.filter(([, n]) => n > 0),
    counts: c,
  };
}

// Iconos en línea (SVG) para logros y el panel del jugador.
const ICONS = {
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9 15l2 2 4-4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  stack: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  rocket: '<path d="M12 15c-2-2-3-5-1-9 2-3 6-3 8-3 0 2 0 6-3 8-4 2-4 4-4 4z"/><path d="M9 15l-3 3M7 13l-3-1 3-3h3M11 17l1 3 3-3v-3"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/>',
  piggy: '<path d="M5 11a6 5 0 0 1 11-3h2l1 3-2 1v3l-2 1v2h-3v-2H9v2H6v-3a5 5 0 0 1-1-4z"/><circle cx="14" cy="10" r=".8"/>',
  sword: '<path d="M14 4h6v6L9 21l-3-3L17 7"/><path d="M5 15l4 4M4 20l2-2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  flame: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-5 1-8z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
};

function icon(name, cls = 'gi') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.star}</svg>`;
}

module.exports = { XP, LEVELS, ACHIEVEMENTS, profile, levelFor, icon, ICONS };
