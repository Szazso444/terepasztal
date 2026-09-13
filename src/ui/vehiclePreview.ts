import type { AtlasRegistry } from '../engine/atlas';
import { itemDef, itemKind, type LocoDef, type WagonDef } from '../gacha/items';
import { vehicleSpec } from '../sim/body';
import { el, btn } from './dom';
import { frameForItem, spriteDataUrl } from './spritePreview';

export function vehicleProperties(id: string): string[] {
  const d = itemDef(id),
    s = vehicleSpec(d);
  const base = [
    `${s.size} · ${s.L} tile${s.L === 1 ? '' : 's'} · ${s.plan}`,
    `${d.weight} t empty`,
  ];
  if (itemKind(id) === 'loco') {
    const l = d as LocoDef;
    base.push(
      `${l.type} · ${l.speed.toFixed(2)} tiles/s · ${l.power} t haul`,
      s.drawBogies
        ? `${s.segments.map((p) => `${p.nb} × ${p.bogie === 'bogie' ? 4 : 6} wheels`).join(' + ')}`
        : '2 axles · 4 wheels',
    );
    if (l.fuelCap) base.push(`Fuel ${l.fuelCap} · ${l.fuelPerTile} per tile`);
    if (l.waterCap) base.push(`Water ${l.waterCap} · ${l.waterPerTile} per tile`);
  } else {
    const w = d as WagonDef;
    base.push(`${w.carries} · ${w.capacity} units`, (w.accepts ?? []).join(', '));
  }
  base.push(s.size === 'large' ? 'High-speed track required' : 'Regular and high-speed track');
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
    'aria-label': 'Viewing angle',
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
    'Pause rotation',
    () => {
      spin = !spin;
      toggle.textContent = spin ? 'Pause rotation' : 'Rotate';
    },
    'small',
  );
  slider.oninput = () => {
    spin = false;
    toggle.textContent = 'Rotate';
    facing = +slider.value;
    paint();
  };
  img.draggable = false;
  img.onpointerdown = (e) => {
    dragX = e.clientX;
    spin = false;
    toggle.textContent = 'Rotate';
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
        el('div', { class: 'dim', text: 'Rotating isometric preview · drag to turn' }),
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
