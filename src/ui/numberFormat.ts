/** Money and whole numbers as the panels print them. DOM-free, so Node tests can import it. */
export function fmtMoney(v: number) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
export function fmtInt(v: number) {
  return Math.round(v).toLocaleString('en-US');
}
