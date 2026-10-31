/**
 * What the Contracts screen decides, apart from drawing it: the tabs and their counts, which
 * contracts a tab lists and in what order, what a card says about time and delivery, and the words
 * an empty tab shows. DOM-free, so it runs under Node.
 */
export type ContractTab = 'offers' | 'active' | 'history';

/** The last contracts the Recent tab keeps. */
export const HISTORY_LIMIT = 12;

/** Under this share of its deadline an active contract is running out of time. */
export const LOW_TIME = 0.25;

/** The finished contracts Recent lists: the last `limit` of them, the newest first. */
export function recentContracts<T extends { status: string }>(
  all: readonly T[],
  limit = HISTORY_LIMIT,
): T[] {
  return all
    .filter((c) => c.status === 'done' || c.status === 'failed' || c.status === 'cancelled')
    .slice(-limit)
    .reverse();
}

/** The active contracts, the one that runs out first on top; the list given stays as it is. */
export function activeByDeadline<T extends { expires: number }>(active: readonly T[]): T[] {
  return [...active].sort((p, q) => p.expires - q.expires);
}

/** Is an active contract's time nearly up? `remaining` is its share of the deadline left. */
export function timeIsLow(remaining: number): boolean {
  return remaining < LOW_TIME;
}

/** How much of an order has arrived, 0 to 1. */
export function deliveredShare(c: { delivered: number; amount: number }): number {
  return c.amount > 0 ? Math.min(1, Math.max(0, c.delivered / c.amount)) : 0;
}

/** A missed or cancelled contract pays nothing: its payout is shown struck through. */
export function payoutLost(status: string): boolean {
  return status === 'failed' || status === 'cancelled';
}

export interface TabCounts {
  offers: number;
  active: number;
  history: number;
}

/** The tabs in order, each with the number of cards under it. */
export function contractTabs(
  counts: TabCounts,
  labels: Record<ContractTab, string>,
): { id: ContractTab; label: string; count: number }[] {
  return (['offers', 'active', 'history'] as const).map((id) => ({
    id,
    label: labels[id],
    count: counts[id],
  }));
}

/** The tab that exists: a value that is none leaves the screen where it was. */
export function pickTab(id: string, current: ContractTab): ContractTab {
  return id === 'offers' || id === 'active' || id === 'history' ? id : current;
}

export type EmptyKind = 'noOffers' | 'needStations' | 'noActive' | 'noHistory';

/**
 * Which empty text a tab with no cards shows. Offers say why nothing is on the board: no pair of
 * stations makes a contract yet, or the next ones simply have not come.
 */
export function emptyKind(tab: ContractTab, canGenerate: boolean): EmptyKind {
  if (tab === 'offers') return canGenerate ? 'noOffers' : 'needStations';
  return tab === 'active' ? 'noActive' : 'noHistory';
}

/** The tone of a finished contract's status chip: delivered is good, missed is bad. */
export function statusTone(status: string): 'good' | 'bad' | 'dim' {
  if (status === 'done') return 'good';
  return status === 'failed' ? 'bad' : 'dim';
}

/** What the per-rarity offer policies add up to: every rarity one way, or a mix. */
export type AutoState = 'accept' | 'prompt' | 'mixed';

/**
 * The Auto-accept switch's truth from the policy of each rarity. On means every rarity takes
 * its offers, off every rarity leaves them; Auto-deny anywhere, or any other mix, is its own state:
 * the switch cannot say that, and flipping it would replace each choice.
 */
export function autoState(policies: readonly string[]): AutoState {
  if (!policies.length) return 'prompt';
  if (policies.every((p) => p === 'accept')) return 'accept';
  return policies.every((p) => p === 'prompt') ? 'prompt' : 'mixed';
}

/** The tab a contract is listed under, null for one no tab lists (an offer that has expired). */
export function tabOfStatus(status: string): ContractTab | null {
  if (status === 'offer') return 'offers';
  if (status === 'active') return 'active';
  return status === 'done' || status === 'failed' || status === 'cancelled' ? 'history' : null;
}
