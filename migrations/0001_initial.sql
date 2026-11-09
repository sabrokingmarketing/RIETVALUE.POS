-- 0001_initial.sql — nursery POS core schema
-- Money is stored as integer cents (ZAR). Business dates are Africa/Johannesburg.

-- ---------------------------------------------------------------------------
-- Authentication (tables used by Better Auth; camelCase columns are its convention)
-- ---------------------------------------------------------------------------
CREATE TABLE "user" (
  "id"            text PRIMARY KEY,
  "name"          text NOT NULL,
  "email"         text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image"         text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),
  "role"          text NOT NULL DEFAULT 'cashier' CHECK ("role" IN ('owner', 'cashier')),
  "active"        boolean NOT NULL DEFAULT true
);

CREATE TABLE "session" (
  "id"        text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token"     text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON "session"("userId");

CREATE TABLE "account" (
  "id"                    text PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz NOT NULL DEFAULT now(),
  "updatedAt"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_user_idx ON "account"("userId");

CREATE TABLE "verification" (
  "id"         text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  timestamptz NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON "verification"("identifier");

-- ---------------------------------------------------------------------------
-- Business settings (single row)
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name      text NOT NULL DEFAULT 'Your Nursery',
  legal_name         text NOT NULL DEFAULT '',
  registration_no    text NOT NULL DEFAULT '',
  vat_registered     boolean NOT NULL DEFAULT false,
  vat_number         text NOT NULL DEFAULT '',
  vat_rate_bp        int NOT NULL DEFAULT 1500 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  address_lines      text NOT NULL DEFAULT '',
  phone              text NOT NULL DEFAULT '',
  whatsapp_number    text NOT NULL DEFAULT '',   -- international format digits, e.g. 27821234567
  email              text NOT NULL DEFAULT '',
  opening_hours      text NOT NULL DEFAULT '',   -- one line per day/period
  map_url            text NOT NULL DEFAULT '',
  directions         text NOT NULL DEFAULT '',
  tagline            text NOT NULL DEFAULT '',
  about_text         text NOT NULL DEFAULT '',
  receipt_footer     text NOT NULL DEFAULT 'Thank you for shopping with us.',
  is_fixture         boolean NOT NULL DEFAULT false, -- true when details are development placeholders
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text REFERENCES "user"("id")
);
INSERT INTO settings (id) VALUES (1);

-- Gap-free counters (receipt numbers etc). Row-locked inside the owning transaction.
CREATE TABLE counters (
  name  text PRIMARY KEY,
  value bigint NOT NULL
);
INSERT INTO counters (name, value) VALUES ('sale', 0), ('return', 0), ('delivery', 0);

-- Internal barcodes come from a sequence that is never reset, so codes are never reused.
CREATE SEQUENCE internal_barcode_seq START 1;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE,
  kind       text NOT NULL CHECK (kind IN ('plant', 'pot', 'supply')),
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id             serial PRIMARY KEY,
  common_name    text NOT NULL CHECK (length(trim(common_name)) > 0),
  botanical_name text NOT NULL DEFAULT '',
  description    text NOT NULL DEFAULT '',
  care_notes     text NOT NULL DEFAULT '',
  category_id    int NOT NULL REFERENCES categories(id),
  slug           text NOT NULL UNIQUE,
  photo_path     text,          -- file name inside UPLOAD_DIR or /fixtures path
  photo_is_fixture boolean NOT NULL DEFAULT false,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE variants (
  id                  serial PRIMARY KEY,
  product_id          int NOT NULL REFERENCES products(id),
  size_label          text NOT NULL CHECK (length(trim(size_label)) > 0), -- "15 cm pot", "6-pack"
  sku                 text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  barcode             text NOT NULL UNIQUE, -- internal Code 128 value, also present in barcodes
  price_cents         int  NOT NULL CHECK (price_cents > 0),
  low_stock_threshold int  NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
  is_public           boolean NOT NULL DEFAULT false,
  on_hand             int  NOT NULL DEFAULT 0 CHECK (on_hand >= 0), -- never negative
  relabel_needed      boolean NOT NULL DEFAULT false,
  relabel_since       timestamptz,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size_label)
);
CREATE INDEX variants_product_idx ON variants(product_id);

-- Every scannable code (internal or supplier alias). The primary key enforces
-- uniqueness across internal codes and aliases. Rows are never deleted, so an
-- archived code can never be reused.
CREATE TABLE barcodes (
  code        text PRIMARY KEY CHECK (code ~ '^[\x21-\x7E]{1,48}$'),
  variant_id  int NOT NULL REFERENCES variants(id),
  kind        text NOT NULL CHECK (kind IN ('internal', 'alias')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text REFERENCES "user"("id"),
  retired_at  timestamptz
);
CREATE INDEX barcodes_variant_idx ON barcodes(variant_id);
CREATE RULE barcodes_no_delete AS ON DELETE TO barcodes DO INSTEAD NOTHING;

CREATE TABLE price_changes (
  id          bigserial PRIMARY KEY,
  variant_id  int NOT NULL REFERENCES variants(id),
  old_cents   int NOT NULL,
  new_cents   int NOT NULL,
  changed_by  text NOT NULL REFERENCES "user"("id"),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL -- 'edit' | 'receiving'
);
CREATE INDEX price_changes_variant_idx ON price_changes(variant_id);

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------
CREATE TABLE deliveries (
  id              serial PRIMARY KEY,
  delivery_no     text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  supplier        text NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',
  received_by     text NOT NULL REFERENCES "user"("id"),
  received_at     timestamptz NOT NULL DEFAULT now(),
  business_date   date NOT NULL
);

CREATE TABLE delivery_lines (
  id          serial PRIMARY KEY,
  delivery_id int NOT NULL REFERENCES deliveries(id),
  variant_id  int NOT NULL REFERENCES variants(id),
  quantity    int NOT NULL CHECK (quantity > 0),
  price_cents int NOT NULL CHECK (price_cents > 0) -- confirmed selling price at receipt
);
CREATE INDEX delivery_lines_delivery_idx ON delivery_lines(delivery_id);

CREATE TABLE stock_movements (
  id           bigserial PRIMARY KEY,
  variant_id   int NOT NULL REFERENCES variants(id),
  quantity     int NOT NULL CHECK (quantity <> 0), -- signed delta
  balance_after int NOT NULL CHECK (balance_after >= 0),
  reason       text NOT NULL CHECK (reason IN ('receive', 'sale', 'return', 'damage', 'plant_loss', 'count_correction')),
  note         text NOT NULL DEFAULT '',
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  operator_id  text NOT NULL REFERENCES "user"("id"),
  source_type  text NOT NULL CHECK (source_type IN ('delivery', 'sale', 'return', 'adjustment')),
  source_ref   text NOT NULL
);
CREATE INDEX stock_movements_variant_idx ON stock_movements(variant_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Till and sales
-- ---------------------------------------------------------------------------
CREATE TABLE till_sessions (
  id                  serial PRIMARY KEY,
  opened_by           text NOT NULL REFERENCES "user"("id"),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  business_date       date NOT NULL,
  opening_float_cents int NOT NULL CHECK (opening_float_cents >= 0),
  closed_by           text REFERENCES "user"("id"),
  closed_at           timestamptz,
  expected_cash_cents int,
  counted_cash_cents  int CHECK (counted_cash_cents >= 0),
  variance_cents      int,
  close_note          text NOT NULL DEFAULT ''
);
-- Only one open till at a time (single checkout station)
CREATE UNIQUE INDEX till_sessions_one_open ON till_sessions ((true)) WHERE closed_at IS NULL;

CREATE TABLE sales (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no       text NOT NULL UNIQUE,
  idempotency_key  text NOT NULL UNIQUE,
  till_session_id  int NOT NULL REFERENCES till_sessions(id),
  cashier_id       text NOT NULL REFERENCES "user"("id"),
  created_at       timestamptz NOT NULL DEFAULT now(),
  business_date    date NOT NULL,
  total_cents      int NOT NULL CHECK (total_cents > 0),
  vat_cents        int NOT NULL CHECK (vat_cents >= 0),
  -- snapshot of tax/business identity for the receipt
  vat_registered   boolean NOT NULL,
  business_snapshot jsonb NOT NULL
);
CREATE INDEX sales_business_date_idx ON sales(business_date);

CREATE TABLE sale_lines (
  id               serial PRIMARY KEY,
  sale_id          uuid NOT NULL REFERENCES sales(id),
  line_no          int NOT NULL,
  variant_id       int NOT NULL REFERENCES variants(id),
  description      text NOT NULL, -- "Lavender — 15 cm pot"
  sku              text NOT NULL,
  quantity         int NOT NULL CHECK (quantity > 0),
  unit_price_cents int NOT NULL CHECK (unit_price_cents > 0),
  line_total_cents int NOT NULL CHECK (line_total_cents = unit_price_cents * quantity),
  vat_rate_bp      int NOT NULL CHECK (vat_rate_bp >= 0),
  vat_cents        int NOT NULL CHECK (vat_cents >= 0),
  UNIQUE (sale_id, line_no)
);
CREATE INDEX sale_lines_variant_idx ON sale_lines(variant_id);

CREATE TABLE payments (
  id             bigserial PRIMARY KEY,
  sale_id        uuid REFERENCES sales(id),
  return_id      int,
  direction      text NOT NULL CHECK (direction IN ('in', 'out')), -- in = sale, out = refund
  method         text NOT NULL CHECK (method IN ('cash', 'card')),
  amount_cents   int NOT NULL CHECK (amount_cents > 0),
  tendered_cents int,
  change_cents   int,
  reference      text NOT NULL DEFAULT '', -- card terminal approval/reference where available
  confirmed_by   text NOT NULL REFERENCES "user"("id"),
  created_at     timestamptz NOT NULL DEFAULT now(),
  till_session_id int REFERENCES till_sessions(id),
  CHECK ((sale_id IS NOT NULL) <> (return_id IS NOT NULL)),
  CHECK (method <> 'cash' OR direction <> 'in' OR (tendered_cents >= amount_cents AND change_cents = tendered_cents - amount_cents))
);
CREATE INDEX payments_sale_idx ON payments(sale_id);

-- Card attempts that the terminal declined: recorded for audit, never a sale.
CREATE TABLE declined_card_attempts (
  id              bigserial PRIMARY KEY,
  checkout_ref    text NOT NULL,
  amount_cents    int NOT NULL,
  note            text NOT NULL DEFAULT '',
  cashier_id      text NOT NULL REFERENCES "user"("id"),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------
CREATE TABLE returns (
  id               serial PRIMARY KEY,
  return_no        text NOT NULL UNIQUE,
  idempotency_key  text NOT NULL UNIQUE,
  sale_id          uuid NOT NULL REFERENCES sales(id),
  till_session_id  int REFERENCES till_sessions(id),
  processed_by     text NOT NULL REFERENCES "user"("id"),
  authorised_by    text NOT NULL REFERENCES "user"("id"),
  reason           text NOT NULL CHECK (length(trim(reason)) > 0),
  refund_method    text NOT NULL CHECK (refund_method IN ('cash', 'card')),
  refund_reference text NOT NULL DEFAULT '',
  total_cents      int NOT NULL CHECK (total_cents > 0),
  vat_cents        int NOT NULL CHECK (vat_cents >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  business_date    date NOT NULL
);
CREATE INDEX returns_business_date_idx ON returns(business_date);
CREATE INDEX returns_sale_idx ON returns(sale_id);
ALTER TABLE payments ADD CONSTRAINT payments_return_fk FOREIGN KEY (return_id) REFERENCES returns(id);

CREATE TABLE return_lines (
  id            serial PRIMARY KEY,
  return_id     int NOT NULL REFERENCES returns(id),
  sale_line_id  int NOT NULL REFERENCES sale_lines(id),
  quantity      int NOT NULL CHECK (quantity > 0),
  condition     text NOT NULL CHECK (condition IN ('resellable', 'damaged')),
  amount_cents  int NOT NULL CHECK (amount_cents > 0),
  vat_cents     int NOT NULL CHECK (vat_cents >= 0)
);
CREATE INDEX return_lines_sale_line_idx ON return_lines(sale_line_id);

-- Sales, sale lines and committed returns are immutable once written.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER sales_immutable BEFORE UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER sale_lines_immutable BEFORE UPDATE OR DELETE ON sale_lines FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER returns_immutable BEFORE UPDATE OR DELETE ON returns FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER return_lines_immutable BEFORE UPDATE OR DELETE ON return_lines FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------
CREATE TABLE label_presets (
  id                serial PRIMARY KEY,
  name              text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('roll', 'sheet')),
  page_width_mm     numeric(6,2) NOT NULL CHECK (page_width_mm > 0),
  page_height_mm    numeric(6,2) NOT NULL CHECK (page_height_mm > 0),
  label_width_mm    numeric(6,2) NOT NULL CHECK (label_width_mm > 0),
  label_height_mm   numeric(6,2) NOT NULL CHECK (label_height_mm > 0),
  margin_top_mm     numeric(6,2) NOT NULL DEFAULT 0 CHECK (margin_top_mm >= 0),
  margin_left_mm    numeric(6,2) NOT NULL DEFAULT 0 CHECK (margin_left_mm >= 0),
  pitch_x_mm        numeric(6,2) NOT NULL CHECK (pitch_x_mm > 0),
  pitch_y_mm        numeric(6,2) NOT NULL CHECK (pitch_y_mm > 0),
  columns           int NOT NULL CHECK (columns BETWEEN 1 AND 10),
  rows              int NOT NULL CHECK (rows BETWEEN 1 AND 30),
  padding_mm        numeric(5,2) NOT NULL DEFAULT 1.5 CHECK (padding_mm >= 0),
  module_mm         numeric(5,3) NOT NULL DEFAULT 0.375 CHECK (module_mm >= 0.19), -- narrow bar width
  is_default        boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX label_presets_one_default ON label_presets ((true)) WHERE is_default;

CREATE TABLE label_print_jobs (
  id          bigserial PRIMARY KEY,
  purpose     text NOT NULL CHECK (purpose IN ('delivery', 'batch', 'reprint', 'test', 'relabel')),
  preset_id   int NOT NULL REFERENCES label_presets(id),
  delivery_id int REFERENCES deliveries(id),
  items       jsonb NOT NULL, -- [{variantId, quantity}]
  label_count int NOT NULL,
  start_position int NOT NULL DEFAULT 1,
  created_by  text NOT NULL REFERENCES "user"("id"),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit log for owner changes
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    text REFERENCES "user"("id"),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id);

-- ---------------------------------------------------------------------------
-- Public catalogue view: the ONLY shape the public website reads.
-- No stock counts, costs, staff or transactions — just a coarse availability.
-- ---------------------------------------------------------------------------
CREATE VIEW public_catalogue AS
SELECT
  p.id            AS product_id,
  p.slug,
  p.common_name,
  p.botanical_name,
  p.description,
  p.care_notes,
  p.photo_path,
  p.photo_is_fixture,
  c.name          AS category_name,
  c.slug          AS category_slug,
  c.sort_order    AS category_sort,
  v.id            AS variant_id,
  v.size_label,
  v.price_cents,
  CASE
    WHEN v.on_hand <= 0 THEN 'sold_out'
    WHEN v.on_hand <= v.low_stock_threshold THEN 'limited'
    ELSE 'in_stock'
  END             AS availability
FROM variants v
JOIN products p   ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
WHERE v.is_public AND v.archived_at IS NULL AND p.archived_at IS NULL;

-- Default label presets (editable by the owner)
INSERT INTO label_presets
  (name, kind, page_width_mm, page_height_mm, label_width_mm, label_height_mm,
   margin_top_mm, margin_left_mm, pitch_x_mm, pitch_y_mm, columns, rows, padding_mm, module_mm, is_default)
VALUES
  ('Roll 50 × 30 mm (thermal, 203 dpi)', 'roll', 50, 30, 50, 30, 0, 0, 50, 30, 1, 1, 1.5, 0.375, true),
  ('A4 sheet 3 × 8 (63.5 × 33.9 mm)', 'sheet', 210, 297, 63.5, 33.9, 12.9, 7.2, 66.04, 33.9, 3, 8, 2, 0.33, false);
