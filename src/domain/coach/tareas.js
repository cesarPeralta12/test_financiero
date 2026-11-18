'use strict';
// Propuestas de tarea del Coach (crear y completar). Nada se guarda sin confirmar; el texto sale de las
// cifras que ya calculó el servidor para el mensaje que originó la propuesta.
const money = require('../../lib/money');

const CRITERIO = 'La acción está hecha y la anotaste en tu tablero.';

/** Título, motivo y criterio de una tarea según la intención del mensaje que la origina. */
const PLANTILLAS = {
  recortar_rapido: (v) => ({ title: `Probar recortar ${String(v.categoria).toLowerCase()} un ${v.recorte_pct} % este mes`, reason: 'Es lo más fácil de ajustar sin tocar lo esencial (hipótesis, no una obligación).', criteria: 'Registraste tus gastos de esa categoría durante el mes y los comparaste con el mes anterior.' }),
  gastos_hormiga: (v) => ({ title: `Revisar mis gastos chicos de ${v.principal}`, reason: 'Los gastos pequeños y repetidos suman más de lo que se nota.', criteria: 'Anotaste cuánto gastaste esta semana en eso y decidiste si lo mantienes.' }),
  suscripciones: () => ({ title: 'Revisar mis suscripciones y pagos recurrentes', reason: 'Conviene confirmar que sigues usando todo lo que pagas cada mes.', criteria: 'Revisaste cada pago recurrente y marcaste cuáles mantienes.' }),
  deuda_liquidable: (v) => ({ title: `Liquidar «${v.deuda}» con mi saldo libre`, reason: 'Tu saldo libre del mes alcanza para saldar esa deuda sin tocar tus ahorros ni tu reserva.', criteria: 'Pagaste la deuda y actualizaste su saldo en tu calculadora.' }),
  deuda_ninguna_liquidable: (v) => ({ title: `Acercarme a liquidar «${v.deuda}»`, reason: 'Es la deuda más cercana a poder saldarse con tu saldo libre.', criteria: 'Registraste un pago o un ahorro destinado a esa deuda.' }),
  deuda_pagar_primero: (v) => ({ title: `Empezar por pagar «${v.deuda}»`, reason: 'Pagar primero la de menor saldo libera su cuota para la siguiente.', criteria: 'Hiciste el pago de esta semana y lo registraste.' }),
  meta_en_riesgo: (v) => ({ title: `Ajustar el aporte a «${v.meta}»`, reason: `Con tu aporte actual la meta tardaría ${v.meses_extra} meses más de lo que querías.`, criteria: `Definiste un aporte mensual cercano a ${money.format(v.aporte_sugerido, 'USD').replace(/[^\d.,]/g, '')} y lo anotaste.` }),
  simular_pago_extra: () => ({ title: 'Decidir si hago un pago extra a mis deudas', reason: 'La simulación muestra cuántos meses e intereses podrías ahorrar (es una hipótesis).', criteria: 'Decidiste el monto y lo registraste como pago.' }),
  mayor_gasto: (v) => ({ title: `Revisar mis gastos en ${String(v.categoria).toLowerCase()}`, reason: 'Es la categoría donde más se va tu dinero este mes.', criteria: 'Revisaste los movimientos de esa categoría y anotaste qué ajustarías.' }),
};

function propuestaTarea(intencion, vars) {
  const f = PLANTILLAS[intencion];
  if (!f) return null;
  const t = f(vars || {});
  return { title: t.title.slice(0, 120), reason: t.reason.slice(0, 300), criteria: (t.criteria || CRITERIO).slice(0, 300) };
}

module.exports = { propuestaTarea, PLANTILLAS };
