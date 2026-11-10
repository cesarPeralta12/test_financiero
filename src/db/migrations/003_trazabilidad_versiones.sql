-- Fase 1: trazabilidad por versión en cada resultado nuevo del test gratuito.
-- Las columnas son opcionales: los resultados anteriores (RESULT_FREE_V1_ES sin
-- trazabilidad) siguen siendo legibles tal como se guardaron.
ALTER TABLE ft_results ADD COLUMN catalog_version TEXT;
ALTER TABLE ft_results ADD COLUMN knowledge_version TEXT;
ALTER TABLE ft_results ADD COLUMN rules_framework_version TEXT;
ALTER TABLE ft_results ADD COLUMN prompt_version TEXT;
ALTER TABLE ft_results ADD COLUMN model TEXT;
ALTER TABLE ft_results ADD COLUMN result_schema_version TEXT;
ALTER TABLE ft_results ADD COLUMN methodology_hash TEXT;
ALTER TABLE ft_results ADD COLUMN input_hash TEXT;
ALTER TABLE ft_results ADD COLUMN fact_package_json TEXT;
