-- «¿Recibes otros ingresos regulares?» ahora pregunta primero Sí/No; la ayuda ya no pide escribir 0.
UPDATE questions SET help = 'Rentas, trabajos extra o apoyos que recibes con regularidad.' WHERE code = 'ingresos_adicionales';
