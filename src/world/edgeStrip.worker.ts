import { edgeStripOf, type EdgeStripRequest } from './edgeStrip';
import { generatorOf } from '../sim/ground';

/**
 * Builds the edge strip away from the page: generating a map one ring bigger takes longer than a
 * frame. It gets one request, answers with the strip, or null when the build threw, and is done.
 */
self.onmessage = (event: MessageEvent<EdgeStripRequest>) => {
  const req = event.data;
  try {
    const strip = edgeStripOf(req, generatorOf(req.chain));
    self.postMessage(strip, { transfer: [strip.terrain.buffer, strip.levels.buffer] });
  } catch (e) {
    console.error(e);
    self.postMessage(null);
  }
};
