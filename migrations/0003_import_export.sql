-- 0003: bulk product import (background jobs with row-level outcomes) and export auditing.

CREATE TABLE import_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    text NOT NULL REFERENCES "user"("id"),
  created_at    timestamptz NOT NULL DEFAULT now(),
  file_name     text NOT NULL,
  format        text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  headers       jsonb NOT NULL,
  mapping       jsonb NOT NULL DEFAULT '{}',
  options       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded', 'validated', 'queued', 'running', 'completed', 'cancelled')),
  total_rows    int NOT NULL DEFAULT 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz,
  last_error    text
);
CREATE INDEX import_jobs_status_idx ON import_jobs(status);

CREATE TABLE import_rows (
  job_id        uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_no        int NOT NULL,                 -- spreadsheet row number (header = 1)
  raw           jsonb NOT NULL,               -- original cells keyed by column header
  data          jsonb,                        -- mapped, normalised values
  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'pending', 'ok', 'failed', 'skipped')),
  action        text CHECK (action IN ('create', 'update', 'unchanged', 'skip')),
  message       text NOT NULL DEFAULT '',
  warnings      jsonb NOT NULL DEFAULT '[]',
  changes       jsonb NOT NULL DEFAULT '{}',
  product_id    int REFERENCES products(id),
  variant_id    int REFERENCES variants(id),
  attempts      int NOT NULL DEFAULT 0,
  processed_at  timestamptz,
  PRIMARY KEY (job_id, row_no)
);
CREATE INDEX import_rows_status_idx ON import_rows(job_id, status);

-- Imports may move stock. Each row's movement is unique, so a resumed or retried job
-- can never add the same received quantity twice.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_source_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source_type_check
  CHECK (source_type IN ('delivery', 'sale', 'return', 'adjustment', 'import'));
CREATE UNIQUE INDEX stock_movements_import_once ON stock_movements (source_ref, variant_id) WHERE source_type = 'import';

-- Remember where an imported photo came from so re-imports don't download it again.
ALTER TABLE products ADD COLUMN photo_source_url text;
