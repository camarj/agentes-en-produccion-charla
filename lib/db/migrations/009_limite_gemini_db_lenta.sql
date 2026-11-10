-- Interruptores de caos de PRD §15 G7, apagados:
-- «Límite de Gemini»: el principal falla con un 429 RESOURCE_EXHAUSTED simulado.
-- «Base de datos lenta»: cada consulta de la app a charla.db tarda 1,5 s más.
INSERT INTO interruptores (clave, valor) VALUES ('limite_gemini', 'off') ON CONFLICT (clave) DO NOTHING;
INSERT INTO interruptores (clave, valor) VALUES ('base_datos_lenta', 'off') ON CONFLICT (clave) DO NOTHING;
