import { daySeconds } from '../sim/rules';
import { STR } from '../strings';

/** A whole number with its thousands apart, as this language writes it. */
function grouped(v: number) {
  return Math.round(v).toLocaleString('en-US').replace(/,/g, STR.format.thousandsMark);
}
/**
 * Money, whole numbers and spans of game time as the panels print them. DOM-free, so Node tests
 * can import it.
 */
export function fmtMoney(v: number) {
  return STR.format.money(grouped(v));
}
export function fmtInt(v: number) {
  return grouped(v);
}
/** A number with its decimal mark, as this language writes it. */
export function fmtDecimal(v: number, digits?: number) {
  return (digits === undefined ? String(v) : v.toFixed(digits)).replace(
    '.',
    STR.format.decimalMark,
  );
}
/** Game seconds as days, or under a day as hours and minutes. */
export function fmtDuration(sec: number) {
  const days = sec / daySeconds();
  if (days >= 1) return STR.format.days(fmtDecimal(days, 1));
  const h = Math.floor(days * 24);
  const m = Math.floor(((days * 24) % 1) * 60);
  return STR.format.hoursMinutes(h, String(m).padStart(2, '0'));
}
