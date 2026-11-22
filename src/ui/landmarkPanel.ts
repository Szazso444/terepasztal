import type { Commands } from '../sim/commands';
import type { LandmarkItem, LandmarkRegistry } from '../sim/landmarks';
import type { WindLevel } from '../sim/wind';
import { STR } from '../strings';
import { btn, el } from './dom';
import {
  actionButton,
  buttonRow,
  choiceRows,
  meter,
  note,
  sectionHeader,
  well,
  type ConfirmOptions,
} from './kit';
import {
  landmarkName,
  landmarkView,
  type LandmarkAction,
  type LandmarkView,
  type PathView,
} from './landmarkView';

/** What the panel reads, and what its buttons ask for: the registry is read, never driven. */
export interface LandmarkPanelHost {
  landmarks: Pick<LandmarkRegistry, 'byId' | 'reasonOf'>;
  /** the three choices go through the commands only */
  commands: Pick<Commands, 'startLandmark' | 'salvageLandmark' | 'cancelLandmark'>;
  /** the game hour and the wind now: what the condition is checked against */
  now(): { hour: number; wind: WindLevel };
  confirm(title: string, text: string, o?: ConfirmOptions): Promise<boolean>;
  toast(m: string, k?: 'info' | 'warn' | 'good'): void;
  onClose(): void;
}

/** How often an open panel looks again, in milliseconds: the clock and the deliveries move it. */
const REFRESH_MS = 500;

/**
 * Side panel for a selected landmark (#548, spec section 7), top left where the works panel stands:
 * the name and story (Unknown while only spotted), the stage, both paths with what they cost and
 * give, the buttons that choose, the delivery progress and the condition while it restores, and the
 * effect once it is done. It is drawn again only when what it says changes, so a button under the
 * pointer stays the same element. Start, Salvage and Cancel ask first: they are final.
 */
export class LandmarkPanel {
  readonly root: HTMLElement;
  private readonly body = el('div', { class: 'panel-body tp-scroll' });
  private readonly title = el('span', { class: 'panel-name' });
  item: LandmarkItem | null = null;
  /** the pick the player made for the Restore of the landmark shown, where it has one */
  private pick = '';
  private said = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly host: LandmarkPanelHost) {
    this.root = el(
      'div',
      { id: 'landmark-panel', class: 'panel' },
      el(
        'div',
        { class: 'panel-title' },
        this.title,
        btn('×', () => this.close(), 'panel-x'),
      ),
      this.body,
    );
    this.root.style.display = 'none';
  }

  open(item: LandmarkItem) {
    if (this.item?.id !== item.id) this.pick = '';
    this.item = item;
    this.root.style.display = '';
    this.timer ??= setInterval(() => this.render(), REFRESH_MS);
    this.render(true);
  }
  close() {
    this.item = null;
    this.root.style.display = 'none';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host.onClose();
  }

  /** Draw the landmark as it is now; `force` draws even when nothing it says has changed. */
  render(force = false) {
    const open = this.item;
    const item = open && this.host.landmarks.byId(open.id);
    if (!open || !item) {
      if (open) this.close();
      return;
    }
    const view = landmarkView(item, {
      ...this.host.now(),
      reason: this.host.landmarks.reasonOf(item.id),
    });
    if (!view) {
      this.close();
      return;
    }
    const said = JSON.stringify([view, this.pick]);
    if (!force && said === this.said) return;
    this.said = said;
    this.title.textContent = view.title;
    this.body.replaceChildren(...this.draw(view, item));
  }

  private draw(v: LandmarkView, item: LandmarkItem): HTMLElement[] {
    const out: HTMLElement[] = [well(null, note(v.story), sectionHeader(v.stageName))];
    for (const p of v.paths) out.push(this.pathWell(v, p));
    if (v.progress.length) {
      const head = STR.landmarks.progressHead;
      const rows: HTMLElement[] = v.progress.map((p) => meter(p.text, '', p.share));
      if (v.condition) rows.push(...this.conditionNotes(v));
      if (v.effect) rows.push(note(v.effect));
      if (v.actions.includes('cancel'))
        rows.push(buttonRow(this.button('cancel', item, 'danger small')));
      out.splice(1, 0, well(head, ...rows));
    } else if (v.condition && v.stage === 'surveyed') {
      out.push(well(null, ...this.conditionNotes(v)));
    }
    if (v.effect && v.stage !== 'restoring') {
      const rows = [note(v.effect)];
      if (v.reason) rows.push(note(v.reason, 'bad'));
      out.push(well(null, ...rows));
    }
    return out;
  }

  private conditionNotes(v: LandmarkView): HTMLElement[] {
    const c = v.condition;
    if (!c) return [];
    return [note(c.text), ...(c.state ? [note(c.state, c.holds ? '' : 'bad')] : [])];
  }

  private pathWell(v: LandmarkView, p: PathView): HTMLElement {
    const item = this.item as LandmarkItem;
    const rows: HTMLElement[] = [note(p.cost)];
    if (p.gives) rows.push(note(p.gives));
    const picking = p.picks.length > 0;
    if (picking) {
      rows.push(
        note(STR.landmarks.pick.head),
        choiceRows({
          options: p.picks.map((k) => ({ id: k.id, label: k.label, hint: k.gives })),
          value: this.pick,
          onChange: (id) => {
            this.pick = id;
            this.render();
          },
        }),
      );
    }
    const action: LandmarkAction = p.id === 'restore' ? 'start' : 'salvage';
    if (v.actions.includes(action)) {
      const wait = action === 'start' && picking && !this.pick;
      rows.push(
        buttonRow(
          this.button(action, item, action === 'salvage' ? 'danger small' : 'pri small', wait),
        ),
      );
    }
    return well(p.name, ...rows);
  }

  private button(a: LandmarkAction, item: LandmarkItem, cls: string, wait = false) {
    return actionButton(STR.landmarks.buttons[a], () => void this.ask(a, item.id), {
      cls,
      disabled: wait,
      title: wait ? STR.landmarks.refusals.pick : undefined,
    });
  }

  /** The player chose: ask, since each choice is final, then ask the commands. */
  private async ask(a: LandmarkAction, id: number) {
    const L = STR.landmarks;
    const item = this.host.landmarks.byId(id);
    if (!item) return;
    const name = landmarkName(item.def);
    const text = a === 'start' ? L.confirm.restore(name) : L.confirm[a](name);
    const yes = await this.host.confirm(L.buttons[a], text, {
      yes: L.buttons.confirm,
      no: L.buttons.keep,
      danger: a !== 'start',
    });
    if (!yes) return;
    const c = this.host.commands;
    const r =
      a === 'start'
        ? c.startLandmark(id, this.pick || undefined)
        : a === 'salvage'
          ? c.salvageLandmark(id)
          : c.cancelLandmark(id);
    if (!r.ok) this.host.toast(L.refusals[r.reason] ?? r.reason, 'warn');
    this.render(true);
  }
}
