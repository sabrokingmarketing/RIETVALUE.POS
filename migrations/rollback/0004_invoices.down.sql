-- Rollback for 0004_invoices.sql. Run only together with redeploying the previous release,
-- after taking a backup. Invoices, customers and the e-mail log are lost; sales are kept.
BEGIN;
DROP TABLE IF EXISTS invoice_emails;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP FUNCTION IF EXISTS invoice_lines_guard();
DROP FUNCTION IF EXISTS invoice_guard();
DROP TABLE IF EXISTS customers;
DELETE FROM counters WHERE name = 'invoice';
ALTER TABLE settings DROP COLUMN IF EXISTS logo_file, DROP COLUMN IF EXISTS invoice_payment_info,
  DROP COLUMN IF EXISTS invoice_terms_days, DROP COLUMN IF EXISTS invoice_thanks;
DELETE FROM schema_migrations WHERE version = '0004_invoices.sql';
COMMIT;
