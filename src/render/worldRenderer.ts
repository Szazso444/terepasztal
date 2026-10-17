import {
  Assets,
  Container,
  Sprite,
  Rectangle,
  Graphics,
  Mesh,
  MeshGeometry,
  Texture,
} from 'pixi.js';
import type { AtlasRegistry, FrameInfo } from '../engine/atlas';
import {
  tileToWorld,
  worldToTile,
  worldToTileInt,
  depthKey,
  DIRS,
  DIR_DX,
  DIR_DY,
  ELEV_PX,
  HALF_W,
  HALF_H,
  TILE_H,
} from '../engine/iso';
import {
  Terrain,
  Biome,
  type GameMap,
  type PropInstance,
  type PropKind,
  idx,
} from '../world/tiles';
import type { RegionState } from '../world/regions';
import type { Camera } from '../engine/camera';
import { MATERIAL_COLORS, Material, materialAt } from './landscapeModel';
import { scaleReference, TREE_SCALE, isTree, type ScaleReference } from './assetScale';
import { SurfaceAssets, fieldFrames, fieldTexture, windowSprite } from './surfaceAssets';
import { footGround, footScatter, type Foot } from './groundFit';
import { hash2 } from '../engine/rng';
import { Landscape } from './landscape';
import { standOnGround, LEVEL_GROUND, type Ground } from './slope';
import { scatterFor } from './scatter';
import { levelAt } from '../world/elevation';
import { bedFor, railLevel, type RailBed } from '../world/railProfile';
import { DEFAULT_RELIEF } from './terrainRelief';
import { underPaintedWater } from './terrainMaterials';
import { doorstepChanges, pavingDoorsteps, type PavingDoor } from './townPaving';
import { PAL, type RGB } from '../art/palette';
import BRIDGE_KIT_JSON from './bridgeKit.json';
import {
  bridgeTileMeshes,
  destroyBridgeParts,
  GROUND_BOX,
  prepareSurface,
  WATER_TILES,
  WATERLINE,
  type BridgeSurfaces,
} from './bridgeMeshes';
import { bridgeJoins, bridgePlan, deckSamples, type BridgeSite } from './bridgeLayout';
import { HarvestHighlight } from './harvestHighlight';
import { groundOf as groundDataOf, type FrameGround } from '../art/buildingGround';
import { buildingYard, footprintTiles, sameYard, yardTiles, type Yard } from './buildingYard';
import { plinthColour, plinthOf, plinthShapes } from './plinth';
import {
  CELL_BLOCKED,
  CELL_FIELD,
  CELL_OPEN,
  RUN_S,
  RUN_W,
  readSite,
  type FieldCell,
  type FieldFrame,
  type FieldPicture,
} from './wheatField';
import { FIELD_BUDGET_MS, WheatFields, type WheatHost } from './wheatFields';
import { doorSides, roadCode, roadSides } from './roadShape';
import { crossingAxis, levelCrossingFrame } from './levelCrossing';

export type BridgeStyle = 'textured' | 'kit' | 'procedural';
/** One bridge tile as the game knows it, for the textured style (setTexturedBridges). */
export type TexturedBridge = Omit<BridgeSite, 'deck'> & {
  /** Over water: supports stand in it, and the deck never sinks below the waterline's. */
  water: boolean;
  /** The bridge's upgrade level. */
  level: number;
};

/**
 * Tile offsets at which a textured bridge tile notices the ground under it and in front of it
 * (toward +x +y, as far as bridgeMeshes.ts looks for ground hiding its supports).
 */
const GROUND_AT = [-0.45, 0, 0.45, 0.55, 1, 1.5, 1.95],
  GROUND_SAMPLES = GROUND_AT.flatMap((a) => GROUND_AT.map((b) => [a, b]));

/** Measured kit geometry in world px (tools/bridge-kit.mjs). */
const BRIDGE_KIT = BRIDGE_KIT_JSON as Record<
  string,
  { thickness?: number; height?: number; length?: number; along?: number }
>;

const CHUNK = 8;

/**
 * Props a railway cuts instead of pushing aside. A wheat field lies over its whole tile, so
 * moved beside the rails it would land half on the next tile and over the sleepers; the track
 * cuts it, and the field shows again when the track goes.
 */
const CUT_BY_TRACK: ReadonlySet<PropKind> = new Set<PropKind>(['wheat']);

/** An illustrated picture: more texels than world pixels (an atlas `resolution` above 1). */
function illustrated(f: FrameInfo) {
  return f.texture.frame.width / f.w > 1;
}

/** What fits one building to the ground, beside its picture (`setStructure`). */
interface GroundFitSprites {
  /** The soft shadow it casts, in the contact ground layer. */
  shadow: Sprite;
  /** The shade over its picture's foot, drawn right after the picture. */
  foot: Sprite;
  /** Weeds and pebbles over the front of its base, in its depth. */
  weeds: Sprite;
  /** The texture they are drawn on, the building's own; null when nothing grows. */
  weedsTexture: Texture | null;
  /** The picture's feet and the tile it stands on, which the weeds grow from. */
  feet: readonly Foot[];
  x: number;
  y: number;
  /** What the weeds were last drawn for: the feet, and the tile with its ground. */
  drawn: { feet: readonly Foot[]; on: string } | null;
}

/**
 * Show `texture` as a building's weeds and free the one shown before: each building has its own
 * (the shadow's and the foot's are shared by every building with the same picture).
 */
function showWeeds(fit: GroundFitSprites, texture: Texture | null) {
  const old = fit.weedsTexture;
  fit.weedsTexture = texture;
  if (!fit.weeds.destroyed) fit.weeds.texture = texture ?? Texture.EMPTY;
  old?.destroy(true);
}

/**
 * What fits one building to the ground under it beyond its ground fit (#436): its yard, which the
 * painter wears into the ground, and the plinth under its picture where the ground drops away.
 */
interface Footing {
  frame: string;
  ground: FrameGround;
  scale: number;
  /** its anchor, the footprint's centre, in map tile coordinates */
  x: number;
  y: number;
  /** the tile it was placed on (`setStructure`), whose ground height its picture stands at */
  tx: number;
  ty: number;
  yard: Yard;
  /** the colour of its walls' base (`baseColour`), which its plinth is built in */
  wall: RGB | null;
  /** how far (world px) its picture is lifted onto the highest ground under its foot */
  lift: number;
  /** the plinth, drawn just under its picture; null where the ground under it is level */
  plinth: Graphics | null;
  /** what the plinth was last drawn for */
  drawn: string;
}

/** Put a building's ground fit where its picture `s` stands, at its scale and depth. */
function placeGroundFit(fit: GroundFitSprites, s: Sprite) {
  fit.shadow.position.copyFrom(s.position);
  fit.foot.position.copyFrom(s.position);
  fit.foot.scale.copyFrom(s.scale);
  fit.foot.zIndex = s.zIndex + 0.005;
  fit.weeds.position.copyFrom(s.position);
  fit.weeds.zIndex = s.zIndex + 0.02;
}

/**
 * Isometric world view. Ground tiles live in chunked static containers (culled per chunk);
 * everything with height lives in one depth-sorted object layer so trains can pass behind trees.
 */
export class WorldRenderer {
  readonly root = new Container();
  readonly ground = new Container();
  readonly track = new Container();
  /**
   * The level-crossing decks (#309, #329) laid over the track where a road crosses it: over the
   * track and under the ground lights, the harvest highlight and everything that stands.
   */
  readonly crossings = new Container();
  readonly platforms = new Container();
  /** Piers of bridges carried over land, standing on the ground under their decks. */
  private piers = new Container();
  private pierGraphics = new Map<number, Graphics>();
  private platformSprites = new Map<number, Sprite>();
  private platformMasks = new Map<number, Graphics>();
  readonly objects = new Container();
  readonly overlay = new Container(); // cursors, ghosts – drawn over objects
  readonly fog = new Container();
  /** additive ground lights (per-tile lighting), drawn over track and under objects */
  readonly lights = new Container();
  /**
   * The tiles a harvest station counts, lit over the ground and its lights and under objects; the
   * game puts the night overlay under it, so the night does not darken it.
   */
  readonly harvest: HarvestHighlight;
  /** out-of-map void ring */
  readonly border = new Container();
  private trackSprites = new Map<number, Sprite>();
  /** The frame each track sprite shows (`setTrack`): a plain straight takes a level crossing. */
  private trackFrames = new Map<number, string>();
  /** The level-crossing decks by tile, and the meshes of those on a climbing straight. */
  private decks = new Map<number, Sprite>();
  private deckMeshes = new Map<number, Mesh>();
  private structures = new Map<string, Sprite>();
  private groundSprites: Sprite[] = [];
  private fogShapes = new Map<number, Graphics>();
  /** regions whose ground and props have been built */
  private builtRegions = new Set<number>();
  private waterSprites: { s: Sprite; base: string }[] = [];
  private waterPhase = 0;
  private waterFrame = 0;
  /** number of void tiles drawn around the playable map */
  static readonly BORDER = 8;
  private propSprites = new Map<number, Sprite[]>();
  /** The prop sprites that track cuts rather than displaces (CUT_BY_TRACK). */
  private cutSprites = new WeakSet<Sprite>();
  /** The prop sprites of deposits (coal, oil): a road hides no deposit, as the player needs it. */
  private deposits = new WeakSet<Sprite>();
  /** Visual-only nature (scatter.ts) per tile, with each sprite's offset inside its tile. */
  private scatterSprites = new Map<number, { s: Sprite; ox: number; oy: number }[]>();
  /** Stations, buildings and placed decor, as the game knows them; scatter keeps clear. */
  occupied: (x: number, y: number) => boolean = () => false;
  /** Tiles that must render flat (track / station on hill). */
  private flattened = new Set<number>();
  /** Rail profile over each straight track tile (world/railProfile.ts). */
  private railBeds = new Map<number, RailBed>();
  /** Track tiles whose rail bends or climbs: the piece is a mesh that follows the profile. */
  private trackMeshes = new Map<number, Mesh>();
  readonly landscape: Landscape;
  private summitSprites = new Map<number, Sprite>();
  private terrainVisibilityVersion = -1;
  private structureAnchors = new Map<string, { x: number; y: number; dx: number; dy: number }>();
  private surfaces = new SurfaceAssets();
  private windowLights = new Map<string, Sprite>();
  /** Each building's fit to the ground (groundFit.ts), keyed like its structure. */
  private groundFits = new Map<string, GroundFitSprites>();
  /** The buildings' cast shadows: on the ground, under the track and everything that stands. */
  private contactGround = new Container({ cullableChildren: true });
  /** Each building's yard and plinth, keyed like its structure. */
  private footings = new Map<string, Footing>();
  /** Whether a road lies on tile (x, y) (src/sim/roads.ts): a door path runs on to it. */
  roadAt: (x: number, y: number) => boolean = () => false;
  /** The street doors of every place (`setCity`), by the tile they are in. */
  private doorsByTile = new Map<number, PavingDoor[]>();
  /** The same doors by the tile each reaches: a road there runs an arm to its door. */
  private doorsByReach = new Map<number, PavingDoor[]>();
  /** The road tiles as the renderer last heard of them (`setRoads`, `roadChanged`). */
  private roads = new Set<number>();
  /** The code of each road tile as the painter was last handed it (`roadCode`, roadShape.ts). */
  private roadCodes = new Map<number, number>();
  private waterDetails = new Graphics();
  private waterClock = 0;
  private rippleRefresh = 0;
  private view: { x: number; y: number; w: number; h: number } | null = null;
  /** The wheat fields' pictures (#444), one per field tile's sprite. */
  private wheat: WheatFields;
  /** What the fields' pictures read of the world (`fieldSite`). */
  private wheatHost: WheatHost;
  /**
   * The variants' pictures the fields are coloured from: undefined before they are asked for,
   * 'wait' while they are read, null where none can be.
   */
  private fieldFrames: readonly (FieldFrame | null)[] | null | 'wait' | undefined = undefined;
  /**
   * The footprint tiles of the buildings with ground data, with the sides a field runs up to
   * (RUN_W, RUN_S); worked out again after a building or its door paths change.
   */
  private fieldRuns: Map<number, number> | null = null;
  /**
   * How the fields' pictures read the variants' atlas frames (0 to 2, null for one the atlas lacks)
   * and are made into textures: through a canvas, which Node has none of, so there the sprites
   * keep their atlas frames. Tests hand in their own.
   */
  fieldArt: {
    frames(
      frames: readonly (FrameInfo | null)[],
    ): Promise<(FieldFrame | null)[]> | (FieldFrame | null)[] | null;
    texture(p: FieldPicture): Texture;
  } = {
    frames: (frames) =>
      typeof document === 'undefined' || typeof createImageBitmap === 'undefined'
        ? null
        : fieldFrames(frames),
    texture: (p) => fieldTexture(p),
  };

  constructor(
    readonly atlas: AtlasRegistry,
    readonly map: GameMap,
    readonly regions: RegionState,
  ) {
    this.landscape = new Landscape(map, this.flattened, this.railBeds);
    this.harvest = new HarvestHighlight(map, (x, y) => this.surfacePoint(x, y));
    this.wheat = new WheatFields(map.w, map.h);
    this.wheatHost = {
      site: (x, y) => this.fieldSite(x, y),
      frames: () => this.readFieldFrames(),
      texture: (p) => this.fieldArt.texture(p),
      view: () => this.view,
    };
    this.landscape.root.visible = false;
    this.root.on('destroyed', () => {
      this.surfaces.destroy();
      for (const fit of this.groundFits.values()) showWeeds(fit, null);
      this.wheat.destroy();
    });
    this.objects.sortableChildren = true;
    this.piers.sortableChildren = true;
    this.objects.cullableChildren = true;
    this.ground.cullableChildren = true;
    this.fog.cullableChildren = true;
    this.track.cullableChildren = true;
    this.crossings.cullableChildren = true;
    this.border.cullableChildren = true;
    this.lights.cullableChildren = true;
    this.root.addChild(
      this.border,
      this.landscape.root,
      this.ground,
      this.waterDetails,
      this.contactGround,
      this.piers,
      this.platforms,
      this.track,
      this.crossings,
      this.lights,
      this.harvest.layer,
      this.objects,
      this.fog,
      this.overlay,
    );
    this.buildBorder();
    this.buildGround();
    this.buildProps();
    this.rebuildFog();
  }

  private city = new Set<number>();
  /** The doorsteps the painter lays (`pavingDoorsteps`), four numbers each. */
  private doorsteps: readonly number[] = [];
  /**
   * The towns' paved tiles (`cityTiles`, src/sim/city.ts) and the street doors of the places that
   * stand among them (src/sim/doors.ts): the painter paves the tiles and lays a doorstep in front
   * of each door on a paved tile.
   */
  setCity(tiles: Set<number>, doors: Iterable<PavingDoor> = []) {
    const { w, h } = this.map;
    const changed = new Set([...this.city, ...tiles]);
    const old = this.city;
    const list = [...doors];
    const oldSteps = this.doorsteps,
      steps = pavingDoorsteps(list, (k) => tiles.has(k), w, h);
    this.city = tiles;
    this.doorsteps = steps;
    this.landscape.setCity(tiles, steps);
    for (const k of changed)
      if (old.has(k) !== tiles.has(k)) {
        // the painter paves a town's tiles over their water too (refreshGround tells bridges)
        this.refreshGround(k % w, Math.floor(k / w));
        this.refreshScatter(k % w, Math.floor(k / w), 0);
        // a field ends short of paving
        this.wheat.near(k % w, Math.floor(k / w));
      }
    // a doorstep laid or taken up is painted again where it reaches
    for (const k of doorstepChanges(oldSteps, steps, w, h))
      this.refreshGround(k % w, Math.floor(k / w));
    // nothing grows at a building's foot on paving
    for (const fit of this.groundFits.values()) this.growWeeds(fit);
    // a door's path follows the doors the places have now
    this.doorsByTile = new Map();
    this.doorsByReach = new Map();
    for (const d of list) {
      const k = d.tile.y * w + d.tile.x,
        at = this.doorsByTile.get(k);
      if (at) at.push(d);
      else this.doorsByTile.set(k, [d]);
      const rx = d.tile.x + DIR_DX[d.side],
        ry = d.tile.y + DIR_DY[d.side];
      if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
      const to = this.doorsByReach.get(ry * w + rx);
      if (to) to.push(d);
      else this.doorsByReach.set(ry * w + rx, [d]);
    }
    this.refreshYards(() => true);
    // and a road on a door's reach runs an arm to it
    this.updateRoads(this.roads);
  }
  /**
   * A road was laid on tile (x, y) or taken off it (`roadAt` says which): the yards of the
   * buildings beside it take their door paths on to it, or back to their own edge; the tile and
   * its four neighbours are painted again with the road's new shape, a level crossing's deck is
   * laid or lifted, and the nature on the tile hides under the road or comes back.
   */
  roadChanged(x: number, y: number) {
    const { w, h } = this.map;
    if (x >= 0 && y >= 0 && x < w && y < h) {
      const k = y * w + x;
      if (this.roadAt(x, y)) this.roads.add(k);
      else this.roads.delete(k);
      this.roadShown(x, y);
      const around = [k];
      for (const d of DIRS) {
        const nx = x + DIR_DX[d],
          ny = y + DIR_DY[d];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) around.push(ny * w + nx);
      }
      this.updateRoads(around, around);
    }
    this.refreshYards((f) => Math.abs(f.x - x) < 3 && Math.abs(f.y - y) < 3);
    // a field ends short of a road
    this.wheat.near(x, y);
  }
  /**
   * The roads a save holds (`Roads.list`), in place of any the renderer knew: every road tile is
   * painted (none on the paving), every level crossing gets its deck, and the nature on each tile
   * hides under its road; where a road it knew is gone, the ground is painted again without it.
   */
  setRoads(tiles: Iterable<{ x: number; y: number }>) {
    const { w, h } = this.map,
      old = this.roads;
    this.roads = new Set();
    for (const { x, y } of tiles)
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h)
        this.roads.add(y * w + x);
    const touched = new Set([...old, ...this.roads]);
    for (const k of touched) {
      this.roadShown(k % w, Math.floor(k / w));
      this.wheat.near(k % w, Math.floor(k / w));
    }
    this.updateRoads(touched, touched);
    this.refreshYards(() => true);
  }
  /** What stands on tile (x, y) follows its road: nature hides under it, a deck lies over track. */
  private roadShown(x: number, y: number) {
    this.showProps(idx(this.map, x, y));
    this.refreshScatter(x, y, 0);
    this.refreshDeck(x, y);
  }
  /** Is there a road on tile (x, y), as the renderer last heard? False off the map. */
  private hasRoad(x: number, y: number) {
    const { w, h } = this.map;
    return x >= 0 && y >= 0 && x < w && y < h && this.roads.has(y * w + x);
  }
  /**
   * The axis the road on tile (x, y) runs along where it is a level crossing: a road on a plain
   * straight of regular or narrow track, square to it. Null for any other tile.
   */
  private crossingAt(x: number, y: number) {
    if (!this.hasRoad(x, y)) return null;
    const frame = this.trackFrames.get(idx(this.map, x, y));
    return frame === undefined ? null : crossingAxis(frame);
  }
  /**
   * The code of the road on tile (x, y) (`roadCode`, roadShape.ts), -1 for none: the sides it
   * joins (its road neighbours and its street doors), the sides it meets in the middle (an edge it
   * shares with a level crossing, and a door's), and whether it is a level crossing itself.
   */
  private roadCodeAt(x: number, y: number) {
    if (!this.hasRoad(x, y)) return -1;
    const doors = this.doorsByReach.get(idx(this.map, x, y)) ?? [],
      sides = roadSides((rx, ry) => this.hasRoad(rx, ry), doors, x, y);
    let pinned = doorSides(doors, x, y);
    for (const d of DIRS)
      if (sides & (1 << d) && this.crossingAt(x + DIR_DX[d], y + DIR_DY[d])) pinned |= 1 << d;
    return roadCode(sides, pinned, this.crossingAt(x, y));
  }
  /**
   * Work out again the codes of the road tiles among `tiles`; if any changed, the painter is handed
   * the roads and repaints those tiles, and the tiles `also` lists.
   */
  private updateRoads(tiles: Iterable<number>, also: Iterable<number> = []) {
    const { w } = this.map,
      repaint = new Set(also);
    for (const k of tiles) {
      const code = this.roadCodeAt(k % w, Math.floor(k / w));
      if ((code < 0 ? undefined : code) === this.roadCodes.get(k)) continue;
      if (code < 0) this.roadCodes.delete(k);
      else this.roadCodes.set(k, code);
      repaint.add(k);
    }
    if (!repaint.size) return;
    const list: number[] = [];
    for (const [k, code] of this.roadCodes) list.push(k, code);
    this.landscape.setRoads(list);
    for (const k of repaint) this.landscape.repaint(k % w, Math.floor(k / w));
  }
  private groundFrame(x: number, y: number): string {
    if (this.city.has(y * this.map.w + x)) return 'terrain/city_' + (x % 3) + '_' + (y % 3);
    const i = idx(this.map, x, y);
    const t = this.map.terrain[i] as Terrain;
    const v = this.map.variant[i];
    const b = this.map.biome[i] as Biome;
    switch (t) {
      case Terrain.Grass:
        return b === Biome.Plains
          ? `terrain/plains_${v}`
          : b === Biome.Taiga
            ? `terrain/taiga_${v}`
            : b === Biome.Swamp
              ? `terrain/swamp_${v}`
              : b === Biome.Desert
                ? `terrain/desert_${v}`
                : `terrain/grass_${v}`;
      case Terrain.Forest:
        return b === Biome.Swamp ? `terrain/swamp_${v}` : `terrain/forest_${v}`;
      case Terrain.Hill:
        return this.flattened.has(i) ? `terrain/hillcut_${v}` : `terrain/hill_${v % 3}`;
      case Terrain.Water:
        return `terrain/water_${v % 3}_f0`;
      case Terrain.Rock:
        return `terrain/rock_${v}`;
      case Terrain.Mountain:
        return `terrain/mountain_${v % 3}`;
      case Terrain.Sand:
        return b === Biome.Desert ? `terrain/desert_${v}` : `terrain/sand_${v}`;
    }
  }

  /** Ground for every revealed region; hidden regions are built when they get revealed. */
  private buildGround() {
    const { w, h } = this.map;
    this.groundSprites = new Array(w * h);
    this.ground.sortableChildren = true;
    for (let i = 0; i < this.regions.unlocked.length; i++)
      if (this.regions.isRevealed(i)) this.buildRegion(i);
  }
  /** Build ground sprites (in culled CHUNK blocks) and props of one region once. */
  private buildRegion(ri: number) {
    if (this.builtRegions.has(ri)) return;
    this.builtRegions.add(ri);
    const r = this.regions.regionRect(ri);
    const { w, h } = this.map;
    const x1 = Math.min(w, r.x + r.w);
    const y1 = Math.min(h, r.y + r.h);
    for (let cy0 = r.y; cy0 < y1; cy0 += CHUNK)
      for (let cx0 = r.x; cx0 < x1; cx0 += CHUNK) {
        const chunk = new Container();
        chunk.cullable = true;
        chunk.cullableChildren = false;
        const tiles: { x: number; y: number }[] = [];
        for (let y = cy0; y < Math.min(y1, cy0 + CHUNK); y++)
          for (let x = cx0; x < Math.min(x1, cx0 + CHUNK); x++) tiles.push({ x, y });
        tiles.sort((a, b) => a.x + a.y - (b.x + b.y));
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const t of tiles) {
          const s = this.makeGroundSprite(t.x, t.y);
          chunk.addChild(s);
          this.groundSprites[idx(this.map, t.x, t.y)] = s;
          minX = Math.min(minX, s.x - HALF_W);
          maxX = Math.max(maxX, s.x + HALF_W);
          minY = Math.min(minY, s.y - HALF_H - 2 * ELEV_PX);
          maxY = Math.max(maxY, s.y + HALF_H);
        }
        chunk.cullArea = new Rectangle(minX, minY, maxX - minX, maxY - minY);
        // draw order: blocks with smaller (x+y) first so hill faces layer correctly
        chunk.zIndex = Math.floor(cx0 / CHUNK) + Math.floor(cy0 / CHUNK);
        this.ground.addChild(chunk);
        this.landscape.add(cx0, cy0, Math.min(CHUNK, x1 - cx0), Math.min(CHUNK, y1 - cy0));
      }
    this.ground.sortChildren();
    for (let y = r.y; y < y1; y++)
      for (let x = r.x; x < x1; x++) {
        const i = idx(this.map, x, y);
        const list = this.map.props.get(i);
        if (list && !this.propSprites.has(i)) this.buildPropsAt(i, list);
        else if (!list) this.buildScatterAt(x, y);
      }
    this.applyTintTo(r.x, r.y, x1, y1);
  }
  /** Is this tile's region built (revealed)? */
  isBuilt(x: number, y: number) {
    return this.builtRegions.has(this.regions.regionIndex(x, y));
  }

  private makeGroundSprite(x: number, y: number): Sprite {
    const frame = this.groundFrame(x, y);
    const f = this.atlas.get(frame);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    const p = tileToWorld(x, y);
    s.position.set(p.x, p.y);
    s.visible = !this.landscape.active || !this.landscape.isPainted(x, y);
    if (this.map.terrain[idx(this.map, x, y)] === Terrain.Water) {
      this.waterSprites.push({ s, base: frame.slice(0, -3) });
    }
    return s;
  }

  /** Re-texture a ground tile (after flattening a hill, etc). */
  refreshGround(x: number, y: number) {
    this.landscape.invalidate(x, y);
    // the water painted there may have moved under a bridge: it is drawn again (animate)
    if (!this.bridgeWaterChanged && this.nearTexturedBridge(x, y)) this.bridgeWaterChanged = true;
    const i = idx(this.map, x, y);
    const s = this.groundSprites[i];
    if (!s) return;
    const frame = this.groundFrame(x, y);
    const f = this.atlas.get(frame);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    s.visible = !this.landscape.active || !this.landscape.isPainted(x, y);
    const isWater = this.map.terrain[i] === Terrain.Water;
    const wi = this.waterSprites.findIndex((w) => w.s === s);
    if (isWater && wi < 0) this.waterSprites.push({ s, base: frame.slice(0, -3) });
    else if (!isWater && wi >= 0) this.waterSprites.splice(wi, 1);
    s.tint = isWater || this.city.has(i) ? 0xffffff : this.groundTint;
  }

  /**
   * Track was laid on the tile: push its trees and bushes to the sides of the rails (straight
   * pieces) or clear them (curves, switches, crossings need the whole tile). A field is neither
   * moved nor cleared: it stays in the map at its own place and is not drawn while track lies on
   * the tile (CUT_BY_TRACK).
   */
  displaceProps(x: number, y: number, links: [number, number][]) {
    const i = idx(this.map, x, y);
    const list = this.map.props.get(i);
    if (!list?.length) return;
    const ns = links.length === 1 && links[0].includes(0) && links[0].includes(2);
    const ew = links.length === 1 && links[0].includes(1) && links[0].includes(3);
    // curves, switches and crossings clear everything but a field
    const kept = ns || ew ? list : list.filter((p) => CUT_BY_TRACK.has(p.kind));
    if (!kept.length) {
      this.map.props.delete(i);
      this.removeProps(x, y);
      return;
    }
    if (kept.length < list.length) this.map.props.set(i, kept);
    for (const p of kept) {
      if (CUT_BY_TRACK.has(p.kind)) {
        // the field is only cut, never moved: one a save kept pushed aside is put back
        p.ox = 0;
        p.oy = 0;
      } else if (ns) {
        p.ox = p.ox >= 0 ? 0.4 : -0.4;
        p.oy = Math.max(-0.3, Math.min(0.3, p.oy));
      } else {
        p.oy = p.oy >= 0 ? 0.4 : -0.4;
        p.ox = Math.max(-0.3, Math.min(0.3, p.ox));
      }
    }
    this.rebuildProps(x, y);
    // the track sprite follows this call: the tile counts as railed from here
    this.showProps(i, true);
    this.wheat.near(x, y);
  }
  /** Re-create the prop sprites of one tile from the map data (after terrain edits). */
  rebuildProps(x: number, y: number) {
    this.removeProps(x, y);
    const i = idx(this.map, x, y);
    const list = this.map.props.get(i);
    if (list) this.buildPropsAt(i, list);
    else this.buildScatterAt(x, y);
    this.wheat.near(x, y);
  }

  /** Re-tile after terrain edits: ground texture, props, and objects standing on the tile. */
  retile(x: number, y: number) {
    if (!this.isBuilt(x, y)) return;
    this.refreshGround(x, y);
    this.rebuildProps(x, y);
    const t = this.trackSprites.get(idx(this.map, x, y));
    if (t) this.placeTrackSprite(t, x, y);
  }

  setFlattened(x: number, y: number, flat: boolean) {
    const i = idx(this.map, x, y);
    if (this.flattened.has(i) === flat) return;
    if (flat) this.flattened.add(i);
    else this.flattened.delete(i);
    this.refreshGround(x, y);
    this.showProps(i);
    this.wheat.near(x, y);
  }
  isFlattened(x: number, y: number) {
    return this.flattened.has(idx(this.map, x, y));
  }
  /** Ground-level y offset for objects standing on a tile (raised hills lift them). */
  elevationOf(x: number, y: number) {
    if (!this.landscape.failed) return this.landscape.elevation(x, y);
    // Props and people pass fractional tile coordinates; elevation belongs to their tile.
    const tx = Math.round(x),
      ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return 0;
    const i = idx(this.map, tx, ty);
    if (this.map.terrain[i] === Terrain.Mountain) return -2 * ELEV_PX;
    return this.map.terrain[i] === Terrain.Hill && !this.flattened.has(i) ? -ELEV_PX : 0;
  }

  private buildProps() {
    for (const [i, list] of this.map.props)
      if (this.isBuilt(i % this.map.w, Math.floor(i / this.map.w))) this.buildPropsAt(i, list);
  }
  private buildPropsAt(i: number, list: PropInstance[]) {
    if (this.propSprites.has(i)) return;
    {
      const x = i % this.map.w;
      const y = Math.floor(i / this.map.w);
      if (!this.isBuilt(x, y)) return;
      const sprites: Sprite[] = [];
      for (const p of list) {
        const s = this.propSprite(x, y, p);
        if (!s) continue;
        if (CUT_BY_TRACK.has(p.kind)) this.cutSprites.add(s);
        if (p.kind === 'coal' || p.kind === 'oil') this.deposits.add(s);
        // a field shows its picture once it is painted (#444)
        if (p.kind === 'wheat' && !this.wheat.sprite(i)) this.wheat.set(i, s);
        sprites.push(s);
      }
      if (sprites.length) {
        this.propSprites.set(i, sprites);
        this.showProps(i);
      }
    }
  }
  /**
   * Show or hide the prop sprites of tile `i`: all of them are hidden on flattened ground, those
   * track cuts while track lies on the tile (`railed`, by default whether it has a sprite), and all
   * but a deposit while a road does. The map's props stay as they are.
   */
  private showProps(i: number, railed = this.trackSprites.has(i)) {
    const flat = this.flattened.has(i),
      road = this.roads.has(i);
    for (const s of this.propSprites.get(i) ?? [])
      s.visible = !flat && !(railed && this.cutSprites.has(s)) && !(road && !this.deposits.has(s));
  }

  private propSprite(x: number, y: number, p: PropInstance) {
    const key = `props/${p.kind}_${p.variant}`;
    if (!this.atlas.has(key)) return null;
    const f = this.atlas.get(key);
    const s = new Sprite(f.texture);
    s.anchor.set(f.anchorX, f.anchorY);
    if (isTree(p.kind)) s.scale.set(TREE_SCALE);
    const wp = tileToWorld(x + p.ox, y + p.oy);
    s.position.set(Math.round(wp.x), Math.round(wp.y + this.elevationOf(x + p.ox, y + p.oy)));
    s.zIndex = depthKey(x + p.ox, y + p.oy, 10);
    s.cullable = true;
    s.tint = this.propTint;
    this.objects.addChild(s);
    return s;
  }
  /** Rebuild the visual-only nature on one tile from its current surroundings. */
  private buildScatterAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return;
    const i = idx(this.map, x, y);
    for (const { s } of this.scatterSprites.get(i) ?? []) s.destroy();
    this.scatterSprites.delete(i);
    if (!this.isBuilt(x, y)) return;
    const list = scatterFor(this.map, x, y, {
      occupied: (xx, yy) =>
        this.trackSprites.has(idx(this.map, xx, yy)) ||
        this.roads.has(idx(this.map, xx, yy)) ||
        this.occupied(xx, yy),
      city: (xx, yy) => this.city.has(idx(this.map, xx, yy)),
      // A stacked bank passes through: one neighbour a level up, another a level down.
      steep: (xx, yy) => {
        const here = levelAt(this.map, xx, yy),
          around = [
            levelAt(this.map, xx + 1, yy),
            levelAt(this.map, xx - 1, yy),
            levelAt(this.map, xx, yy + 1),
            levelAt(this.map, xx, yy - 1),
          ];
        return around.some((l) => l > here) && around.some((l) => l < here);
      },
    });
    const sprites = [];
    for (const p of list) {
      const s = this.propSprite(x, y, p);
      if (s) sprites.push({ s, ox: p.ox, oy: p.oy });
    }
    if (sprites.length) this.scatterSprites.set(i, sprites);
  }
  /** Something was built or cleared near (x, y): scatter there follows. */
  private refreshScatter(x: number, y: number, radius: number) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx,
          yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < this.map.w && yy < this.map.h)
          if (!this.map.props.has(idx(this.map, xx, yy))) this.buildScatterAt(xx, yy);
      }
  }

  removeProps(x: number, y: number) {
    const i = idx(this.map, x, y);
    for (const s of this.propSprites.get(i) ?? []) s.destroy();
    this.propSprites.delete(i);
    if (this.wheat.sprite(i)) this.wheat.set(i, null);
    this.wheat.near(x, y);
  }

  /** One translucent diamond per revealed-but-unowned region; hidden regions draw nothing. */
  rebuildFog() {
    for (const g of this.fogShapes.values()) g.destroy();
    this.fogShapes.clear();
    for (let i = 0; i < this.regions.unlocked.length; i++) {
      if (!this.regions.isRevealed(i)) continue;
      this.buildRegion(i);
      if (this.regions.unlocked[i]) continue;
      const r = this.regions.regionRect(i);
      const x1 = Math.min(this.map.w, r.x + r.w);
      const y1 = Math.min(this.map.h, r.y + r.h);
      const a = tileToWorld(r.x, r.y);
      const b = tileToWorld(x1, r.y);
      const c = tileToWorld(x1, y1);
      const d = tileToWorld(r.x, y1);
      const g = new Graphics();
      g.poly([a.x, a.y - HALF_H, b.x, b.y - HALF_H, c.x, c.y - HALF_H, d.x, d.y - HALF_H]).fill({
        color: 0x08080c,
        alpha: 0.62,
      });
      g.cullable = true;
      this.fog.addChild(g);
      this.fogShapes.set(i, g);
    }
  }

  /** Apply camera transform. */
  applyCamera(cam: Camera) {
    this.view = cam.viewRect();
    const z = cam.zoom;
    this.root.scale.set(z);
    this.root.position.set(
      Math.round(cam.viewW / 2 - cam.x * z),
      Math.round(cam.viewH / 2 - cam.y * z),
    );
    // Same resolution cap as the renderer in game.ts.
    this.landscape.focus(this.view, z * Math.min(window.devicePixelRatio || 1, 2));
  }

  animate(dt: number) {
    if (this.landscape.flush()) {
      this.refreshSummits();
      this.harvest.refresh();
      for (const [i, s] of this.trackSprites)
        this.placeTrackSprite(s, i % this.map.w, Math.floor(i / this.map.w));
      for (const [i, list] of this.scatterSprites) {
        const x = i % this.map.w,
          y = Math.floor(i / this.map.w);
        for (const { s, ox, oy } of list)
          s.y = Math.round(tileToWorld(x + ox, y + oy).y + this.elevationOf(x + ox, y + oy));
      }
      for (const [i, sprites] of this.propSprites) {
        const props = this.map.props.get(i) ?? [],
          x = i % this.map.w,
          y = Math.floor(i / this.map.w);
        props.forEach((p, j) => {
          const s = sprites[j];
          if (s)
            s.y = Math.round(
              tileToWorld(x + p.ox, y + p.oy).y + this.elevationOf(x + p.ox, y + p.oy),
            );
        });
      }
      for (const [id, a] of this.structureAnchors) {
        const s = this.structures.get(id);
        if (!s) continue;
        const p = this.surfacePoint(a.x, a.y);
        s.position.set(p.x + a.dx, p.y + a.dy);
        const footing = this.footings.get(id);
        if (footing) this.fitPlinth(footing, s);
        const fit = this.groundFits.get(id);
        if (fit) placeGroundFit(fit, s);
        this.windowLights.get(id)?.position.copyFrom(s.position);
      }
      for (let i = 0; i < this.groundSprites.length; i++) {
        const s = this.groundSprites[i];
        if (s)
          s.visible =
            !this.landscape.active ||
            !this.landscape.isPainted(i % this.map.w, Math.floor(i / this.map.w));
      }
    }
    // Bridges follow the water painted round them: a tile whose water changed is drawn again.
    if (this.bridgeWaterChanged || this.texturedFailed !== this.landscape.failed)
      this.setTexturedBridges(this.texturedTiles);
    this.landscape.root.visible = this.landscape.active;
    this.ground.visible = !this.landscape.active || !this.landscape.ready;
    if (
      this.landscape.active &&
      this.terrainVisibilityVersion !== this.landscape.visibilityVersion
    ) {
      this.terrainVisibilityVersion = this.landscape.visibilityVersion;
      for (let i = 0; i < this.groundSprites.length; i++) {
        const s = this.groundSprites[i];
        if (s) s.visible = !this.landscape.isPainted(i % this.map.w, Math.floor(i / this.map.w));
      }
      this.refreshSummits();
    }
    this.waterClock += dt;
    this.rippleRefresh += dt;
    if (this.rippleRefresh > 0.12 && this.view) {
      this.rippleRefresh = 0;
      this.waterDetails.clear();
      const view = this.view;
      for (let y = 0; y < this.map.h; y++)
        for (let x = 0; x < this.map.w; x++) {
          if (this.map.terrain[y * this.map.w + x] !== Terrain.Water || !this.isBuilt(x, y))
            continue;
          const h = hash2(x + this.map.originX, y + this.map.originY, this.map.seed + 95);
          if (h > 0.28) continue;
          const p = tileToWorld(x, y);
          if (
            p.x < view.x - 20 ||
            p.x > view.x + view.w + 20 ||
            p.y < view.y - 20 ||
            p.y > view.y + view.h + 20
          )
            continue;
          const phase = this.waterClock * 0.7 + h * 71,
            drift = Math.sin(phase) * 2;
          this.waterDetails
            .moveTo(p.x - 4 + drift, p.y)
            .quadraticCurveTo(p.x + drift, p.y + 0.7, p.x + 5 + drift, p.y - 0.2)
            .stroke({ color: 0xb7d1be, width: 0.6, alpha: 0.04 + 0.055 * (1 + Math.sin(phase)) });
        }
    }
    this.waterPhase += dt;
    if (this.waterPhase > 0.28) {
      this.waterPhase = 0;
      this.waterFrame = (this.waterFrame + 1) % 4;
      for (const w of this.waterSprites) {
        w.s.texture = this.atlas.get(`${w.base}_f${this.waterFrame}`).texture;
      }
    }
    this.updateFields();
  }

  /**
   * Paint the wheat fields' pictures (#444) for at most `budget` ms, the tiles in view first; a
   * picture that takes longer goes on in the next call, and is made into its texture in a call of
   * its own. With no limit (`Infinity`), every picture there is to paint.
   */
  updateFields(budget = FIELD_BUDGET_MS) {
    if (!this.wheat.busy) return;
    const end = performance.now() + budget,
      more = () => performance.now() < end;
    do this.wheat.update(this.wheatHost, more);
    while (budget === Infinity && this.wheat.busy && this.fieldFrames !== 'wait');
  }
  /** The variants' pictures, read once; 'wait' while they are read, null where none can be. */
  private readFieldFrames() {
    if (this.fieldFrames === undefined) {
      const usable = (frames: readonly (FieldFrame | null)[] | null) =>
        frames?.some((f) => f) ? frames : null;
      let read: ReturnType<typeof this.fieldArt.frames> = null;
      try {
        read = this.fieldArt.frames(
          [0, 1, 2].map((v) => {
            const key = `props/wheat_${v}`;
            return this.atlas.has(key) ? this.atlas.get(key) : null;
          }),
        );
      } catch {
        read = null;
      }
      if (read && 'then' in read) {
        this.fieldFrames = 'wait';
        read.then(
          (frames) => (this.fieldFrames = usable(frames)),
          () => (this.fieldFrames = null),
        );
      } else this.fieldFrames = usable(read);
    }
    return this.fieldFrames;
  }
  /**
   * The site of the field tile at (x, y) (wheatField.ts), or null where its sprite shows no field:
   * gone, hidden under track or on flattened ground, or on a tile that is no field to its
   * neighbours either.
   */
  private fieldSite(x: number, y: number) {
    const s = this.wheat.sprite(idx(this.map, x, y));
    if (!s || s.destroyed || !s.visible || this.fieldCell(x, y).kind !== CELL_FIELD) return null;
    const { originX, originY } = this.map;
    return readSite(x + originX, y + originY, (wx, wy) =>
      this.fieldCell(wx - originX, wy - originY),
    );
  }
  /**
   * What tile (x, y) is to a wheat field beside it: a building's footprint, and off the map, are
   * blocked; a field where its wheat is drawn (not under track, not on flattened ground, its
   * sprite not taken away, as under a station; in a region not built yet, where it will be drawn);
   * blocked by track, a road, paving, water and anything standing there; otherwise open land. Each
   * with its level. It reads the map and what stands on it, never which regions were built first.
   */
  private fieldCell(x: number, y: number): FieldCell {
    const { w, h } = this.map;
    if (x < 0 || y < 0 || x >= w || y >= h)
      return { kind: CELL_BLOCKED, variant: 0, level: 0, run: 0 };
    const i = y * w + x,
      level = levelAt(this.map, x, y),
      run = this.footprintRuns().get(i);
    if (run !== undefined) return { kind: CELL_BLOCKED, variant: 0, level, run };
    const wheat =
      this.flattened.has(i) || this.trackSprites.has(i) || this.roads.has(i)
        ? undefined
        : this.map.props.get(i)?.find((p) => p.kind === 'wheat');
    if (wheat && (!this.isBuilt(x, y) || this.wheat.sprite(i)))
      return { kind: CELL_FIELD, variant: wheat.variant, level, run: 0 };
    if (
      this.trackSprites.has(i) ||
      this.city.has(i) ||
      this.map.terrain[i] === Terrain.Water ||
      this.roadAt(x, y) ||
      this.roads.has(i) ||
      this.occupied(x, y)
    )
      return { kind: CELL_BLOCKED, variant: 0, level, run: 0 };
    return { kind: CELL_OPEN, variant: 0, level, run: 0 };
  }
  /**
   * The footprint tiles of the buildings with ground data (the ones with a yard, #436), each with
   * the sides of it a wheat field runs up to: W and S (screen NW and SW), but not a side the
   * building's yard has a door path on.
   */
  private footprintRuns() {
    if (this.fieldRuns) return this.fieldRuns;
    const { w, h } = this.map,
      runs = new Map<number, number>();
    for (const f of this.footings.values()) {
      const open = (dx: number, dy: number) =>
          !f.yard.paths.some((p) => p.dx === dx && p.dy === dy),
        run = (open(-1, 0) ? RUN_W : 0) | (open(0, 1) ? RUN_S : 0);
      for (const t of footprintTiles(f.ground, f.x, f.y))
        if (t.x >= 0 && t.y >= 0 && t.x < w && t.y < h) {
          const k = t.y * w + t.x;
          runs.set(k, (runs.get(k) ?? RUN_W | RUN_S) & run);
        }
    }
    this.fieldRuns = runs;
    return runs;
  }

  /** Void ring outside the playable area so zooming out never shows raw background. */
  private buildBorder() {
    const B = WorldRenderer.BORDER;
    const { w, h } = this.map;
    const CH = 16;
    const chunks = new Map<
      string,
      { c: Container; minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (let y = -B; y < h + B; y++)
      for (let x = -B; x < w + B; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) continue;
        const key = `${Math.floor(x / CH)},${Math.floor(y / CH)}`;
        let ch = chunks.get(key);
        if (!ch) {
          ch = {
            c: new Container(),
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity,
          };
          ch.c.cullable = true;
          ch.c.cullableChildren = false;
          chunks.set(key, ch);
          this.border.addChild(ch.c);
        }
        const f = this.atlas.get(`terrain/void_${(((x * 7 + y * 13) % 3) + 3) % 3}`);
        const sp = new Sprite(f.texture);
        sp.anchor.set(f.anchorX, f.anchorY);
        const pt = tileToWorld(x, y);
        sp.position.set(pt.x, pt.y);
        // fade towards the outside so the edge reads as deep water
        const d = Math.max(-x, -y, x - (w - 1), y - (h - 1));
        sp.alpha = 1;
        const k = Math.max(0.22, 1 - d * 0.11);
        const v = Math.round(255 * k);
        sp.tint = (v << 16) | (v << 8) | Math.min(255, Math.round(v * 1.1));
        ch.c.addChild(sp);
        ch.minX = Math.min(ch.minX, pt.x - HALF_W);
        ch.maxX = Math.max(ch.maxX, pt.x + HALF_W);
        ch.minY = Math.min(ch.minY, pt.y - HALF_H);
        ch.maxY = Math.max(ch.maxY, pt.y + HALF_H);
      }
    for (const ch of chunks.values())
      ch.c.cullArea = new Rectangle(ch.minX, ch.minY, ch.maxX - ch.minX, ch.maxY - ch.minY);
  }

  /** Multiply-tint every ground and prop sprite (seasons). Water and void are left alone. */
  private groundTint = 0xffffff;
  private propTint = 0xffffff;
  private refreshSummits() {
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        if (!this.isBuilt(x, y)) continue;
        const k = idx(this.map, x, y),
          show =
            this.landscape.active && this.landscape.isPainted(x, y) && this.landscape.summit(x, y);
        let s = this.summitSprites.get(k);
        if (!show) {
          s?.destroy();
          this.summitSprites.delete(k);
          continue;
        }
        const key = `terrain/mountain_${this.map.variant[k] % 3}`,
          f = this.atlas.get(key),
          style = this.landscape.style,
          // With a match set, lit like the ground it stands on (the painter's height light).
          texture = this.surfaces.summit(
            key,
            f,
            style.summitMatch ?? 0,
            style.summitMatch === undefined
              ? 1
              : 1 + (style.heightLight ?? 0) * levelAt(this.map, x, y),
          );
        if (s) s.texture = texture;
        else {
          s = new Sprite({ texture, cullable: true });
          s.anchor.set(f.anchorX, f.anchorY);
          s.scale.set(1.05 + hash2(x + this.map.originX, y + this.map.originY, 27) * 0.3);
          s.zIndex = depthKey(x, y, 2);
          this.objects.addChild(s);
          this.summitSprites.set(k, s);
        }
        const p = this.surfacePoint(x, y);
        s.position.set(p.x, p.y);
        s.tint = this.groundTint;
      }
  }
  setSeasonTint(ground: number, props: number) {
    this.groundTint = ground;
    this.landscape.setTint(ground);
    for (const s of this.summitSprites.values()) s.tint = ground;
    this.propTint = props;
    for (let i = 0; i < this.groundSprites.length; i++) {
      const s = this.groundSprites[i];
      if (!s) continue;
      if (this.map.terrain[i] === Terrain.Water) continue;
      s.tint = this.city.has(i) ? 0xffffff : ground;
    }
    for (const list of this.propSprites.values()) for (const s of list) s.tint = props;
    for (const fit of this.groundFits.values()) fit.weeds.tint = props;
  }
  /** Apply the current season tint to a freshly built region. */
  private applyTintTo(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = idx(this.map, x, y);
        const s = this.groundSprites[i];
        if (s && this.map.terrain[i] !== Terrain.Water)
          s.tint = this.city.has(i) ? 0xffffff : this.groundTint;
        for (const p of this.propSprites.get(i) ?? []) p.tint = this.propTint;
        for (const p of this.scatterSprites.get(i) ?? []) p.s.tint = this.propTint;
      }
  }

  /** Show a track piece sprite on a tile (or clear it). Flat: lives in the track layer under objects. */
  /** Highlight colour per tile (path tracing); 0xffffff clears. Night shading is applied on top. */
  private trackHighlight = new Map<number, number>();
  private trackNight = 0;
  setTrackTint(x: number, y: number, color: number) {
    const i = idx(this.map, x, y);
    if (color === 0xffffff) this.trackHighlight.delete(i);
    else this.trackHighlight.set(i, color);
    for (const s of [
      this.trackSprites.get(i),
      this.trackMeshes.get(i),
      this.decks.get(i),
      this.deckMeshes.get(i),
    ])
      if (s) s.tint = this.trackColour(i);
  }
  private trackColour(i: number) {
    const hl = this.trackHighlight.get(i);
    if (hl !== undefined) return hl;
    // ballast is light; darken it with the night so the line does not glow through the dark
    const k = 1 - 0.55 * this.trackNight;
    const local = MATERIAL_COLORS[materialAt(this.map, i % this.map.w, Math.floor(i / this.map.w))];
    const r = Math.round((225 + local[0] * 0.1) * k);
    const g = Math.round((225 + local[1] * 0.1) * k);
    const b = Math.round((225 + local[2] * 0.1) * k + 0x10 * this.trackNight);
    return (r << 16) | (g << 8) | Math.min(255, b);
  }
  /** Darken every track sprite with the night (0 day .. 1 deep night). */
  setTrackNight(night: number) {
    if (Math.abs(night - this.trackNight) < 0.04) return;
    this.trackNight = night;
    for (const pieces of [this.trackSprites, this.trackMeshes, this.decks, this.deckMeshes])
      for (const [i, s] of pieces) s.tint = this.trackColour(i);
  }
  /**
   * Piers for a bridge platform over land: each stands on the ground under it and reaches up to
   * the deck (`deck` world pixels up, 4 px thick), so none is longer than the drop it spans and
   * none sinks into the terrain. Straight spans (`axis` 0 along y, 1 along x) get a pair of
   * piers (stone) or a braced trestle (wood); curves and switches (`axis` null) a pier per
   * corner. `material` null removes them.
   */
  setBridgePiers(
    x: number,
    y: number,
    material: 'wood' | 'stone' | null,
    axis: 0 | 1 | null = null,
    deck = 0,
  ) {
    const k = idx(this.map, x, y);
    let g = this.pierGraphics.get(k);
    if (!material) {
      g?.destroy();
      this.pierGraphics.delete(k);
      return;
    }
    if (!g) {
      g = new Graphics();
      this.piers.addChild(g);
      this.pierGraphics.set(k, g);
    }
    g.clear();
    const stone = material === 'stone',
      side = stone ? PAL.stone : PAL.timber,
      hex = (c: RGB, f: number) =>
        (Math.min(255, Math.round(c[0] * f)) << 16) |
        (Math.min(255, Math.round(c[1] * f)) << 8) |
        Math.min(255, Math.round(c[2] * f)),
      top = deck - 4,
      // (along, across) in the span's own axes -> tile offsets.
      at = (l: number, w: number) => (axis === 0 ? { dx: w, dy: l } : { dx: l, dy: w });
    const posts: { dx: number; dy: number; hx: number; hy: number }[] = [];
    if (axis === null)
      for (const cx of [-0.34, 0.34])
        for (const cy of [-0.34, 0.34])
          posts.push({ dx: cx, dy: cy, hx: stone ? 0.09 : 0.04, hy: stone ? 0.09 : 0.04 });
    else if (stone)
      for (const l of [-0.38, 0.38]) {
        const o = at(l, 0);
        posts.push({ ...o, hx: axis ? 0.07 : 0.3, hy: axis ? 0.3 : 0.07 });
      }
    else
      for (const l of [-0.4, 0.4])
        for (const w of [-0.26, 0.26]) posts.push({ ...at(l, w), hx: 0.035, hy: 0.035 });
    // Far posts first, so nearer ones cover them.
    posts.sort((a, b) => a.dx + a.dy - (b.dx + b.dy));
    const screen = (tx: number, ty: number, z: number) => {
      const p = tileToWorld(tx, ty);
      return { x: p.x, y: p.y - z };
    };
    const feet: { x: number; y: number; ground: number }[] = [];
    for (const p of posts) {
      const fx = x + p.dx,
        fy = y + p.dy,
        ground = -this.elevationOf(fx, fy);
      feet.push({ x: fx, y: fy, ground });
      if (top - ground < 1) continue;
      const corner = (sx: number, sy: number, z: number) =>
          screen(fx + sx * p.hx, fy + sy * p.hy, z),
        face = (a: [number, number], b: [number, number], c: number) => {
          const pa = corner(a[0], a[1], ground),
            pb = corner(b[0], b[1], ground),
            qb = corner(b[0], b[1], top),
            qa = corner(a[0], a[1], top);
          g!.poly([pa.x, pa.y, pb.x, pb.y, qb.x, qb.y, qa.x, qa.y]).fill(c);
        };
      // The two faces toward the camera: +y lit from the upper left, +x in shade.
      face([-1, 1], [1, 1], hex(side[1], 0.9));
      face([1, 1], [1, -1], hex(side[2], 0.72));
      // A darker band where the pier meets the ground reads as contact, not as a cut.
      const a = corner(-1, 1, ground),
        b = corner(1, 1, ground),
        c = corner(1, -1, ground);
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .lineTo(c.x, c.y)
        .stroke({ width: 1.5, color: hex(side[2], 0.45), alpha: 0.6 });
    }
    // Timber trestles brace their near pair of posts with a cross.
    if (!stone && axis !== null) {
      const near = feet.filter((_, i) => {
        const o = posts[i];
        return (axis ? o.dy : o.dx) > 0;
      });
      if (near.length === 2) {
        const [p, q] = near,
          lo = Math.max(p.ground, q.ground),
          span = top - lo;
        if (span > 4) {
          const a = screen(p.x, p.y, lo + 1),
            b = screen(q.x, q.y, top - 1),
            c = screen(q.x, q.y, lo + 1),
            d = screen(p.x, p.y, top - 1);
          g.moveTo(a.x, a.y)
            .lineTo(b.x, b.y)
            .moveTo(c.x, c.y)
            .lineTo(d.x, d.y)
            .stroke({
              width: 1.5,
              color: hex(side[0], 0.85),
            });
        }
      }
    }
  }
  /**
   * How bridges draw: `textured` the procedural shapes wearing the kit's surfaces
   * (bridgeMeshes.ts), merged with their neighbours into wide bridges; `kit` the illustrated kit
   * pieces; `procedural` the generated spans. Setting it redraws the bridges (onBridgeStyle).
   */
  get bridgeStyle() {
    return this.style;
  }
  set bridgeStyle(style: BridgeStyle) {
    if (style === this.style) return;
    this.style = style;
    this.onBridgeStyle();
  }
  private style: BridgeStyle = 'textured';
  /** Called when the bridge style changes; the game redraws its bridges. */
  onBridgeStyle: () => void = () => {};
  /** The style bridges draw in: the chosen one, or the next whose assets are there. */
  get bridgeMode(): BridgeStyle {
    if (this.style === 'textured' && this.bridgeSurfaces) return 'textured';
    if (this.style !== 'procedural' && this.atlas.has('bridgekit/stone-deck-x')) return 'kit';
    return 'procedural';
  }
  private bridgeSurfaces: BridgeSurfaces | null = null;
  /** Loads the kit's repeating surfaces (public/assets/bridge-surface-*.png). */
  async loadBridgeSurfaces() {
    if (this.bridgeSurfaces) return true;
    const base = `${import.meta.env.BASE_URL}assets/bridge-surface-`;
    try {
      const [stoneTop, stoneWall, woodTop, woodGrain] = await Promise.all(
        ['stone-top', 'stone-wall', 'wood-top', 'wood-grain'].map((n) =>
          Assets.load<Texture>(`${base}${n}.png`),
        ),
      );
      for (const t of [stoneTop, stoneWall, woodTop, woodGrain]) prepareSurface(t.source);
      this.bridgeSurfaces = { stoneTop, stoneWall, woodTop, woodGrain };
      return true;
    } catch {
      return false;
    }
  }
  private texturedParts = new Map<number, { key: string; under: Container; near: Container }>();
  /** The bridge tiles last drawn, drawn again when the water painted round them may change. */
  private texturedTiles: readonly TexturedBridge[] = [];
  /** A town's paving or a terrain edit came near a textured bridge since it was drawn. */
  private bridgeWaterChanged = false;
  /** Whether the landscape had failed when the bridges were drawn (bridgeGround). */
  private texturedFailed = false;
  /**
   * Every bridge tile in the textured style (none in the others): supports, deck and far
   * parapets under the trains, near parapets over them. Tiles merge with their neighbours
   * (bridgeLayout.ts); a tile whose parts did not change keeps its meshes.
   */
  setTexturedBridges(tiles: readonly TexturedBridge[]) {
    this.texturedTiles = tiles;
    this.bridgeWaterChanged = false;
    this.texturedFailed = this.landscape.failed;
    const surfaces = this.bridgeMode === 'textured' ? this.bridgeSurfaces : null,
      sites = surfaces
        ? tiles.map((t) => ({ ...t, deck: this.deckProfile(t.x, t.y, t.axis, t.water) }))
        : [],
      joins = bridgeJoins(sites, this.map.w),
      ground = (tx: number, ty: number) => this.bridgeGround(tx, ty),
      keep = new Set<number>();
    for (const site of sites) {
      const k = idx(this.map, site.x, site.y),
        j = joins.get(k)!,
        // Everything the meshes depend on, to a tenth of a pixel: the ground is sampled under
        // the tile and in front of it, where it can hide the tile's faces, and the water painted
        // there is given by what it is painted from.
        key = JSON.stringify([
          site.material,
          site.axis,
          site.water,
          site.level,
          site.open,
          j,
          site.deck.map((z) => Math.round(z * 10)),
          GROUND_SAMPLES.map(([dx, dy]) => Math.round(ground(site.x + dx, site.y + dy) * 10)),
          this.bridgeWaterKey(site.x, site.y),
        ]);
      keep.add(k);
      const old = this.texturedParts.get(k);
      if (old?.key === key) continue;
      if (old) for (const c of [old.under, old.near]) destroyBridgeParts(c);
      const [from, to] = GROUND_BOX,
        parts = bridgeTileMeshes(
          {
            ...site,
            ground,
            top: this.groundTop(site.x + from, site.y + from, site.x + to, site.y + to),
          },
          bridgePlan(site, j, site.water),
          surfaces!,
        );
      parts.under.zIndex = site.x + site.y;
      parts.near.zIndex = depthKey(site.x, site.y, 35);
      this.piers.addChild(parts.under);
      this.objects.addChild(parts.near);
      this.texturedParts.set(k, { key, ...parts });
    }
    for (const [k, old] of this.texturedParts)
      if (!keep.has(k)) {
        for (const c of [old.under, old.near]) destroyBridgeParts(c);
        this.texturedParts.delete(k);
      }
  }
  /**
   * A bridge deck's top (the rail level) in world px up at DECK_SAMPLES along its axis; one level
   * for a pad. Over water it never sinks below the waterline's deck.
   */
  private deckProfile(x: number, y: number, axis: 0 | 1 | null, water: boolean): number[] {
    const tile = this.railBeds.get(idx(this.map, x, y)),
      dir = axis === 1 ? 'x' : 'y',
      bed = tile?.axis === dir ? tile : tile?.cross?.axis === dir ? tile.cross : undefined,
      floor = (z: number) => (water ? Math.max(0, z) : z);
    if (axis === null || !bed || this.landscape.failed) return [floor(-this.railAt(x, y).dz)];
    return deckSamples(bed, axis === 1 ? x : y, this.levelPx).map(floor);
  }
  /**
   * Ground under a bridge, world px up: the terrain, or the waterline where the landscape paints
   * water (`underPaintedWater`, the painter's own waterline inside the tile). With the landscape
   * off for the session the per-tile ground shows instead, its water a whole tile.
   */
  private bridgeGround(tx: number, ty: number) {
    let water: boolean;
    if (!this.landscape.failed) water = underPaintedWater(this.map, tx, ty, this.paved);
    else {
      const x = Math.round(tx),
        y = Math.round(ty);
      water =
        x >= 0 &&
        y >= 0 &&
        x < this.map.w &&
        y < this.map.h &&
        this.map.terrain[idx(this.map, x, y)] === Terrain.Water;
    }
    return water ? WATERLINE : -this.elevationOf(tx, ty);
  }
  /** A height (world px up) the ground under bridges never exceeds in the box given. */
  private groundTop(x0: number, y0: number, x1: number, y1: number) {
    // The per-tile ground stands a mountain's two steps up at most (elevationOf).
    return this.landscape.failed ? 2 * ELEV_PX : this.landscape.heightTop(x0, y0, x1, y1);
  }
  /** A town's tile, paved by the painter (`setCity`). */
  private readonly paved = (tile: number) => this.city.has(tile);
  /**
   * What the water painted round bridge tile (x, y) is made from: per tile of WATER_TILES (the
   * painter's blend reads no others for the points the tile's faces are cut to), whether it is
   * water and whether it is paved, and whether the per-tile ground stands in for the landscape.
   * Off the map, the edge tile, as the painter reads it.
   */
  private bridgeWaterKey(x: number, y: number) {
    const { w, h } = this.map,
      [from, to] = WATER_TILES;
    let key = this.landscape.failed ? 'tiles:' : 'painted:';
    for (let ty = y + from; ty <= y + to; ty++)
      for (let tx = x + from; tx <= x + to; tx++) {
        const k = Math.max(0, Math.min(h - 1, ty)) * w + Math.max(0, Math.min(w - 1, tx));
        key += (this.map.terrain[k] === Terrain.Water ? 1 : 0) + (this.city.has(k) ? 2 : 0);
      }
    return key;
  }
  /** Is tile (x, y) among the tiles whose water a textured bridge tile is cut to (WATER_TILES)? */
  private nearTexturedBridge(x: number, y: number) {
    const [from, to] = WATER_TILES;
    for (const k of this.texturedParts.keys()) {
      const dx = x - (k % this.map.w),
        dy = y - Math.floor(k / this.map.w);
      if (dx >= from && dx <= to && dy >= from && dy <= to) return true;
    }
    return false;
  }
  private kitParts = new Map<number, Container>();
  /**
   * Everything under a kit bridge deck on one tile, in the pier layer: piers or trestle posts cut
   * to the ground (or into the water) under each one, timber braces between the posts, and over
   * water stone arches or timber trusses hung from both deck edges. `axis` 0 runs along y, 1
   * along x, null is a pad under a curve or switch; `deck` is the rail level in world px.
   */
  setBridgeKit(
    x: number,
    y: number,
    material: 'wood' | 'stone' | null,
    axis: 0 | 1 | null = null,
    deck = 0,
    water = false,
  ) {
    const k = idx(this.map, x, y);
    this.kitParts.get(k)?.destroy({ children: true });
    this.kitParts.delete(k);
    if (!material) return;
    const c = new Container(),
      stone = material === 'stone',
      dir = axis === 1 ? 'x' : 'y',
      slab = `${material}-${axis === null ? 'pad' : `deck-${dir}`}`,
      underside = deck - BRIDGE_KIT[slab].thickness!,
      at = (l: number, w: number) => (axis === 0 ? { dx: w, dy: l } : { dx: l, dy: w }),
      screen = (tx: number, ty: number, z: number) => {
        const p = tileToWorld(tx, ty);
        return { x: p.x, y: p.y - z };
      },
      ground = (tx: number, ty: number) => (water ? -30 : -this.elevationOf(tx, ty));
    // Walls hung under both long edges, over water: the far one first.
    if (water && axis !== null) {
      const key = `${material}-${stone ? 'arch' : 'truss'}-${dir}`,
        f = this.atlas.get(`bridgekit/${key}`),
        h = BRIDGE_KIT[key].height!;
      for (const far of [true, false]) {
        const s = new Sprite(f.texture),
          o = far ? (axis === 1 ? { dx: 0, dy: -1 } : { dx: -1, dy: 0 }) : { dx: 0, dy: 0 },
          // Tucked a few px up behind the deck, so no water shows between them.
          p = screen(x + o.dx, y + o.dy, underside - h + 4);
        s.anchor.set(f.anchorX, f.anchorY);
        s.position.set(p.x, p.y);
        c.addChild(s);
      }
    }
    // Piers (stone) or posts (wood), far ones first so nearer ones cover them.
    const shaft = stone ? 'stone-pier' : 'wood-post',
      f = this.atlas.get(`bridgekit/${shaft}`),
      half = (stone ? 0.2 : 0.07) * 32,
      spots: { dx: number; dy: number }[] = [];
    if (axis === null)
      for (const a of [-0.36, 0.36]) for (const b of [-0.36, 0.36]) spots.push({ dx: a, dy: b });
    else if (!water || !stone)
      for (const l of [-0.4, 0.4]) for (const w of [-0.3, 0.3]) spots.push(at(l, w));
    spots.sort((a, b) => a.dx + a.dy - (b.dx + b.dy));
    const feet = new Map<string, number>();
    for (const o of spots) {
      const gx = x + o.dx,
        gy = y + o.dy,
        g = ground(gx, gy),
        length = underside - g;
      feet.set(`${o.dx},${o.dy}`, g);
      if (length < 1) continue;
      const cut = this.surfaces.shaft(`bridgekit/${shaft}`, f, length, half, water ? 6 : 0),
        s = new Sprite(cut.texture),
        p = screen(gx, gy, underside);
      s.anchor.set(f.anchorX, cut.anchorY);
      s.position.set(p.x, p.y);
      c.addChild(s);
    }
    // Timber braces across each pair of posts along the span.
    if (!stone && axis !== null) {
      const key = `wood-brace-${dir}`,
        bf = this.atlas.get(`bridgekit/${key}`),
        bh = BRIDGE_KIT[key].height!;
      for (const w of [-0.3, 0.3]) {
        const a = at(-0.4, w),
          b = at(0.4, w),
          lo = Math.max(feet.get(`${a.dx},${a.dy}`) ?? 0, feet.get(`${b.dx},${b.dy}`) ?? 0),
          span = underside - lo;
        if (span < 5) continue;
        // The brace is drawn on the near tile edge; move it onto this post line, 0.8 tile long.
        const s = new Sprite(bf.texture),
          edge = at(0, 0.5),
          line = at(0, w),
          p = screen(x + line.dx - edge.dx, y + line.dy - edge.dy, lo);
        s.anchor.set(bf.anchorX, bf.anchorY);
        s.scale.set(BRIDGE_KIT[key].along ?? 0.8, span / bh);
        s.position.set(p.x, p.y);
        c.addChild(s);
      }
    }
    this.piers.addChild(c);
    this.kitParts.set(k, c);
  }
  /** `lift` raises the platform above the ground plane: a bridge deck carried over land. */
  setPlatform(
    x: number,
    y: number,
    frame: string | null,
    layer = 0,
    clipToWater = false,
    lift = 0,
  ) {
    const key = y * this.map.w + x + layer * this.map.w * this.map.h;
    let s = this.platformSprites.get(key);
    if (!frame) {
      this.platformMasks.get(key)?.destroy();
      this.platformMasks.delete(key);
      s?.destroy();
      this.platformSprites.delete(key);
      return;
    }
    if (!s) {
      s = new Sprite();
      this.platforms.addChild(s);
      this.platformSprites.set(key, s);
    }
    const f = this.atlas.get(frame);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    const p = tileToWorld(x, y);
    s.position.set(p.x, p.y - lift);
    if (clipToWater) {
      let mask = this.platformMasks.get(key);
      if (!mask) {
        mask = new Graphics();
        this.platforms.addChild(mask);
        this.platformMasks.set(key, mask);
      }
      mask.clear();
      // Below-deck masonry must disappear behind the bank. Its screen-space height
      // can otherwise put the foot of a pier over a completely different land tile.
      for (let ty = Math.max(0, y - 3); ty <= Math.min(this.map.h - 1, y + 3); ty++)
        for (let tx = Math.max(0, x - 3); tx <= Math.min(this.map.w - 1, x + 3); tx++) {
          if (this.map.terrain[idx(this.map, tx, ty)] !== Terrain.Water) continue;
          const q = tileToWorld(tx, ty);
          mask
            .poly([q.x, q.y - HALF_H, q.x + HALF_W, q.y, q.x, q.y + HALF_H, q.x - HALF_W, q.y])
            .fill(0xffffff);
        }
      s.mask = mask;
    } else if (this.platformMasks.has(key)) {
      s.mask = null;
      this.platformMasks.get(key)!.destroy();
      this.platformMasks.delete(key);
    }
  }
  setTrack(x: number, y: number, frame: string | null) {
    const i = idx(this.map, x, y);
    let s = this.trackSprites.get(i);
    if (frame) this.trackFrames.set(i, frame);
    else this.trackFrames.delete(i);
    if (!frame) {
      if (s) {
        s.destroy();
        this.trackSprites.delete(i);
      }
      this.trackMeshes.get(i)?.destroy();
      this.trackMeshes.delete(i);
      this.showProps(i);
      this.refreshScatter(x, y, 0);
      this.wheat.near(x, y);
      this.trackUnderRoad(x, y);
      return;
    }
    const f = this.atlas.get(frame);
    if (!s) {
      s = new Sprite(f.texture);
      s.cullable = true;
      this.track.addChild(s);
      this.trackSprites.set(i, s);
    } else s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    s.tint = this.trackColour(i);
    this.placeTrackSprite(s, x, y);
    this.showProps(i);
    this.refreshScatter(x, y, 0);
    this.wheat.near(x, y);
    this.trackUnderRoad(x, y);
  }
  /**
   * The track on tile (x, y) changed: where a road lies on it, its level crossing's deck follows,
   * and the road there and beside it is painted again where its shape changed (a level crossing's
   * road runs straight through the middle, and so its neighbours meet it there).
   */
  private trackUnderRoad(x: number, y: number) {
    this.refreshDeck(x, y);
    if (!this.hasRoad(x, y)) return;
    const { w, h } = this.map,
      around = [y * w + x];
    for (const d of DIRS) {
      const nx = x + DIR_DX[d],
        ny = y + DIR_DY[d];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) around.push(ny * w + nx);
    }
    this.updateRoads(around);
  }
  /**
   * The level-crossing deck on tile (x, y) (#309): its frame over a plain straight of regular or
   * narrow track where a road lies on it, at the place and with the transform of the track piece
   * under it, tinted as the piece is. None where the road or the track is gone, nor where the
   * atlas lacks the frame.
   */
  private refreshDeck(x: number, y: number) {
    const i = idx(this.map, x, y),
      track = this.trackFrames.get(i),
      frame =
        this.roads.has(i) && track !== undefined && this.trackSprites.has(i)
          ? levelCrossingFrame(track)
          : null;
    let s = this.decks.get(i);
    if (!frame || !this.atlas.has(frame)) {
      s?.destroy();
      this.decks.delete(i);
      this.deckMeshes.get(i)?.destroy();
      this.deckMeshes.delete(i);
      return;
    }
    const f = this.atlas.get(frame);
    if (!s) {
      s = new Sprite(f.texture);
      s.cullable = true;
      this.crossings.addChild(s);
      this.decks.set(i, s);
    } else s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    s.tint = this.trackColour(i);
    this.seat(s, x, y, this.deckMeshes, this.crossings);
  }
  /**
   * New rail profile after a track or bridge change. Tiles whose bed changed repaint their ground
   * and re-seat their track piece, so a line conforms as its neighbours are laid.
   */
  setRailBeds(beds: ReadonlyMap<number, RailBed>) {
    const changed: number[] = [];
    for (const [k, bed] of beds)
      if (JSON.stringify(this.railBeds.get(k)) !== JSON.stringify(bed)) changed.push(k);
    for (const k of this.railBeds.keys()) if (!beds.has(k)) changed.push(k);
    for (const k of changed) {
      const bed = beds.get(k),
        x = k % this.map.w,
        y = Math.floor(k / this.map.w);
      if (bed) this.railBeds.set(k, bed);
      else this.railBeds.delete(k);
      this.landscape.invalidate(x, y);
      const s = this.trackSprites.get(k);
      if (s) this.placeTrackSprite(s, x, y);
    }
    return changed.length;
  }
  /** World pixels one level rises. */
  private get levelPx() {
    return this.landscape.failed ? DEFAULT_RELIEF.step : this.landscape.step;
  }
  /**
   * The rail under (x, y): on a straight line, its profile height and grade along the axis (a
   * bridge deck included); elsewhere the ground. Trains and track pieces stand on this.
   */
  railAt(x: number, y: number): Ground {
    const tile = this.railBeds.get(idx(this.map, Math.round(x), Math.round(y)));
    if (!tile || this.landscape.failed) return this.groundAt(x, y);
    const bed = bedFor(tile, x, y);
    const t = bed.axis === 'x' ? x : y,
      d = 0.05,
      step = this.levelPx,
      grade = ((railLevel(bed, t + d) - railLevel(bed, t - d)) / (2 * d)) * -step;
    return {
      dz: -railLevel(bed, t) * step,
      sgx: bed.axis === 'x' ? grade : 0,
      sgy: bed.axis === 'y' ? grade : 0,
    };
  }
  /** Height of a bridge deck above the ground under it, in world pixels (0 off bridges). */
  deckLift(x: number, y: number) {
    const bed = this.railBeds.get(idx(this.map, x, y));
    return bed?.bridge ? -this.railAt(x, y).dz + this.elevationOf(x, y) : 0;
  }
  /**
   * Track rests on the rail profile; a bending or climbing piece is a mesh following it. A level
   * crossing's deck over it goes with it.
   */
  private placeTrackSprite(s: Sprite, x: number, y: number) {
    this.seat(s, x, y, this.trackMeshes, this.track);
    const deck = this.decks.get(idx(this.map, x, y));
    if (deck) this.seat(deck, x, y, this.deckMeshes, this.crossings);
  }
  /**
   * Seat picture `s` of tile (x, y) on the rail profile: standing at the rail's height where the
   * line runs level, else hidden behind a mesh of its texture (`meshes`, in `layer` just under it)
   * whose vertices follow the profile.
   */
  private seat(s: Sprite, x: number, y: number, meshes: Map<number, Mesh>, layer: Container) {
    const i = idx(this.map, x, y),
      p = tileToWorld(x, y),
      bed = this.railBeds.get(i);
    let mesh = meshes.get(i);
    if (!bed || bed.flat || this.landscape.failed) {
      mesh?.destroy();
      meshes.delete(i);
      s.renderable = true;
      standOnGround(s, p.x, p.y, { ...LEVEL_GROUND, dz: this.railAt(x, y).dz });
      return;
    }
    const geometry = this.trackGeometry(s, x, y, bed);
    if (!mesh) {
      mesh = new Mesh({ geometry, texture: s.texture });
      mesh.cullable = true;
      layer.addChildAt(mesh, layer.getChildIndex(s));
      meshes.set(i, mesh);
    } else {
      mesh.geometry.destroy();
      mesh.geometry = geometry;
      mesh.texture = s.texture;
    }
    mesh.tint = s.tint;
    mesh.position.set(p.x, p.y);
    s.renderable = false;
  }
  /**
   * The piece's texture on a grid whose vertices are lifted to the rail profile under them. Every
   * vertex reads the one line profile, so neighbouring pieces (and their overlaps) coincide.
   */
  private trackGeometry(s: Sprite, x: number, y: number, bed: RailBed) {
    const NX = 16,
      NY = 4,
      w = s.texture.width,
      h = s.texture.height,
      step = this.levelPx,
      centre = bed.axis === 'x' ? x : y,
      positions = new Float32Array((NX + 1) * (NY + 1) * 2),
      uvs = new Float32Array(positions.length),
      indices = new Uint32Array(NX * NY * 6);
    for (let j = 0; j <= NY; j++)
      for (let i = 0; i <= NX; i++) {
        const k = (j * (NX + 1) + i) * 2,
          u = i / NX,
          v = j / NY,
          px = (u - s.anchor.x) * w,
          py = (v - s.anchor.y) * h,
          // Ground offset under this pixel: tx = px/64 + py/32, ty = py/32 - px/64.
          t = centre + (bed.axis === 'x' ? px / 64 + py / 32 : py / 32 - px / 64);
        positions[k] = px;
        positions[k + 1] = py - railLevel(bed, t) * step;
        uvs[k] = u;
        uvs[k + 1] = v;
      }
    for (let j = 0, n = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i,
          b = a + 1,
          c = a + NX + 1,
          d = c + 1;
        indices.set([a, b, c, b, d, c], n);
        n += 6;
      }
    return new MeshGeometry({ positions, uvs, indices });
  }
  /** The surface under (x, y) for sprites standing on it; level ground without the painter. */
  groundAt(x: number, y: number): Ground {
    if (this.landscape.failed) return { ...LEVEL_GROUND, dz: this.elevationOf(x, y) };
    const g = this.landscape.slope(x, y);
    return { dz: -g.z, sgx: -g.gx, sgy: -g.gy };
  }
  /**
   * Rails climb only straight, at most one level per tile; everything else needs level ground.
   * The relief that decides is built on the main thread, so the answer is the same whether the
   * paint workers run or have failed.
   */
  groundAllows(x: number, y: number, need: 'straight' | 'level') {
    return this.landscape.groundAllows(x, y, need);
  }

  /** Place or update a tall structure sprite keyed by id in the depth-sorted object layer. */
  setStructure(id: string, x: number, y: number, frame: string, layer = 20, dy = 0, dx = 0) {
    const f = this.atlas.get(frame);
    this.structureAnchors.set(id, { x, y, dx, dy });
    let s = this.structures.get(id);
    if (!s) {
      s = new Sprite();
      s.cullable = true;
      this.objects.addChild(s);
      this.structures.set(id, s);
    }
    // texture, anchor and size: a reused sprite never keeps the size of the frame it showed
    const building = this.setSpriteFrame(s, frame);
    const p = tileToWorld(x, y);
    s.position.set(p.x + dx, p.y + this.elevationOf(x, y) + dy);
    s.zIndex = depthKey(x, y, layer);
    // only a building has window lights and a ground fit; drop those of a building shown before
    if (!building) this.dropBuildingDressing(id);
    else {
      // a copy of its atlas frame, texel for texel, sampled without mipmaps (surfaceAssets.ts)
      s.texture = this.surfaces.picture(frame, f);
      const art = this.fitToGround(id, s, frame, f, building.scale, x, y);
      this.setFooting(id, s, frame, building.scale, x, y, dx, dy, art.base ?? null);
      let light = this.windowLights.get(id);
      if (!light) {
        light = windowSprite();
        this.objects.addChild(light);
        this.windowLights.set(id, light);
      }
      light.texture = this.surfaces.window(frame, f, !illustrated(f), building.family);
      light.anchor.set(f.anchorX, f.anchorY);
      light.position.copyFrom(s.position);
      light.scale.copyFrom(s.scale);
      light.zIndex = s.zIndex + 0.01;
    }
    // Stations reach up to two tiles from their anchor; nature there clears away.
    this.refreshScatter(x, y, 2);
    // and a field beside one ends short of it, or runs up to it
    this.fieldRuns = null;
    this.wheat.near(x - 2, y - 2, x + 2, y + 2);
    return s;
  }
  /**
   * Fit building `id`, picture `s` showing `frame` at `scale` on tile (x, y), to the ground: the
   * soft shadow it casts, the shade over its foot and the weeds and pebbles over its base. They
   * are layers of their own; the picture stays its atlas frame's texels. A picture with its
   * ground shadow baked in (a generated works or station) casts none, so it is not doubled.
   */
  private fitToGround(
    id: string,
    s: Sprite,
    frame: string,
    f: FrameInfo,
    scale: number,
    x: number,
    y: number,
  ) {
    const art = this.surfaces.groundFit(frame, f, scale);
    let fit = this.groundFits.get(id);
    if (!fit) {
      fit = {
        shadow: new Sprite({ cullable: true }),
        foot: new Sprite({ cullable: true }),
        weeds: new Sprite({ cullable: true }),
        weedsTexture: null,
        feet: [],
        x: 0,
        y: 0,
        drawn: null,
      };
      this.contactGround.addChild(fit.shadow);
      this.objects.addChild(fit.foot, fit.weeds);
      this.groundFits.set(id, fit);
    }
    for (const [sprite, layer] of [
      [fit.shadow, art.shadow],
      [fit.foot, art.foot],
    ] as const) {
      sprite.visible = !!layer;
      if (!layer) continue;
      sprite.texture = layer.texture;
      sprite.anchor.set(layer.anchorX, layer.anchorY);
    }
    fit.feet = art.feet;
    fit.x = Math.round(x);
    fit.y = Math.round(y);
    this.growWeeds(fit);
    fit.weeds.tint = this.propTint;
    placeGroundFit(fit, s);
    return art;
  }
  /**
   * The yard and plinth of building `id`, picture `s` showing `frame` at `scale`, placed on tile
   * (x, y) and moved (dx, dy) world px from it, as `setStructure` places it: its anchor is the
   * footprint's centre on the ground. A frame without ground data (src/art/buildingGround.json)
   * has neither. `wall` is the colour of its walls' base.
   */
  private setFooting(
    id: string,
    s: Sprite,
    frame: string,
    scale: number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    wall: RGB | null,
  ) {
    const ground = groundDataOf(frame);
    if (!ground) {
      this.dropFooting(id);
      return;
    }
    const off = worldToTile(dx, dy);
    let footing = this.footings.get(id);
    const was = footing?.yard ?? null;
    const site = { frame, ground, scale, x: x + off.x, y: y + off.y, tx: x, ty: y, wall };
    if (footing) Object.assign(footing, site);
    else {
      footing = { ...site, yard: null as unknown as Yard, lift: 0, plinth: null, drawn: '' };
      this.footings.set(id, footing);
    }
    const yard = this.yardOf(footing);
    footing.yard = yard;
    if (!sameYard(was, yard)) this.yardsChanged(was, yard);
    this.fitPlinth(footing, s);
    const fit = this.groundFits.get(id);
    if (fit) placeGroundFit(fit, s);
  }
  /** A building's yard as its footing, the doors and the roads round it stand now. */
  private yardOf(f: Footing): Yard {
    const { w, h } = this.map,
      material = materialAt(this.map, f.tx, f.ty),
      doors: PavingDoor[] = [];
    for (const t of footprintTiles(f.ground, f.x, f.y))
      if (t.x >= 0 && t.y >= 0 && t.x < w && t.y < h)
        doors.push(...(this.doorsByTile.get(t.y * w + t.x) ?? []));
    return buildingYard(
      f.frame,
      f.ground,
      {
        x: f.x,
        y: f.y,
        scale: f.scale,
        sandy: material === Material.Sand || material === Material.Desert,
      },
      doors,
      // a path runs on to a road next door, not on to the rails of a level crossing
      (rx, ry) =>
        rx >= 0 &&
        ry >= 0 &&
        rx < w &&
        ry < h &&
        this.roadAt(rx, ry) &&
        !this.trackSprites.has(idx(this.map, rx, ry)),
    );
  }
  /** Work out again the yards of the footings `which` picks; repaint those that changed. */
  private refreshYards(which: (f: Footing) => boolean) {
    for (const f of this.footings.values()) {
      if (!which(f)) continue;
      const yard = this.yardOf(f);
      if (sameYard(f.yard, yard)) continue;
      const was = f.yard;
      f.yard = yard;
      this.yardsChanged(was, yard);
      // a door path on its W or S side keeps a field there from running up to it
      this.fieldRuns = null;
      this.wheat.near(f.x - 2, f.y - 2, f.x + 2, f.y + 2);
    }
  }
  /** Hand the yards to the painter and repaint where yard `was` gave way to `now`. */
  private yardsChanged(was: Yard | null, now: Yard | null) {
    const { w, h } = this.map;
    this.landscape.setYards([...this.footings.values()].map((f) => f.yard));
    const tiles = new Set<number>();
    for (const yard of [was, now]) if (yard) for (const k of yardTiles(yard, w, h)) tiles.add(k);
    for (const k of tiles) this.landscape.repaint(k % w, Math.floor(k / w));
  }
  /**
   * Stand building `f`'s picture `s` on the ground under its foot, from where its tile's ground
   * puts it: lifted onto the highest ground under its foot, with a plinth from its walls' foot down
   * to the ground wherever that drops away (plinth.ts), drawn just under the picture. Off the
   * painted relief (the per-tile ground) and under machinery measured by its outline, none.
   */
  private fitPlinth(f: Footing, s: Sprite) {
    const plinth =
      this.landscape.failed || f.ground.fit !== 'walls'
        ? null
        : plinthOf(
            f.ground.foot.map(([px, py]) => [px * f.scale, py * f.scale] as const),
            f.x,
            f.y,
            -this.elevationOf(f.tx, f.ty),
            (mx, my) => -this.elevationOf(mx, my),
          );
    f.lift = plinth?.lift ?? 0;
    s.y -= f.lift;
    if (!plinth?.runs.length) {
      f.plinth?.destroy();
      f.plinth = null;
      f.drawn = '';
      return;
    }
    if (!f.plinth) {
      f.plinth = new Graphics({ cullable: true });
      this.objects.addChild(f.plinth);
    }
    const colour = plinthColour(f.wall),
      key = JSON.stringify([colour, plinth.runs]);
    if (key !== f.drawn) {
      f.drawn = key;
      const g = f.plinth.clear();
      for (const shape of plinthShapes(plinth, colour)) {
        g.poly(shape.points, shape.width === undefined);
        if (shape.width === undefined) g.fill({ color: shape.colour, alpha: shape.alpha });
        else g.stroke({ color: shape.colour, alpha: shape.alpha, width: shape.width });
      }
    }
    f.plinth.position.copyFrom(s.position);
    // under the picture, over everything a depth step behind it
    f.plinth.zIndex = s.zIndex - 0.004;
  }
  /** A building's yard and plinth go with it: the ground under its yard is painted again. */
  private dropFooting(id: string) {
    const f = this.footings.get(id);
    if (!f) return;
    this.footings.delete(id);
    f.plinth?.destroy();
    this.yardsChanged(f.yard, null);
  }
  /** Draw a building's weeds and pebbles for the ground its tile has now (none on paving). */
  private growWeeds(fit: GroundFitSprites) {
    const { x, y, feet } = fit,
      ground = footGround(materialAt(this.map, x, y), this.city.has(idx(this.map, x, y))),
      on = `${x},${y}|${ground}`;
    if (fit.drawn?.feet === feet && fit.drawn.on === on) return;
    fit.drawn = { feet, on };
    const art = this.surfaces.weeds(
      footScatter(feet, x + this.map.originX, y + this.map.originY, ground),
      ground,
    );
    showWeeds(fit, art?.texture ?? null);
    fit.weeds.visible = !!art;
    if (art) fit.weeds.anchor.set(art.anchorX, art.anchorY);
  }
  setWindowNight(night: number) {
    for (const [id, light] of this.windowLights) {
      light.alpha = night * 0.88;
      const owner = this.structures.get(id)!;
      light.visible = owner.visible;
      light.position.copyFrom(owner.position);
      light.scale.copyFrom(owner.scale);
      light.rotation = owner.rotation;
    }
  }
  private atmosphereTints = new WeakMap<Container, { base: number; applied: number }>();
  /** Ground is tinted by the multiply layer. Objects tint before their emissive masks. */
  setAtmosphereTint(color: number) {
    for (const object of this.objects.children) {
      if (object.label === 'emissive') continue;
      const previous = this.atmosphereTints.get(object);
      const base = previous && object.tint === previous.applied ? previous.base : object.tint;
      let applied = 0;
      for (const shift of [0, 8, 16])
        applied |= Math.round((((base >> shift) & 255) * ((color >> shift) & 255)) / 255) << shift;
      object.tint = applied;
      this.atmosphereTints.set(object, { base, applied });
    }
  }
  /** A structure's window lights, ground fit, yard and plinth, which only a building has. */
  private dropBuildingDressing(id: string) {
    this.dropFooting(id);
    const fit = this.groundFits.get(id);
    if (fit) {
      showWeeds(fit, null);
      for (const part of [fit.shadow, fit.foot, fit.weeds]) part.destroy();
    }
    this.groundFits.delete(id);
    this.windowLights.get(id)?.destroy();
    this.windowLights.delete(id);
  }
  removeStructure(id: string) {
    const anchor = this.structureAnchors.get(id);
    this.structureAnchors.delete(id);
    this.dropBuildingDressing(id);
    const s = this.structures.get(id);
    if (s) {
      s.destroy();
      this.structures.delete(id);
    }
    if (anchor) {
      this.refreshScatter(anchor.x, anchor.y, 2);
      this.fieldRuns = null;
      this.wheat.near(anchor.x - 2, anchor.y - 2, anchor.x + 2, anchor.y + 2);
    }
  }
  getStructure(id: string) {
    return this.structures.get(id);
  }

  /** Create a sprite in the overlay layer (ghost previews). */
  makeOverlaySprite(frame: string): Sprite {
    const s = new Sprite();
    this.setSpriteFrame(s, frame);
    this.overlay.addChild(s);
    return s;
  }
  /**
   * Show `frame` on `s` at its anchor and size: a building by its scale reference (a turned
   * frame by its unturned frame's), a tree at tree scale, anything else at 1, so a reused sprite
   * never keeps the size of the frame it showed before. Returns the building's scale reference,
   * or null for a frame without one.
   */
  setSpriteFrame(s: Sprite, frame: string): ScaleReference | null {
    const f = this.atlas.get(frame);
    s.texture = f.texture;
    s.anchor.set(f.anchorX, f.anchorY);
    const building = scaleReference(this.atlas, frame, illustrated(f) ? f.h : undefined);
    s.scale.set(
      building
        ? building.scale
        : frame.startsWith('props/') && isTree(frame.slice(6).replace(/_\d+$/, ''))
          ? TREE_SCALE
          : 1,
    );
    return building;
  }

  /** World pixel position of the top surface of a tile centre (for placing sprites). */
  surfacePoint(x: number, y: number) {
    const p = tileToWorld(x, y);
    return { x: p.x, y: p.y + this.elevationOf(x, y) };
  }
  tileAtSurface(x: number, y: number) {
    return this.landscape.failed ? worldToTileInt(x, y) : this.landscape.tileAtWorld(x, y);
  }
}

export const TILE_PIXEL_H = TILE_H;
