import type { Intent } from '../intent';

/**
 * The boot's loading screen as pure rules: which ways into the game show it and end in the reveal
 * (`bootPlan`), and how far the boot has got across its stages (`BootProgress`). `main.ts` drives
 * the screen with them, and `Game.init` reports its stages through a `BootProgressHook`.
 */

/** The stages the loading bar measures, in the order the boot runs them. */
export const BOOT_STAGES = ['pictures', 'map', 'renderer', 'ground'] as const;
export type BootStage = (typeof BOOT_STAGES)[number];

/**
 * Each stage's share of the bar: the atlas pictures, generating the map, building the renderer and
 * the UI, and painting the ground in the camera's view. Roughly how long each takes on a first
 * start; a share is relative to the others (they need not sum to 1) and must be above 0.
 */
export const STAGE_WEIGHTS: Readonly<Record<BootStage, number>> = {
  pictures: 0.3,
  map: 0.25,
  renderer: 0.15,
  ground: 0.3,
};

/** The longest the loading screen waits for the ground in view to be painted, in ms. */
export const GROUND_WAIT_MS = 10_000;

/**
 * Hears how far a stage of `Game.init` has got (0..1). A promise it returns is awaited before
 * init goes on, so the boot can paint its bar between stages.
 */
export type BootProgressHook = (stage: BootStage, fraction: number) => void | Promise<void>;

/**
 * The whole boot's progress, 0..1, from what each stage reports: the stages weighted as declared.
 * A stage keeps the most it has reached, so the total never goes back; it is 1 exactly once every
 * stage has reported 1.
 */
export class BootProgress {
  private readonly reached = new Map<BootStage, number>();

  constructor(private readonly weights: Readonly<Record<BootStage, number>> = STAGE_WEIGHTS) {}

  /**
   * `stage` has done `fraction` of its work; returns the total. A value above 1 counts as 1, and
   * one that is lower than the stage reached before, or no number at all, changes nothing.
   */
  report(stage: BootStage, fraction: number): number {
    if (fraction > (this.reached.get(stage) ?? 0)) this.reached.set(stage, Math.min(1, fraction));
    return this.total;
  }

  get total(): number {
    let all = 0;
    let done = 0;
    for (const stage of BOOT_STAGES) {
      const w = this.weights[stage];
      all += w;
      done += w * (this.reached.get(stage) ?? 0);
    }
    return all > 0 ? done / all : 0;
  }
}

/**
 * The ground stage's fraction from the landscape's count of the chunks in view
 * (`Landscape.viewProgress`); a view with no chunk in it has nothing left to paint.
 */
export function groundFraction(view: { done: number; total: number }): number {
  return view.total > 0 ? Math.min(1, view.done / view.total) : 1;
}

/** What the boot shows on its way in. */
export interface BootPlan {
  /** the loading screen covers the boot, its bar following the stages */
  loading: boolean;
  /** the screen ends in the reveal onto the game in play, and the music starts as it begins */
  reveal: boolean;
  /** the screen ends with "Click to begin", and that click starts the reveal */
  clickToBegin: boolean;
}

/** What the boot knows besides its intent. */
export interface BootFlags {
  /** a dev-server reload carried the running game over (`takeDevSession`) */
  devReload?: boolean;
  /** the title screen the boot opened is being left by its Continue, for the game under it */
  continueFromTitle?: boolean;
}

/**
 * What the boot shows for an intent (`src/intent.ts`; null is a page load with none):
 *
 * - a way into play (a new game, a level, Continue, a save slot, the world grown, and the title's
 *   Continue at boot): the loading screen, "Click to begin", then the reveal with the music;
 * - the title screen (no intent, or the menu one): the loading screen alone, as the title is
 *   silent until the player starts;
 * - a dev reload, the editor and the editor's play test: neither.
 */
export function bootPlan(intent: Intent | null, flags: BootFlags = {}): BootPlan {
  if (flags.devReload) return plan(false, false);
  if (flags.continueFromTitle) return plan(true, true);
  switch (intent?.action) {
    case 'edit':
      return plan(false, false);
    case 'play':
      return intent.testing ? plan(false, false) : plan(true, true);
    case 'new':
    case 'continue':
      return plan(true, true);
    default:
      return plan(true, false);
  }
}

/** A plan; the click is asked for wherever the reveal plays. */
function plan(loading: boolean, reveal: boolean): BootPlan {
  return { loading, reveal, clickToBegin: reveal };
}
