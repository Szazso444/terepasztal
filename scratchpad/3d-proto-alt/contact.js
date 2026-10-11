// Pure (browser and node) wheel-contact solver; see wheel-contact.mjs for the verification run.
/** axle x positions (metres, part frame, nose +x) from the gear fractions of the whole vehicle */
export function axlesOf(gearPart, lo, hi) {
  // fixed axles only: trucks are separate sprites/meshes and have no wheels in the body mesh
  const fr = gearPart.rigid?.length ? gearPart.rigid : (gearPart.trucks ?? []).flat();
  return fr.map((f) => lo + ((f - gearPart.from) / (gearPart.to - gearPart.from)) * (hi - lo));
}
/**
 * contacts: for every axle and side, the lowest vertex within `win` metres of the axle along x and inside
 * the wheel band (|y| between yMin and yMax on that side). Then least squares:
 *   z = h + x*tan(pitch) + y*tan(roll)   over all contacts
 *   y = side*g/2 + lat + x*tan(yaw)      over all contacts (g solved too)
 */
export function solve(P, axles, { win = 0.25, yMin = 0.45, yMax = 1.6 } = {}) {
  const t0 = performance.now();
  const contacts = [];
  for (const ax of axles) for (const side of [-1, 1]) {
    let best = null;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (Math.abs(x - ax) > win || y * side < yMin || y * side > yMax) continue;
      if (!best || z < best[2]) best = [x, y, z];
    }
    if (best) contacts.push({ ax, side, x: best[0], y: best[1], z: best[2] });
  }
  // the tread is the outermost-lowest ring: take, per contact, the mean y of the vertices within 1 cm of its z
  for (const c of contacts) {
    let sy = 0, n = 0;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - c.x) < 0.08 && P[i + 1] * c.side > yMin && P[i + 1] * c.side < yMax && P[i + 2] < c.z + 0.01) { sy += P[i + 1]; n++; }
    c.y = sy / n;
  }
  const lsq = (rows, rhs) => { // normal equations, small n
    const n = rows[0].length, A = Array.from({ length: n }, () => new Float64Array(n + 1));
    rows.forEach((r, k) => { for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += r[i] * r[j]; A[i][n] += r[i] * rhs[k]; } });
    for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; } }
    return A.map((row, i) => row[n] / row[i]);
  };
  const [h, tp, tr] = lsq(contacts.map((c) => [1, c.x, c.y]), contacts.map((c) => c.z));
  const [lat, ty, g2] = lsq(contacts.map((c) => [1, c.x, c.side]), contacts.map((c) => c.y));
  const res = contacts.map((c) => c.z - (h + tp * c.x + tr * c.y));
  return { contacts: contacts.length, height_m: h, pitch_deg: Math.atan(tp) * 180 / Math.PI, roll_deg: Math.atan(tr) * 180 / Math.PI, yaw_deg: Math.atan(ty) * 180 / Math.PI, lateral_m: lat, gauge_m: 2 * g2,
    residual_mm: Math.max(...res.map(Math.abs)) * 1000, ms: performance.now() - t0, detail: contacts };
}
export function perturb(P, { pitch = 0, roll = 0, yaw = 0, lift = 0, lateral = 0 }) {
  const d = Math.PI / 180, [cp, sp, cr, sr, cy, sy] = [Math.cos(pitch * d), Math.sin(pitch * d), Math.cos(roll * d), Math.sin(roll * d), Math.cos(yaw * d), Math.sin(yaw * d)];
  const Q = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    let x = P[i], y = P[i + 1], z = P[i + 2];
    [y, z] = [y * cr - z * sr, y * sr + z * cr];       // roll about x
    [x, z] = [x * cp - z * sp, x * sp + z * cp];       // pitch about y (nose up positive)
    [x, y] = [x * cy - y * sy, x * sy + y * cy];       // yaw about z
    Q[i] = x; Q[i + 1] = y + lateral; Q[i + 2] = z + lift;
  }
  return Q;
}
