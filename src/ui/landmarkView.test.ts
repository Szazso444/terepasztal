import { describe, expect, it } from 'vitest';
import { content } from '../data/content';
import { LANDMARK_STAGES, type LandmarkItem, type LandmarkStage } from '../sim/landmarks';
import { WIND_LEVELS } from '../sim/wind';
import { STR } from '../strings';
import {
  conditionHolds,
  effectLine,
  landmarkView,
  shownName,
  type LandmarkWorld,
} from './landmarkView';

const DAY: LandmarkWorld = { hour: 12, wind: 'calm', reason: '' };

function item(def: string, stage: LandmarkStage, rest: Partial<LandmarkItem> = {}): LandmarkItem {
  return { id: 1, def, x: 10, y: 10, region: [0, 0], stage, ...rest };
}

describe('landmark panel view', () => {
  it('shows nothing of a hidden landmark, and Unknown with the spotted line of a spotted one', () => {
    expect(landmarkView(item('bellkeepers_refuge', 'hidden'), DAY)).toBeNull();
    const v = landmarkView(item('bellkeepers_refuge', 'spotted'), DAY);
    expect(v?.title).toBe(STR.landmarks.unknown);
    expect(v?.story).toBe(STR.landmarks.spotted);
    expect(v?.paths).toEqual([]);
    expect(v?.actions).toEqual([]);
  });

  it('names and tells a surveyed one, with both paths and the two choices', () => {
    const v = landmarkView(item('bellkeepers_refuge', 'surveyed'), DAY);
    expect(v?.title).toBe(STR.landmarks.names.bellkeepers_refuge);
    expect(v?.story).toBe(STR.landmarks.stories.bellkeepers_refuge);
    expect(v?.paths.map((p) => p.id)).toEqual(['restore', 'salvage']);
    expect(v?.paths[0].cost).toContain('20');
    expect(v?.paths[1].cost).toBe(STR.landmarks.paths.salvageCost);
    expect(v?.actions).toEqual(['start', 'salvage']);
  });

  it('offers the picks of a restore that has them, each with its effect', () => {
    const v = landmarkView(item('ashen_conservatory', 'surveyed'), DAY);
    const picks = v?.paths[0].picks ?? [];
    expect(picks.length).toBeGreaterThan(1);
    for (const p of picks) {
      expect(p.id).toMatch(/^produce:|^boost$/);
      expect(p.label).toBeTruthy();
      expect(p.gives).toBeTruthy();
    }
    expect(v?.paths[0].gives).toBe('');
  });

  it('shows each cargo delivered and required while restoring, with the condition', () => {
    const v = landmarkView(
      item('stormglass_observatory', 'restoring', {
        path: 'restore',
        delivered: { stone: 15, iron: 20 },
      }),
      { ...DAY, wind: 'storm' },
    );
    expect(v?.progress.map((p) => p.share)).toEqual([0.5, 1]);
    expect(v?.progress[0].text).toContain('15');
    expect(v?.progress[0].text).toContain('30');
    expect(v?.condition?.holds).toBe(true);
    expect(v?.actions).toEqual(['salvage', 'cancel']);
    const calm = landmarkView(
      item('stormglass_observatory', 'restoring', { path: 'restore', delivered: {} }),
      DAY,
    );
    expect(calm?.condition?.holds).toBe(false);
    expect(calm?.condition?.state).toBe(STR.landmarks.conditions.waits);
  });

  it('says the night runs from 20:00 to 05:00 and the storm is the wind level', () => {
    for (const h of [20, 23, 0, 4]) expect(conditionHolds('night', h, 'calm')).toBe(true);
    for (const h of [5, 12, 19]) expect(conditionHolds('night', h, 'storm')).toBe(false);
    for (const w of WIND_LEVELS) expect(conditionHolds('storm', 12, w)).toBe(w === 'storm');
  });

  it('gives the effect once restored, with the pick chosen, and why a producer stops', () => {
    const boost = { kind: 'boost', strength: 2 } as const;
    const v = landmarkView(
      item('house_between_seasons', 'restored', { path: 'restore', pick: 'boost' }),
      DAY,
    );
    const def = content.landmarks.find((d) => d.id === 'house_between_seasons');
    const want = def?.restore.pick?.find((p) => p.kind === 'boost') ?? boost;
    expect(v?.effect).toBe(effectLine(want));
    const foundry = landmarkView(item('sleeping_foundry', 'restored', { path: 'restore' }), {
      ...DAY,
      reason: 'inputs',
    });
    expect(foundry?.reason).toBe(STR.landmarks.produceReasons.inputs);
    const ok = landmarkView(item('sleeping_foundry', 'restored', { path: 'restore' }), DAY);
    expect(ok?.reason).toBeNull();
  });

  it('shows the one-time reward of a salvaged one and no actions', () => {
    const v = landmarkView(item('flooded_archive', 'salvaged', { path: 'salvage' }), DAY);
    expect(v?.effect).toContain('2');
    expect(v?.actions).toEqual([]);
  });

  it('words every landmark of the content at every stage, with no empty line', () => {
    for (const def of content.landmarks)
      for (const stage of LANDMARK_STAGES) {
        const pick = def.restore.pick?.[0];
        const k = pick
          ? pick.kind === 'produce'
            ? `produce:${pick.cargo}`
            : pick.kind
          : undefined;
        const v = landmarkView(
          item(def.id, stage, {
            path: stage === 'salvaged' ? 'salvage' : 'restore',
            pick: k,
            delivered: {},
          }),
          DAY,
        );
        if (stage === 'hidden') {
          expect(v).toBeNull();
          continue;
        }
        const lines = [
          v?.title,
          v?.story,
          v?.stageName,
          v?.effect ?? 'x',
          ...(v?.paths.flatMap((p) => [p.name, p.cost]) ?? []),
          ...(v?.progress.map((p) => p.text) ?? []),
        ];
        for (const l of lines) expect(l, `${def.id} ${stage}`).toBeTruthy();
        expect(shownName(item(def.id, stage))).toBe(v?.title);
      }
  });
});
