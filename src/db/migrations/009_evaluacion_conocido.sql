-- Evaluación profunda inteligente: marca cuándo la persona revisó «lo que ya sabemos de ti» para no mostrarlo otra vez.
ALTER TABLE evaluations ADD COLUMN known_reviewed_at TEXT;
