import { Container, Rectangle } from 'pixi.js';
import { TrainRenderer } from '/src/render/trainRenderer.ts';
import { content } from '/src/data/content.ts';
import {
  vehicleSpec,
  poseVehicle,
  Polyline,
  facingOf,
  DRAWN_FACINGS,
  mirrorFacing,
  residualRotation,
  ROTATION_SHARE,
} from '/src/sim/body.ts';
import { referencePath, vehicleAccess } from '/src/sim/compat.ts';

export function checkBogies(step = 0.1) {
  const g = window.game;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  const rows = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  for (const def of [...content.locomotives, ...content.wagons].filter(
    (d) => d.size !== 'small' && d.size,
  )) {
    const spec = vehicleSpec(def);
    const isLoco = content.locomotives.includes(def);
    const row = { id: def.id, samples: 0, visibleWheelPixels: 0, maxSwivel: 0, maxSlide: 0 };
    for (const cls of ['regular', 'high_speed']) {
      if (vehicleAccess(def, cls)) continue;
      for (let rot = 0; rot < 4; rot++)
        for (const hand of [-1, 1])
          for (const reversed of [false, true]) {
            const a = (rot * Math.PI) / 2;
            const pl = new Polyline(
              referencePath(cls).pts.map((p) => ({
                x: p.x * Math.cos(a) - p.y * hand * Math.sin(a),
                y: p.x * Math.sin(a) + p.y * hand * Math.cos(a),
              })),
            );
            const layer = new Container({ sortableChildren: true });
            const renderer = new TrainRenderer(g.atlas, layer);
            const train = {
              id: 1,
              vehicleSpecs: [spec],
              vehiclePoses: [],
              prevVehiclePoses: [],
              locos: isLoco ? [{ def }] : [],
              wagons: isLoco ? [] : [{ def }],
              reversed,
            };
            for (let front = spec.L; front <= pl.length; front += step) {
              const pose = poseVehicle(pl, front, spec);
              train.vehiclePoses = [pose];
              renderer.update([train], 1);
              layer.sortChildren();
              const car = renderer.cars.get(1)[0];
              assert(car.parts.length === spec.segments.length, def.id + ': artificial body hinge');
              let bi = 0;
              pose.segments.forEach((segment, si) => {
                const body = car.parts[si];
                assert(segment.L === spec.segments[si].L, def.id + ': body length changed');
                assert(
                  body.x === Math.round((segment.x - segment.y) * 32),
                  def.id + ': body position',
                );
                segment.bogies.forEach((bogie) => {
                  const sprite = car.bogies[bi++];
                  const f = facingOf(bogie.angle),
                    drawn = DRAWN_FACINGS.has(f);
                  assert(!sprite.mask, def.id + ': hidden bogie motion');
                  assert(
                    sprite.x === Math.round((bogie.x - bogie.y) * 32) &&
                      sprite.y === Math.round((bogie.x + bogie.y) * 16),
                    def.id + ': bogie slid off rail',
                  );
                  assert(
                    sprite.texture ===
                      g.atlas.get(`rolling/${bogie.kind}_f${drawn ? f : mirrorFacing(f)}`).texture,
                    def.id + ': incorrect axle group/facing',
                  );
                  assert(
                    Math.abs(sprite.rotation - residualRotation(bogie.angle, f) * ROTATION_SHARE) <
                      1e-8,
                    def.id + ': static bogie angle',
                  );
                  row.maxSwivel = Math.max(
                    row.maxSwivel,
                    Math.abs(
                      Math.atan2(
                        Math.sin(bogie.angle - segment.angle),
                        Math.cos(bogie.angle - segment.angle),
                      ),
                    ),
                  );
                  row.maxSlide = Math.max(row.maxSlide, bogie.lateral);
                });
              });
              // Alpha masks measure visibility, not containment: the wheel pixels below/alongside
              // the raised body must survive composition. Full containment hid all wheel motion.
              const frame = new Rectangle(
                Math.round((pose.x - pose.y) * 32) - 125,
                Math.round((pose.x + pose.y) * 16) - 95,
                250,
                170,
              );
              const extract = () =>
                g.app.renderer.extract.pixels({ target: layer, frame, antialias: false }).pixels;
              car.undercarriage.visible = false;
              const bodyMask = extract();
              car.undercarriage.visible = true;
              car.parts.forEach((s) => (s.visible = false));
              const wheelMask = extract();
              for (let k = 3; k < wheelMask.length; k += 4)
                if (wheelMask[k] && !bodyMask[k]) row.visibleWheelPixels++;
              row.samples++;
            }
            renderer.remove(1);
            layer.destroy({ children: true });
          }
    }
    assert(
      row.maxSwivel > 0.1 && row.maxSlide > 0.01 && row.visibleWheelPixels > 0,
      def.id + ': no visible independent bogie movement',
    );
    rows.push(row);
    console.log('Bogie sweep: ' + def.id);
  }
  return { step, samples: rows.reduce((sum, r) => sum + r.samples, 0), rows };
}
