import { Container, Rectangle } from 'pixi.js';
import { TrainRenderer } from '/src/render/trainRenderer.ts';
import { content } from '/src/data/content.ts';
import { vehicleSpec, poseVehicle, Polyline } from '/src/sim/body.ts';
import { referencePath, vehicleAccess } from '/src/sim/compat.ts';
export async function gpuMasks(
  ids = [...content.locomotives, ...content.wagons]
    .filter((d) => d.size === 'medium' || d.size === 'large')
    .map((d) => d.id),
  step = 0.05,
  disableMasks = false,
  resolution = 1,
) {
  const g = window.game;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  let samples = 0,
    outside = 0,
    nonempty = 0;
  const failures = [],
    rows = [];
  for (const id of ids) {
    const startSamples = samples,
      startOutside = outside;
    const def = [...content.locomotives, ...content.wagons].find((d) => d.id === id);
    const spec = vehicleSpec(def);
    const isLoco = content.locomotives.includes(def);
    for (const cls of ['regular', 'high_speed']) {
      if (vehicleAccess(def, cls)) continue;
      const base = referencePath(cls);
      for (let rot = 0; rot < 4; rot++)
        for (const hand of [-1, 1])
          for (const reversed of [false, true]) {
            const a = (rot * Math.PI) / 2;
            const pl = new Polyline(
              base.pts.map((p) => ({
                x: p.x * Math.cos(a) - p.y * hand * Math.sin(a),
                y: p.x * Math.sin(a) + p.y * hand * Math.cos(a),
              })),
            );
            const layer = new Container({ sortableChildren: true });
            const r = new TrainRenderer(g.atlas, layer);
            const t = {
              id: 1,
              vehicleSpecs: [spec],
              vehiclePoses: [],
              prevVehiclePoses: [],
              locos: isLoco ? [{ def }] : [],
              wagons: isLoco ? [] : [{ def }],
              reversed,
            };
            for (let front = spec.L; front <= pl.length; front += step) {
              const p = poseVehicle(pl, front, spec);
              t.vehiclePoses = [p];
              t.prevVehiclePoses = [poseVehicle(pl, front - 0.02, spec)];
              r.update([t], 0.5);
              layer.sortChildren();
              const car = r.cars.get(1)[0];
              if (disableMasks) {
                car.bogies.forEach((b) => (b.mask = null));
                if (car.silhouette) car.silhouette.visible = false;
              }
              const frame = new Rectangle(
                Math.round((p.x - p.y) * 32) - 125,
                Math.round((p.x + p.y) * 16) - 95,
                250,
                170,
              );
              const extract = () =>
                g.app.renderer.extract.pixels({
                  target: layer,
                  frame,
                  resolution,
                  antialias: false,
                }).pixels;
              if (car.undercarriage) car.undercarriage.visible = false;
              else car.bogies.forEach((s) => (s.visible = false));
              const body = extract();
              car.parts.forEach((s) => (s.visible = false));
              if (car.undercarriage) car.undercarriage.visible = true;
              else car.bogies.forEach((s) => (s.visible = true));
              const bogie = extract();
              let n = 0,
                ink = 0;
              for (let k = 3; k < body.length; k += 4)
                if (bogie[k]) {
                  ink++;
                  if (!body[k]) n++;
                }
              if (ink) nonempty++;
              if (n) {
                outside += n;
                if (failures.length < 12)
                  failures.push({ id, cls, rot, hand, reversed, front, outside: n });
              }
              samples++;
            }
            r.remove(1);
            layer.destroy({ children: true });
          }
    }
    rows.push({ id, samples: samples - startSamples, outside: outside - startOutside });
    console.log('GPU checked ' + id);
  }
  return { step, resolution, samples, outside, nonempty, rows, failures };
}
