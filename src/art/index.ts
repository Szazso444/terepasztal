import type { AtlasGenerator } from '../engine/atlas';
import { generateTerrainAtlas } from './terrain';
import { generatePropsAtlas } from './props';
import { generateTrackAtlas } from './track';
import { generateStructuresAtlas } from './structures';
import { generateRollingAtlas } from './rolling';
import { generateFxAtlas } from './fx';

/**
 * Atlas groups. A real `/public/assets/<name>.png` + `.json` pair overrides the generator for that
 * group only; frame names inside must match the ones the generators emit.
 */
export const ATLAS_GROUPS: { name: string; generate: AtlasGenerator }[] = [
  { name: 'terrain', generate: generateTerrainAtlas },
  { name: 'props', generate: generatePropsAtlas },
  { name: 'track', generate: generateTrackAtlas },
  { name: 'structures', generate: generateStructuresAtlas },
  { name: 'rolling', generate: generateRollingAtlas },
  { name: 'fx', generate: generateFxAtlas },
];
