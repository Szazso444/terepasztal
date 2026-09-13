import { Container, Rectangle, Sprite } from 'pixi.js';
import { TrainRenderer } from '/src/render/trainRenderer.ts';
import { content } from '/src/data/content.ts';
import { vehicleSpec, poseVehicle } from '/src/sim/body.ts';
import { referencePath } from '/src/sim/compat.ts';

export function sequence() {
  const g = window.game;
  g.clock.setSpeed(0);
  g.app.ticker.stop();
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 1060;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#203238';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#f5dda9';
  c.font = '26px sans-serif';
  c.fillText('RIGID BODIES / INDEPENDENT BOGIES', 28, 38);
  c.font = '17px sans-serif';
  ['Straight', 'Entering', 'Middle of curve', 'Leaving'].forEach((s, i) =>
    c.fillText(s, i * 360 + 30, 72),
  );
  ['f7', 'sd40', 'dda40x'].forEach((id, row) => {
    const def = content.locomotives.find((d) => d.id === id),
      spec = vehicleSpec(def);
    const cls = spec.size === 'large' ? 'high_speed' : 'regular',
      pl = referencePath(cls);
    const arc = ((cls === 'regular' ? 0.5 : 1.5) * Math.PI) / 2;
    const fronts = [3.7, 4.4, 4 + arc / 2 + spec.L / 2, 4 + arc + spec.L * 0.8];
    c.fillStyle = '#f5dda9';
    c.font = '17px sans-serif';
    c.fillText(
      `${def.name} · ${spec.segments[0].nb} bogies × ${def.bogieAxles === 3 ? '6' : '4'} wheels · ${cls}`,
      28,
      100 + row * 280,
    );
    fronts.forEach((front, col) => {
      const pose = poseVehicle(pl, front, spec);
      const layer = new Container({ sortableChildren: true });
      const renderer = new TrainRenderer(g.atlas, layer);
      renderer.update(
        [
          {
            id: 1,
            vehicleSpecs: [spec],
            vehiclePoses: [pose],
            prevVehiclePoses: [],
            locos: [{ def }],
            wagons: [],
            reversed: false,
          },
        ],
        1,
      );
      layer.sortChildren();
      const wx = (pose.x - pose.y) * 32,
        wy = (pose.x + pose.y) * 16;
      c.save();
      c.beginPath();
      c.rect(col * 360 + 15, 112 + row * 280, 330, 252);
      c.clip();
      c.translate(col * 360 + 180, 240 + row * 280);
      c.scale(2.5, 2.5);
      c.translate(-wx, -wy);
      for (const side of [-1, 1]) {
        c.beginPath();
        pl.pts.forEach((p, i) => {
          const tangent = pl.tangent(pl.cum[i]);
          const x = p.x - tangent.y * side * 0.095,
            y = p.y + tangent.x * side * 0.095;
          i ? c.lineTo((x - y) * 32, (x + y) * 16) : c.moveTo((x - y) * 32, (x + y) * 16);
        });
        c.strokeStyle = '#66817f';
        c.lineWidth = 0.7;
        c.stroke();
      }
      const image = g.app.renderer.extract.canvas({
        target: layer,
        frame: new Rectangle(wx - 80, wy - 80, 160, 160),
        antialias: false,
      });
      c.drawImage(image, wx - 80, wy - 80);
      c.restore();
      renderer.remove(1);
      layer.destroy({ children: true });
    });
  });
  c.fillStyle = '#f5dda9';
  c.font = '18px sans-serif';
  c.fillText('Shared wheel groups (both sides drawn, with separate axles)', 28, 976);
  ['bogie', 'bogie3', 'engine_unit'].forEach((kind, i) => {
    const f = g.atlas.get(`rolling/${kind}_f0`),
      sprite = new Sprite(f.texture);
    const image = g.app.renderer.extract.canvas({ target: sprite });
    c.drawImage(image, 550 + i * 285, 972, image.width * 4, image.height * 4);
    sprite.destroy();
  });
  canvas.style = 'position:fixed;inset:0;z-index:999999;width:1440px;height:1060px';
  document.body.append(canvas);
}
