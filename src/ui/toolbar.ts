import { el, btn, fmtMoney } from './dom';
import { STR } from '../strings';
import { TRACK_KINDS, pieceCost, type TrackKind } from '../world/track';
import { STATION_DEFS } from '../sim/stations';
import { DECOR_DEFS } from '../sim/build';

export type Tool =
  | { kind: 'none' }
  | { kind: 'track'; piece: TrackKind }
  | { kind: 'station'; defId: string }
  | { kind: 'decor'; defId: string }
  | { kind: 'remove' };

/** Bottom build bar. */
export class Toolbar {
  readonly root: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private status = el('span', { class: 'tb-status dim' });
  readonly extra = el('div', { class: 'tb-group' });

  constructor(
    private readonly onSelect: (t: Tool) => void,
    private readonly tierProvider: () => number,
  ) {
    const trackGroup = el(
      'div',
      { class: 'tb-group' },
      el('span', { class: 'tb-label', text: STR.toolbar.track }),
    );
    for (const k of TRACK_KINDS) {
      const name = (trackDataName(k) ?? k) + ` ${fmtMoney(pieceCost(k))}`;
      const b = btn(name, () => this.select({ kind: 'track', piece: k }));
      b.title = name;
      this.buttons.set(`track:${k}`, b);
      trackGroup.append(b);
    }
    const stationGroup = el(
      'div',
      { class: 'tb-group' },
      el('span', { class: 'tb-label', text: STR.toolbar.stations }),
    );
    for (const d of STATION_DEFS) {
      const b = btn(`${d.name} ${fmtMoney(d.cost)}`, () =>
        this.select({ kind: 'station', defId: d.id }),
      );
      b.title = d.flavor;
      this.buttons.set(`station:${d.id}`, b);
      stationGroup.append(b);
    }
    const decorGroup = el(
      'div',
      { class: 'tb-group' },
      el('span', { class: 'tb-label', text: STR.toolbar.decor }),
    );
    for (const d of DECOR_DEFS) {
      const b = btn(`${d.name} ${fmtMoney(d.cost)}`, () =>
        this.select({ kind: 'decor', defId: d.id }),
      );
      b.title = d.flavor;
      this.buttons.set(`decor:${d.id}`, b);
      decorGroup.append(b);
    }
    const removeBtn = btn(STR.toolbar.remove, () => this.select({ kind: 'remove' }));
    removeBtn.title = STR.toolbar.removeHint;
    this.buttons.set('remove', removeBtn);
    this.root = el(
      'div',
      { id: 'toolbar', class: 'panel' },
      el(
        'div',
        { class: 'tb-row' },
        trackGroup,
        stationGroup,
        decorGroup,
        el('div', { class: 'tb-group' }, removeBtn),
        this.extra,
      ),
      el('div', { class: 'tb-row tb-statusrow' }, this.status),
    );
  }

  select(t: Tool) {
    this.onSelect(t);
    this.setActive(t);
  }

  setActive(t: Tool) {
    const key =
      t.kind === 'track'
        ? `track:${t.piece}`
        : t.kind === 'station'
          ? `station:${t.defId}`
          : t.kind === 'decor'
            ? `decor:${t.defId}`
            : t.kind === 'remove'
              ? 'remove'
              : '';
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === key);
  }

  refresh() {
    const tier = this.tierProvider();
    for (const d of STATION_DEFS) {
      const b = this.buttons.get(`station:${d.id}`)!;
      b.disabled = d.tier > tier;
    }
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }
}

function trackDataName(k: TrackKind): string | undefined {
  return {
    straight: 'Straight',
    curve: 'Curve',
    switch: 'Switch',
    crossing: 'Crossing',
    bridge: 'Bridge',
  }[k];
}
