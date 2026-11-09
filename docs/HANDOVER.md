# Handover guide — owner and cashier

This guide is written for the people at the counter. It covers a normal day: stock comes in during the morning, and a cashier who learns that afternoon can sell it.

## For the owner

### First day (once only)

1. **Sign in** at `/login` with the owner account that was created during setup.
2. **Settings:** enter the nursery's real name, address, phone, e-mail and receipt footer.
   - Tick "registered for VAT" only if you are registered with SARS, and enter the VAT number.
   - Ask your accountant to confirm your VAT treatment.
3. **Staff → Add a staff member:** add each cashier and give them their e-mail and temporary password in person.
4. **Print labels → Edit label sizes:** measure your label roll (or A4 sheet) with a ruler and check the numbers match. Then press **Print one test label** and scan it at the till.

### Morning: receive stock

1. Go to **Receive stock**.
2. In **Find the plant**, type the name, or scan a label you already have.
   - If the plant is new, press **New plant** and fill in its name, category, pot size and selling price.
   - If the plant exists but this pot size is new, press **New size** next to it.
   - Each pot size is its own item. A 15 cm lavender and a 20 cm lavender have different prices and different barcodes.
3. For each plant, type **how many arrived** and check the **selling price**. If you change the price, the shelf labels already on that size are flagged for replacement.
4. Press **Save receipt of stock**. The stock is now counted.
   - If the screen says there was no answer, press Save again. This is safe and never counts the stock twice.
5. Press **Print labels for this delivery**. The label count matches the quantities you received.
6. Check the preview, press **Open PDF to print** and print at **Actual size / 100%**.
7. Stick one label on each pot.

### During the day

- **Price change:** go to Plants & products, open the plant and change the price on the size. The till uses the new price straight away.
  - If a cashier has that pot in a basket, the till shows the old and new price and asks them to accept it before payment.
  - Then go to **Print labels → Shelf labels to replace**, print the new labels, stick them on and press **Mark selected as relabelled**.
- **Dead, damaged or miscounted plants:** go to **Stock → Adjust**, choose the reason and write what happened. Every change is recorded with your name.
- **Returns:** open the receipt (**Receipts** at the till) and use **Return items**.
  - Choose **Resellable** if the plant goes back on the table, or **Damaged** if it does not. Only resellable plants go back into stock.
  - When a cashier processes a return, you authorise it with your e-mail and password on their screen.

### End of day

- The cashier (or you) closes the till under **Cash up**.
- Open **Day report** to see:
  - gross sales, returns and net sales
  - the cash and card split
  - expected cash, counted cash and the variance
  - top plants and low stock
- Press **Download CSV** for your bookkeeper.

## For the cashier

### Start of shift

1. Sign in with the e-mail and password the owner gave you.
2. If the till shows **"The till is not open"**, press **Open the till**, count the cash in the drawer, type the total (for example `500`) and press **Open the till**.

### Selling

1. **Scan** each pot's label. The cursor is already in the scan box.
   - Every scan adds **one** pot. Two lavender pots: scan the label on each pot.
   - The box at the top shows the last item and how many are in the basket.
2. **No label, or it won't scan:**
   - Type the number under the barcode and press Enter, or
   - Type the plant name in **Find by name or SKU** and tap the right pot size.
3. **"No item has the code …":** nothing was added and the basket is unchanged. Check the label, or find the plant by name.
4. **Changing amounts:** use **+** and **−**, or type the quantity. **Remove** takes a line out.
5. Press **Take payment**.
   - **Cash:** type the amount the customer gave you (or tap a note button). The change is shown in large figures. Press **Complete cash sale** and give the change shown.
   - **Card:**
     1. Key the amount into the card terminal.
     2. The customer pays on the terminal.
     3. When the terminal shows **APPROVED**, optionally type its reference, then press **Terminal shows APPROVED — complete sale**.
     4. If the terminal declines, press **Terminal declined**. Nothing is charged.
   - Never type card numbers into the till.
6. Press **Print receipt**. If the printer jams, go to **Receipts**, open the sale and press **Reprint receipt**. Reprinting never changes the sale or the stock.

### If something goes wrong

- **"Offline — checkout is disabled"**: the internet or server is down. Keep the customer's plants aside. You can finish when it comes back.
- **"Connection lost while completing a sale"**: **do not take payment again.** Press **Check and finish sale**.
  - It looks the sale up. If the sale was not recorded, it records that same sale now. The customer is never charged twice.
  - Only press "Customer was not charged — back to basket" if you are sure no money changed hands.
- **"Prices have changed"**: the owner changed a price. Tell the customer the new price, then press **Accept new prices**.
- **"Only 0 × … in stock"**: the stock record says there are none left. Ask the owner to count it and correct the stock before selling.
- **Signed out**: sign in again. The basket is kept on this computer.

### End of shift

1. Go to **Cash up**.
2. Count all the cash in the drawer, including the float.
3. Type the total and press **Close the till**.
4. If the count doesn't match, write a short note explaining why. The screen then shows the expected cash, your count and the difference.
