/**
 * A number as a player types it. A comma is a decimal mark as well as a point (`0,9` is `0.9`, as
 * a number box of a browser in many a locale writes it); text that is no number is NaN, and so is
 * a number with a mark of each kind. DOM-free, so it is tested under Node.
 */
export function parseDecimal(text: string): number {
  const t = text.trim();
  // one comma between digits, or with digits on one side: the decimal mark
  const comma = /^[+-]?(\d+,\d*|,\d+)$/.test(t);
  return Number(comma ? t.replace(',', '.') : t);
}
