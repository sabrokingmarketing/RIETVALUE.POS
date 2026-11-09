const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 8990 -> "R 89,90" (en-ZA locale formatting) */
export function formatZAR(cents: number): string {
  // Intl outputs a non-breaking space between R and the amount; keep it.
  return zar.format(cents / 100);
}

/** Plain amount for compact displays and labels: 8990 -> "R89.90" */
export function formatRand(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R${rands}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parse a staff-typed rand amount to integer cents without floating point.
 * Accepts "89.90", "89,90", "R 89.90", "1 200", "200". Returns null if invalid.
 */
export function parseRandToCents(input: string): number | null {
  const s = input.replace(/[\sR ]/gi, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Cents value for an <input> default, e.g. 8990 -> "89.90" */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * VAT contained in a VAT-inclusive amount, rounded half-up to the cent,
 * using integer arithmetic only. rateBp: 1500 = 15%.
 */
export function vatIncluded(amountCents: number, rateBp: number): number {
  if (rateBp <= 0 || amountCents <= 0) return 0;
  const d = 10000 + rateBp;
  return Math.floor((2 * amountCents * rateBp + d) / (2 * d));
}
