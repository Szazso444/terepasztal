import type { AtlasRegistry } from '../engine/atlas';
import { itemDef, itemKind } from '../gacha/items';
import { el } from './dom';
import { STR } from '../strings';
import {
  actionButton,
  columns,
  labelValue,
  note,
  page,
  rangePercent,
  slider,
  well,
  type FootSpec,
} from './kit';
import { rarityStars } from './labels';
import type { Screen } from './modal';
import { frameForItem, spriteDataUrl } from './spritePreview';
import { vehicleProperties } from './vehicleProperties';
import { FACING_COUNT, FACING_STEP_MS, facingDegrees, nextFacing, turnedBy } from './inspectView';

/**
 * Inspect 3D: a model turning on its own, from every one of its headings, over the screen that
 * asked for it. Drag it, or take the angle slider, to turn it by hand; Back returns.
 */
export class InspectScreen implements Screen {
  readonly id = 'inspect';
  readonly icon = 'eye';
  readonly frameSize = 'M';
  readonly root = page();
  private defId: string | null = null;
  private facing = 0;
  private spin = true;
  private raf = 0;
  private last = 0;
  private dragX: number | null = null;
  private img = el('img', { class: 'ec-turn-img', alt: '' });
  private heading = el('span', { class: 'ec-heading' });
  private toggle = actionButton(STR.vehicle.pause, () => this.setSpin(!this.spin), {
    cls: 'small',
  });
  private angle: HTMLElement | null = null;

  constructor(private readonly atlas: AtlasRegistry) {
    this.setupTurning();
  }

  get title(): string {
    return this.defId ? itemDef(this.defId).name : STR.craft.inspect;
  }

  /** Choose the model to show; the caller puts the screen on the stack. */
  show(defId: string) {
    this.defId = defId;
    this.facing = 0;
    this.spin = true;
    this.build();
  }

  frameFooter(): FootSpec {
    const kind = this.defId && itemKind(this.defId) === 'loco' ? STR.gacha.loco : STR.gacha.wagon;
    return { note: STR.vehicle.note(this.defId ? kind : '') };
  }

  onOpen() {
    this.last = 0;
    const tick = (now: number) => {
      if (this.spin && now - this.last > FACING_STEP_MS) {
        this.turnTo(nextFacing(this.facing));
        this.last = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  onClose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---------------------------------------------------------------- turning
  private setupTurning() {
    this.img.draggable = false;
    this.img.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      this.setSpin(false);
      this.img.setPointerCapture(e.pointerId);
    });
    this.img.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      const step = turnedBy(e.clientX - this.dragX);
      if (step) {
        this.turnTo(this.facing + step);
        this.dragX = e.clientX;
      }
    });
    const end = () => (this.dragX = null);
    this.img.addEventListener('pointerup', end);
    this.img.addEventListener('pointercancel', end);
  }

  private setSpin(on: boolean) {
    this.spin = on;
    this.toggle.textContent = on ? STR.vehicle.pause : STR.vehicle.rotate;
  }

  /** Show the heading `to` (a number of headings round, in either direction). */
  private turnTo(to: number) {
    this.facing = ((to % FACING_COUNT) + FACING_COUNT) % FACING_COUNT;
    this.paint();
  }

  private paint() {
    if (!this.defId) return;
    this.img.src = spriteDataUrl(this.atlas, frameForItem(this.defId, this.facing), 3) ?? '';
    this.heading.textContent = STR.vehicle.degrees(facingDegrees(this.facing));
    const input = this.angle?.querySelector('input');
    if (input) {
      input.value = String(this.facing);
      input.style.setProperty(
        '--k-fill',
        `${rangePercent(this.facing, { min: 0, max: FACING_COUNT - 1 })}%`,
      );
      const shown = this.angle?.querySelector('em');
      if (shown) shown.textContent = STR.vehicle.degrees(facingDegrees(this.facing));
    }
  }

  // ---------------------------------------------------------------- what is on show
  private build() {
    const id = this.defId;
    if (!id) return;
    const d = itemDef(id);
    this.angle = slider({
      min: 0,
      max: FACING_COUNT - 1,
      step: 1,
      value: this.facing,
      label: STR.vehicle.angle,
      format: (v) => STR.vehicle.degrees(facingDegrees(v)),
      onInput: (v) => {
        this.setSpin(false);
        this.turnTo(v);
      },
    });
    this.setSpin(true);
    this.root.replaceChildren(
      columns(
        [
          well(
            STR.vehicle.preview,
            el('div', { class: 'ec-turn' }, this.img, this.heading),
            note(STR.vehicle.hint),
            el(
              'div',
              { class: 'ec-angle' },
              el('span', { text: STR.vehicle.angle }),
              this.angle,
              this.toggle,
            ),
            d.era ? el('p', { class: 'k-p ec-era', text: d.era }) : null,
          ),
        ],
        [
          well(
            STR.vehicle.properties,
            labelValue(
              STR.vehicle.quality,
              el(
                'span',
                { class: `rarity-${d.rarity}` },
                rarityStars(d.rarity, `rarity-${d.rarity}`),
                ` ${STR.craft.quality[d.rarity] ?? d.rarity}`,
              ),
            ),
            labelValue(
              STR.vehicle.kind,
              itemKind(id) === 'loco' ? STR.gacha.loco : STR.gacha.wagon,
            ),
            ...vehicleProperties(id).map((text) => el('div', { class: 'ec-prop', text })),
          ),
        ],
      ),
    );
    this.paint();
  }
}
