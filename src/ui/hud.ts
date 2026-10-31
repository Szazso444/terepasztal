import { el, btn } from './dom';
import { LANGUAGE, LANGUAGES, LANGUAGE_NAME, STR, type Language } from '../strings';
import { SPEED_ORDER, type GameClock } from '../sim/time';
import type { AgeStatus } from '../sim/ages';
import type { AtlasRegistry } from '../engine/atlas';
import { ttTerm, type Tooltip } from './tooltip';
import { title } from './tooltipDoc';
import { tipBuild } from './tooltipRender';
import { ageTip, eraView } from './ageTooltip';
import { ageIconSvg } from './ageIcon';
import {
  compactLevel,
  foldCount,
  topbarCompact,
  type CompactLevel,
} from './fit';
import { historyIconSvg, historyTip, type HistoryWay } from './historyControls';
import { segmented } from './kit';
import { MenuBar } from './menuBar';
import { NowPlaying, type MusicDeck } from './nowPlaying';
import type { History } from '../sim/history';

export interface HudModel {
  /** current age index (0 steam, 1 diesel, 2 electric, 3 nuclear, 4 magnetic, 5 hyper) */
  tier: number;
}

/** What the undo and redo buttons read of the history. */
export type HistoryView = Pick<History, 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'>;

/**
 * Top bar: title, the menu bar (`menuBar.ts`) and undo and redo on the left; on the right the
 * music (`nowPlaying.ts`), the season, the era widget (the current age's icon and name, and a bar
 * toward the next age; resting on it lists every age with its goals), then day, clock and speed as
 * the last block.
 *
 * When the bar is short of room (`fit`) it goes `compact` in two steps: first tighter spacing and
 * the weather words in the Weather row's tooltip; only if that is still not enough, the era widget
 * without the age's name as well (`compact-2`; its tooltip has the name). Then the menu entries
 * lose their labels one by one (`FOLD_ORDER`), the icon staying and the tooltip naming it. The era
 * widget and the date and speed never give way; past that, the menu bar is cut.
 */
export class Hud {
  readonly root: HTMLElement;
  /** the era widget: the age's icon and name, the bar toward the next age and its percent */
  private eraIcon = el('span', { class: 'era-icon' });
  private eraName = el('span', { class: 'era-name' });
  private eraFill = el('div', { class: 'era-fill', style: 'width:0%' });
  private eraBar = el('div', { class: 'era-bar' }, this.eraFill);
  private eraPct = el('span', { class: 'era-pct' });
  /** the age whose icon is drawn */
  private eraId: string | null = null;
  private day = el('span', { class: 'value' });
  private clockEl = el('span', { class: 'value' });
  private speedBtns: HTMLButtonElement[] = [];
  /** the menus: `createPlayUi` wires them and puts their pane in `#ui-root` */
  readonly menuBar: MenuBar;
  private undoBtn = this.historyBtn('undo');
  private redoBtn = this.historyBtn('redo');
  /** undo and redo right of the menus; the level editor records nothing and hides them */
  private historyCell = el('div', { class: 'stat history' });
  /** what the history can do now; its tooltips read it when they open */
  private history: HistoryView | null = null;
  /** EN | HU, right of the menus and of undo and redo */
  private languageCell = el('div', { class: 'stat lang', title: STR.settings.language });
  onHistory: ((way: HistoryWay) => void) | null = null;
  /** the language control: it reloads the page, or `showLanguage` puts the control back */
  onLanguage: ((language: Language) => void) | null = null;
  private locked = false;
  private fps = el('span', { class: 'value dim' });
  private nowPlaying: NowPlaying;
  private weather = el('span', { class: 'value' });
  /** the spacing the bar has now, the labels it has folded (`fit`), a fit waiting for the next frame */
  private compact: CompactLevel = 0;
  private folded = 0;
  private fitQueued = false;

  constructor(
    private readonly clock: GameClock,
    /** progress towards every age: read on every update, and when the era tooltip opens */
    private readonly ages: () => AgeStatus[],
    atlas: AtlasRegistry,
    tooltip: Tooltip,
    music: MusicDeck,
  ) {
    const time = el('div', { class: 'time' });
    // the buttons read in SPEED_ORDER; speedBtns stays by real index, as clock.speedIndex is
    for (const i of SPEED_ORDER) {
      const s = STR.hud.speed[i];
      const b =
        i === 0
          ? btn(s, () => this.clock.togglePause(), 'pause')
          : btn(s, () => this.clock.setSpeed(i), 'small');
      // pause keeps its own title (update)
      if (i !== 0) b.title = STR.hud.speedKey(s, '+ / −');
      this.speedBtns[i] = b;
      time.append(b);
    }
    this.menuBar = new MenuBar((doc) => tipBuild(atlas, doc));
    this.nowPlaying = new NowPlaying(music, (text) => tipBuild(atlas, () => [title(text())]));
    // the whole widget is the term: resting on it opens the ages tooltip
    const era = ttTerm(
      el('div', { class: 'panel stat era' }, this.eraIcon, this.eraName, this.eraBar, this.eraPct),
      tipBuild(atlas, () => ageTip(this.ages())),
    );
    // a term around the button: a disabled button still says what it would do
    const undoTip = tipBuild(atlas, () => historyTip('undo', this.history?.undoLabel ?? null));
    const redoTip = tipBuild(atlas, () => historyTip('redo', this.history?.redoLabel ?? null));
    this.historyCell.append(ttTerm(this.undoBtn, undoTip), ttTerm(this.redoBtn, redoTip));
    this.showLanguage();
    this.root = el(
      'div',
      { id: 'topbar', class: 'strip' },
      el('div', { class: 'title', text: STR.title }),
      this.menuBar.root,
      this.historyCell,
      this.languageCell,
      el('div', { class: 'spacer' }),
      el('div', { class: 'stat' }, this.fps),
      this.nowPlaying.root,
      el('div', { class: 'stat weather' }, this.weather),
      era,
      // one block at the right end, the era widget just before it
      el('div', { class: 'panel stat datespeed' }, this.day, this.clockEl, time),
    );
    tooltip.bindTerms(this.root);
    // a window resize, or a cell that grows or shrinks (an age, the weather, the advisor's badge, the
    // editor hiding entries of the menu bar), changes the room; the observer fires on a change only
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.queueFit());
      ro.observe(this.root);
      for (const cell of this.root.children) ro.observe(cell);
    }
  }

  private historyBtn(way: HistoryWay) {
    const b = btn('', () => this.onHistory?.(way), 'small');
    // fixed markup from historyControls.ts, never from data
    b.innerHTML = historyIconSvg(way, 14);
    b.disabled = true;
    return b;
  }
  /** The language control, on the language of this page load. */
  showLanguage() {
    this.languageCell.replaceChildren(
      segmented({
        options: LANGUAGES.map((id) => ({
          id,
          label: id.toUpperCase(),
          title: LANGUAGE_NAME[id],
        })),
        value: LANGUAGE,
        onChange: (id) => this.onLanguage?.(id as Language),
        cls: 'small',
      }),
    );
  }

  /** Undo and redo follow the history: a button with nothing to do is disabled. */
  setHistory(h: HistoryView) {
    this.history = h;
    this.undoBtn.disabled = !h.canUndo;
    this.redoBtn.disabled = !h.canRedo;
  }

  /**
   * Fit in the next frame, not inside the observer: the fit resizes the cells it observes, which
   * the observer would report as a loop if it happened in its own callback.
   */
  private queueFit() {
    if (this.fitQueued) return;
    this.fitQueued = true;
    requestAnimationFrame(() => {
      this.fitQueued = false;
      this.fit();
    });
  }

  /**
   * The loosest spacing at which everything fits (`compactLevel`): normal, then `compact`, then
   * `compact-2`, each laid out on its own and measured for overflow or a cut in the menu bar or the
   * weather text (`topbarCompact`). At the last level, as few labels gone as fit (`foldCount`). So
   * the answer does not depend on the last one, and the classes and the tooltip are written only
   * when it changed. An open menu follows its entry.
   */
  private fit() {
    const short = () => topbarCompact(this.root, [this.menuBar.root, this.weather]);
    this.menuBar.setFolded(0);
    const level =
      compactLevel((at) => {
        this.setLevelClasses(at);
        return short();
      }) ?? this.compact; // a hidden bar has no answer: keep the last one
    this.setLevelClasses(level);
    this.folded =
      foldCount(this.menuBar.foldable, (count) => {
        this.menuBar.setFolded(count);
        return short();
      }) ?? this.folded;
    this.menuBar.setFolded(this.folded);
    this.menuBar.place();
    if (level === this.compact) return;
    this.compact = level;
    this.titleWeather();
  }

  private setLevelClasses(level: CompactLevel) {
    this.root.classList.toggle('compact', level >= 1);
    this.root.classList.toggle('compact-2', level >= 2);
  }

  /** The Weather row's tooltip: in compact, the weather words the bar no longer shows. */
  private titleWeather() {
    const now = this.weather.textContent ?? '';
    this.menuBar.setHint(
      'weather',
      this.compact >= 1 && now ? STR.hud.weatherToggleHintNow(now) : STR.hud.weatherToggleHint,
    );
  }

  setToggles(weather: boolean, day: boolean) {
    this.menuBar.setOn('weather', weather);
    this.menuBar.setOn('dayNight', day);
  }

  /** Editor: hide the game screens and freeze the clock controls. */
  setEditor(on: boolean) {
    this.menuBar.setMode(on ? 'editor' : 'play');
    this.historyCell.style.display = on ? 'none' : '';
    this.locked = on;
    for (const b of this.speedBtns) b.disabled = on;
  }

  setWeather(text: string) {
    if (this.weather.textContent !== text) {
      this.weather.textContent = text;
      (this.weather.parentElement as HTMLElement).style.display = text ? '' : 'none';
      this.titleWeather();
    }
  }

  setFps(v: number | null) {
    this.fps.textContent = v === null ? '' : `${v} fps`;
    (this.fps.parentElement as HTMLElement).style.display = v === null ? 'none' : '';
  }

  /** The era widget: written only where it changed, as this runs every frame. */
  private updateEra(tier: number) {
    const v = eraView(this.ages(), tier);
    if (v.id !== this.eraId) {
      this.eraId = v.id;
      // fixed markup from ageIcon.ts, never from data
      this.eraIcon.innerHTML = ageIconSvg(v.id, 16);
    }
    if (this.eraName.textContent !== v.name) {
      this.eraName.textContent = v.name;
      // hidden at compact-2, a new name resizes no cell the observer watches: fit again by hand
      this.queueFit();
    }
    // the last age has no next one: no bar, and the label says it is the current one
    const bar = v.percent === undefined ? 'none' : '';
    if (this.eraBar.style.display !== bar) this.eraBar.style.display = bar;
    const width = `${v.percent ?? 100}%`;
    if (this.eraFill.style.width !== width) this.eraFill.style.width = width;
    const label = v.percent === undefined ? STR.ages.current : STR.hud.agePercent(v.percent);
    if (this.eraPct.textContent !== label) this.eraPct.textContent = label;
  }

  update(m: HudModel) {
    this.nowPlaying.update();
    this.updateEra(m.tier);
    this.day.textContent = STR.hud.day(this.clock.day);
    this.clockEl.textContent = this.clock.formatClock();
    this.speedBtns.forEach((b, i) =>
      b.classList.toggle('active', !this.locked && i === this.clock.speedIndex),
    );
    const paused = this.clock.speedIndex === 0;
    const pb = this.speedBtns[0];
    const glyph = paused ? '▶' : '❚❚';
    if (pb.textContent !== glyph) pb.textContent = glyph;
    pb.classList.toggle('paused', paused);
    pb.title = paused ? STR.hud.resume : STR.hud.pause;
  }
}
