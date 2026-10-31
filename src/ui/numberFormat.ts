import { daySeconds } from '../sim/rules';

/**
 * Money, whole numbers and spans of game time as the panels print them. DOM-free, so Node tests
 * can import it.
 */
export function fmtMoney(v: number) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
export function fmtInt(v: number) {
  return Math.round(v).toLocaleString('en-US');
}
/** Game seconds as days, or under a day as hours and minutes. */
export function fmtDuration(sec: number) {
  const days = sec / daySeconds();
  if (days >= 1) return `${days.toFixed(1)}d`;
  const h = Math.floor(days * 24);
  const m = Math.floor(((days * 24) % 1) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
