-- 0004: invoices (from POS sales or made by hand), a small customer book and e-mail delivery log.

ALTER TABLE settings
  ADD COLUMN logo_file            text NOT NULL DEFAULT '',  -- uploaded logo (uuid.png|jpg) in the upload dir; '' = built-in logo
  ADD COLUMN invoice_payment_info text NOT NULL DEFAULT '',  -- bank details / how to pay, printed on invoices
  ADD COLUMN invoice_terms_days   int  NOT NULL DEFAULT 7 CHECK (invoice_terms_days BETWEEN 0 AND 365),
  ADD COLUMN invoice_thanks       text NOT NULL DEFAULT 'Thank you for your business!';

INSERT INTO counters (name, value) VALUES ('invoice', 0) ON CONFLICT (name) DO NOTHING;

CREATE TABLE customers (
  id          serial PRIMARY KEY,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email       text NOT NULL DEFAULT '' CHECK (length(email) <= 200),
  phone       text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  company     text NOT NULL DEFAULT '' CHECK (length(company) <= 120),
  vat_number  text NOT NULL DEFAULT '' CHECK (length(vat_number) <= 20),
  address     text NOT NULL DEFAULT '' CHECK (length(address) <= 400),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_uq ON customers (lower(email)) WHERE email <> '';
CREATE INDEX customers_name_idx ON customers (lower(name));

CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no        text UNIQUE,                       -- assigned when issued; drafts have none
  source            text NOT NULL CHECK (source IN ('sale', 'manual')),
  sale_id           uuid UNIQUE REFERENCES sales(id),  -- one invoice per POS sale
  status            text NOT NULL CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  customer_id       int REFERENCES customers(id),
  bill_name         text NOT NULL DEFAULT '',
  bill_company      text NOT NULL DEFAULT '',
  bill_email        text NOT NULL DEFAULT '',
  bill_phone        text NOT NULL DEFAULT '',
  bill_address      text NOT NULL DEFAULT '',
  bill_vat_number   text NOT NULL DEFAULT '',
  issue_date        date NOT NULL,
  due_date          date,
  reference         text NOT NULL DEFAULT '',          -- customer's order number etc.
  notes             text NOT NULL DEFAULT '',
  payment_info      text NOT NULL DEFAULT '',
  subtotal_cents    int NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),  -- excl. VAT
  vat_cents         int NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  total_cents       int NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  vat_registered    boolean NOT NULL,
  business_snapshot jsonb NOT NULL,
  paid_at           timestamptz,
  paid_method       text NOT NULL DEFAULT '' CHECK (paid_method IN ('', 'cash', 'card', 'eft', 'other')),
  paid_reference    text NOT NULL DEFAULT '',
  void_reason       text NOT NULL DEFAULT '',
  created_by        text NOT NULL REFERENCES "user"("id"),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  issued_at         timestamptz,
  voided_at         timestamptz,
  CHECK (subtotal_cents + vat_cents = total_cents),
  CHECK ((status = 'draft') = (invoice_no IS NULL)),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CHECK (due_date IS NULL OR due_date >= issue_date),
  CHECK (source <> 'sale' OR sale_id IS NOT NULL)
);
CREATE INDEX invoices_status_idx ON invoices (status, issue_date DESC);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE INDEX invoices_created_idx ON invoices (created_at DESC);

CREATE TABLE invoice_lines (
  id               serial PRIMARY KEY,
  invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no          int NOT NULL,
  variant_id       int REFERENCES variants(id),
  description      text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  sku              text NOT NULL DEFAULT '',
  quantity         int NOT NULL CHECK (quantity BETWEEN 1 AND 99999),
  unit_price_cents int NOT NULL CHECK (unit_price_cents >= 0),   -- VAT inclusive, like shelf prices
  line_total_cents int NOT NULL CHECK (line_total_cents = unit_price_cents * quantity),
  vat_rate_bp      int NOT NULL CHECK (vat_rate_bp >= 0),
  vat_cents        int NOT NULL CHECK (vat_cents >= 0),
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);

CREATE TABLE invoice_emails (
  id          serial PRIMARY KEY,
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  to_email    text NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent', 'failed', 'not_configured')),
  error       text NOT NULL DEFAULT '',
  sent_by     text REFERENCES "user"("id"),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_emails_invoice_idx ON invoice_emails (invoice_id, created_at DESC);

-- Once issued, an invoice's money, lines and bill-to details are fixed. Only payment status,
-- voiding and the timestamps may change. Drafts can be edited or deleted freely.
CREATE FUNCTION invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'issued invoices cannot be deleted' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.invoice_no IS DISTINCT FROM OLD.invoice_no OR NEW.total_cents <> OLD.total_cents OR NEW.vat_cents <> OLD.vat_cents
    OR NEW.subtotal_cents <> OLD.subtotal_cents OR NEW.bill_name <> OLD.bill_name OR NEW.bill_company <> OLD.bill_company
    OR NEW.bill_address <> OLD.bill_address OR NEW.bill_vat_number <> OLD.bill_vat_number OR NEW.issue_date <> OLD.issue_date
    OR NEW.business_snapshot <> OLD.business_snapshot OR NEW.source <> OLD.source OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
    OR NEW.status = 'draft' OR OLD.status = 'void') THEN
    RAISE EXCEPTION 'issued invoice % is immutable', OLD.invoice_no USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE FUNCTION invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN RAISE EXCEPTION 'lines of an issued invoice cannot change' USING ERRCODE = 'P0001'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
