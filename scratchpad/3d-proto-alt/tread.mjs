import { positions } from './wheel-contact.mjs';
for (const [name, axles] of [['engine', [-2.29, -0.95, 0.40]], ['tender', [-0.90, 0.03, 1.14]]]) {
  const P = positions(`export/black_five_${name}.glb`);
  for (const ax of axles) {
    let zmin = 9; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - ax) < 0.3 && Math.abs(P[i + 1]) > 0.2) zmin = Math.min(zmin, P[i + 2]);
    let lo = 9, hi = 0, n = 0; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - ax) < 0.3 && Math.abs(P[i + 1]) > 0.2 && P[i + 2] < zmin + 0.03) { lo = Math.min(lo, Math.abs(P[i + 1])); hi = Math.max(hi, Math.abs(P[i + 1])); n++; }
    console.log(name, 'axle x', ax, 'lowest z', (zmin * 1000).toFixed(0), 'mm; tread |y| from', lo.toFixed(2), 'to', hi.toFixed(2), 'm (', n, 'verts ) -> rail centre', ((lo + hi) / 2).toFixed(2), 'm, gauge', (lo + hi).toFixed(2), 'm =', ((lo + hi) / 6.235).toFixed(3), 'tile');
  }
}
