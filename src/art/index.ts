import type { AtlasGenerator } from '../engine/atlas';
import { generateTerrainAtlas } from './terrain';
import { generatePropsAtlas } from './props';
import { generateIllustratedTrackAtlas } from './trackIllustrated';
import { loadTrackMaterials } from './trackMaterials';
import { generateStructuresAtlas } from './structures';
import { generateRollingAtlas, generateWagonAtlas } from './rolling';
import { generateFxAtlas } from './fx';
import { generateIconsAtlas } from './icons';
import { generatePeopleAtlas } from './people';
import { generateTunnelAtlas } from './tunnelArt';

/**
 * Atlas groups. A real `/public/assets/<name>.png` + `.json` pair overrides the generator for that
 * group only; frame names inside must match the ones the generators emit.
 */
export const ATLAS_GROUPS: { name: string; generate: AtlasGenerator }[] = [
  { name: 'terrain', generate: generateTerrainAtlas },
  { name: 'props', generate: generatePropsAtlas },
  // the painted track materials, where they load (public/assets/track-materials)
  {
    name: 'track',
    generate: async () =>
      generateIllustratedTrackAtlas(await loadTrackMaterials(import.meta.env.BASE_URL)),
  },
  { name: 'structures', generate: generateStructuresAtlas },
  { name: 'rolling', generate: generateRollingAtlas },
  { name: 'wagons', generate: generateWagonAtlas },
  { name: 'fx', generate: generateFxAtlas },
  { name: 'icons', generate: generateIconsAtlas },
  { name: 'people', generate: generatePeopleAtlas },
  // placeholder tunnel frames: the glass rooms, the portal throat and ring, brick and coping
  { name: 'tunnel', generate: generateTunnelAtlas },
  // Illustrated bridge kit (tools/bridge-kit.mjs); without the file, bridges stay procedural.
  { name: 'bridges', generate: emptyAtlas },
];

function emptyAtlas() {
  const image = document.createElement('canvas');
  image.width = image.height = 1;
  return { image, frames: {} };
}
