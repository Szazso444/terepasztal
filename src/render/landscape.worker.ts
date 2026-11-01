import {
  Material,
  materialAt,
  snowLineAt,
  stoneGroundAt,
  type LandscapeMap,
} from './landscapeModel';
import { reliefHeight, surfaceAlongRay, RELIEF_MAX, type TerrainRelief } from './terrainRelief';
import {
  grassDetail,
  paintedWater,
  rockExposure,
  shareSurfaceDetail,
  shareWildSheet,
  surfaceNoise,
  surfaceColor,
  surfaceMaterial,
  wildTexel,
} from './terrainMaterials';
import {
  bankMaterial,
  channelsOf,
  fallAt,
  frontAt,
  iceAt,
  isRiver,
  moraineAt,
  riverAt,
  type Channels,
  type Lay,
  type RiverPoint,
} from './waterPaint';
import { FRINGE_EARTH, PAVING_FAR, PAVING_FRINGE, PAVING_SOLID, TownPaving } from './townPaving';
import { BuildingYards } from './buildingYard';
import { pavingFade, RoadPaint } from './roadPaint';
import { hash2 } from '../engine/rng';
import { Terrain } from '../world/tiles';

let map: LandscapeMap,
  relief: TerrainRelief,
  samples: Uint8ClampedArray,
  reduced: Uint8ClampedArray;
// No map yet: every job is turned away until the first one arrives.
let version = -1,
  tint = 0xffffff;
/** The towns' paving: the paved tiles and the doorsteps, with the outline drawn from them. */
let paving = new TownPaving(0, 0, 0, 0, []);
/** The buildings' yards and door paths (buildingYard.ts). */
let yards = new BuildingYards(0, 0, 0, 0, []);
/** The roads (roadPaint.ts), none on the paving. */
let roads = new RoadPaint(0, 0, 0, 0, []);
/** The roads on the paving alone: the lanes of setts laid along them (townPaving.ts). */
let lanes = new RoadPaint(0, 0, 0, 0, []);
// Where snow starts, by biome id: sent by the landscape, as this worker cannot read the content.
let snowLevels: readonly number[] = [];
/** Rivers, falls and glaciers of the map (waterPaint.ts). */
let channels: Channels;
/** The sheet the current job reads, for `wildTexel`. */
let sheet: Uint8ClampedArray;
const readSheet = (material: number, u: number, v: number, out: number[]) =>
  wildTexel(sheet, material, u, v, out);
const river: RiverPoint = { water: 0, still: 0, bank: 0 };
const lay: Lay = { r: 0, g: 0, b: 0, a: 0, dark: 0 };
self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  try {
    if (data.url) {
      const response = await fetch(data.url);
      if (!response.ok) throw Error(`Terrain surfaces: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      samples = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      reduced = halve(samples, canvas.width, canvas.height);
      shareSurfaceDetail(samples, reduced);
      await loadWild(data.url);
      self.postMessage({ loaded: true });
      return;
    }
    if (data.map) {
      map = data.map;
      relief = data.relief;
      channels = channelsOf(map, relief.style.step, relief.tiles ?? undefined);
      version = data.version;
      tint = data.tint;
      paving = new TownPaving(
        map.w,
        map.h,
        map.originX,
        map.originY,
        data.city,
        data.doorsteps ?? [],
      );
      yards = new BuildingYards(map.w, map.h, map.originX, map.originY, data.yards ?? []);
      const town = paving;
      roads = new RoadPaint(map.w, map.h, map.originX, map.originY, data.roads ?? [], (k) =>
        town.paved(k),
      );
      lanes = new RoadPaint(
        map.w,
        map.h,
        map.originX,
        map.originY,
        data.roads ?? [],
        (k) => !town.paved(k),
      );
      snowLevels = data.snowLevels;
      return;
    }
    const { x, y, w, h, id } = data,
      scale: number = data.scale ?? 1;
    // A job for a map this worker does not have is answered, never dropped: the landscape waits
    // for an answer before it hands the chunk out again.
    if (data.version !== version) {
      self.postMessage({ stale: true, id, scale, version: data.version });
      return;
    }
    const started = performance.now(),
      // Chunks drawn at one pixel per world pixel read a half-size copy, so they stay filtered.
      source = scale > 1 ? samples : reduced;
    sheet = source;
    const left = (x - y - h) * 32 - 4,
      top = (x + y - 1) * 16 - RELIEF_MAX - 5;
    const width = ((w + h) * 32 + 8) * scale,
      height = ((w + h) * 16 + RELIEF_MAX + 12) * scale;
    const canvas = new OffscreenCanvas(width, height),
      ctx = canvas.getContext('2d')!;
    const pixels = new Uint8ClampedArray(width * height * 4),
      color = [0, 0, 0],
      part = [0, 0, 0],
      wet = [0, 0, 0],
      blend = new Array<number>(12);
    let raised = false;
    for (let ty = Math.max(0, y - 2); ty < Math.min(map.h, y + h + 3) && !raised; ty++)
      for (let tx = Math.max(0, x - 2); tx < Math.min(map.w, x + w + 3); tx++)
        if (relief.centres[ty * map.w + tx] > 0) {
          raised = true;
          break;
        }
    for (let py = 0; py < height; py += 1)
      for (let px = 0; px < width; px += 1) {
        const sx = left + (px + 0.5) / scale,
          sy = top + (py + 0.5) / scale,
          bx = sx / 64 + sy / 32,
          by = sy / 32 - sx / 64;
        const z = raised ? surfaceAlongRay(map, relief, bx, by, 10) : 0;
        const tx = bx + z / 32,
          ty = by + z / 32;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        if (tx < x - 0.57 || ty < y - 0.57 || tx >= x + w - 0.43 || ty >= y + h - 0.43) continue;
        const wx = tx + map.originX,
          wy = ty + map.originY;
        const tileIndex = Math.round(ty) * map.w + Math.round(tx),
          terrain = map.terrain[tileIndex],
          paved = paving.paved(tileIndex),
          // How far inside the towns' paving this lies (tiles, townPaving.ts); well inside it the
          // paving alone shows and the ground under it is not painted.
          pave = paving.near(tileIndex) ? paving.distance(tx, ty) : -PAVING_FAR,
          solid = pave >= PAVING_SOLID;
        // Pilot: the climate's own ground between the stones (desert sand, taiga moss...).
        const stoneGround = relief.style.biomeTops ? stoneGroundAt(map, tileIndex) : 0;
        color[0] = color[1] = color[2] = 0;
        // Water keeps its colours under the season's tint, and so does the paving (below). The
        // water's share is the waterline bridges cut their supports to (paintedWater): none on a
        // town's tile, which is paved over its water too.
        const waterWeight = solid ? 0 : paintedWater(map, tx, ty, paved, blend);
        // Tile-face style: rock shows where the slope is steep, not in random islands.
        let steep: number | undefined,
          slope = 0,
          // levels the surface climbs per tile here, once read
          levels = -1;
        if (!solid && relief.style.faces && relief.style.rockFaces !== false && raised) {
          faceGradient(tx, ty);
          levels = Math.hypot(gradient[0], gradient[1]) / relief.style.step;
          if (relief.tiles && !relief.style.everyBankRock) {
            // Terraces: a one-level bank stays grassy with the odd outcrop; banks stacked two
            // levels within about a tile, or on mountains, are rock.
            const bank = unit((levels - 0.8) / 0.6);
            slope = unit((levels - 0.3) / 0.7);
            if (bank > 0) {
              const stacked =
                terrain === Terrain.Mountain ? 1 : unit((levelSpan(tx, ty) - 1.4) / 0.4);
              const outcrop = unit(
                (surfaceNoise(wx * 1.4, wy * 1.4, 631) -
                  0.6 +
                  (surfaceNoise(wx * 5, wy * 5, 637) - 0.5) * 0.12) /
                  0.1,
              );
              steep = bank * Math.max(stacked, outcrop);
            } else steep = 0;
          } else
            steep = unit((levels - 1.4 + (surfaceNoise(wx * 3, wy * 3, 617) - 0.5) * 0.6) / 0.4);
        }
        for (let m = 0; m < 4 && !solid; m++) {
          const weight = blend[m + 4];
          if (!weight) continue;
          let material = blend[m];
          // Under a town's paving its water is its own ground, which worn setts show.
          if (paved && material === Material.Water) material = pavedGround(tx, ty);
          if (z > 2 && terrain === Terrain.Mountain && material === 7) material = Material.HighRock;
          const tile = blend[m + 8];
          // A river is narrower than its tile: the ground beside it is its neighbours', damp.
          let channel = 0;
          if (material === Material.Water && isRiver(map, tile)) {
            riverAt(channels, map, tile, tx, ty, river);
            channel = river.water;
            material = bankMaterial(map, tile, tx, ty);
          } else if (map.terrain[tile] === Terrain.Ice)
            channel = iceAt(channels, map, tile, tx, ty);
          surfaceColor(
            source,
            material,
            wx,
            wy,
            part,
            EXPOSED[material] ? steep : undefined,
            stoneGround,
          );
          if (map.terrain[tile] === Terrain.Ice) {
            if (channel > 0) {
              surfaceColor(source, Material.Ice, wx, wy, wet);
              for (let c = 0; c < 3; c++) part[c] += (wet[c] - part[c]) * channel;
            }
          } else if (material !== Material.Water && channels.iced[tile]) {
            const rubble = moraineAt(map, tile, tx, ty);
            if (rubble > 0) {
              surfaceColor(source, Material.Moraine, wx, wy, wet);
              for (let c = 0; c < 3; c++) part[c] += (wet[c] - part[c]) * rubble;
            }
          } else if (blend[m] === Material.Water && isRiver(map, tile) && !paved) {
            if (river.bank > 0 && channel < 1) {
              surfaceColor(source, Material.Bank, wx * 2, wy * 2, wet);
              for (let c = 0; c < 3; c++) {
                const damp = part[c] * 0.8 + (wet[c] - BANK_MEAN[c]) * 0.33;
                part[c] += (damp - part[c]) * 0.8 * river.bank;
              }
            }
            if (channel > 0) {
              surfaceColor(source, Material.River, wx, wy, wet);
              if (river.still > 0) {
                const r = wet[0];
                const g = wet[1];
                const b = wet[2];
                surfaceColor(source, Material.Water, wx, wy, wet);
                wet[0] = r + (wet[0] - r) * river.still;
                wet[1] = g + (wet[1] - g) * river.still;
                wet[2] = b + (wet[2] - b) * river.still;
              }
              for (let c = 0; c < 3; c++) part[c] += (wet[c] - part[c]) * channel;
            }
          }
          for (let c = 0; c < 3; c++) color[c] += part[c] * weight;
        }
        // A building's yard and its door paths are worn into its ground (buildingYard.ts), under
        // the paving; they keep out of the water and off a steep bank, as a yard is level ground.
        if (!solid && yards.near(tileIndex)) {
          yards.weigh(tx, ty, tileIndex);
          if (yards.touched) {
            if (raised && levels < 0) {
              faceGradient(tx, ty);
              levels = Math.hypot(gradient[0], gradient[1]) / relief.style.step;
            }
            const bank = raised ? unit((levels - 0.25) / 0.35) : 0;
            yards.paint(tx, ty, color, (1 - waterWeight) * (1 - bank), tint, source, part);
          }
        }
        // A road is painted over the yards and under the paving (roadPaint.ts), out of the water
        // but over the bank up to a bridge deck's end; it fades out over the paving's fringe,
        // short of its outline.
        if (!solid && roads.near(tileIndex) && roads.weigh(tx, ty, tileIndex) > 0) {
          const wet = waterWeight * (1 - roads.abutment(tx, ty, tileIndex));
          roads.paint(tx, ty, color, (1 - wet) * pavingFade(pave), tint, waterWeight);
        }
        let shade = 1;
        if (raised && relief.style.faces) shade = faceShade(tx, ty);
        else if (raised) {
          const dx =
            (reliefHeight(map, relief, tx + 0.65, ty) - reliefHeight(map, relief, tx - 0.65, ty)) /
            1.3;
          const dy =
            (reliefHeight(map, relief, tx, ty + 0.65) - reliefHeight(map, relief, tx, ty - 0.65)) /
            1.3;
          shade = Math.max(0.83, Math.min(1.12, 1 + dx * 0.012 - dy * 0.015));
        }
        snowed = 0;
        // The paving is lit by its level like the ground, the solid middle too, so the line from
        // which the ground under it is not painted shows no step; snow goes on painted ground only.
        if (raised && waterWeight < 1) {
          // Grass on a slope reads a shade apart from grass on the flat.
          const bankGrass = relief.style.bankGrass;
          if (bankGrass && slope > 0) {
            const k = slope * (1 - (steep ?? 0)) * bankGrass.amount,
              tone = BANK_TONES[bankGrass.tone];
            for (let c = 0; c < 3; c++) color[c] *= 1 + (tone[c] - 1) * k;
          }
          shade *= previewLooks(
            tx,
            ty,
            z,
            wx,
            wy,
            snowLineAt(map, snowLevels, tileIndex),
            steep ?? 0,
            solid || terrain === Terrain.Ice ? null : color,
            waterWeight,
            source,
          );
        }
        if (pave > -PAVING_FRINGE) {
          // The ground under the season's tint, then the paving, or the packed earth just outside
          // it, over its land: neither reaches into water.
          const land = 1 - waterWeight;
          for (let c = 0; c < 3; c++)
            color[c] *= waterWeight + (land * ((tint >> (16 - c * 8)) & 255)) / 255;
          if (pave > 0) {
            // a road across the square runs on as a lane of setts laid along it
            if (lanes.near(tileIndex)) {
              const lane = lanes.centre(tx, ty, tileIndex);
              paving.paint(tx, ty, pave, color, scale, part, lane, lanes.axis(tx, ty, tileIndex));
            } else paving.paint(tx, ty, pave, color, scale, part);
            for (let c = 0; c < 3; c++) color[c] = (color[c] + (part[c] - color[c]) * land) * shade;
          } else {
            const earth = paving.fringe(tx, ty, pave) * land;
            for (let c = 0; c < 3; c++)
              color[c] = (color[c] + (FRINGE_EARTH[c] - color[c]) * earth) * shade;
          }
        } else
          for (let c = 0; c < 3; c++)
            color[c] *=
              shade * (waterWeight + ((1 - waterWeight) * ((tint >> (16 - c * 8)) & 255)) / 255);
        // Snow and ice stay under the cursor's white, however high they lie.
        if (terrain === Terrain.Ice || snowed > 0)
          for (let c = 0; c < 3; c++) color[c] = Math.min(color[c], SNOW_CAP[c]);
        // A fall's cascade and an ice front go over the lit ground: they are water and ice, the
        // light is their own.
        if (channels.any) {
          const falls = channels.falls.get(tileIndex);
          const fronts = channels.fronts.get(tileIndex);
          if (falls || fronts) {
            lay.a = lay.dark = 0;
            if (falls)
              for (const f of falls) fallAt(f, map, tx, ty, z, waterWeight, readSheet, lay);
            if (fronts) for (const f of fronts) frontAt(f, tx, ty, z, readSheet, lay);
            const ground = 1 - lay.dark;
            for (let c = 0; c < 3; c++) color[c] *= ground;
            if (lay.a > 0) {
              color[0] += (lay.r - color[0]) * lay.a;
              color[1] += (lay.g - color[1]) * lay.a;
              color[2] += (lay.b - color[2]) * lay.a;
            }
          }
        }
        const k = (py * width + px) * 4;
        pixels[k] = color[0];
        pixels[k + 1] = color[1];
        pixels[k + 2] = color[2];
        pixels[k + 3] = 255;
      }
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    // Identical world-seeded strokes overlap without extending chunk alpha boundaries.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const tufts: number[] = [];
    const ox = map.originX,
      oy = map.originY;
    const tinted = (r: number, g: number, b: number, a: number) =>
      `rgba(${Math.round((r * ((tint >> 16) & 255)) / 255)},${Math.round((g * ((tint >> 8) & 255)) / 255)},${Math.round((b * (tint & 255)) / 255)},${a})`;
    for (
      let iy = Math.floor((y + oy - 0.7) / 0.18);
      iy <= Math.ceil((y + h + oy + 0.7) / 0.18);
      iy++
    )
      for (
        let ix = Math.floor((x + ox - 0.7) / 0.18);
        ix <= Math.ceil((x + w + ox + 0.7) / 0.18);
        ix++
      ) {
        if (hash2(ix, iy, 238) > grassDetail(ix * 0.18, iy * 0.18) * 0.34) continue;
        const tx = ix * 0.18 - ox + (hash2(ix, iy, 111) - 0.5) * 0.15,
          ty = iy * 0.18 - oy + (hash2(ix, iy, 114) - 0.5) * 0.15;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        // none on the paving, nor on the packed earth round it, nor on a building's yard, nor on a
        // road's core (on its soft edge they may grow)
        if (onPaving(tx, ty, -0.1) || onYard(tx, ty) || onRoad(tx, ty)) continue;
        const material = surfaceMaterial(map, tx, ty);
        if (![0, 1, 3, 4, 7].includes(material)) continue;
        if (material === 7 && rockExposure(tx + ox, ty + oy) > 0.45) continue;
        // no grass grows through snow
        const tile = Math.round(ty) * map.w + Math.round(tx);
        const line = snowLineAt(map, snowLevels, tile) - 0.25;
        if (reliefHeight(map, relief, tx, ty) / relief.style.step >= line) continue;
        const sx = (tx - ty) * 32 - left,
          sy = (tx + ty) * 16 - reliefHeight(map, relief, tx, ty) - top;
        const length = 1.6 + hash2(ix, iy, 17) * 1.5;
        if (tx >= x - 0.5 && ty >= y - 0.5 && tx < x + w - 0.5 && ty < y + h - 0.5)
          tufts.push(sx, sy, length, material === 1 ? 1 : 0);
      }
    // Small stones are baked into the same terrain image, never spawned as objects.
    for (let iy = Math.floor((y + oy - 0.7) / 0.4); iy <= Math.ceil((y + h + oy + 0.7) / 0.4); iy++)
      for (
        let ix = Math.floor((x + ox - 0.7) / 0.4);
        ix <= Math.ceil((x + w + ox + 0.7) / 0.4);
        ix++
      ) {
        const r = hash2(ix, iy, 812);
        if (r > 0.045) continue;
        const tx = ix * 0.4 - ox + (hash2(ix, iy, 819) - 0.5) * 0.3,
          ty = iy * 0.4 - oy + (hash2(ix, iy, 817) - 0.5) * 0.3;
        if (tx < -0.5 || ty < -0.5 || tx >= map.w - 0.5 || ty >= map.h - 0.5) continue;
        if (surfaceMaterial(map, tx, ty) === 5 || onPaving(tx, ty, -0.05) || onRoad(tx, ty))
          continue;
        const sx = (tx - ty) * 32 - left,
          sy = (tx + ty) * 16 - reliefHeight(map, relief, tx, ty) - top;
        const size = 0.8 + hash2(ix, iy, 82) * 1.1;
        ctx.fillStyle = tinted(88, 91, 70, 0.3);
        ctx.beginPath();
        ctx.ellipse(sx, sy + 0.3, size * 1.2, size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tinted(162, 160, 130, 0.66);
        ctx.beginPath();
        ctx.moveTo(sx - size, sy);
        ctx.lineTo(sx - size * 0.4, sy - size * 0.6);
        ctx.lineTo(sx + size * 0.7, sy - size * 0.45);
        ctx.lineTo(sx + size, sy + 0.2);
        ctx.lineTo(sx, sy + 0.45);
        ctx.closePath();
        ctx.fill();
      }
    const grass = new Float32Array(tufts);
    const output = ctx.getImageData(0, 0, width, height).data;
    self.postMessage(
      {
        id,
        version,
        left,
        top,
        width,
        height,
        scale,
        pixels: output,
        grass,
        tint,
        ms: performance.now() - started,
      },
      { transfer: [output.buffer, grass.buffer] },
    );
  } catch (error) {
    // The stack goes separately: Firefox's does not repeat the message.
    self.postMessage({
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
/**
 * The wild sheet beside the surface sheet at `url`, and its half-size copy. A painter without it
 * goes on with the plain materials (WILD_FALLBACK).
 */
async function loadWild(url: string) {
  try {
    const response = await fetch(url.replace('terrain-surfaces', 'wild-surfaces'));
    if (!response.ok) return;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const wild = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    shareWildSheet(samples, wild);
    shareWildSheet(reduced, halve(wild, canvas.width, canvas.height));
  } catch {
    // the plain materials stand in
  }
}
/** 2×2 box reduction of the packed surface sheet. */
function halve(pixels: Uint8ClampedArray, width: number, height: number) {
  const w = width >> 1,
    h = height >> 1,
    out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const k = (y * 2 * width + x * 2) * 4 + c;
        out[(y * w + x) * 4 + c] =
          (pixels[k] + pixels[k + 4] + pixels[k + width * 4] + pixels[k + width * 4 + 4] + 2) >> 2;
      }
  return out;
}
/** Does the towns' paving reach map point (x, y) on the map, to within `margin` tiles outside it? */
function onPaving(x: number, y: number, margin: number) {
  return paving.near(Math.round(y) * map.w + Math.round(x)) && paving.distance(x, y) > margin;
}
/** Is map point (x, y) well inside a building's yard or on a door path? */
function onYard(x: number, y: number) {
  const k = Math.round(y) * map.w + Math.round(x);
  return yards.near(k) && yards.weigh(x, y, k) > 0.5;
}
/** Is map point (x, y) on a road's core, inside its soft edge? */
function onRoad(x: number, y: number) {
  return roads.onCore(x, y, Math.round(y) * map.w + Math.round(x));
}
/**
 * The ground under the paving of the town's tile at (x, y) where its blend reads water: the tile's
 * own land (a town's tile is never water; grass if the map says otherwise).
 */
function pavedGround(x: number, y: number) {
  const own = materialAt(map, Math.round(x), Math.round(y));
  return own === Material.Water ? Material.Grass : own;
}
/** Materials whose rock exposure follows the slope (materials 0, 1, 3, 4, 7, 9 and the high rock). */
const EXPOSED = [1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
/** The bank swatch's mean colour: its gravel shows as light and dark about this. */
const BANK_MEAN = [118, 108, 92];
const gradient = [0, 0];
/** Surface slope in world pixels per tile at (x, y): the analytic derivative of its corners. */
function faceGradient(x: number, y: number) {
  const tx = Math.floor(x + 0.5),
    ty = Math.floor(y + 0.5),
    u = x - tx + 0.5,
    v = y - ty + 0.5,
    stride = map.w + 1,
    k = ty * stride + tx,
    c = relief.corners,
    step = relief.style.step;
  gradient[0] = gradient[1] = 0;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  if (relief.tiles) {
    // Terraces: the rounded banks have no corner formula; measure the surface itself.
    const d = 0.05;
    gradient[0] =
      (reliefHeight(map, relief, x + d, y) - reliefHeight(map, relief, x - d, y)) / (2 * d);
    gradient[1] =
      (reliefHeight(map, relief, x, y + d) - reliefHeight(map, relief, x, y - d)) / (2 * d);
    return;
  }
  const a = c[k] * step,
    b = c[k + 1] * step,
    d = c[k + stride + 1] * step,
    e = c[k + stride] * step;
  gradient[0] = b - a + (a - b - e + d) * v;
  gradient[1] = e - a + (a - b - e + d) * u;
}
/**
 * Light from the tile's own surface slope, so each elevated tile reads as a face and slopes
 * change visibly at tile edges. Upper-left light.
 */
function faceShade(x: number, y: number) {
  faceGradient(x, y);
  let shade = Math.max(0.68, Math.min(1.24, 1 + gradient[0] * 0.016 - gradient[1] * 0.019));
  if (relief.style.rims) {
    // Curvature: convex slope tops catch light, concave feet sit in soft shadow.
    const d = 0.12,
      h = reliefHeight(map, relief, x, y),
      curve =
        (reliefHeight(map, relief, x + d, y) +
          reliefHeight(map, relief, x - d, y) +
          reliefHeight(map, relief, x, y + d) +
          reliefHeight(map, relief, x, y - d) -
          4 * h) /
        (d * d);
    shade *= Math.max(0.8, Math.min(1.16, 1 - curve * 0.0004));
  }
  return shade;
}
/** Smoothstep of t clamped to 0..1. */
function unit(t: number) {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}
/** How many levels the surface spans within three quarters of a tile around (x, y). */
function levelSpan(x: number, y: number) {
  const d = 0.75,
    hs = [
      reliefHeight(map, relief, x, y),
      reliefHeight(map, relief, x + d, y),
      reliefHeight(map, relief, x - d, y),
      reliefHeight(map, relief, x, y + d),
      reliefHeight(map, relief, x, y - d),
    ];
  return (Math.max(...hs) - Math.min(...hs)) / relief.style.step;
}
/** Colour multipliers for grass on a slope (`ReliefStyle.bankGrass`). */
const BANK_TONES = {
  dry: [1.1, 1.04, 0.84],
  dark: [0.88, 0.92, 0.95],
  lush: [0.9, 1.02, 0.86],
};
const snowColor = [0, 0, 0];
/** How much snow the last point took, and the brightest snow and ice may be: #DCE1E4. */
let snowed = 0;
const SNOW_CAP = [220, 225, 228];
/**
 * Looks from the relief style (the shipped style has the height light and snow): higher levels
 * paint lighter (ground level unchanged), snow patches from the tile's snow line and full snow a
 * level above, and a cast shadow darkens ground that a higher tile hides from the upper-left light.
 * Snow goes on `color`, the ground's colour, which is null where the ground is not painted (under
 * solid paving). Returns the shading factor.
 */
function previewLooks(
  x: number,
  y: number,
  z: number,
  wx: number,
  wy: number,
  snowLine: number,
  steep: number,
  color: number[] | null,
  water: number,
  source: Uint8ClampedArray,
) {
  const style = relief.style,
    level = Math.max(0, z / style.step);
  let factor = 1;
  if (style.heightLight) factor *= 1 + style.heightLight * level;
  if (style.snow && color) {
    const above = level - snowLine,
      // Half cover (patches) on the snow line's level, full cover from the level above.
      cover = 0.5 * unit((above + 0.25) / 0.25) + 0.5 * unit((above - 0.75) / 0.25);
    if (cover > 0) {
      const n =
          surfaceNoise(wx * 1.3, wy * 1.3, 641) * 0.8 + surfaceNoise(wx * 6, wy * 6, 643) * 0.2,
        // Patchy snow keeps off steep rock; full snow covers everything.
        amount = unit((cover - n) / 0.06) * (cover < 0.99 ? 1 - 0.6 * steep : 1);
      // none on water: a river stays open above the snow line
      const snow = amount * (1 - water);
      snowed = snow;
      if (snow > 0) {
        surfaceColor(source, Material.Snow, wx, wy, snowColor);
        for (let c = 0; c < 3; c++) color[c] += (snowColor[c] - color[c]) * snow;
      }
    }
  }
  if (style.shadows) {
    const d = 0.4,
      over = (reliefHeight(map, relief, x - d, y) - z - d * style.step * 0.9) / style.step;
    factor *= 1 - 0.24 * unit(over / 0.6);
  }
  return factor;
}
