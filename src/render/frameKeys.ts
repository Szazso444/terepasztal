import type { AtlasRegistry } from '../engine/atlas';
import type { BogieKind, PartKind } from '../sim/body';
import { FACINGS } from '../sim/body';
import type { LocoDef, WagonDef } from '../data/content';
import { bogieFrame, loadFrame, locoFrame, wagonFrame } from '../art/frames';

/** A list of frame keys by facing. */
export type KeysByFacing = readonly string[];

function byFacing(frame: (facing: number) => string): KeysByFacing {
  return Array.from({ length: FACINGS }, (_, f) => frame(f));
}

/**
 * The rolling stock's frame keys by facing, each list worked out once: `locoFrame` and its kin
 * build their names and fallbacks anew on every call, and a train asks for every sprite, every
 * frame. The atlas is complete before the train renderer exists, so a key never changes.
 */
export class FrameKeys {
  private readonly kept = new Map<unknown, Map<unknown, Map<unknown, KeysByFacing>>>();
  constructor(private readonly atlas: Pick<AtlasRegistry, 'has'>) {}

  loco(def: LocoDef, part: PartKind) {
    return (
      this.find(def, part, null) ??
      this.keep(
        def,
        part,
        null,
        byFacing((f) => locoFrame(this.atlas, def, f, part)),
      )
    );
  }
  wagon(def: WagonDef) {
    return (
      this.find(def, null, null) ??
      this.keep(
        def,
        null,
        null,
        byFacing((f) => wagonFrame(this.atlas, def, f)),
      )
    );
  }
  bogie(style: string | undefined, kind: BogieKind, narrow: boolean) {
    return (
      this.find(style, kind, narrow) ??
      this.keep(
        style,
        kind,
        narrow,
        byFacing((f) => bogieFrame(this.atlas, style, kind, f, narrow)),
      )
    );
  }
  load(kind: string, thin: boolean) {
    return (
      this.find('load', kind, thin) ??
      this.keep(
        'load',
        kind,
        thin,
        byFacing((f) => loadFrame(kind, f, thin)),
      )
    );
  }

  private find(a: unknown, b: unknown, c: unknown) {
    return this.kept.get(a)?.get(b)?.get(c);
  }
  private keep(a: unknown, b: unknown, c: unknown, keys: KeysByFacing) {
    let inA = this.kept.get(a);
    if (!inA) this.kept.set(a, (inA = new Map()));
    let inB = inA.get(b);
    if (!inB) inA.set(b, (inB = new Map()));
    inB.set(c, keys);
    return keys;
  }
}
