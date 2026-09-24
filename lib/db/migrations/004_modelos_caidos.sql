-- Interruptor de caos «Modelos caídos»: fallan el principal y el respaldo.
-- Si falta la fila, el código lo toma como 'off'; se siembra por claridad.
INSERT OR IGNORE INTO interruptores (clave, valor) VALUES ('modelos_caidos', 'off');
