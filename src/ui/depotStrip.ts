import type { AtlasRegistry } from '../engine/atlas';
import { sfx } from '../engine/audio';
import { STR } from '../strings';
import type { Car } from './depotView';
import { el } from './dom';
import { vehicleArt } from './economyParts';
import { actionButton, spriteSlot } from './kit';
import { withCard, type CardTip } from './vehicleRow';

/** What a strip that can be changed asks for; a train in service has none. */
export interface StripEdit {
  /** take the vehicle off the train */
  remove(car: Car): void;
  /** move it to place `to` among the vehicles of its kind */
  move(car: Car, to: number): void;
  /** take every vehicle off */
  clear(): void;
}

/** The vehicles of one kind, as a move counts its places. */
const kindOf = (cars: readonly Car[], car: Car) => cars.filter((c) => c.loco === car.loco);

/**
 * The train as small pictures, in the order it runs. A click takes a vehicle off, a drag or the
 * arrow keys move it along its kind: engines stay ahead of wagons, as `Fleet.create` makes a train.
 */
export function consistStrip(
  atlas: AtlasRegistry,
  cars: readonly Car[],
  card: (car: Car) => CardTip,
  edit?: StripEdit,
): HTMLElement {
  const root = el('div', { class: `dp-cars ${edit ? '' : 'ro'}`.trim() });
  let dragged: Car | null = null;
  const clearMarks = () => {
    for (const e of root.querySelectorAll('.drag, .over')) e.classList.remove('drag', 'over');
  };
  cars.forEach((car, i) => {
    const first = i > 0 && !car.loco && cars[i - 1].loco;
    const e = el(
      'div',
      {
        class: ['dp-car', first ? 'dp-car-w' : '', car.bad ? 'dp-car-bad' : ''].join(' ').trim(),
        'data-uid': String(car.uid),
      },
      spriteSlot(withCard(atlas, vehicleArt(atlas, car.defId), card(car))),
      car.level > 1 ? el('em', { text: STR.roster.lv(car.level) }) : null,
    );
    root.append(e);
    if (!edit) return;
    e.tabIndex = 0;
    e.draggable = true;
    e.setAttribute('role', 'button');
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();
      sfx('ui.click');
      edit.remove(car);
    });
    e.addEventListener('keydown', (ev) => {
      // the game reads these keys as well: they stop here, on a vehicle in the strip
      const by = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
      if (by) edit.move(car, kindOf(cars, car).indexOf(car) + by);
      else if (ev.key === 'Delete' || ev.key === 'Enter') edit.remove(car);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    });
    e.addEventListener('dragstart', (ev) => {
      dragged = car;
      e.classList.add('drag');
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', String(car.uid));
      }
    });
    e.addEventListener('dragover', (ev) => {
      if (!dragged || dragged.loco !== car.loco) return;
      ev.preventDefault();
      if (dragged !== car) e.classList.add('over');
    });
    e.addEventListener('dragleave', () => e.classList.remove('over'));
    e.addEventListener('dragend', () => {
      dragged = null;
      clearMarks();
    });
    e.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const from = dragged;
      dragged = null;
      clearMarks();
      if (from && from !== car && from.loco === car.loco)
        edit.move(from, kindOf(cars, car).indexOf(car));
    });
  });
  if (edit)
    root.append(
      el('small', { class: 'dp-hint', text: STR.depot.stripHint }),
      actionButton(STR.depot.clearConsist, () => edit.clear(), {
        cls: 'small',
        title: STR.depot.clearHint,
      }),
    );
  return root;
}
