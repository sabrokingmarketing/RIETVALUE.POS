# Test results

Run on 2026-11-09 against PostgreSQL 16.15 and Chromium (Playwright 1.63). The browser tests run against a **production build** (`next build && next start`).

The results are split into two groups:

- **Automated** (sections 1–3): ran here and passed.
- **Physical** (section 4): needs the client's own equipment.

## 1. Type check

`npm run typecheck` reported no errors.

## 2. Integration tests: 29 passed

Command: `npm test`. These run against a real PostgreSQL test database, which is reset for every file.

```
✓ tests/integration/labels.test.ts > label PDF > A4 sheet: exact page size, start position, long names, and every barcode decodes 992ms
✓ tests/integration/labels.test.ts > label PDF > 50 × 30 mm roll bars are pure black vector rectangles at the configured module width 75ms
✓ tests/integration/labels.test.ts > money > parses and formats ZAR without floating-point drift 2ms
✓ tests/integration/edge-cases.test.ts > checkout safety > duplicate checkout (double-click) creates one sale and moves stock once 35ms
✓ tests/integration/edge-cases.test.ts > checkout safety > lost response after commit: retrying the same checkout reference returns the original sale 21ms
✓ tests/integration/edge-cases.test.ts > checkout safety > two sessions attempting the final pot: exactly one succeeds, the other is told which line 109ms
✓ tests/integration/edge-cases.test.ts > checkout safety > rejected card payment records nothing but an audit row; basket can then be paid in cash 20ms
✓ tests/integration/edge-cases.test.ts > checkout safety > unknown barcode resolves to nothing and changes nothing 2ms
✓ tests/integration/edge-cases.test.ts > checkout safety > stale price: checkout is refused until the cashier accepts the new price 25ms
✓ tests/integration/edge-cases.test.ts > checkout safety > insufficient cash is refused and nothing is recorded 10ms
✓ tests/integration/edge-cases.test.ts > checkout safety > archived products cannot be sold 11ms
✓ tests/integration/edge-cases.test.ts > checkout safety > checkout needs an open till 19ms
✓ tests/integration/edge-cases.test.ts > checkout safety > sales are immutable at the database level 6ms
✓ tests/integration/edge-cases.test.ts > returns > damaged return refunds but does not restock 55ms
✓ tests/integration/edge-cases.test.ts > returns > caps returns at the unreturned quantity and is idempotent 22ms
✓ tests/integration/edge-cases.test.ts > returns > cashier needs owner authorisation; a wrong password is refused 245ms
✓ tests/integration/edge-cases.test.ts > permissions > blocks cashier price editing, receiving, adjustments and reports 10ms
✓ tests/integration/edge-cases.test.ts > permissions > a deactivated cashier cannot complete a sale 114ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > receiving retries are safe 10ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > adjustments need a reason and can never make stock negative 24ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > supplier aliases keep leading zeros, are unique across all codes and are never reused 37ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > scans, label printing and abandoned baskets leave stock untouched 20ms
✓ tests/integration/edge-cases.test.ts > label layouts > rejects a layout too small for the code 4ms
✓ tests/integration/journey.test.ts > lavender journey > creates the plant and receives 12 at R89.90 27ms
✓ tests/integration/journey.test.ts > lavender journey > prints 12 stickers without touching stock, and the barcodes decode 257ms
✓ tests/integration/journey.test.ts > lavender journey > scans two, takes R200 cash, gives R20.20 change and issues one R179.80 receipt 16ms
✓ tests/integration/journey.test.ts > lavender journey > reprints the receipt and stock stays at 10 9ms
✓ tests/integration/journey.test.ts > lavender journey > returns one resellable plant for R89.90: 11 in stock and R89.90 net sales 147ms
✓ tests/integration/journey.test.ts > lavender journey > reconciles the till and the stock ledger 9ms
Tests  29 passed (29)
```

These tests cover:

- **The journey from the brief:** create lavender → receive 12 @ R89.90 → render 12 stickers (each page 50 × 30 mm, barcode decoded by ZXing after rasterising) → scan two → R200 cash → R20.20 change → one R179.80 receipt (S000001) → 10 in stock → reprint (still 10) → return one resellable → 11 in stock, R89.90 net sales and net cash. The return reproduces the VAT rounding (R23.45 on the sale, R11.73 on the return) and the till balances.
- **Checkout safety:**
  - A damaged return refunds the customer but does not restock.
  - Three simultaneous duplicate checkouts produce one sale.
  - Two sessions racing for the final pot: one succeeds and the other is told which line failed.
  - A lost response after commit returns the original sale.
  - A rejected card leaves an audit row only.
  - An unknown barcode changes nothing.
  - A stale price blocks checkout until accepted, and the variant is flagged for relabelling.
  - Insufficient cash is refused, and receipt numbers stay gap-free.
  - Archived products cannot be sold. Checkout needs an open till.
  - The database refuses to update or delete sales.
- **Permissions and stock:**
  - A cashier is blocked from price editing, receiving, adjustments and reports. A deactivated cashier cannot sell.
  - Returns are capped at the unreturned quantity and are idempotent. Owner authorisation is required.
  - Receiving retries are safe. Adjustments need a reason and never make stock negative.
  - Supplier aliases keep leading zeros, are unique across all codes and are never reused.
  - Scans, label jobs and abandoned baskets leave stock untouched.
- **Labels:**
  - A layout too small for the code is rejected (too narrow, too short, bars too thin, off the page).
  - A4 sheet start position and page overflow work. A long name wraps.
  - A supplier-style code with leading zeros decodes.
  - The PDF contains vector bars only (no raster images).

## 3. Browser tests: 16 passed

Command: `npm run test:e2e`. These use Playwright and Chromium against the production build.

```
✓   1 [desktop] › tests/e2e/journey.spec.ts:16:1 › owner creates lavender, receives 12 and prints 12 labels (2.8s)
✓   2 [desktop] › tests/e2e/journey.spec.ts:55:1 › cashier scans two, takes R200 cash and gives R20.20 change (1.1s)
✓   3 [desktop] › tests/e2e/journey.spec.ts:85:1 › receipt reprints without touching stock; owner returns one resellable plant (1.3s)
✓   4 [desktop] › tests/e2e/public-and-permissions.spec.ts:10:3 › public website on a phone › home, plants, plant detail, about and visit render without horizontal scroll (673ms)
✓   5 [desktop] › tests/e2e/public-and-permissions.spec.ts:26:3 › public website on a phone › owner workspace is usable on a phone (1.1s)
✓   6 [desktop] › tests/e2e/public-and-permissions.spec.ts:36:1 › public pages never expose stock counts, SKUs, barcodes or staff (463ms)
✓   7 [desktop] › tests/e2e/public-and-permissions.spec.ts:49:1 › anonymous requests to private data are refused (48ms)
✓   8 [desktop] › tests/e2e/public-and-permissions.spec.ts:59:1 › cashier cannot open owner pages, edit prices or read reports (672ms)
✓   9 [desktop] › tests/e2e/public-and-permissions.spec.ts:74:1 › deactivated cashier is signed out and cannot sign in (1.6s)
✓  10 [desktop] › tests/e2e/till-safety.spec.ts:40:1 › unknown barcode shows a message and leaves the basket intact (811ms)
✓  11 [desktop] › tests/e2e/till-safety.spec.ts:51:1 › quantity field keeps focus while typing; scanning resumes after basket buttons (832ms)
✓  12 [desktop] › tests/e2e/till-safety.spec.ts:70:1 › insufficient cash blocks completion; rejected card then approved card (1.1s)
✓  13 [desktop] › tests/e2e/till-safety.spec.ts:95:1 › lost response after commit: recovery finishes the same sale without charging twice (1.2s)
✓  14 [desktop] › tests/e2e/till-safety.spec.ts:118:1 › offline disables final checkout (815ms)
✓  15 [desktop] › tests/e2e/till-safety.spec.ts:129:1 › stale price must be accepted before tender (951ms)
✓  16 [desktop] › tests/e2e/till-safety.spec.ts:146:1 › two sessions racing for the final pot: one sale, the other told which line (5.2s)
✓  17 [desktop] › tests/e2e/till-safety.spec.ts:164:1 › duplicate checkout POST with the same key returns the original sale (550ms)
17 passed (33.8s)
```

These tests cover:

- **Lavender journey through the real UI:**
  - Owner creates the plant, receives 12 and prints the delivery labels. The PDF is fetched, checked for 12 pages of 50 × 30 mm, and the barcode is decoded.
  - Cashier opens the till, scans twice (one line, quantity 2, R179.80), tenders R200 and sees R20.20 change on S000001. Stock is 10.
  - The 80 mm reprint opens marked COPY, and stock stays at 10.
  - Owner records a resellable return: stock 11, report net sales R89.90.
  - The till closes with R0.00 variance.
- **Till failure paths:**
  - Unknown barcode.
  - Focus is not stolen from the quantity field. A scanner typing while a button has focus still lands in the scan field.
  - Insufficient cash, a declined card, then an approved card with a reference.
  - Lost response after commit: the response is dropped by the network layer, the page is reloaded, and "Check and finish sale" completes the same sale. Exactly one sale exists and stock moved once.
  - Offline disables checkout. The stale-price dialog must be accepted.
  - Two browser sessions racing for the last pot.
  - Duplicate POST with the same key, and a cross-site POST that is refused with 403.
- **Privacy and permissions:**
  - The former website paths redirect to sign-in or return 404.
  - Owner workspace pages fit a Pixel 7-sized phone with no sideways scroll.
  - Anonymous API calls get 401.
  - A cashier is sent to "Owner access only", gets 403 on reports and cannot edit prices.
  - A deactivated cashier is signed out and cannot sign in again.

## 4. Checks that need the client's equipment

These cannot be automated here. Use [ACCEPTANCE.md](ACCEPTANCE.md) on site.

| Check | Why it is not automated here |
|---|---|
| Printed sticker measures 50 × 30 mm on the real label printer at Actual size | Needs the printer, driver and label stock. The PDF page size and bar widths are verified in software. |
| The real scanner reads the printed sticker; Enter suffix and keyboard layout | Needs the scanner. Keyboard-wedge input (typing the code plus Enter) is simulated in the browser tests. |
| Label adhesive and print survive watering | Physical material test. |
| 80 mm receipt prints full-width and cuts | Needs the receipt printer and driver settings. Receipt content is checked in the browser. |
| Card terminal approval, decline and reference flow | Standalone terminal. The app's side of the flow is tested. |
| Till reconciliation with counted physical cash | Needs a real drawer count. The arithmetic is tested. |
| Docker image build (`docker compose up --build`) | No Docker daemon in this build environment. The same `npm run build && npm start` path is what the browser tests run. |
| Password-reset e-mail delivery | Needs SMTP credentials (`SMTP_URL`). Without them, links go to the server log, and `npm run owner:reset-password` is available. |
| Backup restore on the production host | The backup/restore round trip was run on the development database (counts matched). Repeat it once on the live host. |

Note: the public website was removed after this run's first version; the browser list above predates that change. The re-run after removal passed 16/16 browser tests (website tests replaced by a "website is gone" check) and 29/29 integration tests.
