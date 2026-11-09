# Physical setup — scanner, label printer, labels and receipts

> **Status:** the client has not yet confirmed the exact models. The settings below work with any device of the class described. Write the chosen models into the table at the end once they are agreed, and run the on-site checks in [ACCEPTANCE.md](ACCEPTANCE.md).

## 1. Barcode scanner (USB, keyboard mode)

**What to buy:** any 1D (or 1D/2D) handheld USB scanner that works as a keyboard ("HID keyboard" or "keyboard wedge"), for example a Honeywell Voyager 1200g/1250g, Zebra DS2208, or a reputable generic model. It must read **Code 128**.

**Configure it** using the programming barcodes in the scanner's manual:

1. Interface: **USB HID keyboard**.
2. Symbologies: **Code 128 ON**. Leave EAN/UPC on if you will add supplier barcodes as aliases.
3. Suffix: **Enter (CR)** after every scan. There should be no prefix.
4. Keyboard country: **US** (digits are the same on the South African layout).
5. Optional: turn the scanner's "same-code delay" off. The till treats two deliberate scans of the same pot as two pots.

**Test without the app:** open Notepad, scan a label, and check that the digits appear followed by a new line.

## 2. Label printer (direct thermal, 203 dpi)

**What to buy:** a desktop direct-thermal printer at 203 dpi with a Windows/macOS driver, for example a Zebra ZD220d/ZD421d, TSC TE200, Godex G500, or Xprinter XP-365B. Direct thermal needs no ribbon.

**Labels:** direct-thermal paper labels, **50 × 30 mm**, on a roll with a 25 mm core and gap sensing. For pots that get watered, choose a **synthetic (polypropylene) direct-thermal** label with a freezer- or water-resistant adhesive. Paper labels smudge when wet.

**Driver setup:**

1. Install the manufacturer's driver (ZDesigner, TSC, Seagull, and so on), not "Generic / Text Only".
2. Under Printing Preferences → Page setup, create a stock or paper size of exactly **50 mm wide × 30 mm high**, orientation **landscape** (label wider than tall), and margins **0**.
3. Media type: **gap / notch** (die-cut labels), method **direct thermal**. Darkness around 20–25 of 30; increase it if the bars look grey.
4. Run the printer's media **calibration** (on most Zebras, hold the feed button until it flashes twice).

**Printing from the app:**

1. Print labels → **Prepare labels** → **Open PDF to print**.
2. In the PDF print dialog, choose the label printer and set **Actual size / Scale 100%**, never "Fit". The paper size must be 50 × 30 mm.
3. Each PDF page is one label.

**Settings in the app (Print labels → Edit label sizes):** "Roll 50 × 30 mm (thermal, 203 dpi)" uses a narrow bar of **0.375 mm**, which is 3 printer dots. The 8-digit code is then about 30 mm wide, plus 3.75 mm of quiet zone on each side. On a 300 dpi printer, change the narrow bar to **0.338 mm** (4 dots).

## 3. A4 label sheets (fallback for an office printer)

The default preset is "A4 sheet 3 × 8 (63.5 × 33.9 mm)", the common 24-up layout:

- top margin 12.9 mm
- left margin 7.2 mm
- horizontal pitch 66.04 mm
- vertical pitch 33.9 mm

**Check the layout on plain paper first:**

1. Tick **Show label edges** and print on plain A4 at **Actual size**.
2. Hold the printout against a label sheet in front of a light.
3. If the labels sit too low, reduce the top margin. If they sit too far right, reduce the left margin. Save the preset.

**Part-used sheets:** set **Start at label position** to skip labels that have already been used.

## 4. Receipt printer (80 mm)

**What to buy:** an 80 mm thermal receipt printer with a Windows/macOS driver (for example Epson TM-T20III, Star TSP143, or Xprinter XP-80). Use USB or network.

**Setup:**

1. Install the driver, then select paper **80 mm × receipt (roll)** with auto-cut on.
2. In Chrome, open a receipt and press **Print receipt**.
3. In the print dialog, choose the receipt printer, set Margins **None** and Scale **100**, and turn **Headers and footers** off.
4. Chrome remembers these settings for the next receipt.

The A4 receipt option uses any normal printer.

**For one-click receipts:** you can start Chrome with `--kiosk-printing` so it prints straight to the default printer without the dialog. Only do this on the till PC, and set the receipt printer as the default.

## 5. The till computer

- Use Chrome or Edge, kept up to date. Bookmark `https://<your-domain>/till` and sign in once per day.
- Screen: at least 1280 × 800 for the side-by-side till. Tablets (768 px and wider) also show the basket and total side by side.
- The till needs the internet to complete a sale. It shows "Offline — checkout disabled" when the connection drops and keeps the basket until it returns.

## Agreed equipment (fill in on site)

| Item | Make / model | Driver / firmware | Verified on (date) |
|---|---|---|---|
| Barcode scanner | | | |
| Label printer | | | |
| Label stock | | | |
| Receipt printer | | | |
| Till PC / tablet + browser | | | |
| Card terminal (standalone) | | | |
