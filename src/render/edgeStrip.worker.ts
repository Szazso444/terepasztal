import { edgeStripOf, type EdgeStripRequest } from '../world/edgeStrip';
import { regionOf, type GameMap } from '../world/tiles';
import { generatorOf } from '../sim/ground';
import { meshBuffers, stripMeshes } from './edgeStripMesh';

/** What the worker is given: the build, and the region grid of the map, to file the blocks by. */
export interface EdgeStripJob {
  req: EdgeStripRequest;
  regions: Pick<GameMap, 'regionSize' | 'regionsX'>;
}

/**
 * Builds the edge strip away from the page: generating a map one ring bigger takes longer than a
 * frame, and so does working out its shape. It gets one job, answers with the shape (`StripMesh`),
 * or null when the build threw, and is done.
 */
self.onmessage = (event: MessageEvent<EdgeStripJob>) => {
  const { req, regions } = event.data;
  try {
    const strip = edgeStripOf(req, generatorOf(req.chain));
    const meshes = stripMeshes(strip, (x, y) => regionOf(regions, x, y));
    self.postMessage(meshes, { transfer: meshBuffers(meshes) });
  } catch (e) {
    console.error(e);
    self.postMessage(null);
  }
};
