import { Container, ImageSource, Matrix, Sprite, Texture } from 'pixi.js';
import { craneOf, millOf, potsOf, type Mill, type Pot } from '../art/buildingLife';
import type { AtlasRegistry } from '../engine/atlas';
import type { WindState } from '../sim/wind';
import {
  PLUME_LIT,
  PLUME_PUFFS,
  cranePhase,
  ease,
  gustAt,
  lot,
  millGust,
  millPhase,
  millSpeed,
  pinnedAlpha,
  plumeLife,
  plumePuff,
} from './lifeMotion';
import type { SurfaceAssets } from './surfaceAssets';

/** The sail cross's frame: one picture, face-on, that every windmill lays into its own plane. */
export const SAILS_FRAME = 'structures/windmill_sails';
/** How fast the sails follow the wind's strength and the gust at the hub (seconds). */
const MILL_EASE = 1.8;
const GUST_EASE = 0.25;
/** World px kept round the view, and how far a plume reaches from its pot. */
const VIEW_MARGIN = 90;
/** The drawing order over a building: its sails or load, then its smoke. */
const OVER_PARTS = 0.03;
const OVER_SMOKE = 0.04;
/** A puff's picture: its radius in texels on a canvas this wide, three lobes in a soft rim. */
const PUFF_R = 22;
const PUFF_SIZE = 96;
const PUFF_VARIANTS = 3;
/** A works chimney's smoke is this much darker. */
const WORK_TINT = 0xe2e0dc;

interface TurningSails {
  sails: Sprite;
  mill: Mill;
  /** turns a second the strength asks for, eased */
  rev: number;
  /** what the gust at the hub makes of them, eased */
  gust: number;
  phase: number;
}
interface Plume {
  pot: Pot;
  work: boolean;
  seed: number;
  rate: number;
  /** how far up a puff's life the plume has run, 0..1; a share of it, so a new wind keeps it */
  lead: number;
  /** seconds since it was last drawn */
  owed: number;
  /** its puffs, oldest first; made when the plume first comes into view */
  group: Container | null;
}
/** What moves on one building. */
interface Site {
  body: Sprite;
  scale: number;
  zIndex: number;
  sails: TurningSails | null;
  plumes: Plume[];
  load: { sprite: Sprite; pivotX: number; pivotY: number } | null;
}
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One puff of smoke as `smokeDrawTall` draws it: three lobes, a rim, a shade and a lit body. */
function puffCanvas(variant: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PUFF_SIZE;
  const g = canvas.getContext('2d')!,
    c = PUFF_SIZE / 2,
    q = (variant * 6.2832) / PUFF_VARIANTS + 0.8,
    blob = (x: number, y: number, k: number) => {
      const r = PUFF_R * k;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.arc(x + r * 0.55 * Math.cos(q), y + r * 0.45 * Math.sin(q), r * 0.66, 0, 6.2832);
      g.arc(x + r * 0.5 * Math.cos(q + 2.3), y + r * 0.4 * Math.sin(q + 2.3), r * 0.58, 0, 6.2832);
      g.fill();
    };
  g.globalAlpha = 0.3;
  g.fillStyle = '#c4c0b9';
  blob(c, c, 1.28);
  g.globalAlpha = 0.5;
  g.fillStyle = '#a9a6a1';
  blob(c + PUFF_R * 0.22, c + PUFF_R * 0.2, 1);
  g.globalAlpha = 1;
  g.fillStyle = '#e2ded6';
  blob(c - PUFF_R * 0.12, c - PUFF_R * 0.12, 0.82);
  return canvas;
}

/**
 * The small signs of life on buildings, in the game's own wind: chimney smoke (#517), the quarry
 * crane's swinging load (#517) and the windmill's turning sails (#518). Each building's parts are
 * sprites of its own in the depth-sorted layer, just over the building, so whatever stands before
 * it stands before them. With `enabled` off (Building life, #514) nothing moves: no smoke, the load
 * hangs still as the picture has it, the sails stand where they are.
 */
export class BuildingLife {
  enabled = true;
  private readonly sites = new Map<string, Site>();
  private readonly matrix = new Matrix();
  private puffs: Texture[] | null = null;
  /** seconds this has run, the clock the gusts and the plumes are read at */
  private t = 0;
  /** which half of the plumes moves this frame */
  private even = false;

  constructor(
    private readonly atlas: AtlasRegistry,
    private readonly layer: Container,
    private readonly surfaces: SurfaceAssets,
  ) {}

  /** Building `id` shows `frame` on `body`, drawn at `scale`: give it what moves in that frame. */
  place(id: string, body: Sprite, frame: string, scale: number) {
    this.remove(id);
    const crane = craneOf(frame),
      mill = millOf(frame),
      pots = potsOf(frame);
    if (!crane && !mill && !pots) return;
    const zIndex = body.zIndex,
      site: Site = { body, scale, zIndex, sails: null, plumes: [], load: null };
    if (mill && this.atlas.has(SAILS_FRAME)) {
      const f = this.atlas.get(SAILS_FRAME),
        sails = new Sprite({ texture: f.texture, cullable: true });
      sails.anchor.set(f.anchorX, f.anchorY);
      sails.zIndex = zIndex + OVER_PARTS;
      this.layer.addChild(sails);
      site.sails = { sails, mill, rev: 0, gust: 0, phase: 0 };
      this.layTheSails(site, site.sails);
    }
    if (crane) {
      const { picture, load } = this.surfaces.crane(frame, this.atlas.get(frame), crane),
        sprite = new Sprite({ texture: load.texture, cullable: true });
      body.texture = picture;
      sprite.anchor.set(load.anchorX, load.anchorY);
      sprite.scale.set(scale);
      sprite.zIndex = zIndex + OVER_PARTS;
      sprite.position.set(body.x + crane.pivot[0] * scale, body.y + crane.pivot[1] * scale);
      this.layer.addChild(sprite);
      site.load = { sprite, pivotX: crane.pivot[0], pivotY: crane.pivot[1] };
    }
    (pots ?? []).forEach((pot, i) => {
      const x = Math.round((body.x + pot.dx * scale) * 3),
        y = Math.round((body.y + pot.dy * scale) * 3);
      if (pot.work || lot(x, y, 470 + i) < PLUME_LIT)
        site.plumes.push({
          pot,
          work: pot.work,
          seed: lot(x, y, 471 + i) * 97.3,
          rate: 0.85 + 0.3 * lot(x, y, 472 + i),
          lead: lot(x, y, 474 + i),
          owed: 0,
          group: null,
        });
    });
    this.sites.set(id, site);
  }

  /** Building `id` is gone, or shows a frame with nothing that moves. */
  remove(id: string) {
    const site = this.sites.get(id);
    if (!site) return;
    site.sails?.sails.destroy();
    site.load?.sprite.destroy();
    for (const p of site.plumes) p.group?.destroy({ children: true });
    this.sites.delete(id);
  }

  /** Move everything `dt` seconds on (0 while the game is paused), `view` in world px. */
  update(dt: number, wind: WindState, view: View) {
    this.t += dt;
    this.even = !this.even;
    let turn = this.even;
    for (const site of this.sites.values()) {
      const { body } = site,
        seen =
          body.x > view.x - VIEW_MARGIN * 2 &&
          body.x < view.x + view.w + VIEW_MARGIN * 2 &&
          body.y > view.y - VIEW_MARGIN * 2 &&
          body.y < view.y + view.h + VIEW_MARGIN * 3;
      if (site.sails) this.turn(site, site.sails, dt, wind, seen);
      if (site.load) this.swing(site, wind, seen);
      for (const plume of site.plumes) {
        const x = body.x + plume.pot.dx * site.scale,
          y = body.y + plume.pot.dy * site.scale,
          inView = this.enabled && seen && this.potInView(x, y, view);
        turn = !turn;
        plume.owed += dt;
        if (!inView) {
          if (plume.group) plume.group.visible = false;
        } else if (turn || !plume.group?.visible) {
          // smoke is slow: half the plumes each frame, each taking the time it is owed
          this.drawPlume(plume, site, x, y, plume.owed, wind);
          plume.owed = 0;
        }
      }
    }
  }

  private potInView(x: number, y: number, v: View) {
    return (
      x > v.x - VIEW_MARGIN &&
      x < v.x + v.w + VIEW_MARGIN &&
      y > v.y - VIEW_MARGIN / 3 &&
      y < v.y + v.h + VIEW_MARGIN
    );
  }

  private turn(site: Site, m: TurningSails, dt: number, wind: WindState, seen: boolean) {
    if (!this.enabled) {
      m.rev = 0;
      return;
    }
    const { hub } = m.mill,
      want = millSpeed(wind.strength),
      x = site.body.x + hub[0] * site.scale,
      y = site.body.y + hub[1] * site.scale;
    m.rev = ease(m.rev, want, dt, MILL_EASE);
    if (m.rev < 1e-4 && !want) m.rev = 0;
    m.gust = ease(m.gust, millGust(gustAt(wind.strength, wind.dir, x, y, this.t)), dt, GUST_EASE);
    m.phase = millPhase(m.phase, m.rev * m.gust, dt);
    if (seen) this.layTheSails(site, m);
  }

  /** The cross turned by its phase in its own face, then laid into the sails' plane at the hub. */
  private layTheSails(site: Site, m: TurningSails) {
    const { hub, plane } = m.mill,
      k = site.scale,
      c = Math.cos(m.phase),
      n = Math.sin(m.phase),
      [[p00, p01], [p10, p11]] = plane;
    this.matrix.set(
      k * (p00 * c + p01 * n),
      k * (p10 * c + p11 * n),
      k * (p01 * c - p00 * n),
      k * (p11 * c - p10 * n),
      site.body.x + hub[0] * k,
      site.body.y + hub[1] * k,
    );
    m.sails.setFromMatrix(this.matrix);
  }

  private swing(site: Site, wind: WindState, seen: boolean) {
    const load = site.load!;
    load.sprite.position.set(
      site.body.x + load.pivotX * site.scale,
      site.body.y + load.pivotY * site.scale,
    );
    if (!this.enabled) load.sprite.rotation = 0;
    else if (seen) {
      const s = wind.strength,
        gust = gustAt(s, wind.dir, load.sprite.x, load.sprite.y + 25, this.t);
      load.sprite.rotation = -cranePhase(this.t, s, gust, wind.dir.x);
    }
  }

  private puffTextures() {
    this.puffs ??= Array.from(
      { length: PUFF_VARIANTS },
      (_, i) =>
        new Texture({
          source: new ImageSource({
            resource: puffCanvas(i),
            scaleMode: 'linear',
            autoGenerateMipmaps: true,
          }),
        }),
    );
    return this.puffs;
  }

  private plumeGroup(plume: Plume, site: Site) {
    const group = new Container(),
      textures = this.puffTextures();
    group.zIndex = site.zIndex + OVER_SMOKE;
    for (let i = 0; i <= PLUME_PUFFS; i++) {
      const puff = new Sprite(textures[i % PUFF_VARIANTS]);
      puff.anchor.set(0.5);
      if (plume.work) puff.tint = WORK_TINT;
      group.addChild(puff);
    }
    this.layer.addChild(group);
    plume.group = group;
    return group;
  }

  /**
   * The plume at (x, y): sixteen puffs a fixed share of a life apart, so that one column climbs,
   * and one pinned at the mouth. Sprites keep their order and take the puffs oldest first, the
   * youngest on top, so nothing is sorted from one frame to the next.
   */
  private drawPlume(plume: Plume, site: Site, x: number, y: number, dt: number, wind: WindState) {
    const group = plume.group ?? this.plumeGroup(plume, site),
      { work, seed } = plume,
      s = wind.strength,
      textures = this.puffs!,
      t = this.t,
      life = plumeLife(s, work, plume.rate),
      lead = (plume.lead = (plume.lead + dt / life) % 1),
      // the puff that is oldest now; `age` falls by 1 / PLUME_PUFFS from each puff to the next
      oldest = Math.ceil((1 - lead) * PLUME_PUFFS) - 1,
      angle = Math.atan2(wind.dir.y, wind.dir.x);
    group.visible = true;
    for (let n = 0; n < PLUME_PUFFS; n++) {
      const j = (oldest - n + PLUME_PUFFS) % PLUME_PUFFS,
        age = (lead + j / PLUME_PUFFS) % 1,
        gust = gustAt(s, wind.dir, x, y - 20, t - age * life * 0.5),
        shape = plumePuff(age, s, gust, work),
        puff = group.getChildAt<Sprite>(n);
      if (shape.alpha < 0.01) {
        puff.visible = false;
        continue;
      }
      const rise = shape.rise * (1 + 0.07 * Math.sin(j * 5.3 + seed)),
        wobble = Math.sin(t * 0.9 + j * 2.1 + seed) * 1.8 * Math.pow(age, 0.7) * (1 - 0.6 * s),
        r = shape.radius * (0.88 + 0.24 * lot(j, seed, 473));
      puff.visible = true;
      puff.texture = textures[j % PUFF_VARIANTS];
      puff.position.set(x + shape.drift * wind.dir.x + wobble, y - rise + shape.drift * wind.dir.y);
      puff.scale.set((r * shape.stretch) / PUFF_R, (r * shape.flat) / PUFF_R);
      puff.rotation = shape.stretch > 1.02 ? angle : 0;
      puff.alpha = shape.alpha;
    }
    // the pinned puff, over them all, closes the air between the pot and the plume
    const pin = group.getChildAt<Sprite>(PLUME_PUFFS);
    pin.position.set(x, y);
    pin.scale.set((work ? 1.7 : 1.5) / PUFF_R);
    pin.alpha = pinnedAlpha(s, work);
  }
}
