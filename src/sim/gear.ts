/**
 * Running gear as the model image draws it: each body part with its extent and its wheel groups,
 * as fractions of the whole locomotive's length (0 = rear end, 1 = front end), measured on the
 * image's near side. `gearSegments` scales it to a length in tiles and builds the rigid segments
 * the body poser stands on the track.
 */
import type { BogieKind, PartKind, SegmentSpec } from './body';

export interface GearPart {
  part: PartKind;
  from: number;
  to: number;
  /** axles fixed in this part's frame */
  rigid?: number[];
  /** swivelling trucks and bogies, each a list of its axles */
  trucks?: number[][];
  /** drawn back to front (a rear snout) */
  mirror?: boolean;
  /** indices into `trucks` of units that carry the frame (a Mallet's front engine) */
  carry?: number[];
  /**
   * A half of a hinged body: this end of it ('front' or 'rear', as the vehicle runs) rests on the
   * part next to it. The part is carried there, on the track's centre line, without a truck.
   */
  hinge?: 'front' | 'rear';
}
export interface Gear {
  parts: GearPart[];
}

function kindOf(axles: number): BogieKind {
  return axles >= 4 ? 'bogie4' : axles === 3 ? 'bogie3' : 'bogie';
}

/** Segments of a geared vehicle `L` tiles long, front part first. */
export function gearSegments(gear: Gear, L: number): SegmentSpec[] {
  const parts = [...gear.parts].sort((a, b) => b.to - a.to);
  return parts.map((p) => {
    const len = (p.to - p.from) * L;
    // distances behind this part's own front, front to rear. A part drawn back to front (a rear
    // snout) has its own front at the vehicle's rear: the body poser turns it round again.
    const behind = p.mirror ? (f: number) => (f - p.from) * L : (f: number) => (p.to - f) * L;
    const rigid = (p.rigid ?? []).map(behind).sort((a, b) => a - b);
    const trucks = (p.trucks ?? [])
      .map((axles, i) => ({
        at: behind(axles.reduce((a, b) => a + b, 0) / axles.length),
        kind: kindOf(axles.length),
        carries: p.carry?.includes(i) ?? false,
        src: i,
      }))
      .sort((a, b) => a.at - b.at);
    const seg: SegmentSpec = {
      part: p.part,
      L: len,
      W: len,
      nb: trucks.length,
      bogie: 'bogie',
      front: (1 - p.to) * L,
      mirror: p.mirror,
    };
    if (trucks.length) {
      seg.at = trucks.map((t) => t.at);
      seg.kinds = trucks.map((t) => t.kind);
      seg.truck = trucks.map((t) => t.src);
      seg.W = seg.at[seg.at.length - 1] - seg.at[0];
    }
    const carried = trucks.filter((x) => x.carries).map((x) => x.at);
    if (carried.length) seg.carry = carried;
    if (rigid.length >= 2) seg.rigid = rigid;
    else if (rigid.length === 1) {
      // one fixed axle: a truck that cannot swivel; carried like a pivot
      const all = [
        ...trucks.map((t) => ({ at: t.at, src: t.src })),
        { at: rigid[0], src: -1 },
      ].sort((a, b) => a.at - b.at);
      seg.at = all.map((x) => x.at);
      seg.kinds = seg.at.map(() => 'bogie');
      seg.truck = all.map((x) => x.src);
      seg.nb = seg.at.length;
    }
    if (p.hinge) {
      seg.hinge = p.hinge;
      const own = (seg.at ?? []).map((at, i) => ({
        at,
        kind: seg.kinds![i],
        src: seg.truck![i],
        hidden: false,
      }));
      const all = [
        ...own,
        {
          at: behind(p.hinge === 'front' ? p.to : p.from),
          kind: 'bogie' as BogieKind,
          src: -1,
          hidden: true,
        },
      ].sort((a, b) => a.at - b.at);
      seg.at = all.map((x) => x.at);
      seg.kinds = all.map((x) => x.kind);
      seg.truck = all.map((x) => x.src);
      seg.hidden = all.map((x) => x.hidden);
      seg.nb = all.length;
      seg.W = seg.at[seg.at.length - 1] - seg.at[0];
    }
    if (!seg.rigid && seg.nb < 2) {
      // no wheels of its own (a cab hung between two snouts): it rests on its two ends
      seg.at = [0, len];
      seg.kinds = ['bogie', 'bogie'];
      seg.hidden = [true, true];
      seg.truck = [-1, -1];
      seg.nb = 2;
      seg.W = len;
    }
    return seg;
  });
}
