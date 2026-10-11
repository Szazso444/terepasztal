import { drawIllustrated, assetManifest } from './illustrated.js';
import { dimensions } from '../grid-buildings/footprint.mjs';
const buildings = assetManifest.buildings ?? [],
  container = document.getElementById('library');
function draw() {
  container.replaceChildren();
  const filter = document.getElementById('filter').value;
  for (const b of buildings.filter((a) => filter === 'all' || a.tiles === Number(filter))) {
    const section = document.createElement('section'),
      heading = document.createElement('div'),
      h = document.createElement('h2'),
      link = document.createElement('a'),
      row = document.createElement('div');
    heading.className = 'heading';
    h.textContent = b.id;
    link.textContent = `Place · ${b.tiles} tile${b.tiles === 2 ? 's' : ''}`;
    link.href = `index.html?asset=${encodeURIComponent(b.key)}`;
    heading.append(h, link);
    row.className = 'row';
    const ref = document.createElement('div');
    ref.className = 'cell reference';
    const img = new Image();
    img.src = b.reference
      ? '/' + b.reference
      : b.key === 'house'
        ? '/assets/source/base-v1/house-cottage.png'
        : '/assets/source/base-v1/station.png';
    img.alt = b.id + ' original';
    img.loading = 'lazy';
    const label = document.createElement('small');
    label.textContent = 'Original reference';
    ref.append(label, img);
    row.append(ref);
    for (let r = 0; r < 4; r++) {
      const cell = document.createElement('div'),
        caption = document.createElement('small'),
        canvas = document.createElement('canvas');
      cell.className = 'cell';
      caption.textContent = `Facing ${r + 1}`;
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext('2d'),
        [w, h] = dimensions(b.tiles, r),
        p = (x, y, z = 0) => [150 + (x - y) * 62, 245 + (x + y) * 31 - z * 84];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          ctx.beginPath();
          [
            [x - w / 2, y - h / 2],
            [x + 1 - w / 2, y - h / 2],
            [x + 1 - w / 2, y + 1 - h / 2],
            [x - w / 2, y + 1 - h / 2],
          ].forEach((a, i) => {
            const [u, v] = p(...a);
            i ? ctx.lineTo(u, v) : ctx.moveTo(u, v);
          });
          ctx.closePath();
          ctx.fillStyle =
            b.material === 'dirt' ? '#a88e61' : b.material === 'gravel' ? '#92948a' : '#b7ad94';
          ctx.fill();
          ctx.strokeStyle = '#eccb85';
          ctx.stroke();
        }
      drawIllustrated(ctx, b.tiles, r, p, [-w / 2, -h / 2], b.key);
      cell.append(caption, canvas);
      row.append(cell);
    }
    section.append(heading, row);
    container.append(section);
  }
  document.getElementById('summary').textContent =
    `${buildings.length} buildings · ${buildings.length * 4} illustrated facings · four directions per building`;
  window.buildingLibraryReady = true;
}
document.getElementById('filter').onchange = draw;
draw();
