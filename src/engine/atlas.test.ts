import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { AtlasRegistry, type AtlasImage } from './atlas';

// How a group's file pair can come back from the server. `ok` is a good pair; every other way
// leaves the group to its generator.
const WAYS = {
  ok: 'a good json and png',
  missing: 'json answers 404',
  html: 'json comes back as the html page',
  network: 'json fetch rejects',
  garbled: 'json does not parse',
  resolution: 'json resolution outside 1 to 8',
  png: 'png fails to load',
} as const;
type Way = keyof typeof WAYS;

/** The way each group's files come back in the current test, by group name. */
let served = new Map<string, Way>();

function respond(path: string): Promise<Response> {
  const [, name, ext] = /^\/assets\/(.+)\.(json|png)$/.exec(path)!;
  const way = served.get(name) ?? 'missing';
  if (ext !== 'json') throw new Error(`fetch is for the json only: ${path}`);
  const json = (body: string) =>
    new Response(body, { headers: { 'content-type': 'application/json' } });
  const frames = { [`${name}/a`]: { x: 0, y: 0, w: 2, h: 2, ax: 1, ay: 2 } };
  switch (way) {
    case 'missing':
      return Promise.resolve(new Response('', { status: 404 }));
    case 'html':
      return Promise.resolve(
        new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
      );
    case 'network':
      return Promise.reject(new TypeError('Failed to fetch'));
    case 'garbled':
      return Promise.resolve(json('{"frames":'));
    case 'resolution':
      return Promise.resolve(json(JSON.stringify({ frames, resolution: 12 })));
    default:
      return Promise.resolve(json(JSON.stringify({ frames })));
  }
}

/** An image element that loads the next tick, or fails for a group served with a bad png. */
class StubImage {
  width = 2;
  height = 2;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(path: string) {
    const name = /^\/assets\/(.+)\.png$/.exec(path)![1];
    setTimeout(() => (served.get(name) === 'png' ? this.onerror : this.onload)?.());
  }
}

/** A one-frame procedural atlas whose frame is named for the group. */
function generator(name: string) {
  return (): AtlasImage => ({
    image: { width: 1, height: 1 } as HTMLCanvasElement,
    frames: { [`${name}/a`]: { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 1 } },
  });
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  served = new Map();
  vi.stubGlobal('fetch', (path: string) => respond(path));
  vi.stubGlobal('Image', StubImage);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AtlasRegistry', () => {
  it('warns once for a shipped group that falls back, and never for a group with no file', async () => {
    // every way a file can come back, for a group that ships one and for one that does not
    const groups: { name: string; generate: () => AtlasImage }[] = [];
    const shipped = new Set<string>();
    for (const way of Object.keys(WAYS) as Way[])
      for (const ships of [true, false]) {
        const name = `${ships ? 'shipped' : 'unshipped'}-${way}`;
        served.set(name, way);
        if (ships) shipped.add(name);
        groups.push({ name, generate: generator(name) });
      }
    const atlas = new AtlasRegistry(shipped);
    await atlas.load(groups);
    // a second load of the same groups is still once per group
    await atlas.load(groups);

    const warned = warn.mock.calls.map((args) => String(args[0]));
    const expected = groups
      .map((g) => g.name)
      .filter((name) => shipped.has(name) && served.get(name) !== 'ok');
    expect(warned).toHaveLength(expected.length);
    for (const name of expected)
      expect(warned.filter((line) => line.startsWith(`Atlas: ${name} `))).toHaveLength(1);
    for (const g of groups) {
      expect(atlas.groupOrigin.get(g.name)).toBe(
        served.get(g.name) === 'ok' ? 'png' : 'procedural',
      );
      expect(atlas.has(`${g.name}/a`)).toBe(true);
    }
  });

  it('names the file and what went wrong with it', async () => {
    served.set('terrain', 'html');
    served.set('props', 'png');
    served.set('icons', 'missing');
    const atlas = new AtlasRegistry(new Set(['terrain', 'props', 'icons']));
    await atlas.load(
      ['terrain', 'props', 'icons'].map((n) => ({ name: n, generate: generator(n) })),
    );
    expect(warn.mock.calls.map((args) => String(args[0])).sort()).toEqual([
      'Atlas: icons falls back to procedural art: /assets/icons.json answered 404',
      'Atlas: props falls back to procedural art: /assets/props.png did not load as an image',
      'Atlas: terrain falls back to procedural art: /assets/terrain.json came as text/html',
    ]);
  });
});
