/**
 * What the landmark panel says (#548): one pure function from a landmark and the clock and wind to
 * the lines the panel draws, so Node tests read them. Every word comes from `STR.landmarks`; the
 * content (`landmarkDef`) gives the numbers and the cargo.
 */
import {
  landmarkDef,
  type LandmarkCondition,
  type LandmarkDef,
  type LandmarkEffect,
} from '../data/content';
import {
  pickKey,
  type LandmarkItem,
  type LandmarkStage,
  type ProduceReason,
} from '../sim/landmarks';
import { cargoName, cargoWord } from '../sim/cargo';
import { fmtCost } from '../sim/stores';
import type { Cost } from '../data/content';
import type { WindLevel } from '../sim/wind';
import { STR } from '../strings';
import { fmtMoney } from './numberFormat';

/** The two paths a surveyed landmark offers. */
export type LandmarkPathId = 'restore' | 'salvage';
/** What a button asks the commands for. */
export type LandmarkAction = 'start' | 'salvage' | 'cancel';

/** What the panel reads of the world besides the landmark. */
export interface LandmarkWorld {
  /** the game hour, 0 to 24 */
  hour: number;
  wind: WindLevel;
  /** why a restored landmark made nothing in the last step */
  reason: ProduceReason;
}

/** One alternative of a Restore that ends in a pick. */
export interface PickView {
  id: string;
  label: string;
  /** what it gives, as a line */
  gives: string;
}

export interface PathView {
  id: LandmarkPathId;
  name: string;
  /** what it costs: the goods to deliver, or nothing */
  cost: string;
  /** what it gives; empty where the player picks (`picks`) */
  gives: string;
  picks: PickView[];
}

export interface ProgressView {
  /** the line: cargo, delivered and required */
  text: string;
  share: number;
}

export interface ConditionView {
  /** what it asks */
  text: string;
  /** whether it holds now, in words; empty before the restore starts */
  state: string;
  holds: boolean;
}

export interface LandmarkView {
  id: number;
  stage: LandmarkStage;
  /** the name, or Unknown while only spotted */
  title: string;
  story: string;
  stageName: string;
  /** both paths while a choice is open (surveyed), the Salvage one while restoring */
  paths: PathView[];
  progress: ProgressView[];
  condition: ConditionView | null;
  /** the effect that runs, or ran: one line */
  effect: string | null;
  /** why a restored landmark that produces makes nothing now */
  reason: string | null;
  actions: LandmarkAction[];
}

/** The game hours 20:00 to 05:00, whatever the day and night display says (spec section 3). */
export function conditionHolds(c: LandmarkCondition, hour: number, wind: WindLevel): boolean {
  return c === 'night' ? hour >= 20 || hour < 5 : wind === 'storm';
}

/** The name of a landmark: its string, or its id for a def the strings do not know. */
export function landmarkName(defId: string): string {
  return STR.landmarks.names[defId] ?? defId;
}

/** What the panel and the tile tooltip call a landmark: Unknown until it is surveyed. */
export function shownName(item: { def: string; stage: string }): string {
  return item.stage === 'spotted' ? STR.landmarks.unknown : landmarkName(item.def);
}

/** A one-time grant, as money and goods in one list. */
function grantText(e: Extract<LandmarkEffect, { kind: 'grant' }>): string {
  const parts: string[] = [];
  if (e.money) parts.push(fmtMoney(e.money));
  if (e.cargo) parts.push(fmtCost(e.cargo));
  return parts.join(', ');
}

/** The toast for goods of a grant that found no store with room; null when all of it arrived. */
export function grantLossLine(item: { def: string }, lost: Cost): string | null {
  if (!Object.values(lost).some((v) => v > 0)) return null;
  return STR.landmarks.toasts.lost(landmarkName(item.def), fmtCost(lost));
}

/** An effect as one line. */
export function effectLine(e: LandmarkEffect): string {
  const L = STR.landmarks.effects;
  switch (e.kind) {
    case 'grant':
      return L.grant(grantText(e));
    case 'produce':
      return e.consumes
        ? L.produceFrom(
            cargoWord(e.cargo),
            e.perDay,
            cargoWord(e.consumes.cargo),
            e.consumes.perDay,
          )
        : L.produce(cargoWord(e.cargo), e.perDay);
    case 'attraction':
      return L.attraction(e.perDay);
    case 'boost':
      return L.boost(e.strength);
  }
}

/** The name of one pick: a produce and a boost have their words, anything else its effect. */
function pickLabel(e: LandmarkEffect): string {
  const P = STR.landmarks.pick;
  if (e.kind === 'produce') return P.produce(cargoWord(e.cargo));
  if (e.kind === 'boost') return P.boost;
  return effectLine(e);
}

/** The effect a path runs: Salvage's, or Restore's own or its pick (as the registry reads it). */
export function runningEffect(item: LandmarkItem, def: LandmarkDef): LandmarkEffect | undefined {
  if (item.path === 'salvage') return def.salvage.effect;
  if (item.path !== 'restore') return undefined;
  return def.restore.pick?.find((p) => pickKey(p) === item.pick) ?? def.restore.effect;
}

function restorePath(def: LandmarkDef): PathView {
  const L = STR.landmarks.paths;
  const picks = (def.restore.pick ?? []).map((p) => ({
    id: pickKey(p),
    label: pickLabel(p),
    gives: effectLine(p),
  }));
  return {
    id: 'restore',
    name: L.restore,
    cost: L.restoreCost(fmtCost(def.restore.needs)),
    gives: def.restore.effect ? L.gives(effectLine(def.restore.effect)) : '',
    picks,
  };
}

function salvagePath(def: LandmarkDef): PathView {
  const L = STR.landmarks.paths;
  return {
    id: 'salvage',
    name: L.salvage,
    cost: L.salvageCost,
    gives: L.gives(effectLine(def.salvage.effect)),
    picks: [],
  };
}

function progressOf(item: LandmarkItem, def: LandmarkDef): ProgressView[] {
  return Object.entries(def.restore.needs).map(([cargo, required]) => {
    const got = Math.min(required, item.delivered?.[cargo] ?? 0);
    // the trains move fractions: a whole unit shows once it is whole
    const shown = Math.min(required, Math.floor(got + 1e-6));
    return {
      text: STR.landmarks.progress(cargoName(cargo), shown, required),
      share: required > 0 ? got / required : 1,
    };
  });
}

/**
 * The panel of one landmark. Null for one the panel shows nothing of: a hidden one, or one whose
 * def the content lacks.
 */
export function landmarkView(item: LandmarkItem, w: LandmarkWorld): LandmarkView | null {
  const def = landmarkDef(item.def);
  if (!def || item.stage === 'hidden') return null;
  const L = STR.landmarks;
  const spotted = item.stage === 'spotted';
  const view: LandmarkView = {
    id: item.id,
    stage: item.stage,
    title: shownName(item),
    story: spotted ? L.spotted : (L.stories[item.def] ?? ''),
    stageName: L.stages[item.stage] ?? item.stage,
    paths: [],
    progress: [],
    condition: null,
    effect: null,
    reason: null,
    actions: [],
  };
  const cond = def.restore.condition;
  switch (item.stage) {
    case 'surveyed':
      view.paths = [restorePath(def), salvagePath(def)];
      view.condition = cond ? { text: L.conditions[cond], state: '', holds: false } : null;
      view.actions = ['start', 'salvage'];
      break;
    case 'restoring': {
      const e = runningEffect(item, def);
      const holds = cond ? conditionHolds(cond, w.hour, w.wind) : true;
      view.progress = progressOf(item, def);
      view.condition = cond
        ? {
            text: L.conditions[cond],
            state: holds ? L.conditions.holds : L.conditions.waits,
            holds,
          }
        : null;
      view.effect = e ? L.paths.gives(effectLine(e)) : null;
      view.paths = [salvagePath(def)];
      view.actions = ['salvage', 'cancel'];
      break;
    }
    case 'restored':
    case 'salvaged': {
      const e = runningEffect(item, def);
      view.effect = e ? effectLine(e) : null;
      view.reason = item.stage === 'restored' ? L.produceReasons[w.reason] || null : null;
      break;
    }
    case 'spotted':
      break;
  }
  return view;
}
