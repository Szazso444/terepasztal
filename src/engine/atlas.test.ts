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
  noframes: 'json has no frames',
  arrayframes: 'json frames is an array',
  nullframe: 'json has a frame that is null',
  sizeless: 'json has a frame with no size',
  png: 'png fails to load',
} as const;
type Way = keyof typeof WAYS;

/** The way each group's files come back in the current test, by group name. */
let served = new Map<string, Way>();
/** Every url fetched or set as an image source in the current test, in order. */
let requested: string[] = [];

/** The group a request is for, whatever base path it was made under. */
function groupOf(path: string, ext: 'json' | 'png') {
  requested.push(path);
  return new RegExp(`^(?:.*/)?assets/([^/]+)\\.${ext}$`).exec(path)![1];
}

function respond(path: string): Promise<Response> {
  const ext = path.endsWith('.png') ? 'png' : 'json';
  const name = groupOf(path, ext);
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
    case 'noframes':
      return Promise.resolve(json(JSON.stringify({ partial: true, resolution: 4 })));
    case 'arrayframes':
      return Promise.resolve(json(JSON.stringify({ frames: [frames[`${name}/a`]] })));
    case 'nullframe':
      return Promise.resolve(json(JSON.stringify({ frames: { ...frames, [`${name}/b`]: null } })));
    case 'sizeless':
      return Promise.resolve(
        json(
          JSON.stringify({ frames: { [`${name}/a`]: { x: 0, y: 0, w: 0, h: 2, ax: 0, ay: 2 } } }),
        ),
      );
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
    const name = groupOf(path, 'png');
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
  requested = [];
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
      // a skipped file leaves none of its frames behind: only the generator's one frame is there
      expect(atlas.keys(`${g.name}/`)).toEqual([`${g.name}/a`]);
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

  it('skips a file that breaks the frame contract and still loads every other group', async () => {
    const bad = { props: 'noframes', icons: 'arrayframes', people: 'nullframe', fx: 'sizeless' };
    served.set('terrain', 'ok');
    for (const [name, way] of Object.entries(bad)) served.set(name, way as Way);
    const names = ['terrain', ...Object.keys(bad), 'track'];
    const atlas = new AtlasRegistry(new Set(names));
    await atlas.load(names.map((n) => ({ name: n, generate: generator(n) })));

    expect(atlas.groupOrigin.get('terrain')).toBe('png');
    for (const name of names) {
      if (name !== 'terrain') expect(atlas.groupOrigin.get(name)).toBe('procedural');
      expect(atlas.keys(`${name}/`)).toEqual([`${name}/a`]);
    }
    expect(warn.mock.calls.map((args) => String(args[0])).sort()).toEqual([
      'Atlas: fx falls back to procedural art: /assets/fx.json frame fx/a needs finite x, y, ax, ay and positive w, h',
      'Atlas: icons falls back to procedural art: /assets/icons.json has no frames object',
      'Atlas: people falls back to procedural art: /assets/people.json frame people/b needs finite x, y, ax, ay and positive w, h',
      'Atlas: props falls back to procedural art: /assets/props.json has no frames object',
      'Atlas: track falls back to procedural art: /assets/track.json answered 404',
    ]);
  });

  it('fetches the files under the base path the build is served from', async () => {
    served.set('terrain', 'ok');
    const groups = ['terrain', 'icons'].map((n) => ({ name: n, generate: generator(n) }));

    // a build served under a sub-path, which also names the file it warns about by that path
    await new AtlasRegistry(new Set(['icons']), '/terepasztal/').load(groups);
    expect(requested.sort()).toEqual([
      '/terepasztal/assets/icons.json',
      '/terepasztal/assets/terrain.json',
      '/terepasztal/assets/terrain.png',
    ]);
    expect(warn.mock.calls.map((args) => String(args[0]))).toEqual([
      'Atlas: icons falls back to procedural art: /terepasztal/assets/icons.json answered 404',
    ]);

    // a relative base, for a build that is opened from wherever it was copied to
    requested = [];
    await new AtlasRegistry(new Set(), './').load(groups);
    expect(requested.sort()).toEqual([
      './assets/icons.json',
      './assets/terrain.json',
      './assets/terrain.png',
    ]);

    // the default is the build's own base, '/' here as in a root deploy: the requests are unchanged
    requested = [];
    expect(import.meta.env.BASE_URL).toBe('/');
    await new AtlasRegistry(new Set()).load(groups);
    expect(requested.sort()).toEqual([
      '/assets/icons.json',
      '/assets/terrain.json',
      '/assets/terrain.png',
    ]);
  });
});
