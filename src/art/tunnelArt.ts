import { AtlasBuilder, type AtlasImage } from '../engine/atlas';
import { HALF_H, HALF_W } from '../engine/iso';
import { PAL, mix, type RGB } from './palette';

/*
 * Placeholder pictures for tunnels: the dug-tile room the Drill shows through the glass (floor,
 * two back walls, the shade they cast, the lit lip of the floor), the throat and ring of a portal,
 * and the brick and coping the portal face and the retaining wall are laid from. Codex repaints
 * every one of these later, so the frame names, canvas sizes and anchors are the contract; the
 * drawing is only good enough to judge the fit by. Ported from the tunnel trial (digArt, bricks
 * and the arch of frontArt); the rest of frontArt (the face cut to the ground, the cutting wall,
 * its gravel floor) is the renderer's, drawn at run time from these swatches.
 *
 * Every frame is painted in a canvas whose centre is the frame's anchor: the tile centre for a tile
 * frame, the point of the portal plane at the rail for a portal, the middle of a swatch. The atlas
 * trims the transparent margin and moves the anchor with it.
 */

/** Texels per world pixel, and so the atlas `resolution`. */
export const TUNNEL_R = 3;
/** Canvas sizes in world pixels. A tile frame has room for a tile and a wall standing on it. */
export const TILE_FRAME = 96;
export const PORTAL_FRAME = 200;
/** A brick swatch is one tile of plane long and 16 courses of 3 px high; it repeats both ways. */
export const BRICK_W = 36;
export const BRICK_H = 48;
export const BRICK_COURSE = 3;
const BRICK_PER_ROW = 6;
export const COPING_W = BRICK_W;
export const COPING_H = 5;
/** Height of the wall frames above the tile edge they stand on, in world pixels. */
const WALL_H = 22;

/** The opening of a portal: half width in tiles, and the spring and crown of its arch in pixels. */
export const OPEN_W = 0.46;
export const OPEN_SPRING = 18;
export const OPEN_CROWN = 34;

/** Rock as the banks show it: dressed stone, the hill's own earth, and its shadow. */
const ROCK = {
  hi: PAL.stone[1],
  mid: PAL.hill[0],
  lo: mix(PAL.hillSideR, PAL.outline, 0.45),
};
const BRICK: RGB = PAL.roof[0];
const BRICK_PALE: RGB = mix(PAL.roof[0], PAL.roofSlate[0], 0.5);
const MORTAR: RGB = mix(PAL.roof[2], PAL.outline, 0.5);
const DARK: RGB = [7, 8, 10];

export const TILE_FRAMES = {
  floor: [0, 1, 2, 3].map((i) => `tunnel/floor_${i}`),
  wallN: [0, 1, 2].map((i) => `tunnel/wall_N_${i}`),
  wallW: [0, 1, 2].map((i) => `tunnel/wall_W_${i}`),
  shadeN: 'tunnel/shade_N',
  shadeW: 'tunnel/shade_W',
  rimS: 'tunnel/rim_S',
  rimE: 'tunnel/rim_E',
};
export const PORTAL_FRAMES = { E: 'tunnel/portal_E', S: 'tunnel/portal_S' };
export const BRICK_FRAMES = [0, 1, 2, 3].map((i) => `tunnel/brick_${i}`);
export const COPING_FRAME = 'tunnel/coping';

const rgb = (c: RGB | readonly number[], a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const scaled = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];

/** A tile point as screen pixels, `z` pixels up. The tile centre is the origin. */
const P = (x: number, y: number, z = 0) => ({ x: (x - y) * HALF_W, y: (x + y) * HALF_H - z });

/** A fixed pseudo-random value in 0..1 for `a`, so the pictures are the same every time. */
function noise(a: number) {
  const v = Math.sin(a * 91.7) * 43758.5;
  return v - Math.floor(v);
}

/** A canvas `w` by `h` world pixels with the origin at its centre, drawn at `TUNNEL_R` texels. */
function sheet(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w * TUNNEL_R;
  canvas.height = h * TUNNEL_R;
  const c = canvas.getContext('2d')!;
  c.setTransform(TUNNEL_R, 0, 0, TUNNEL_R, (w * TUNNEL_R) / 2, (h * TUNNEL_R) / 2);
  return { c, image: () => c.getImageData(0, 0, w * TUNNEL_R, h * TUNNEL_R) };
}

function path(c: CanvasRenderingContext2D, points: { x: number; y: number }[]) {
  c.beginPath();
  points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

/** The diamond of one tile. */
const diamond = () => [P(-0.5, -0.5), P(0.5, -0.5), P(0.5, 0.5), P(-0.5, 0.5)];

/**
 * The room a dug tile shows through the glass. `next` is the one pseudo-random sequence all the
 * frames share, so a variant differs from the one before it.
 */
function drawRoom(ab: AtlasBuilder) {
  let seed = 1;
  const next = () => noise(seed++);
  const { hi, mid, lo } = ROCK;
  const add = (key: string, s: ReturnType<typeof sheet>) =>
    ab.add(key, s.image(), (TILE_FRAME * TUNNEL_R) / 2, (TILE_FRAME * TUNNEL_R) / 2);

  // a speckled gravel floor
  for (const key of TILE_FRAMES.floor) {
    const s = sheet(TILE_FRAME, TILE_FRAME);
    const c = s.c;
    path(c, diamond());
    c.save();
    c.clip();
    c.fillStyle = rgb(mix(mid, lo, 0.72));
    c.fillRect(-40, -24, 80, 48);
    for (let i = 0; i < 70; i++) {
      const big = next() < 0.2;
      c.fillStyle = rgb(mix(mid, next() < 0.5 ? lo : hi, next() * 0.5), 0.55);
      c.beginPath();
      c.ellipse(-34 + next() * 68, -18 + next() * 36, big ? 3.2 : 1.2, big ? 1.7 : 0.7, 0, 0, 7);
      c.fill();
    }
    c.restore();
    add(key, s);
  }

  // a wall along one back edge; `a` and `b` are the ends of that edge
  const wall = (key: string, a: number[], b: number[], light: number) => {
    const s = sheet(TILE_FRAME, TILE_FRAME);
    const c = s.c;
    const at = (t: number, z: number) => P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z);
    path(c, [at(0, 0), at(1, 0), at(1, WALL_H), at(0, WALL_H)]);
    c.save();
    c.clip();
    c.fillStyle = rgb(scaled(mid, light));
    c.fillRect(-48, -48, 96, 96);
    // rock streaks, like the banks
    for (let i = 0; i < 26; i++) {
      const t = next(),
        z0 = next() * WALL_H,
        len = 4 + next() * 12,
        wide = 0.03 + next() * 0.08,
        k = next(),
        col = k < 0.5 ? mix(mid, lo, 0.3 + k) : mix(mid, hi, (k - 0.5) * 1.5);
      path(c, [at(t, z0), at(t + wide, z0), at(t + wide * 0.7, z0 + len), at(t, z0 + len)]);
      c.fillStyle = rgb(scaled(col, light), 0.6);
      c.fill();
    }
    // dark at the foot, fading out toward the top, so the glass reads over it
    const foot = at(0.5, 0),
      top = at(0.5, WALL_H),
      g = c.createLinearGradient(foot.x, foot.y, top.x, top.y);
    g.addColorStop(0, 'rgba(14,10,8,.6)');
    g.addColorStop(0.35, 'rgba(14,10,8,0)');
    c.fillStyle = g;
    c.fillRect(-48, -48, 96, 96);
    c.restore();
    // and the whole wall thins toward its top
    c.globalCompositeOperation = 'destination-in';
    const fade = c.createLinearGradient(foot.x, foot.y, top.x, top.y);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.55, 'rgba(0,0,0,.95)');
    fade.addColorStop(1, 'rgba(0,0,0,.3)');
    c.fillStyle = fade;
    c.fillRect(-48, -48, 96, 96);
    add(key, s);
  };
  for (const key of TILE_FRAMES.wallN) wall(key, [-0.5, -0.5], [0.5, -0.5], 0.85);
  for (const key of TILE_FRAMES.wallW) wall(key, [-0.5, 0.5], [-0.5, -0.5], 1);

  // the shade a back wall casts on the floor, `dx` and `dy` tiles deep
  const shade = (key: string, a: number[], b: number[], dx: number, dy: number) => {
    const s = sheet(TILE_FRAME, TILE_FRAME);
    const c = s.c;
    const pa = P(a[0], a[1]),
      pb = P(b[0], b[1]),
      qa = P(a[0] + dx, a[1] + dy),
      qb = P(b[0] + dx, b[1] + dy),
      g = c.createLinearGradient(
        (pa.x + pb.x) / 2,
        (pa.y + pb.y) / 2,
        (qa.x + qb.x) / 2,
        (qa.y + qb.y) / 2,
      );
    g.addColorStop(0, 'rgba(8,6,6,.62)');
    g.addColorStop(1, 'rgba(8,6,6,0)');
    c.fillStyle = g;
    path(c, [pa, pb, qb, qa]);
    c.fill();
    add(key, s);
  };
  shade(TILE_FRAMES.shadeN, [-0.5, -0.5], [0.5, -0.5], 0, 0.45);
  shade(TILE_FRAMES.shadeW, [-0.5, -0.5], [-0.5, 0.5], 0.45, 0);

  // a lit lip where the floor ends on the camera side
  const rim = (key: string, a: number[], b: number[]) => {
    const s = sheet(TILE_FRAME, TILE_FRAME);
    const c = s.c;
    const pa = P(a[0], a[1]),
      pb = P(b[0], b[1]);
    c.strokeStyle = rgb(hi, 0.75);
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(pa.x, pa.y);
    c.lineTo(pb.x, pb.y);
    c.stroke();
    add(key, s);
  };
  rim(TILE_FRAMES.rimS, [-0.5, 0.5], [0.5, 0.5]);
  rim(TILE_FRAMES.rimE, [0.5, -0.5], [0.5, 0.5]);
}

/**
 * Brick courses laid on a flat swatch, `BRICK_PER_ROW` bricks to the row, every other row shifted
 * half a brick. The swatch wraps both ways: a brick cut by the edge takes its other half from the
 * opposite edge, with the same colour, and the courses are an even number. `variant` picks the
 * brick colours.
 */
function drawBrick(variant: number) {
  const s = sheet(BRICK_W, BRICK_H);
  const c = s.c;
  const L = 1 / BRICK_PER_ROW;
  // `a` runs across the swatch in tiles, `z` up it in pixels
  const x = (a: number) => (a - 0.5) * BRICK_W;
  const y = (z: number) => BRICK_H / 2 - z;
  c.fillStyle = rgb(MORTAR);
  c.fillRect(-BRICK_W / 2, -BRICK_H / 2, BRICK_W, BRICK_H);
  for (let row = 0; row * BRICK_COURSE < BRICK_H; row++) {
    const z = row * BRICK_COURSE,
      shift = row % 2 ? L / 2 : 0;
    for (let k = -1; k <= BRICK_PER_ROW; k++) {
      const a = Math.max(0, k * L + shift),
        b = Math.min(1, (k + 1) * L + shift - 0.012);
      if (b <= a) continue;
      // the two halves of a brick cut by the edge are one brick
      const n = noise(
          row * 13.1 +
            (((k % BRICK_PER_ROW) + BRICK_PER_ROW) % BRICK_PER_ROW) * 7.3 +
            variant * 3.7,
        ),
        tone = 0.82 + n * 0.36;
      c.fillStyle = rgb(scaled(n < 0.14 ? BRICK_PALE : BRICK, tone));
      c.fillRect(x(a), y(z + BRICK_COURSE), x(b) - x(a), BRICK_COURSE - 0.45);
    }
  }
  return s.image();
}

/** A course of dressed stone to cap the top of the face and of the cutting wall, one tile long. */
function drawCoping() {
  const s = sheet(COPING_W, COPING_H);
  const c = s.c;
  const { hi, mid, lo } = ROCK,
    body = mix(hi, mid, 0.3),
    top = -1.5,
    height = 3;
  c.fillStyle = rgb(body);
  c.fillRect(-COPING_W / 2, top, COPING_W, height);
  // alternate blocks a shade apart, with a joint between them
  for (let i = 0; i < 3; i++) {
    c.fillStyle = rgb(mix(body, i % 2 ? lo : hi, 0.12), 0.8);
    c.fillRect(-COPING_W / 2 + (i * COPING_W) / 3, top, COPING_W / 3, height);
    c.fillStyle = rgb(lo, 0.5);
    c.fillRect(-COPING_W / 2 + (i * COPING_W) / 3, top, 0.4, height);
  }
  // lit on top, shaded below
  c.fillStyle = rgb(hi, 0.8);
  c.fillRect(-COPING_W / 2, top, COPING_W, 0.7);
  c.fillStyle = rgb(lo, 0.55);
  c.fillRect(-COPING_W / 2, top + height - 0.7, COPING_W, 0.7);
  return s.image();
}

/**
 * The throat and ring of a portal on the plane its face stands in. E: the plane runs along y and
 * the mountain lies toward -x; S is the same picture mirrored, lit a little brighter. The anchor is
 * the plane at the rail, half way across the opening. Only what a portal has of its own: the rail
 * in the throat is the real track behind it, the dark over it is drawn at run time, and the face
 * around the ring is brick cut to the ground then.
 */
function drawPortal(face: 'E' | 'S') {
  const s = sheet(PORTAL_FRAME, PORTAL_FRAME);
  const c = s.c;
  if (face === 'S') c.scale(-1, 1);
  // a point of the plane: `u` along it in tiles, `z` up in pixels, `d` tiles into the mountain
  const q = (u: number, z: number, d = 0) => P(-d, u, z);
  const arch = (grow = 0) => {
    const pts = [q(-OPEN_W - grow, 0)];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * (1 - i / 24);
      pts.push(
        q(
          Math.cos(a) * (OPEN_W + grow),
          OPEN_SPRING + Math.sin(a) * (OPEN_CROWN - OPEN_SPRING + grow * 16),
        ),
      );
    }
    pts.push(q(OPEN_W + grow, 0));
    return pts;
  };
  const light = face === 'S' ? 1 : 0.82;
  const { hi, mid, lo } = ROCK;

  // the ring: dressed stone let into the face, with the joints between its stones
  path(c, arch(0.12));
  c.fillStyle = rgb(scaled(mix(hi, mid, 0.35), light));
  c.fill();
  c.strokeStyle = 'rgba(40,32,26,.55)';
  c.lineWidth = 0.55;
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI * (i / 14),
      from = q(Math.cos(a) * OPEN_W, OPEN_SPRING + Math.sin(a) * (OPEN_CROWN - OPEN_SPRING)),
      to = q(
        Math.cos(a) * (OPEN_W + 0.12),
        OPEN_SPRING + Math.sin(a) * (OPEN_CROWN - OPEN_SPRING + 1.9),
      );
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
  }
  path(c, arch(0.12));
  c.strokeStyle = 'rgba(30,24,20,.45)';
  c.lineWidth = 0.7;
  c.stroke();

  // the throat: the floor and the far wall run in and go dark
  c.save();
  path(c, arch());
  c.clip();
  c.fillStyle = rgb(DARK);
  c.fillRect(-200, -200, 400, 400);
  const depth = 1.6,
    dir = P(-depth, 0, 0),
    g = c.createLinearGradient(0, 0, dir.x, dir.y);
  g.addColorStop(0, rgb(mix(mid, lo, 0.4)));
  g.addColorStop(0.45, rgb(mix(lo, [10, 10, 12], 0.5)));
  g.addColorStop(1, 'rgba(8,8,10,1)');
  path(c, [
    q(-OPEN_W, 0),
    q(-OPEN_W, OPEN_CROWN + 6),
    q(-OPEN_W, OPEN_CROWN + 6, depth),
    q(-OPEN_W, 0, depth),
  ]);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,.45)';
  c.lineWidth = 1;
  for (let d = 0.18; d < depth; d += 0.26) {
    const a = q(-OPEN_W, 0, d),
      b = q(-OPEN_W, OPEN_CROWN + 6, d);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  path(c, [q(-OPEN_W, 0), q(OPEN_W, 0), q(OPEN_W, 0, depth), q(-OPEN_W, 0, depth)]);
  const f = c.createLinearGradient(0, 0, dir.x, dir.y);
  f.addColorStop(0, 'rgba(84,76,66,1)');
  f.addColorStop(0.5, 'rgba(36,33,30,1)');
  f.addColorStop(1, 'rgba(8,8,10,1)');
  c.fillStyle = f;
  c.fill();
  c.restore();
  return s.image();
}

/** The `tunnel` atlas group: placeholder frames, repainted later under the same names. */
export function generateTunnelAtlas(): AtlasImage {
  const ab = new AtlasBuilder();
  drawRoom(ab);
  BRICK_FRAMES.forEach((key, i) =>
    ab.add(key, drawBrick(i), (BRICK_W * TUNNEL_R) / 2, (BRICK_H * TUNNEL_R) / 2),
  );
  ab.add(COPING_FRAME, drawCoping(), (COPING_W * TUNNEL_R) / 2, (COPING_H * TUNNEL_R) / 2);
  (['E', 'S'] as const).forEach((face) =>
    ab.add(
      PORTAL_FRAMES[face],
      drawPortal(face),
      (PORTAL_FRAME * TUNNEL_R) / 2,
      (PORTAL_FRAME * TUNNEL_R) / 2,
    ),
  );
  return { ...ab.build(2048), resolution: TUNNEL_R };
}
