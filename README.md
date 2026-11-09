# Nursery POS — owner workspace and till

A single deployable web app for one independent plant nursery in South Africa. There is no public website: the root URL goes straight to staff sign-in and the till.

- **Owner workspace** (`/admin`) – plants and sizes, receiving stock, label printing, stock and adjustments, day report and CSV, staff, settings.
- **Cashier till** (`/till`) – scan and sell, cash and card (separate terminal), receipts and reprints, returns, till float and cash-up.

Money is integer cents (ZAR), formatting is `en-ZA`, and business dates are `Africa/Johannesburg`. No AI API key is needed.

**Out of scope:** a public website/catalogue (removed; migration `0002` drops its view), online ordering, delivery, card-terminal integration, multi-branch and offline payment capture.

## Assumptions

| Area | Assumption |
|---|---|
| Hardware | One checkout PC or tablet with Chrome or Edge, a USB keyboard-mode barcode scanner that sends Enter after each scan, a 203 dpi direct-thermal label printer with 50 × 30 mm labels, and an 80 mm receipt printer that has a normal OS driver. See [docs/HARDWARE.md](docs/HARDWARE.md). |
| Prices | Selling prices include VAT. VAT is optional and set in Settings; 15% is the default rate. Each sale line stores its own VAT rate and amount. |
| Barcodes | Each sellable size gets an 8-digit internal Code 128 value of the form `21nnnnnn` (`21` is from the GS1 in-store range). These come from a sequence that never resets, so a code is never reused. Supplier barcodes can be added as aliases; they are stored as text, so leading zeros are kept. |
| Cards | Card payments run on the nursery's own standalone terminal. The cashier confirms the terminal shows APPROVED and may enter its reference. This app never collects card details. |
| Returns | The owner authorises every return: either the owner is signed in, or the cashier enters the owner's e-mail and password on the return form. |
| Labels | Labels show the current price at print time. They are not tied to stock, so printing or reprinting never changes stock. |
| Hosting | The app runs as one Node.js process with one PostgreSQL database behind HTTPS. Only one till is assumed (the database allows one open till session at a time). |

## Stack

- Next.js 16 (App Router), React 19, TypeScript and Tailwind CSS 4. Poppins is self-hosted via `@fontsource`.
- PostgreSQL 16 with versioned SQL migrations (`migrations/NNNN_*.sql`, applied by `scripts/migrate.ts` with checksums).
- [Better Auth](https://better-auth.com) for email/password, sessions, password reset and rate limiting. Public sign-up is disabled.
- Labels: `bwip-js` (Code 128 encoder) and `pdf-lib`. Bars are drawn as exact vector rectangles at the configured module width. The browser preview uses pdf.js.
- Tests: Vitest (integration, real PostgreSQL) and Playwright (real production build with Chromium). Barcodes are decoded with ZXing (`zxing-wasm`) after rasterising with poppler `pdftoppm`.

## Local setup (development)

Prerequisites: Node.js 22, PostgreSQL 16 (local install, or Docker) and `poppler-utils` (only needed for the barcode-decoding tests).

**1. Install dependencies** (this also copies the pdf.js worker into `public/`):

```bash
npm install
```

**2. Start a database.** Either use Docker:

```bash
docker compose -f docker-compose.dev.yml up -d
```

or create the databases on a local PostgreSQL:

```bash
sudo -u postgres psql -c "CREATE ROLE nursery LOGIN PASSWORD 'nursery' CREATEDB" -c "CREATE DATABASE nursery_dev OWNER nursery" -c "CREATE DATABASE nursery_test OWNER nursery" -c "CREATE DATABASE nursery_e2e OWNER nursery"
```

**3. Configure.** Copy the example file, then set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `SETUP_TOKEN`:

```bash
cp .env.example .env
```

**4. Apply migrations:**

```bash
npm run db:migrate
```

**5. Optional: load demo data.** This adds demo accounts, placeholder business details and sample stock. It is development only and refuses to run with `NODE_ENV=production`:

```bash
npm run db:seed
```

**6. Run the app:**

```bash
npm run dev
```

Open http://localhost:3000. With demo data, sign in as `owner@demo.test` / `demo-owner-pass` or `cashier@demo.test` / `demo-cashier-pass`. Without demo data, open `/setup` and create the owner with your `SETUP_TOKEN`.

## Tests

The integration tests use the `nursery_test` database and the browser tests use `nursery_e2e`. Both are wiped on every run.

Integration tests:

```bash
npm test
```

Browser tests (production build plus Chromium):

```bash
npm run test:e2e
```

Type check:

```bash
npm run typecheck
```

The latest results are in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

## Production deployment

Use a small VPS or an in-store PC with HTTPS in front of the app (Caddy or nginx). There are two options.

### Option A: Docker Compose (app + PostgreSQL)

**1.** Copy the example environment file:

```bash
cp .env.example .env
```

**2.** Edit `.env`:

- Set `APP_URL=https://your-domain`, a new `BETTER_AUTH_SECRET`, a `SETUP_TOKEN` and `POSTGRES_PASSWORD`.
- Optionally set `SMTP_URL` and `MAIL_FROM` for password-reset e-mails.

**3.** Build and start:

```bash
docker compose up -d --build
```

The app container applies migrations on every start, then serves on `127.0.0.1:3000`.

**4.** Put HTTPS in front. For example, a Caddyfile containing `your-domain { reverse_proxy 127.0.0.1:3000 }`.

### Option B: Plain Node.js

```bash
npm ci
```

```bash
npm run build
```

```bash
NODE_ENV=production npm run db:migrate
```

```bash
NODE_ENV=production npm start
```

Run the last command under systemd or pm2 so it restarts automatically. `UPLOAD_DIR` must be a persistent directory that is included in backups.

### First launch

1. Open `https://your-domain/setup`, enter the `SETUP_TOKEN` and create the owner account. Then remove or rotate `SETUP_TOKEN`.
2. Go to **Settings** and enter the real business details, VAT status and VAT number, address, phone and receipt footer. Check them with the owner (and their accountant for VAT).
3. Go to **Staff** and add each cashier with a temporary password.
4. Go to **Print labels → Edit label sizes** and measure the real label stock. Print a test label.
5. Never run `db:seed` against the live database. The owner dashboard shows a red warning if any `@demo.test` account is active.

### Password recovery

- **Cashier:** the owner uses **Staff → Set new password**. This also signs the cashier out everywhere.
- **Owner with e-mail configured:** use "Forgot your password?" on the sign-in page.
- **Owner without e-mail:** run this on the server:

  ```bash
  npm run owner:reset-password -- owner@example.co.za
  ```

### Backups and restore (tested)

`scripts/backup.sh` writes a `pg_dump` custom-format dump and a tarball of the photos, checks that the dump is readable and keeps 30 days of backups. Run it nightly from cron and copy `BACKUP_DIR` off-site.

Example crontab entry:

```cron
30 21 * * * cd /srv/nursery && DATABASE_URL=... UPLOAD_DIR=/srv/nursery/uploads BACKUP_DIR=/srv/backups scripts/backup.sh
```

With Docker, run `pg_dump` inside the database container instead:

```bash
docker compose exec -T db pg_dump -U nursery --format=custom nursery > backups/db_$(date +%F).dump
```

**Restoring** only works into an *empty* database. The script refuses to restore over existing data.

**1.** Create an empty database:

```bash
createdb -O nursery nursery_restore
```

**2.** Restore the dump and photos:

```bash
RESTORE_DATABASE_URL=postgres://nursery:...@localhost/nursery_restore UPLOAD_DIR=/srv/nursery/uploads scripts/restore.sh backups/db_2026-11-09_2130.dump backups/photos_2026-11-09_2130.tar.gz
```

**3.** Point `DATABASE_URL` at `nursery_restore` and restart the app. The script prints sale and product counts so you can check them against the report.

This round trip was tested on the development database: 2 sales and 154 units on hand in the source, the same in the restored copy, the ledger check passed and the immutability triggers were still active.

## Security summary

- **Permissions** are enforced on the server for every read and write. Each service function checks the actor's role (`assertRole`), and every page, route handler and server action resolves the signed-in staff member from the database. Deactivation and role changes therefore apply immediately.
- **Sessions:** HttpOnly, SameSite=Lax cookies, `Secure` when `APP_URL` is https, 14-hour lifetime. Sign-in is rate-limited in production. Owner authorisation for returns is throttled.
- **CSRF:** server actions use Next.js's built-in origin check, and route handlers that change data reject cross-site origins (tested).
- **Inputs** are validated with Zod. Uploaded photos are checked by their magic bytes and stored under random names. CSV export guards against spreadsheet formula injection.
- **Database integrity:**
  - Sales, sale lines, payments, returns and stock movements are immutable (triggers).
  - Stock cannot go negative (CHECK constraint).
  - Barcodes cannot be deleted (rule), so they are never reused.
  - Only one till can be open at a time.
  - Receipt numbers come from gap-free counters.
- **Audit:** owner changes go to `audit_log`. Each stock movement records quantity, reason, time, operator and source reference.
- **Secrets** come only from the environment (`.env` is git-ignored).

## Project layout

```
migrations/            versioned SQL
scripts/               migrate, seed (dev only), backup/restore, owner password reset
src/server/            domain services (catalog, stock, checkout, returns, till, labels, reports, users, auth)
src/app/till/          cashier till, receipts, returns, cash-up
src/app/admin/         owner workspace
src/app/api/           till lookup/search, checkout, label PDFs, CSV, health
src/app/print/         print-friendly 80 mm / A4 receipts and return slips
tests/integration/     Vitest against PostgreSQL
tests/e2e/             Playwright against a production build
docs/                  handover guide, hardware setup, acceptance checklist, test results
```
