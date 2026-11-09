# Test results

Run on 2026-11-09 against PostgreSQL 16.15 and Chromium (Playwright 1.63). The browser tests ran against a **production build** (`next build && next start`) on its own database.

This report has three sections:

1. **Automated checks:** all ran in this build environment and passed.
2. **Manual checks done here:** layout and backup checks run by hand in this environment.
3. **Physical and live checks:** need the nursery's equipment, a payment terminal or hosting access, and have **not** been done.

## 1. Automated checks

### Type check

`npm run typecheck` reported no errors.

### Integration tests: 46 passed

Command: `npm test`. These run against a real PostgreSQL test database.

```
✓ tests/integration/labels.test.ts > label PDF > A4 sheet: exact page size, start position, long names, and every barcode decodes 767ms
✓ tests/integration/labels.test.ts > label PDF > 50 × 30 mm roll bars are pure black vector rectangles at the configured module width 58ms
✓ tests/integration/labels.test.ts > money > parses and formats ZAR without floating-point drift 1ms
✓ tests/integration/edge-cases.test.ts > checkout safety > duplicate checkout (double-click) creates one sale and moves stock once 32ms
✓ tests/integration/edge-cases.test.ts > checkout safety > lost response after commit: retrying the same checkout reference returns the original sale 22ms
✓ tests/integration/edge-cases.test.ts > checkout safety > two sessions attempting the final pot: exactly one succeeds, the other is told which line 90ms
✓ tests/integration/edge-cases.test.ts > checkout safety > rejected card payment records nothing but an audit row; basket can then be paid in cash 17ms
✓ tests/integration/edge-cases.test.ts > checkout safety > unknown barcode resolves to nothing and changes nothing 2ms
✓ tests/integration/edge-cases.test.ts > checkout safety > stale price: checkout is refused until the cashier accepts the new price 21ms
✓ tests/integration/edge-cases.test.ts > checkout safety > insufficient cash is refused and nothing is recorded 14ms
✓ tests/integration/edge-cases.test.ts > checkout safety > archived products cannot be sold 10ms
✓ tests/integration/edge-cases.test.ts > checkout safety > checkout needs an open till 11ms
✓ tests/integration/edge-cases.test.ts > checkout safety > sales are immutable at the database level 4ms
✓ tests/integration/edge-cases.test.ts > returns > damaged return refunds but does not restock 44ms
✓ tests/integration/edge-cases.test.ts > returns > caps returns at the unreturned quantity and is idempotent 17ms
✓ tests/integration/edge-cases.test.ts > returns > cashier needs owner authorisation; a wrong password is refused 164ms
✓ tests/integration/edge-cases.test.ts > permissions > blocks cashier price editing, receiving, adjustments and reports 10ms
✓ tests/integration/edge-cases.test.ts > permissions > a deactivated cashier cannot complete a sale 84ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > receiving retries are safe 8ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > adjustments need a reason and can never make stock negative 12ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > supplier aliases keep leading zeros, are unique across all codes and are never reused 21ms
✓ tests/integration/edge-cases.test.ts > stock and barcodes > scans, label printing and abandoned baskets leave stock untouched 17ms
✓ tests/integration/edge-cases.test.ts > label layouts > rejects a layout too small for the code 3ms
✓ tests/integration/import-export.test.ts > bulk import > imports plants with several pot sizes, prices, stock and barcodes (leading zeros kept) 115ms
✓ tests/integration/import-export.test.ts > bulk import > export → re-import updates in place without duplicates, and price edits flag relabelling 114ms
✓ tests/integration/import-export.test.ts > bulk import > re-processing or resuming a job never adds the same stock twice 36ms
✓ tests/integration/import-export.test.ts > bulk import > partial failures: bad rows are reported, good rows import, corrected rows import on retry 74ms
✓ tests/integration/import-export.test.ts > bulk import > modes: create-only skips existing SKUs, update-only skips new ones; blank cells keep or clear 84ms
✓ tests/integration/import-export.test.ts > bulk import > archiving through import stops the barcode scanning 22ms
✓ tests/integration/import-export.test.ts > bulk import > rejects invalid files with a clear message and writes nothing 7ms
✓ tests/integration/import-export.test.ts > bulk import > warns when a barcode column was stored as numbers in Excel 27ms
✓ tests/integration/import-export.test.ts > bulk import > validation and cancelling write nothing to the catalogue 15ms
✓ tests/integration/import-export.test.ts > bulk import > only owners can import; cashiers export a limited price list 4ms
✓ tests/integration/import-export.test.ts > bulk import > guards CSV exports against formula injection and re-imports the exact value 36ms
✓ tests/integration/import-export.test.ts > bulk import > template downloads in both formats and auto-maps cleanly 14ms
✓ tests/integration/import-export.test.ts > image import > blocks internal addresses 0ms
✓ tests/integration/import-export.test.ts > image import > stores downloaded photos, and reports failed downloads as row warnings 24ms
✓ tests/integration/journey.test.ts > lavender journey > creates the plant and receives 12 at R89.90 21ms
✓ tests/integration/journey.test.ts > lavender journey > prints 12 stickers without touching stock, and the barcodes decode 182ms
✓ tests/integration/journey.test.ts > lavender journey > scans two, takes R200 cash, gives R20.20 change and issues one R179.80 receipt 12ms
✓ tests/integration/journey.test.ts > lavender journey > reprints the receipt and stock stays at 10 5ms
✓ tests/integration/journey.test.ts > lavender journey > returns one resellable plant for R89.90: 11 in stock and R89.90 net sales 101ms
✓ tests/integration/journey.test.ts > lavender journey > reconciles the till and the stock ledger 10ms
✓ tests/integration/maintenance.test.ts > removing development fixtures before launch > is blocked until a real owner exists 5ms
✓ tests/integration/maintenance.test.ts > removing development fixtures before launch > dry run lists demo data; confirm removes demo accounts, test sales and the fixture catalogue 128ms
✓ tests/integration/maintenance.test.ts > removing development fixtures before launch > refuses when real staff have made sales 14ms
Test Files  5 passed (5)
Tests  46 passed (46)
```

The **import and export** tests (`import-export.test.ts`) cover:

- Importing 5 sizes of 3 plants: multiple pot sizes grouped under one plant, prices, stock added once, a supplied barcode `00012345` with its leading zeros kept, supplier barcodes that scan, and a pot category given the correct kind.
- Export to XLSX, then re-import:
  - unchanged rows are reported as "no change" and no items are duplicated;
  - an edited price and stock count update in place;
  - the re-priced size is flagged for new shelf labels;
  - the stock ledger still balances.
- Resume safety: re-processing a finished row, or resuming a stalled job, never adds stock twice. Exactly one stock movement is recorded.
- Partial failure with 10 rows: 9 row-level problems are reported (bad price, missing SKU, duplicate SKU in the file, the same size twice, a barcode already taken, a SKU belonging to another plant, a new plant without name or category). The valid row imports. Two corrected rows import on retry. The results report lists every row.
- Import modes: create-only, update-only, and blank cells kept or cleared.
- Archiving an item through import.
- Invalid files refused with clear messages: empty, a fake .xlsx, headers only, duplicate headers, an unclosed CSV quote, the wrong file type, no SKU mapped, and one column mapped twice.
- A warning when a barcode column was stored as numbers in Excel.
- Validating or cancelling an import writes nothing.
- Owner-only import, and the cashier's limited export columns.
- The audit trail for imports and exports.
- CSV formula-injection guard, with the exact value restored on re-import.
- Templates in both formats map automatically.
- Image import:
  - private and internal addresses are blocked (127/8, 10/8, 172.16/12, 192.168/16, 169.254.169.254, ::1, fd00::/8, IPv4-mapped addresses);
  - a photo downloads and is stored under a random name;
  - a non-image link becomes a row warning, and the rest of the row still imports.

The **demo-data removal** tests (`maintenance.test.ts`) cover:

- The purge is blocked until a real owner exists.
- The dry-run plan is accurate.
- Confirming removes the demo accounts, their test sales and the fixture catalogue, resets receipt numbering, keeps the stock ledger balanced, and leaves the immutability triggers active.
- The purge refuses outright once real staff have made a sale.

The integration tests from earlier rounds all still pass. They cover:

- **Lavender journey:** receive 12 @ R89.90, render 12 labels (50 × 30 mm, decoded), sell 2 for R179.80 with R200 cash and R20.20 change, 10 left, reprint, return 1, 11 left, net sales R89.90.
- **Checkout safety:** duplicate checkout, lost response, last-pot race, card declined, stale price, insufficient cash, an archived item, the till closed.
- **Integrity:** database immutability, permissions, returns limits, stock adjustments, barcode aliases, label layout limits, money and VAT rounding.

### Browser tests: 22 passed

Command: `npm run test:e2e`. These run Chromium against the production build.

```
✓   1 [desktop] › tests/e2e/import-export.spec.ts:17:1 › owner imports plants with several pot sizes through the guided workflow (2.8s)
✓   2 [desktop] › tests/e2e/import-export.spec.ts:48:1 › export, then re-import the same file: everything matches, nothing is duplicated (2.2s)
✓   3 [desktop] › tests/e2e/import-export.spec.ts:66:1 › partial failure: the bad row is held back, corrected and retried (3.5s)
✓   4 [desktop] › tests/e2e/import-export.spec.ts:88:1 › an invalid file is refused with a clear message (533ms)
✓   5 [desktop] › tests/e2e/import-export.spec.ts:94:1 › cashiers cannot import but can export a price list (566ms)
✓   6 [desktop] › tests/e2e/import-export.spec.ts:109:3 › tablet › POS keeps the total and Take payment on screen (602ms)
✓   7 [desktop] › tests/e2e/journey.spec.ts:16:1 › owner creates lavender, receives 12 and prints 12 labels (1.7s)
✓   8 [desktop] › tests/e2e/journey.spec.ts:55:1 › cashier scans two, takes R200 cash and gives R20.20 change (894ms)
✓   9 [desktop] › tests/e2e/journey.spec.ts:85:1 › receipt reprints without touching stock; owner returns one resellable plant (1.2s)
✓  10 [desktop] › tests/e2e/permissions.spec.ts:10:3 › owner screens on a phone › owner workspace is usable on a phone (1.1s)
✓  11 [desktop] › tests/e2e/permissions.spec.ts:20:1 › the public website is gone: the root goes to sign-in (53ms)
✓  12 [desktop] › tests/e2e/permissions.spec.ts:28:1 › anonymous requests to private data are refused (30ms)
✓  13 [desktop] › tests/e2e/permissions.spec.ts:38:1 › cashier cannot open owner pages, edit prices or read reports (634ms)
✓  14 [desktop] › tests/e2e/permissions.spec.ts:53:1 › deactivated cashier is signed out and cannot sign in (1.2s)
✓  15 [desktop] › tests/e2e/till-safety.spec.ts:40:1 › unknown barcode shows a message and leaves the basket intact (650ms)
✓  16 [desktop] › tests/e2e/till-safety.spec.ts:51:1 › quantity field keeps focus while typing; scanning resumes after basket buttons (809ms)
✓  17 [desktop] › tests/e2e/till-safety.spec.ts:70:1 › insufficient cash blocks completion; rejected card then approved card (956ms)
✓  18 [desktop] › tests/e2e/till-safety.spec.ts:95:1 › lost response after commit: recovery finishes the same sale without charging twice (1.2s)
✓  19 [desktop] › tests/e2e/till-safety.spec.ts:118:1 › offline disables final checkout (677ms)
✓  20 [desktop] › tests/e2e/till-safety.spec.ts:129:1 › stale price must be accepted before tender (887ms)
✓  21 [desktop] › tests/e2e/till-safety.spec.ts:146:1 › two sessions racing for the final pot: one sale, the other told which line (5.1s)
✓  22 [desktop] › tests/e2e/till-safety.spec.ts:164:1 › duplicate checkout POST with the same key returns the original sale (459ms)
22 passed (42.4s)
```

New in this round:

- **Import wizard in the real UI:**
  - upload an XLSX with 5 sizes of 3 plants;
  - automatic column matching;
  - "add received stock" option;
  - preview shows 3 new plants and 0 problems, with nothing written before confirming;
  - import completes, with barcode `000777000` kept and both sizes on one plant;
  - the results report downloads.
- **Export, then re-import through the UI:** "No change" ×5, no duplicates, barcode intact.
- **Partial failure:** the bad price is held back, the Import button stays disabled until the problem row is acknowledged, the row is corrected in the dialog and imports straight away.
- **Invalid file:** a clear error is shown.
- **Cashier:** sent to the forbidden page from Import/Export, gets 403 from the import API, and can export only the price list.
- **Tablet (iPad):** the POS total and Take payment button stay within the screen.
- **Phone:** Dashboard, POS, Products, Receive, Stock, Labels, Sales, Reports, Import/Export and Settings have no sideways scrolling.

Still passing from earlier rounds:

- The lavender journey through the UI.
- Unknown barcode, focus handling, insufficient cash, declined then approved card, lost response with reload recovery, offline, stale price, last-pot race, duplicate POST, and cross-site POST refused.
- Privacy, anonymous 401 responses, cashier restrictions, and a deactivated cashier being refused.

## 2. Manual checks done here

- **Layout review:** screenshots at desktop (1440), tablet (820) and phone (390) of the Dashboard, POS, Import/Export, Products, Stock, Sales and Reports. Two problems were found and fixed:
  - the POS order panel was not filling the screen, which pushed the total off screen on tablets;
  - a hidden table heading made the stock page scroll sideways on phones.
- **Colour contrast:** every colour pairing was measured. Results are in the README.
- **Backup and restore:** round trip on the development database (counts matched). Migration 0003 was rolled back and re-applied on a scratch database, with stock and sales preserved.

## 3. Not yet done: physical and live checks

These need the nursery's equipment or accounts. Run them on site with [ACCEPTANCE.md](ACCEPTANCE.md).

| Check | What is needed |
|---|---|
| **Deployment** | **Not deployed.** Needs: a server or VPS with SSH access (or a hosting account), a domain name and its DNS, and the production `.env` values. Then follow README → Deploy. No hosting credentials were provided in this build. |
| Docker image build | A machine with Docker. There was no Docker daemon in this environment. |
| Label printed at 50 × 30 mm, adhesive survives watering | The label printer, its driver and the label stock. The PDF's size and bar widths are verified in software. |
| The real scanner reads labels (Enter suffix, keyboard layout) | The USB scanner. Keyboard-mode input is simulated in the browser tests. |
| 80 mm receipt prints and cuts | The receipt printer and driver settings. |
| Card terminal approval, decline and reference | The standalone card terminal. The app's confirm and reconcile workflow is tested. **There is no automatic payment integration.** |
| Password-reset e-mail delivery | SMTP credentials (`SMTP_URL`). |
| Restore drill on the production host | Run `scripts/restore-drill.sh` once after deployment. |
| Image import from real supplier websites | Internet access from the server. The download path was tested against a local server, and the address blocking with unit checks. |
