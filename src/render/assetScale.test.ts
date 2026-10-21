import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import atlas from '../../public/assets/structures.json';
import { structureFrame } from '../art/frames';
import { generateStructuresAtlas } from '../art/structures';
import {
  AUTHOR_SCALE,
  DOOR_FRACTION,
  DOOR_PX,
  DOOR_REFERENCE_PX,
  EQUIPMENT_SCALE,
  PERSON_PX,
  structureFamily,
  structureScale,
  hasScaleReference,
  scaleReference,
  unturnedFrame,
  type FrameNames,
} from './assetScale';

it('pins the two heights: a standard door is 13.2 px and a person 9 px', () => {
  expect(DOOR_PX).toBe(13.2);
  expect(PERSON_PX).toBe(9);
});

it("keeps a common door height across packed building levels, before the author's pick", () => {
  let checked = 0;
  for (const [key, frame] of Object.entries(atlas.frames) as [string, { h: number }][]) {
    const family = structureFamily(key);
    if (!DOOR_FRACTION[family]) continue;
    const height = frame.h / atlas.resolution;
    const door =
      (height * DOOR_FRACTION[family] * structureScale(key, height)) /
      (AUTHOR_SCALE[key.replace('structures/', '')] ?? AUTHOR_SCALE[family] ?? 1);
    expect(door, key).toBeCloseTo(DOOR_PX, 5);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});

/**
 * How each family was measured on develop before the person got its own height (#296, decision
 * Q14 a: buildings stay as they are), as plain numbers. `before`, in the next block, reads the
 * module's own tables, so editing a table moves it with the code; these cannot move. A family not
 * named here is new, and its measure is Art's to give. Changing one named here changes every
 * building of its family on screen: that is a question for the author, not a number to update. A
 * family that has no frames left (the diesel refinery, once it is the Fuel Pump) may be taken out
 * of the table and of this list together.
 */
const BASELINE = {
  /** door height in the generated picture, px */
  doors: {
    station: 10.5,
    town: 10,
    townhouse: 18,
    warehouse: 11,
    farm: 12,
    lumber: 12,
    windmill: 13,
    grinder: 12,
  } as Record<string, number>,
  /** door aperture / illustrated frame height */
  fractions: {
    station: 36 / 169,
    town: 43 / 199,
    townhouse: 68 / 251,
    warehouse: 53 / 191,
    farm: 47 / 262,
    windmill: 38 / 240,
  } as Record<string, number>,
  /** declared scale of outdoor equipment with no door */
  declared: {
    water_tower: 0.7,
    fuel_stop: 0.65,
    kiln: 0.7,
    refinery: 1.1,
    power_plant: 1.1,
    quarry: 1,
    pump: 1,
    substation: 1,
    hydro_plant: 1,
    colliery: 1,
    ironworks: 1,
    oil_derrick: 1,
    diesel_refinery: 1,
    wire_mill: 1,
  } as Record<string, number>,
};
/**
 * The author's size pick of 2026-10-18 as plain numbers, pinned apart from `AUTHOR_SCALE` so that
 * editing the table cannot move them. A family not named here is drawn as the references give it.
 */
const PICK: Record<string, number> = {
  town: 1.2,
  station: 0.9,
  warehouse: 1.25,
  farm: 0.75,
  lumber: 0.9,
  quarry: 0.8,
  grinder: 0.8,
  power_plant: 1.2,
  substation: 0.9,
  colliery: 1.2,
  ironworks: 1.2,
  water_tower: 1.3,
  fuel_stop: 1.25,
};
/** Frames exempt from their family's pick: Town Hall L1 is sized by another path (about 1.36 doors). */
const EXEMPT: Record<string, number> = { town_1: 1 };
/** The pick a frame has: its own exemption, else its family's multiplier, else none. */
const pickOf = (frame: string) =>
  EXEMPT[frame.replace('structures/', '')] ?? PICK[structureFamily(frame)] ?? 1;
/**
 * The scale a frame had before the pick, from the numbers above and the 2.1 m door beside the
 * 11 px person.
 */
const referenceScale = (frame: string, illustratedHeight?: number) => {
  const family = structureFamily(frame);
  const fraction = BASELINE.fractions[family];
  const door =
    illustratedHeight && fraction ? illustratedHeight * fraction : BASELINE.doors[family];
  return door ? 13.2 / door : (BASELINE.declared[family] ?? 1);
};
/** The scale a frame has: what the references give, times the author's pick for its family. */
const baselineScale = (frame: string, illustratedHeight?: number) =>
  referenceScale(frame, illustratedHeight) * pickOf(frame);

describe('building scale', () => {
  /**
   * How a building was sized when the person and the door were one number: the door, 2.1 m beside
   * a 1.75 m person drawn 11 px, over the frame's own door. Written out here so a change to either
   * height cannot move it with them.
   */
  const before = (frame: string, illustratedHeight?: number) => {
    const family = structureFamily(frame);
    const door =
      illustratedHeight && DOOR_FRACTION[family]
        ? illustratedHeight * DOOR_FRACTION[family]
        : DOOR_REFERENCE_PX[family];
    const own = door ? ((2.1 / 1.75) * 11) / door : (EQUIPMENT_SCALE[family] ?? 1);
    return own * pickOf(frame);
  };

  it('is unchanged for every packed illustrated frame', () => {
    const frames = Object.entries(atlas.frames) as [string, { h: number }][];
    for (const [key, frame] of frames) {
      const height = frame.h / atlas.resolution;
      expect(structureScale(key, height), key).toBe(before(key, height));
      expect(structureScale(key), key).toBe(before(key));
    }
    expect(frames.length).toBeGreaterThan(50);
  });

  it('is unchanged for every family with a door or a declared estimate', () => {
    const families = new Set([
      ...Object.keys(DOOR_FRACTION),
      ...Object.keys(DOOR_REFERENCE_PX),
      ...Object.keys(EQUIPMENT_SCALE),
    ]);
    for (const family of families)
      for (const frame of [`structures/${family}`, `structures/${family}_lv2`]) {
        expect(structureScale(frame), frame).toBe(before(frame));
        expect(structureScale(frame, 100), frame).toBe(before(frame, 100));
      }
    expect(families.size).toBeGreaterThan(20);
  });

  it('keeps every measure a building family had', () => {
    // the tables may gain families, never lose or change one named in the baseline
    expect(DOOR_REFERENCE_PX).toMatchObject(BASELINE.doors);
    expect(DOOR_FRACTION).toMatchObject(BASELINE.fractions);
    expect(EQUIPMENT_SCALE).toMatchObject(BASELINE.declared);
    // and the door is the height it was derived as: a 2.1 m door beside a 1.75 m person of 11 px
    expect(DOOR_PX).toBe((2.1 / 1.75) * 11);
  });

  it('sizes every family as it was, at every level, stage, height and picture', () => {
    const families = new Set([
      ...Object.keys(BASELINE.doors),
      ...Object.keys(BASELINE.fractions),
      ...Object.keys(BASELINE.declared),
      'not_a_family',
    ]);
    for (const family of families)
      for (const suffix of ['', '_lv2', '_lv3', '_s1', '_3'])
        for (const height of [undefined, 40, 169, 199, 251, 262, 300]) {
          const frame = `structures/${family}${suffix}`;
          expect(structureScale(frame, height), `${frame} at ${height}`).toBe(
            baselineScale(frame, height),
          );
        }
    expect(families.size).toBeGreaterThan(20);
  });

  it('sizes every packed illustrated frame as it was', () => {
    const packed = Object.entries(atlas.frames) as [string, { h: number }][];
    for (const [key, frame] of packed) {
      const height = frame.h / atlas.resolution;
      expect(structureScale(key, height), key).toBe(baselineScale(key, height));
    }
    expect(packed.length).toBeGreaterThan(50);
  });

  it("is a door's height over the door in the picture, whoever stands beside it", () => {
    expect(structureScale('structures/townhouse_s1')).toBe(DOOR_PX / DOOR_REFERENCE_PX.townhouse);
    expect(structureScale('structures/station_1')).toBe(
      (DOOR_PX / DOOR_REFERENCE_PX.station) * AUTHOR_SCALE.station,
    );
    // a measured door: 36 of the station's 169 px, then the author's pick
    expect(structureScale('structures/station_1', 169)).toBeCloseTo(
      (DOOR_PX / 36) * AUTHOR_SCALE.station,
      9,
    );
  });
});

describe("the author's size pick", () => {
  const frames: FrameNames = { has: () => false };
  /** One representative frame per listed family; the sizes are measured the way the game does. */
  const REPRESENTATIVE: Record<string, string> = {
    town: 'structures/town_2',
    station: 'structures/station_2',
    warehouse: 'structures/warehouse_3',
    farm: 'structures/farm_1',
    lumber: 'structures/lumber_4',
    quarry: 'structures/quarry_2',
    grinder: 'structures/grinder_lv2',
    power_plant: 'structures/power_plant',
    substation: 'structures/substation_lv3',
    colliery: 'structures/colliery',
    ironworks: 'structures/ironworks_lv4',
    water_tower: 'structures/water_tower',
    fuel_stop: 'structures/fuel_stop',
  };

  it("pins the author's multipliers, family by family, and the frames exempt from them", () => {
    expect(AUTHOR_SCALE).toEqual({ ...PICK, ...EXEMPT });
    expect(Object.keys(REPRESENTATIVE).sort()).toEqual(Object.keys(PICK).sort());
  });

  it('exempts Town Hall L1 from the town pick, at every measure and turn, and no other town frame', () => {
    for (const height of [undefined, 199, 250]) {
      expect(structureScale('structures/town_1', height), `town_1 at ${height}`).toBe(
        referenceScale('structures/town_1', height),
      );
      for (const n of [2, 3, 4, 5])
        expect(
          structureScale(`structures/town_${n}`, height),
          `town_${n} at ${height}`,
        ).toBeCloseTo(referenceScale(`structures/town_${n}`, height) * 1.2, 12);
    }
    const turned: FrameNames = { has: (k) => k === 'structures/town_1' };
    expect(scaleReference(turned, 'structures/town_1_r2')).toEqual({
      family: 'town',
      scale: referenceScale('structures/town_1'),
    });
  });

  it("is today's size times the multiplier for a frame of each listed family", () => {
    for (const [family, frame] of Object.entries(REPRESENTATIVE)) {
      const today = referenceScale(frame);
      expect(structureFamily(frame), frame).toBe(family);
      expect(structureScale(frame), frame).toBeCloseTo(today * PICK[family], 12);
      expect(scaleReference(frames, frame), frame).toEqual({
        family,
        scale: structureScale(frame),
      });
      expect(scaleReference(frames, frame)?.scale, frame).toBeCloseTo(today * PICK[family], 12);
    }
  });

  it('reaches every level, stage and turn of a family, and a picture measured by its door', () => {
    for (const [family, multiplier] of Object.entries(PICK))
      for (const suffix of ['', '_lv2', '_lv4', '_s1', '_3'])
        for (const height of [undefined, 169, 262]) {
          const frame = `structures/${family}${suffix}`;
          expect(structureScale(frame, height), `${frame} at ${height}`).toBeCloseTo(
            referenceScale(frame, height) * multiplier,
            12,
          );
        }
    // a turn is sized by the frame it was turned from
    const turned: FrameNames = { has: (k) => k === 'structures/town_2' };
    expect(scaleReference(turned, 'structures/town_2_r1')?.scale).toBe(
      structureScale('structures/town_2'),
    );
  });

  it('leaves a family it does not name as the references give it', () => {
    for (const family of [
      'townhouse',
      'windmill',
      'kiln',
      'refinery',
      'pump',
      'hydro_plant',
      'oil_derrick',
      'diesel_refinery',
      'wire_mill',
    ]) {
      expect(AUTHOR_SCALE[family], family).toBeUndefined();
      const frame = `structures/${family}_lv2`;
      expect(structureScale(frame), frame).toBe(referenceScale(frame));
      expect(structureScale(frame, 200), frame).toBe(referenceScale(frame, 200));
    }
    expect(structureScale('structures/not_a_family')).toBe(1);
    expect(scaleReference(frames, 'structures/not_a_family')).toBeNull();
  });
});

describe('the Fuel Pump', () => {
  const frames: FrameNames = {
    has: (key) => ['structures/fuel_pump', 'structures/fuel_pump_lv2'].includes(key),
  };

  it('has a declared scale, in line with the equipment it stands beside', () => {
    expect(EQUIPMENT_SCALE.fuel_pump).toBeGreaterThanOrEqual(EQUIPMENT_SCALE.fuel_stop);
    expect(EQUIPMENT_SCALE.fuel_pump).toBeLessThanOrEqual(EQUIPMENT_SCALE.water_tower);
  });

  it('is drawn at that scale at every level and turn, before its art arrives', () => {
    const own = { family: 'fuel_pump', scale: EQUIPMENT_SCALE.fuel_pump };
    for (const frame of [
      'structures/fuel_pump',
      'structures/fuel_pump_lv2',
      'structures/fuel_pump_lv2_r1',
      'structures/fuel_pump_r3',
    ]) {
      expect(scaleReference(frames, frame), frame).toEqual(own);
    }
    expect(structureScale('structures/fuel_pump_lv2')).toBe(own.scale);
    expect(hasScaleReference('structures/fuel_pump_lv3')).toBe(true);
  });
});

it('requires an explicit calibration or declared estimate for every illustrated structure', () => {
  for (const key of Object.keys(atlas.frames)) expect(hasScaleReference(key), key).toBe(true);
});

/** Node has no ImageData or canvas: enough of both for the atlas packer to run. */
class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    this.width = typeof a === 'number' ? a : b;
    this.height = typeof a === 'number' ? b : (c ?? a.length / 4 / b);
    this.data = typeof a === 'number' ? new Uint8ClampedArray(a * b * 4) : a;
  }
}

describe('turned structure frames', () => {
  /** Every structure frame the game can draw: the generated group with the shipped file over it. */
  let names: Set<string>;
  const frames: FrameNames = { has: (key) => names.has(key) };

  // slow because it generates the whole structures atlas: 0.9 s alone, and a hook has a default of
  // its own (10 s) that a loaded machine can use up, so a limit of 60 s
  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: () => {} }),
      }),
    });
    names = new Set([
      ...Object.keys(generateStructuresAtlas().frames),
      ...Object.keys(atlas.frames),
    ]);
  }, 60_000);
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('are sized, patched and lit as the frame they were turned from', () => {
    let turns = 0,
      buildings = 0;
    for (const key of names)
      for (const rot of [1, 2, 3]) {
        const turned = structureFrame(frames, key, rot);
        if (turned === key) continue;
        turns++;
        const where = `${key} at rotation ${rot} (${turned})`;
        // family (window lights), reference (ground fit) and scale are the frame's own
        const own = hasScaleReference(key)
          ? { family: structureFamily(key), scale: structureScale(key) }
          : null;
        expect(scaleReference(frames, turned), where).toEqual(own);
        expect(scaleReference(frames, key), where).toEqual(own);
        // the turn leads back to its own frame, and that frame is not taken for a turn
        expect(unturnedFrame(frames, turned), where).toBe(key);
        expect(unturnedFrame(frames, key), where).toBe(key);
        if (own) buildings++;
      }
    // the walk reaches the turned pictures, buildings with a scale reference among them
    expect(turns).toBeGreaterThan(250);
    expect(buildings).toBeGreaterThan(200);
  });

  it('are sized as they were before the person had a height of its own', () => {
    let sized = 0;
    for (const key of names) {
      const family = structureFamily(key);
      if (!(
        family in BASELINE.doors ||
        family in BASELINE.fractions ||
        family in BASELINE.declared
      ))
        continue;
      // a generated picture is measured by its reference door, and so is each of its turns
      for (const rot of [0, 1, 2, 3]) {
        const drawn = rot ? structureFrame(frames, key, rot) : key;
        const where = `${drawn} (${key} at rotation ${rot})`;
        expect(scaleReference(frames, drawn)?.scale, where).toBe(baselineScale(key));
        sized++;
      }
    }
    expect(sized).toBeGreaterThan(200);
  });

  it("keep a wide station's axis frames as they were", () => {
    // `<art>_r<axis>[_lv<n>]` names an axis, not a turn: no frame is named without it
    const axes: Record<string, string> = {
      'structures/station_r1': 'station_r1',
      'structures/station_r0': 'station_r0',
      'structures/station_r1_lv2': 'station_r1',
      'structures/farm_r0': 'farm_r0',
      'structures/farm_r1_lv3': 'farm_r1',
      'structures/depot_r0': 'depot_r0',
      'structures/depot_r1': 'depot_r1',
      'structures/depot_r1_lv2': 'depot_r1',
      'structures/depot_narrow_r1': 'depot_narrow_r1',
    };
    for (const [key, family] of Object.entries(axes)) {
      expect(unturnedFrame(frames, key), key).toBe(key);
      expect(structureFamily(key), key).toBe(family);
      // none has a scale reference: drawn at scale 1, with no patches or lights
      expect(hasScaleReference(key), key).toBe(false);
      expect(scaleReference(frames, key), key).toBeNull();
    }
    // a wide frame's own turn is measured by it
    expect(unturnedFrame(frames, 'structures/depot_r0_r2')).toBe('structures/depot_r0');
    expect(unturnedFrame(frames, 'structures/depot_r1_lv2_r3')).toBe('structures/depot_r1_lv2');
    expect(unturnedFrame(frames, 'structures/depot_narrow_r1_r3')).toBe(
      'structures/depot_narrow_r1',
    );
  });

  it('read a turn only where the atlas has the frame it came from', () => {
    const only = (...keys: string[]): FrameNames => ({ has: (k) => keys.includes(k) });
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r2')).toBe('structures/kiln');
    expect(unturnedFrame(only(), 'structures/kiln_r2')).toBe('structures/kiln_r2');
    // `_r0` is never a turn, and a turn is only ever the last suffix
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r0')).toBe('structures/kiln_r0');
    expect(unturnedFrame(only('structures/kiln_lv2'), 'structures/kiln_lv2_r1')).toBe(
      'structures/kiln_lv2',
    );
    expect(unturnedFrame(only('structures/kiln'), 'structures/kiln_r1_lv2')).toBe(
      'structures/kiln_r1_lv2',
    );
  });
});
