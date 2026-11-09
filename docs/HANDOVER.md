# Handover guide — owner and cashier

Stock arrives in the morning and is on the shelf, labelled and sellable by the afternoon. A new cashier can be trained in about 15 minutes.

The menu on the left (behind the **☰** button on phones) has:

- **Owner:** Dashboard · POS · Products · Inventory · Barcode Labels · Sales · Reports · Import/Export · Settings.
- **Cashier:** POS · Barcode Labels · Sales · Export.

## Owner

### First day (once only)

1. Sign in with the owner account created during setup.
2. Under **Settings → Business & VAT**, enter the nursery's real name, address, phone and receipt footer.
   - Tick "registered for VAT" only if you are registered with SARS, and enter your VAT number.
   - Ask your accountant to confirm your VAT treatment.
3. Under **Settings → Staff**, add each cashier and give them their e-mail and temporary password in person.
4. Under **Settings → Label sizes**, measure your labels with a ruler and check the numbers match.
5. Under **Barcode Labels**, press **Print one test label** and scan it at the till.

### Getting your products in

You can add plants one at a time or many at once.

**One at a time:**

1. Go to **Products → Add a plant or product**.
2. Enter the name, category, the first pot size and its price. A barcode is created automatically.
3. Add more sizes on the plant's page. Each size has its own price, SKU and barcode.

**Many at once:**

1. Go to **Import/Export** and download the Excel template.
2. Fill in one row per pot size. Rows with the same *product handle* are sizes of the same plant.
3. Upload the file and check that the columns are matched.
4. Choose what the import may do and how quantities are used:
   - **Replace** = you counted the stock.
   - **Add** = these plants just arrived.
5. Press **Check file** and read the preview. Nothing changes until you confirm.
6. Press **Import**.
7. If any rows have problems, press **Correct** on each one, fix it and save. It is imported straight away.
8. Download the results report for your records.

**Editing many prices at once:**

1. Use **Export Excel**.
2. Change the prices in Excel. Keep the SKU column unchanged.
3. Import the file again. Existing items are updated, never duplicated.
4. Any size whose price changed appears under *Shelf labels to replace*.

### Morning: receive stock

1. Go to **Inventory → Receive stock**.
2. Find each plant by name or by scanning an existing label. Use **New plant** or **New size** for anything new.
3. Enter **how many arrived** and check the **selling price**.
4. Press **Save receipt of stock**.
   - If the screen says it got no answer, press Save again. It never counts stock twice.
5. Press **Print labels for this delivery**.
6. Print at **Actual size / 100%** and stick one label on each pot.

### During the day

- **Price change:** open the plant under **Products** and change its price.
  - The POS uses the new price straight away.
  - If a cashier already has that plant in an open order, they must accept the new price before taking payment.
  - Print replacement labels under **Barcode Labels → Shelf labels to replace**, then mark them done.
- **Dead, damaged or miscounted plants:** go to **Inventory → Adjust**, choose a reason and write what happened.
- **Returns:** go to **Sales**, open the receipt and choose **Return items**.
  - Choose *Resellable* if the plant goes back on the table, or *Damaged* if it doesn't. Only resellable plants go back into stock.
  - When a cashier processes the return, you approve it with your e-mail and password on their screen.

### End of day

- **Sales → Till & cash-up** closes the till.
- **Dashboard** shows today's sales and the last 14 days.
- **Reports** shows the day report: gross sales, returns, net sales, cash/card split, till reconciliation, top plants and low stock.
- **Download CSV** gives your bookkeeper a file of the day's sales.

## Cashier

### Start of shift

1. Sign in.
2. If the POS shows **"The till is not open"**, go to **Sales → Till & cash-up**, count the drawer and enter the float.

### Selling

1. **Scan** each pot. The cursor is already in the scan box, and every scan adds **one** pot.
   - The *Last item* box shows what was added and how many are in the order.
2. **No label?** Tap a category chip or type in **Find by name or SKU**, then tap **Add** on the right product card.
3. **Wrong amount?** Use **+ / −** in the order panel, or type the quantity. **Remove** takes a line out.
4. Choose **Pay by cash** or **Pay by card**, then press **Take payment**.
   - **Cash:** type the amount received (or tap a note button). The change is shown in large figures. Press **Complete cash sale** and give that change.
   - **Card:**
     1. Key the amount into the card terminal and let the customer pay *on the terminal*.
     2. When it shows **APPROVED**, enter the reference if there is one.
     3. Press **Terminal shows APPROVED — complete sale**.
     4. If the terminal declines, press **Terminal declined**. Nothing is charged.
   - Never type card numbers into the POS.
5. Press **Print receipt**. If the printer fails, go to **Sales**, find the receipt and press **Reprint**. Reprinting never changes the sale or the stock.

### If something goes wrong

- **"Offline — checkout is disabled":** keep the customer's plants aside. You can finish when the connection returns.
- **"Connection lost while completing a sale":** **do not take payment again.** Press **Check and finish sale**. It finds the sale, or completes that same sale; the customer is never charged twice.
- **"Prices have changed":** tell the customer the new price, then press **Accept new prices**.
- **"No item has the code …":** nothing was added. Check the label, or find the plant by name.
- **"Only 0 × … in stock":** ask the owner to count that plant and correct the stock.

### End of shift

1. Go to **Sales → Till & cash-up**.
2. Count all cash in the drawer, including the float.
3. Enter the total and press **Close the till**.
4. If the count doesn't match, add a short note explaining why.
