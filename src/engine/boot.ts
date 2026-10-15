import type { Intent } from '../intent';

/**
 * The boot's loading screen as pure rules: which ways into the game show it and end in the reveal,
 * and when it starts the music (`bootPlan`), and how far the boot has got across its stages (`BootProgress`). `main.ts` drives
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

/**
 * When the loading screen starts the music: as loading finishes and "Click to begin" appears, or
 * at that click. Browsers keep sound back until the page has had a click.
 */
export type MusicStart = 'loaded' | 'click';

/** What the boot shows on its way in. */
export interface BootPlan {
  /** the loading screen covers the boot, its bar following the stages */
  loading: boolean;
  /** the screen ends in the reveal onto the game in play */
  reveal: boolean;
  /** the screen ends with "Click to begin", and that click starts the reveal */
  clickToBegin: boolean;
  /**
   * When the screen starts the music, wherever the reveal plays: 'loaded' where the player clicked
   * on the way here (a menu, a save slot or the world's growth led here), 'click' on a page opened
   * afresh, where nothing has been clicked yet. Null where the screen starts none: the title keeps
   * it back until the player starts, and with no screen the boot starts it at once.
   */
  music: MusicStart | null;
}

/** What the boot knows besides its intent. */
export interface BootFlags {
  /** a dev-server reload carried the running game over (`takeDevSession`) */
  devReload?: boolean;
  /** the title screen the boot opened is being left by its Continue, for the game under it */
  continueFromTitle?: boolean;
  /**
   * the page was opened afresh: no menu of a page before it stored the intent (an old
   * `#seed=…&new` link may carry one), so nothing has been clicked yet
   */
  fresh?: boolean;
}

/**
 * What the boot shows for an intent (`src/intent.ts`; null is a page load with none):
 *
 * - a way into play (a new game, a level, Continue, a save slot, the world grown, and the title's
 *   Continue at boot): the loading screen, "Click to begin", then the reveal. The music starts as
 *   loading finishes, as the player clicked on the way here; on a page opened afresh it starts at
 *   "Click to begin", the page's first click;
 * - the title screen (no intent, or the menu one): the loading screen alone, as the title is
 *   silent until the player starts;
 * - a dev reload, the editor and the editor's play test: neither.
 */
export function bootPlan(intent: Intent | null, flags: BootFlags = {}): BootPlan {
  // the title's Continue is a click on this page, however the page was opened
  const music: MusicStart = flags.fresh && !flags.continueFromTitle ? 'click' : 'loaded';
  if (flags.devReload) return plan(false, null);
  if (flags.continueFromTitle) return plan(true, music);
  switch (intent?.action) {
    case 'edit':
      return plan(false, null);
    case 'play':
      return intent.testing ? plan(false, null) : plan(true, music);
    case 'new':
    case 'continue':
      return plan(true, music);
    default:
      return plan(true, null);
  }
}

/** A plan that reveals where it starts the music; the click is asked for wherever it reveals. */
function plan(loading: boolean, music: MusicStart | null): BootPlan {
  const reveal = music !== null;
  return { loading, reveal, clickToBegin: reveal, music };
}
