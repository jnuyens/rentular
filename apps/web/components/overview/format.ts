/** Euro amount with two decimals in the browser's number format. */
export const eur = (n: number): string =>
  `€${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Percentage of `part` in `whole`, clamped to 0..100 and rounded. */
export function pctOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}
