# Rietvalei POS — till, owner workspace and product import/export

A single deployable web app for one independent plant nursery in South Africa. It has:

- **POS (till)** for cashiers
- **Owner workspace**: Dashboard, Products, Inventory, Barcode Labels, Sales, Reports, Import/Export, Settings
- **Bulk import and export** of products from CSV and Excel

Money is stored as integer cents (ZAR), shown in `en-ZA` format, and business dates use the `Africa/Johannesburg` time zone. The app needs no AI API key.

**Not included:** a public website, online ordering, delivery, card-terminal integration, multi-branch and offline payment capture.

## Foundation decision: why this is not WooCommerce

The brief proposed WooCommerce with FooSales. I checked what exists and found:

- **This repository** is a custom Next.js + PostgreSQL system with no WooCommerce code.
- **The connected WordPress.com site** "Rietvalei Nursery" is on a *Simple* plan. That plan cannot install plugins, so it cannot run WooCommerce or FooSales without a paid upgrade.
- **FooSales** is a separate till app with limited styling options, so the requested redesign could not be applied inside it.

The owner chose to **keep the current system as the system of record**.

Moving to WooCommerce later would need four things:

1. A Business or Commerce plan.
2. WooCommerce REST API keys, kept on the server.
3. A one-off product and stock export from this app (Import/Export → Export, which is already in a re-importable format).
4. A decision on which system holds stock and orders.

Nothing in this build blocks that path.

## Design system

The interface uses Poppins throughout. Colours are defined once as tokens in `src/app/globals.css`:

| Token | Hex | Use | Contrast |
|---|---|---|---|
| primary | `#A3E635` | Primary actions and active states, always with dark text | 11.0:1 with dark text |
| soft | `#ECFCCB` | Soft green surfaces and selected rows | deep green text on it: 8.1:1 |
| deep | `#365314` | Readable green text, focus rings, sidebar | 8.7:1 on white |
| surface | `#FFFFFF` | Cards and work surfaces | — |
| mist | `#F7F9F6` | Workspace background | — |
| line | `#E5E7EB` | Card borders (decorative only) | — |
| field | `#879189` | Form-field outlines | 3.3:1 on white (WCAG non-text minimum is 3:1) |
| ink | `#17211B` | Main text | 16.5:1 on white |
| muted | `#647067` | Secondary text | 5.2:1 on white, 4.8:1 on soft |

Rules that come from the contrast checks:

- White text on the bright green fails (1.5:1), so it is never used.
- Keyboard focus is a 3 px deep-green ring, because the bright green is too faint on white.
- Touch targets are at least 44 px.
- Icons always sit next to a text label, or have an accessible name.

The layout follows the two reference images:

- A deep-green sidebar with icons and labels. It becomes an icon rail on tablets and a drawer on phones.
- A top bar with product search, till status and the signed-in user.
- Rounded cards with restrained shadows.
- On the POS: category chips, product cards with **Add** buttons, and a full-height order panel with quantity steppers, the VAT and total summary, payment choice and **Take payment**.

## Stack

- **App:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4.
- **Database:** PostgreSQL 16 with versioned SQL migrations (`migrations/`, applied with checksums by `scripts/migrate.ts`) and rollback scripts (`migrations/rollback/`).
- **Sign-in:** Better Auth (email and password, sessions, password reset, rate limiting; public sign-up is turned off).
- **Labels:** bwip-js for Code 128 encoding and pdf-lib for vector PDFs; the label preview uses pdf.js.
- **Spreadsheets:** ExcelJS for reading and writing XLSX, plus a built-in RFC 4180 CSV parser.
- **Background jobs:** a scheduler inside the app (`src/instrumentation.ts`). It resumes imports and tidies abandoned uploads every 30 seconds.
- **Tests:** Vitest against a real PostgreSQL database, and Playwright against a production build. Barcodes are checked with poppler and ZXing.

## Local setup

You need Node.js 22, PostgreSQL 16 (installed locally or via Docker), and `poppler-utils` (only for the barcode tests).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start a development database with Docker:

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

   Or, on a local PostgreSQL, create the user and three databases yourself:

   ```bash
   sudo -u postgres psql -c "CREATE ROLE nursery LOGIN PASSWORD 'nursery' CREATEDB" -c "CREATE DATABASE nursery_dev OWNER nursery" -c "CREATE DATABASE nursery_test OWNER nursery" -c "CREATE DATABASE nursery_e2e OWNER nursery"
   ```

3. Create your settings file:

   ```bash
   cp .env.example .env
   ```

   Then set `DATABASE_URL=postgres://nursery:nursery@localhost:5432/nursery_dev` and `APP_URL=http://localhost:3000`.

4. Apply the database migrations:

   ```bash
   npm run db:migrate
   ```

5. Optionally load demo data (development only; this refuses to run when `NODE_ENV=production`):

   ```bash
   npm run db:seed
   ```

6. Run the app. Use `npm run dev` for live reload, or `npm run local` for a production build (more reliable when opened through a proxy, a preview or another device).

   ```bash
   npm run dev
   ```

The demo data includes these accounts:

- Owner: `owner@demo.test` / `demo-owner-pass`
- Cashier: `cashier@demo.test` / `demo-cashier-pass`

Without demo data, open `/setup` and enter your `SETUP_TOKEN` to create the owner.

## Tests

Integration tests run against the `nursery_test` database (46 tests):

```bash
npm test
```

Browser tests run against a production build and the `nursery_e2e` database (22 tests):

```bash
npm run test:e2e
```

Type check:

```bash
npm run typecheck
```

Results are in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

## Bulk import and export (owner)

Open **Import/Export**. The import is a six-step guided workflow:

1. **Upload** a CSV or XLSX file (up to 10 MB or 20 000 rows). Templates in both formats can be downloaded from the same page. Each template has two clearly marked EXAMPLE rows and, in the XLSX version, an instructions sheet.
2. **Map columns.** Columns are matched automatically from their headers and aliases, and each match shows example values from the file. Choose the options:
   - **What the import may do:** create and update, create only, or update only.
   - **Quantities:** ignore them, *replace* on-hand stock (a stock count), or *add* them as received stock.
   - **Blank cells:** keep the existing value, or clear optional text fields.
   - Whether to create missing categories and whether to download photos.
3. **Check and preview.** Every row is validated and compared with the catalogue. **Nothing is written at this stage.** The checks include:
   - missing or invalid SKUs, and duplicate SKUs within the file;
   - invalid prices and quantities;
   - barcodes already used by another item;
   - the same size appearing twice under one product;
   - a SKU that belongs to a different product;
   - a category that changes between rows of the same product;
   - a barcode cell saved as a number (which may already have lost its leading zeros).
   The preview shows new plants and sizes, updates (with before → after values), unchanged rows, skipped rows and problems.
4. **Confirm.** If some rows have problems, you must tick to import only the valid rows.
5. **Progress.** Rows are processed in background batches of 25, each row in its own transaction. Leaving the page is safe; a stalled job is picked up again after 2 minutes.
6. **Results.** See the outcome of every row and download the report as XLSX or CSV. Rows with problems can be corrected on screen and imported again.

How the import keeps data consistent:

- **Matching:** rows are matched to existing items by **SKU**. Pot sizes belong together through `product_handle`. Sizes never move between products.
- **No duplicates:** re-importing a file updates items in place.
- **Stock changes happen once:** each row's stock movement has a unique reference (`job:row`) enforced by a database index. A resumed or retried job can never add the same stock twice. A *new* import with "add" adds again, and the screen says so.
- **Barcodes:** leading zeros are kept. Internal barcodes can never be changed or reused. Supplier barcodes are only ever added.
- **Images:** downloaded over https only, with internal and private network addresses blocked (checked at DNS time), 5 MB and 15-second limits, and JPEG/PNG/WebP confirmed from the file's bytes. Each file is saved under a random name. A failed download is reported on its row; the rest of the row still imports.

**Export:** all products, or a filtered selection (search, category, status, low stock), as XLSX or CSV.

- **Owners** get every column, in the import template's format, so an export can be edited and imported back.
- **Cashiers** get a price list (name, category, size, SKU, barcode, price, stock).
- **XLSX** cells are written as text, never as formulas.
- **CSV** cells that start with `=`, `+`, `-` or `@` get a leading apostrophe so spreadsheets don't run them; the import removes it again.

Uploads, starts, row corrections, retries, completions, reports and exports are all recorded in `audit_log`.

## Invoices

Invoices live under **Invoices** in the owner's menu. Each invoice is saved, numbered (`INV-000001`, gap-free) and can be downloaded as an A4 PDF or e-mailed with the PDF attached.

**From the POS.** In *Take payment*, switch on **E-mail an invoice** and type the customer's e-mail (saved customers are suggested). When the sale completes, a paid invoice with the sale's lines is created and e-mailed. The sale itself is never held up: if e-mail fails, the screen says so and offers *Try again*. A sale only ever has one invoice — sending again re-sends the same one. Forgot to tick it? Use **E-mail invoice** on the *Sale complete* card or on the receipt page.

**By hand.** *Invoices → New invoice*: pick or type the customer, choose payment terms (on receipt / 7 / 14 / 30 days or a date), add plants from the catalogue or any custom line, and watch the live preview. *Save draft* keeps it editable with no number; *Issue* numbers and locks it; *Issue & e-mail* also sends it. Later: **Mark as paid** (EFT, cash, card, other), **Void** with a reason, **Duplicate**, or delete a draft. Manual invoices never change stock.

**Rules.** Prices include VAT, like shelf prices. When the business is VAT registered the document is titled *Tax invoice* with both VAT numbers. Once issued, an invoice's lines, amounts and customer are fixed by database triggers; only payment status and voiding can change. Till invoices are refunded through a return on the receipt, not voided. Cashiers can e-mail invoices for till sales but cannot open the Invoices section.

**Logo and payment details.** *Settings → Invoices & logo*: upload the nursery logo (PNG or JPG, up to 2 MB), enter bank details, default payment terms and the footer message. The invoice uses only the nursery's own logo file: the one uploaded there, or `public/brand/logo.png` committed with the app. With neither, the invoice shows the business name in text — the app never draws a logo of its own.

**E-mail setup.** Set `SMTP_URL` and `MAIL_FROM` in `.env` (any SMTP provider: Google Workspace, Microsoft 365, Afrihost, Mailgun…) and restart. Without them, invoices are still saved and downloadable, and the app clearly says nothing was sent. For demos, `MAIL_CAPTURE_DIR=./mail-out` writes each message to a JSON file instead of sending it.

## Deploy (production)

**Status:** not deployed. No hosting account, domain or server access was available in this build. See *What remains* in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

Recommended setup: a small Ubuntu VPS in a South African region (or an in-store PC) with PostgreSQL 16, Node.js 22 and Caddy for automatic HTTPS.

1. Create a server user and the database:

   ```bash
   sudo adduser --system --group nursery
   ```

   ```bash
   sudo -u postgres psql -c "CREATE ROLE nursery LOGIN PASSWORD '<strong password>'" -c "CREATE DATABASE nursery OWNER nursery"
   ```

2. Copy the app to `/srv/nursery`, then install, configure, build and migrate:

   ```bash
   npm ci
   ```

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set `APP_URL`, `BETTER_AUTH_SECRET`, `SETUP_TOKEN`, `DATABASE_URL` and `UPLOAD_DIR`.

   ```bash
   npm run build
   ```

   ```bash
   NODE_ENV=production npm run db:migrate
   ```

3. Install `deploy/nursery-pos.service` as a systemd service, then:

   ```bash
   sudo systemctl enable --now nursery-pos
   ```

4. Install `deploy/Caddyfile` (set your domain) and reload Caddy. Caddy handles HTTPS automatically.

5. Install the cron jobs in `deploy/crontab`: a nightly backup and a weekly restore drill.

6. Check the app is up. A `200` response (with the migration version and the number of stalled imports) means healthy; `503` means the database is down.

   ```bash
   curl -s https://<domain>/api/health
   ```

Later releases are deployed with `scripts/deploy.sh <tag>`. It backs up first, then builds, migrates, restarts and waits for the health check.

**Docker option:** `docker compose up -d --build` uses `Dockerfile` and `docker-compose.yml`, and binds the app to `127.0.0.1:3000` for Caddy. *This was not tested here because there is no Docker daemon in this environment.*

### Sessions, secrets and logs

- **Sessions:** cookies are `HttpOnly`, `SameSite=Lax` and `Secure` (because `APP_URL` is https), and last 14 hours. Sign-in is rate-limited.
- **Secrets:** all secrets live only in `.env`, which is git-ignored.
- **Logs:** errors are written as one JSON line each, so they can be read with `journalctl -u nursery-pos -o cat | grep '"level":"error"'`.

### Backups, restore and rollback

- **Backup:** `scripts/backup.sh` writes a database dump and a photos archive, checks the dump can be read, and keeps 30 days of files.
- **Restore:** `scripts/restore.sh` restores into an *empty* database only, never over existing data. This was tested: the counts matched.
- **Restore drill:** `scripts/restore-drill.sh` restores the newest backup into a scratch database and compares sales counts with live. Run it weekly from cron.
- **Rollback plan:**
  1. Every deploy takes a backup first.
  2. To roll back code, check out the previous tag, then rebuild and restart.
  3. If a migration must be undone, use the matching `migrations/rollback/*.down.sql` via `scripts/rollback.sh <name>`. It refuses to run without a backup from the last hour.
  4. If anything goes wrong, restore the pre-deploy backup.

  The rollback for `0003` was tested: apply → roll back (stock and sales kept) → apply again.

### Going live: removing demo data

Production should start from an empty database that has never been seeded. If the demo data was used on the production database, remove it under control:

1. Create the real owner account.
2. Take a backup.
3. Preview what would be removed (dry run, changes nothing):

   ```bash
   npm run purge:demo
   ```

4. Remove the demo accounts and their test transactions:

   ```bash
   npm run purge:demo -- --confirm
   ```

   Add `--catalogue` to also remove the placeholder plants.

The purge refuses to run if any real staff member has made a sale. It runs in a single transaction and is recorded in the audit log. It was tested on a seeded database.

## Security summary

- **Permissions** are enforced on the server for every read and write. Every service checks the signed-in person's role, and that person is re-read from the database on each request. Import, retry and corrections are owner-only.
- **CSRF:** data-changing API routes refuse requests from other sites (tested), and server actions are protected by Next.js's origin check.
- **Input validation** uses Zod. File uploads are limited in size and type. Image downloads are protected against server-side request forgery (attempts to reach internal network addresses). Exported spreadsheets are protected against formula injection.
- **Database:**
  - Sales, payments, returns and stock movements are immutable.
  - Stock can never go negative.
  - Barcodes can never be deleted or reused.
  - Each import row can move stock only once.
  - Only one till can be open at a time.
- **Audit:** every owner change, import and export is recorded.

## Project layout

```
migrations/              versioned SQL (+ rollback/)
scripts/                 migrate, seed (dev), backup/restore/drill, rollback, deploy, purge demo data, owner password reset
deploy/                  systemd unit, Caddyfile, crontab
src/server/              domain services: catalog, stock, checkout, returns, till, labels, reports, dashboard,
                         importer, exporter, spreadsheet, image-fetch, maintenance, auth, scheduler, log
src/components/shell/    sidebar + top bar
src/app/till/            POS, sales/receipts & returns, cash-up, labels, export (cashier)
src/app/admin/           dashboard, products, inventory, labels, reports, import/export, settings, staff
src/app/api/             till, checkout, labels, import/export, reports, health
tests/integration/       Vitest + PostgreSQL
tests/e2e/               Playwright + production build
docs/                    handover guide, hardware setup, acceptance checklist, test results
```
