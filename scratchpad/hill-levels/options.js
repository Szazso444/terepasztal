// Preview only: swaps the relief style of the running review scene and repaints every chunk.
import { buildRelief } from '/src/render/terrainRelief.ts';

export function reliefStyle(game, style) {
  const l = game.world.landscape;
  l.updateHeights = function () {
    if (this.heightsDirty) {
      this.relief = buildRelief(this.map, this.flat, style, this.rails);
      this.heightsDirty = false;
    }
  };
  l.heightsDirty = true;
  l.invalid = true;
  l.allDirty = true;
  // A dirty tile makes the renderer move props, buildings and summit caps onto the new surface.
  l.dirtyTiles.push({ x: 0, y: 0 });
}
