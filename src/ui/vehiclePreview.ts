import type { AtlasRegistry } from '../engine/atlas';
import { itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import { BOGIE_AXLES, vehicleSpec } from '../sim/body';
import { runsOn } from '../sim/compat';
import { el, btn } from './dom';
import { STR } from '../strings';
import { frameForItem, spriteDataUrl } from './spritePreview';

export function vehicleProperties(id: string): string[] {
  const d = itemDef(id),
    s = vehicleSpec(d);
  const V = STR.vehicle;
  const base = [V.body(s.size, s.L, s.plan), V.weight(d.weight)];
  if (itemKind(id) === 'loco') {
    const l = d as LocoDef;
    base.push(
      V.loco(l.type, l.speed, l.power),
      s.drawBogies
        ? s.segments.map((p) => V.bogie(p.nb, BOGIE_AXLES[p.bogie] * 2)).join(' + ')
        : V.axles,
    );
    if (l.fuelCap) base.push(V.fuel(l.fuelCap, l.fuelPerTile));
    if (l.waterCap) base.push(V.water(l.waterCap, l.waterPerTile));
  } else {
    const w = d as WagonDef;
    base.push(V.wagon(w.carries, w.capacity), (w.accepts ?? []).join(', '));
  }
  base.push(runsOn(d));
  return base;
}
/** Inspect a complete procedural vehicle from all 48 isometric headings. Drag to turn it. */
export function showVehiclePreview(atlas: AtlasRegistry, id: string): () => void {
  const overlay = el('div', { class: 'vehicle-preview-overlay' }),
    img = el('img', { alt: itemDef(id).name }) as HTMLImageElement;
  let facing = 0,
    spin = true,
    raf = 0,
    last = 0,
    dragX: number | null = null;
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: '47',
    value: '0',
    'aria-label': STR.vehicle.angle,
  }) as HTMLInputElement;
  const paint = () => {
    img.src = spriteDataUrl(atlas, frameForItem(id, facing), 3) ?? '';
    slider.value = String(facing);
  };
  const close = () => {
    cancelAnimationFrame(raf);
    overlay.remove();
    document.removeEventListener('keydown', key);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      close();
    }
  };
  document.addEventListener('keydown', key);
  const toggle = btn(
    STR.vehicle.pause,
    () => {
      spin = !spin;
      toggle.textContent = spin ? STR.vehicle.pause : STR.vehicle.rotate;
    },
    'small',
  );
  slider.oninput = () => {
    spin = false;
    toggle.textContent = STR.vehicle.rotate;
    facing = +slider.value;
    paint();
  };
  img.draggable = false;
  img.onpointerdown = (e) => {
    dragX = e.clientX;
    spin = false;
    toggle.textContent = STR.vehicle.rotate;
    img.setPointerCapture(e.pointerId);
  };
  img.onpointermove = (e) => {
    if (dragX === null) return;
    const step = Math.trunc((e.clientX - dragX) / 8);
    if (step) {
      facing = (facing + step + 48 * 100) % 48;
      dragX = e.clientX;
      paint();
    }
  };
  img.onpointerup = () => (dragX = null);
  img.onpointercancel = () => (dragX = null);
  overlay.append(
    el(
      'div',
      { class: 'panel vehicle-preview-panel' },
      el('div', { class: 'panel-title' }, itemDef(id).name, btn('×', close, 'small')),
      el('div', { class: 'vehicle-turntable' }, img),
      el(
        'div',
        { class: 'panel-body' },
        el('div', { class: 'dim', text: STR.vehicle.hint }),
        slider,
        toggle,
        ...vehicleProperties(id).map((text) => el('div', { class: 'kv', text })),
      ),
    ),
  );
  overlay.onmousedown = (e) => {
    if (e.target === overlay) close();
  };
  document.body.append(overlay);
  paint();
  const tick = (now: number) => {
    if (spin && now - last > 120) {
      facing = (facing + 1) % 48;
      paint();
      last = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return close;
}
