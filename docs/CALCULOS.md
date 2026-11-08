# Reglas de cálculo

Motor: `src/domain/calc.js` (versión `1.0.0`, guardada en cada diagnóstico). El servidor calcula todas las cifras; la IA solo las explica. Pruebas: `test/calc.test.js`.

## Precisión y redondeo

- Los importes se manejan como decimales exactos con `decimal.js` (28 dígitos significativos) y se guardan como texto (`'1250.50'`), nunca como coma flotante.
- **Método de redondeo:** `ROUND_HALF_UP` (redondeo comercial: 0,005 pasa a 0,01; −1,005 pasa a −1,01) a **2 decimales**:
  - en pantalla, en el PDF y en los importes guardados;
  - en el interés de cada periodo de una proyección de deuda (como lo hacen las entidades al liquidar mes a mes).
- Los resultados intermedios (tasas mensuales, cocientes) no se redondean.
- Una moneda base por cuenta, elegida en el test. No hay conversiones automáticas: un movimiento en otra moneda se rechaza con un mensaje que pide registrarlo ya convertido.
- Los precios de los productos se guardan en centavos enteros.

## Dato desconocido frente a cero

«No lo sé» se guarda como desconocido (`is_unknown = 1`, sin valor), nunca como 0. Un cálculo que depende de un dato desconocido no se hace: se informa «No calculable» o «Sin dato» y se lista en *Datos insuficientes* o *Datos faltantes*.

## Normalización mensual

| Periodicidad | Factor a mes |
|---|---|
| Semanal | × 52 ÷ 12 |
| Cada 14 días | × 26 ÷ 12 |
| Quincenal (dos veces al mes) | × 2 |
| Mensual | × 1 |
| Bimestral | ÷ 2 |
| Trimestral | ÷ 3 |
| Semestral | ÷ 6 |
| Anual | ÷ 12 |

Los ingresos registran si son netos o brutos. Si son brutos, se avisa y se usan como si fueran netos (supuesto explícito). Los gastos y los pagos de deuda se piden por separado para no contarlos dos veces; el desglose de gastos excluye pagos de deuda y se avisa si hay hipoteca y gasto de vivienda a la vez.

## Fórmulas

- **Saldo disponible** = ingresos netos − gastos − pagos de deuda.
- **Tasa de ahorro** = ahorro mensual ÷ ingresos netos, solo si los ingresos son mayores que 0 (si no, «No aplica sin ingresos»).
- **Avance de meta** = ahorro asignado ÷ objetivo (máximo 100 %).
- **Plazo estimado** = monto pendiente ÷ aporte mensual, redondeado hacia arriba en meses. Con aporte 0 o negativo: «no existe un plazo alcanzable con estos datos». Más de 600 meses: «plazo mayor a 50 años».
- **Aporte necesario** = monto pendiente ÷ meses deseados.
- **Meses de reserva** = ahorro disponible ÷ (gastos + pagos de deuda).
- **Reserva de referencia** = (gastos esenciales + gastos anuales mensualizados + pagos de deuda) × meses recomendados (regla versionada, 3 en v1).

## Tasas de interés

| Tipo | Tasa mensual |
|---|---|
| Nominal anual (mensualizable) | tasa ÷ 12 |
| Efectiva anual | (1 + tasa)^(1/12) − 1 |
| Mensual | tasa |
| No lo sé | sin calcular: la simulación queda **incompleta** y se pide el dato |

## Proyección de deuda

Mes a mes: interés = saldo × tasa mensual (redondeado); se suman comisiones y seguros **solo si se conocen**; el pago cubre interés, cargos y capital; el saldo nunca baja de 0.

- Si la cuota no supera el interés más los cargos del primer mes, se muestra la alerta «la cuota no cubre el interés» con el faltante y **no se devuelve una fecha de cancelación**.
- Varias deudas (Plan Maestro y simulador): método **avalancha**. Se cubren todas las cuotas y el pago extra va a la deuda con mayor tasa mensual conocida; al liquidarse una, su cuota pasa a la siguiente. Las deudas sin tasa no reciben extra y se listan como incompletas.

## Plan Maestro

- Disponible para el plan = máx(saldo disponible + ajuste de gasto, 0). El ajuste es un **supuesto**: gastos flexibles × porcentaje elegido por la persona (regla `ajuste_gasto`), limitado por lo que dijo poder recortar.
- Perfil y pesos (regla `asignacion`): *sin reserva* (menos de 1 mes) 50/30/20, *deuda cara* (tasa efectiva > 20 % o cuota que no amortiza) 30/50/20, *equilibrio* 40/20/40 entre reserva, deuda y metas. La prioridad declarada suma 10 puntos a su partida. Las partidas sin destino (sin deudas con tasa, sin metas o con la reserva completa) se redistribuyen. Los centavos sobrantes van a la última partida.
- Escenarios a 12 meses: sin cambios (dato), con el plan (cálculo) y con ingreso extra (supuesto, nunca ingreso garantizado).

## Simulador

El escenario base es el presupuesto del mes en curso, si existe, o el último diagnóstico. El pago extra a deuda se suma **una sola vez** a los pagos del mes y se aplica al capital en la proyección; el saldo libre baja exactamente en ese importe (prueba automatizada). Simular no escribe nada; guardar un escenario requiere pedirlo.

## Calculadora

Lo previsto (presupuesto mensual) y lo real (movimientos) se guardan y se muestran por separado; nunca se suman entre sí. Los totales se recalculan siempre desde los movimientos, así que editar o eliminar no duplica. Las transferencias entre ahorros propios no cuentan como ingreso ni como gasto; solo mueven saldo entre metas.

## Umbrales versionados (reglas v1, pendientes de validación)

| Regla | Valor |
|---|---|
| Tasa de ahorro baja / saludable | 5 % / 15 % |
| Carga de deuda moderada / alta (cuotas ÷ ingreso) | 20 % / 35 % |
| Reserva mínima / recomendada / sólida | 1 / 3 / 6 meses |
| Vivienda alta (÷ ingreso) | 35 % |
| Deuda cara (tasa efectiva anual) | 20 % |
| Tolerancia de contradicciones | 10 % (mínimo 1 unidad) |

Se editan y publican en *Administración > Reglas*. Ninguna regla asigna una puntuación crediticia.
