import { content } from '/src/data/content.ts';
import * as body from '/src/sim/body.ts';
import * as compat from '/src/sim/compat.ts';
import { TrainRenderer } from '/src/render/trainRenderer.ts';
import { Container, Rectangle } from 'pixi.js';
export async function check(label) {
  const g = window.game;
  g.closeMenus();
  g.settings.autosave = false;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1d2b30';
  ctx.fillRect(0, 0, 1440, 1000);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#f5dda9';
  ctx.font = '26px sans-serif';
  ctx.fillText('CURVE STUDY / ' + label.toUpperCase(), 40, 42);
  const defs = ['dda40x', 'gg1', 'big_boy', 'crocodile', 'gmam', 'sd40'].map((id) =>
    content.locomotives.find((d) => d.id === id),
  );
  const results = [];
  for (let idx = 0; idx < defs.length; idx++) {
    const def = defs[idx],
      spec = body.vehicleSpec(def),
      cls = def.size === 'large' ? 'high_speed' : 'regular',
      pl = compat.referencePath(cls),
      front = 4 + (cls === 'regular' ? 0.4 : 1.15) + spec.L / 2;
    const pose = body.poseVehicle(pl, front, spec),
      layer = new Container({ sortableChildren: true }),
      renderer = new TrainRenderer(g.atlas, layer);
    const train = {
      id: idx + 100,
      vehicleSpecs: [spec],
      vehiclePoses: [pose],
      prevVehiclePoses: [pose],
      locos: [{ def }],
      wagons: [],
      reversed: false,
    };
    renderer.update([train], 1);
    layer.sortChildren();
    const col = idx % 3,
      row = Math.floor(idx / 3),
      ox = col * 480 + 240,
      oy = row * 455 + 295;
    ctx.fillStyle = '#d2c5a1';
    ctx.font = '20px sans-serif';
    ctx.fillText(def.name, col * 480 + 30, row * 455 + 87);
    ctx.font = '14px sans-serif';
    ctx.fillText(
      cls + ' / ' + ((pose.segments[0].angle * 180) / Math.PI).toFixed(1) + ' degrees',
      col * 480 + 30,
      row * 455 + 110,
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * 480 + 16, row * 455 + 125, 448, 300);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(3, 3);
    const wp = { x: (pose.x - pose.y) * 32, y: (pose.x + pose.y) * 16 };
    ctx.translate(-wp.x, -wp.y);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      pl.pts.forEach((p, i) => {
        const t = pl.tangent(pl.cum[i]);
        const x = p.x - t.y * 0.095 * sign,
          y = p.y + t.x * 0.095 * sign;
        const sx = (x - y) * 32,
          sy = (x + y) * 16;
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.strokeStyle = '#94aaa7';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const image = g.app.renderer.extract.canvas({
      target: layer,
      frame: new Rectangle(wp.x - 100, wp.y - 75, 200, 145),
      resolution: 1,
      antialias: false,
    });
    ctx.drawImage(image, wp.x - 100, wp.y - 75);
    ctx.restore();
    renderer.remove(train.id);
    layer.destroy({ children: true });
    results.push({
      id: def.id,
      cls,
      verdict: compat.verdictOf(def, cls),
      regular: compat.verdictOf(def, 'regular'),
      accessRegular: compat.vehicleAccess(def, 'regular'),
    });
  }
  const old = document.getElementById('study');
  if (old) old.remove();
  canvas.id = 'study';
  canvas.style = 'position:fixed;inset:0;z-index:999999;width:1440px;height:1000px';
  document.body.append(canvas);
  return results;
}
