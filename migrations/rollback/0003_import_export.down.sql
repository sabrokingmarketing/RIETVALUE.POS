-- Rollback for 0003_import_export.sql. Run only together with redeploying the previous
-- release, after taking a backup. Import history is lost; products, stock and sales are kept.
BEGIN;
DROP INDEX IF EXISTS stock_movements_import_once;
-- Import stock movements become plain adjustments so the old constraint accepts them.
ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_immutable;
UPDATE stock_movements SET source_type = 'adjustment' WHERE source_type = 'import';
ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_immutable;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_source_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source_type_check
  CHECK (source_type IN ('delivery', 'sale', 'return', 'adjustment'));
ALTER TABLE products DROP COLUMN IF EXISTS photo_source_url;
DROP TABLE IF EXISTS import_rows;
DROP TABLE IF EXISTS import_jobs;
DELETE FROM schema_migrations WHERE version = '0003_import_export.sql';
COMMIT;
