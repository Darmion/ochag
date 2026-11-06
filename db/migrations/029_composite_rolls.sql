BEGIN;

ALTER TABLE roll_log DROP CONSTRAINT roll_log_formula_check;
ALTER TABLE roll_log ADD CONSTRAINT roll_log_formula_check
  CHECK (length(formula) BETWEEN 1 AND 100);

ALTER TABLE roll_log
  ADD COLUMN breakdown jsonb CHECK (breakdown IS NULL OR jsonb_typeof(breakdown) = 'array');

INSERT INTO schema_migrations(version) VALUES (29);

COMMIT;
