import { STR } from '../strings';
import { DEFAULT_SUPPLY, SUPPLY_MODES, type SupplyMode } from '../sim/supply';
import { el } from './dom';
import { choiceRows, formRow, columns, note, page, textField, well, type FootSpec } from './kit';
import type { Screen } from './modal';
import { keepPick, pickIndex, tuningEntries } from './newGameTuning';
import type { ReplaceEffect } from './saveSlots';

/** What the screen needs of the title screen's actions. */
export interface NewGameActions {
  /** `tuning` is the saved tuning picked, null for the shipped rules; the questions are asked there */
  newGame(seed: string, supply: SupplyMode, tuning: string | null): void;
  /** the tunings saved in Game tuning, newest first */
  tunings(): { name: string }[];
  /** what starting a new game loses, for the button's tip */
  asks(): ReplaceEffect | null;
}

/** The tip of Start: it says when the start asks first. */
export function startTip(asks: ReplaceEffect | null): string {
  if (asks === 'game') return STR.newGameScreen.startAsksOver;
  return asks === 'stored' ? STR.newGameScreen.startAsks : STR.newGameScreen.startHint;
}

/**
 * New game: a seed, the production chain with its hint, and the tuning to start from (only once
 * Game tuning keeps one). Start asks the title's questions before it goes.
 */
export class NewGameScreen implements Screen {
  readonly id = 'newgame';
  readonly title = STR.newGameScreen.title;
  readonly frameSize = 'M';
  readonly frameClass = 'fit';
  readonly icon = 'plus';
  readonly formKeys = true;
  readonly root = page();
  /** The Tuning choice of the Map well; `refreshTunings` fills it. */
  private tuningWell = well(STR.menu.newGameTuning);
  /**
   * The saved tuning picked for the next new game, null for the shipped rules. Every drawing of
   * the screen starts it over; nothing is remembered between drawings.
   */
  private tuningPick: string | null = null;
  private supply: SupplyMode = DEFAULT_SUPPLY;
  /** what Start loses, read when the screen opens: the footer is read at every refresh, storage is not */
  private asking: ReplaceEffect | null = null;
  private seed = textField({
    placeholder: STR.settings.seedPlaceholder,
    title: STR.newGameScreen.seedHint,
  });

  constructor(private readonly actions: NewGameActions) {}

  onOpen() {
    this.asking = this.actions.asks();
    this.seed.input.value = '';
    this.supply = DEFAULT_SUPPLY;
    this.render();
  }
  frameFooter(): FootSpec {
    return {
      actions: [
        {
          label: STR.newGameScreen.start,
          primary: true,
          icon: 'play',
          title: startTip(this.asking),
          onClick: () => this.start(),
        },
      ],
    };
  }

  private start() {
    this.actions.newGame(this.seed.input.value.trim(), this.supply, this.tuningPick);
  }

  /**
   * Draw the Tuning choice again from the tunings saved now, and nothing else of the screen, so a
   * typed seed and the production chain stay. The pick stays on a tuning that still exists and
   * falls back to the shipped rules when its tuning is gone; with no tuning saved the choice is
   * not shown.
   */
  refreshTunings() {
    const w = this.tuningWell;
    const entries = tuningEntries(this.actions.tunings());
    this.tuningPick = keepPick(entries, this.tuningPick);
    w.style.display = entries.length ? '' : 'none';
    w.replaceChildren();
    if (!entries.length) return;
    w.append(
      el('div', { class: 'k-sec' }, el('span', { text: STR.menu.newGameTuning })),
      choiceRows({
        // the option is its place in the list: a name is never read back from a label
        options: entries.map((e, i) => ({ id: String(i), label: e.label })),
        value: String(pickIndex(entries, this.tuningPick)),
        onChange: (id) => {
          this.tuningPick = entries[Number(id)]?.name ?? null;
        },
      }),
      note(STR.menu.newGameTuningHint),
    );
  }

  render() {
    this.tuningPick = null;
    this.refreshTunings();
    const chain = well(
      STR.newGameScreen.chain,
      choiceRows({
        options: SUPPLY_MODES.map((m) => ({
          id: m,
          label: STR.menu.supplyModes[m] ?? m,
          hint: STR.menu.supplyHint[m],
        })),
        value: this.supply,
        onChange: (id) => (this.supply = id as SupplyMode),
      }),
    );
    this.root.replaceChildren(
      columns(
        [
          well(
            STR.newGameScreen.map,
            formRow(STR.newGameScreen.seed, this.seed.root),
            note(STR.newGameScreen.seedNote),
          ),
          this.tuningWell,
        ],
        [chain],
      ),
    );
  }
}
