# On-site acceptance checklist

Run this at the nursery with the real equipment, on the **live** system after setup, using one real plant. Tick each step and write down anything unexpected.

Date: ____________  Owner: ____________  Cashier: ____________  Installer: ____________

## A. Before you start

- [ ] Settings hold the real business name, address, phone and VAT status/number (the dashboard shows no "placeholder" warning).
- [ ] No demo accounts are active (the dashboard shows no red "Demo accounts" warning).
- [ ] The owner and at least one cashier can sign in.
- [ ] HTTPS padlock is shown. Opening the root address goes to staff sign-in.

## B. Print a sticker at actual size

- [ ] Receive stock: one plant, quantity **1**, real selling price. Then press **Save receipt of stock**.
- [ ] Press **Print labels for this delivery**. The preview shows the name, pot size, price and barcode.
- [ ] Print at **Actual size / 100%** on the label printer.
- [ ] Measure the printed label with a ruler: **50 × 30 mm** (±0.5 mm). The barcode is not stretched or cut off, the bars are solid black, and there is white space on both sides of the barcode.
- [ ] Check stock: printing did **not** change the stock count.

## C. Stick it on a pot and scan it

- [ ] Stick the label on the pot. Wet it lightly if it will stand outside: the print should not smudge.
- [ ] At the till, scan the pot's label once. The basket shows **1 ×** the right plant and price, and "Last item" shows it.
- [ ] Scan it again. The quantity becomes **2**. Then press − to return it to 1.
- [ ] Scan from about 10–20 cm and at a slight angle. It reads first time.
- [ ] Scan a random product's barcode, such as a cereal box. A red "No item has the code …" message appears and the basket is unchanged.

## D. Complete a cash sale

- [ ] Press **Take payment** → **Cash**, and type an amount larger than the total.
- [ ] The change shown is correct. Press **Complete cash sale**.
- [ ] **Print receipt** prints on the 80 mm printer, full width, readable, and cut. It shows the receipt number, the item, the total, cash tendered and change, and the VAT line if registered.
- [ ] The stock for that plant went down by exactly one.

## E. Reprint the receipt

- [ ] Go to **Receipts**, find the sale by its receipt number, and press **Reprint receipt (80 mm)**.
- [ ] The copy matches the original and is marked "COPY". Stock is unchanged and the day report still shows one sale.

## F. Card sale (with the real terminal)

- [ ] Sell one item by **Card**: key the amount on the terminal, wait for APPROVED, enter the reference, then press **Terminal shows APPROVED — complete sale**.
- [ ] Try a declined card, or cancel on the terminal, then press **Terminal declined**. No sale is recorded.

## G. Reconcile the till

- [ ] Go to **Cash up**, count the drawer, enter the total and press **Close the till**.
- [ ] Expected cash = float + cash sales − cash refunds. The variance is R0.00, or explained in a note.
- [ ] **Day report** for today shows matching gross sales, returns, net sales, the cash/card split and the till session.
- [ ] **Download CSV** opens in Excel or Sheets with one line per item sold.

## H. Return (optional but recommended)

- [ ] On the sale's receipt, return 1 item as **Resellable** (as the cashier, with the owner's authorisation). The stock goes up by one, and net sales drop by the item price.

## I. Bulk import and export

- [ ] Download the Excel template from **Import/Export**. Fill in two real plants with two pot sizes each, real prices and the counted stock. Format the barcode column as **Text**.
- [ ] Upload it. The columns are matched automatically. Choose **Replace stock** and press **Check file**.
- [ ] The preview shows 4 new sizes and 2 new plants. Confirm the import; it completes.
- [ ] **Export Excel**, change one price in Excel, and import the file again. The preview shows **1 update** and the rest **no change**. Product counts do not increase.
- [ ] Print a label for the re-priced size and scan it at the POS. The new price rings up.

## J. Devices

- [ ] On the till computer or tablet, the order total and **Take payment** stay visible while scanning a long order.
- [ ] The owner can open Dashboard, Products and Inventory on their phone.

## K. Backup

- [ ] Run `scripts/backup.sh` (or the Docker equivalent) once by hand. Confirm the files exist and are copied off-site.
- [ ] Schedule the nightly backup.

Signed off by owner: ____________________
