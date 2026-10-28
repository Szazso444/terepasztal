import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasImage } from './atlas';
import {
  ATLAS_CACHE_FORMAT,
  AtlasCache,
  atlasCacheVersion,
  hashString,
  isCachedAtlas,
  openAtlasStore,
  type AtlasCodec,
  type AtlasStore,
  type CachedAtlas,
} from './atlasCache';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A picture as the tests draw it: its size and a name to recognise it by after a round trip. */
type Picture = { width: number; height: number; name: string };
const picture = (name: string, width = 4, height = 2) =>
  ({ width, height, name }) as unknown as HTMLCanvasElement;

/** Encodes a picture as JSON in a Blob and back: lossless, like PNG, and Node has Blob. */
const jsonCodec: AtlasCodec = {
  encode: (image) => Promise.resolve(new Blob([JSON.stringify(image)])),
  decode: async (png) => JSON.parse(await png.text()) as HTMLCanvasElement,
};

/** A store in a map, which also counts what it was asked. */
function memoryStore() {
  const records = new Map<string, unknown>();
  const store: AtlasStore & { records: Map<string, unknown>; gets: number; puts: number } = {
    records,
    gets: 0,
    puts: 0,
    get: (group) => {
      store.gets++;
      return Promise.resolve(records.get(group));
    },
    put: (group, record) => {
      store.puts++;
      records.set(group, record);
      return Promise.resolve();
    },
  };
  return store;
}

const atlasOf = (name: string, resolution?: number): AtlasImage => ({
  image: picture(name),
  frames: {
    [`${name}/a`]: { x: 1, y: 1, w: 2, h: 1, ax: 1, ay: 1 },
    [`${name}/b`]: { x: 0, y: 0, w: 1, h: 1, ax: 0.5, ay: 1 },
  },
  ...(resolution !== undefined ? { resolution } : {}),
});

describe('hashString', () => {
  it('gives 16 hex digits, the same for the same text every time', () => {
    for (const text of ['', 'a', 'terepasztal', '{"locos":[]}', 'ű'.repeat(1000)]) {
      expect(hashString(text)).toMatch(/^[0-9a-f]{16}$/);
      expect(hashString(text)).toBe(hashString(String(text)));
    }
  });

  it('tells apart texts that differ in one character, anywhere', () => {
    const base = JSON.stringify({ locos: [{ id: 'mav375', speed: 60, paint: '#2a4' }] });
    const seen = new Map<string, string>([[hashString(base), base]]);
    for (let i = 0; i < base.length; i++)
      for (const c of ['x', '0', ' ']) {
        if (base[i] === c) continue;
        const text = base.slice(0, i) + c + base.slice(i + 1);
        const h = hashString(text);
        expect(seen.get(h), `"${text}" collides`).toBeUndefined();
        seen.set(h, text);
      }
  });
});

describe('atlasCacheVersion', () => {
  const parts = {
    source: '0123456789abcdef',
    content: { locos: [{ id: 'mav375', paint: 'green' }], wagons: [] },
    agent: 'Chrome/156',
  };

  it('is the same for the same build, content and browser', () => {
    expect(atlasCacheVersion(parts)).toBe(atlasCacheVersion(structuredClone(parts)));
  });

  it('changes with the build source, with any content change, override or not, and with the browser', () => {
    const v = atlasCacheVersion(parts);
    const changed = [
      { ...parts, source: 'fedcba9876543210' },
      // an override from the content editor that repaints one engine
      { ...parts, content: { ...parts.content, locos: [{ id: 'mav375', paint: 'red' }] } },
      { ...parts, content: { ...parts.content, wagons: [{ id: 'hopper' }] } },
      { ...parts, agent: 'Chrome/157' },
    ];
    const versions = changed.map(atlasCacheVersion);
    for (const other of versions) expect(other).not.toBe(v);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('carries the record format, so a new layout misses every older record', () => {
    expect(atlasCacheVersion(parts).startsWith(`f${ATLAS_CACHE_FORMAT}:`)).toBe(true);
  });
});

describe('isCachedAtlas', () => {
  const good = (): CachedAtlas => ({
    version: 'v1',
    frames: { 'g/a': { x: 0, y: 0, w: 2, h: 2, ax: 1, ay: 2 } },
    width: 4,
    height: 2,
    png: new Blob(['x']),
  });

  it('takes a whole record at the version asked for', () => {
    expect(isCachedAtlas(good(), 'v1')).toBe(true);
    expect(isCachedAtlas({ ...good(), resolution: 4 }, 'v1')).toBe(true);
    expect(isCachedAtlas({ ...good(), frames: {} }, 'v1')).toBe(true);
  });

  it('refuses another version and every broken record', () => {
    const broken: [string, unknown][] = [
      ['another version', good()],
      ['nothing', undefined],
      ['a string', 'record'],
      ['an array', [good()]],
      ['no frames', { ...good(), frames: undefined }],
      ['frames as a list', { ...good(), frames: [good().frames['g/a']] }],
      ['a null frame', { ...good(), frames: { 'g/a': null } }],
      [
        'a sizeless frame',
        { ...good(), frames: { 'g/a': { x: 0, y: 0, w: 0, h: 2, ax: 0, ay: 0 } } },
      ],
      ['a frame without anchor', { ...good(), frames: { 'g/a': { x: 0, y: 0, w: 1, h: 1 } } }],
      ['no width', { ...good(), width: undefined }],
      ['zero height', { ...good(), height: 0 }],
      ['a resolution below 1', { ...good(), resolution: 0.5 }],
      ['a resolution that is not a number', { ...good(), resolution: '4' }],
      ['no picture', { ...good(), png: undefined }],
      ['a picture that is not a blob', { ...good(), png: 'iVBORw0' }],
    ];
    for (const [why, record] of broken)
      expect(isCachedAtlas(record, why === 'another version' ? 'v2' : 'v1'), why).toBe(false);
  });
});

describe('AtlasCache', () => {
  it('gives back what it stored: the same frames, resolution and picture', async () => {
    const store = memoryStore();
    const cache = new AtlasCache(Promise.resolve(store), 'v1', jsonCodec);
    for (const [name, res] of [
      ['plain', undefined],
      ['sharp', 4],
    ] as const) {
      const atlas = atlasOf(name, res);
      expect(await cache.write(name, atlas)).toBe(true);
      const back = await cache.read(name);
      expect(back).not.toBeNull();
      expect(back!.frames).toEqual(atlas.frames);
      expect(back!.resolution).toBe(res);
      expect(back!.image as unknown as Picture).toEqual(atlas.image as unknown as Picture);
    }
    expect(await cache.read('never-stored')).toBeNull();
  });

  it('misses a group stored under another content version, and the next write replaces it', async () => {
    const store = memoryStore();
    await new AtlasCache(Promise.resolve(store), 'old', jsonCodec).write('g', atlasOf('g'));
    const now = new AtlasCache(Promise.resolve(store), 'new', jsonCodec);
    expect(await now.read('g')).toBeNull();
    await now.write('g', atlasOf('g'));
    expect(store.records.size).toBe(1);
    expect((store.records.get('g') as CachedAtlas).version).toBe('new');
    expect(await now.read('g')).not.toBeNull();
    expect(await new AtlasCache(Promise.resolve(store), 'old', jsonCodec).read('g')).toBeNull();
  });

  it('misses a picture that decodes to another size than it was stored at', async () => {
    const store = memoryStore();
    const cache = new AtlasCache(Promise.resolve(store), 'v1', jsonCodec);
    await cache.write('g', atlasOf('g'));
    (store.records.get('g') as CachedAtlas).width = 8;
    expect(await cache.read('g')).toBeNull();
  });

  it('turns every failure into a miss on read and a false on write, never a throw', async () => {
    const atlas = atlasOf('g');
    // each store made only when its case runs, so a rejected one is never left unhandled
    const failing: [string, () => Promise<AtlasStore | null>][] = [
      ['no store', () => Promise.resolve(null)],
      ['the store never opens', () => Promise.reject(new Error('open failed'))],
      [
        'the store fails',
        () =>
          Promise.resolve({
            get: () => Promise.reject(new Error('read failed')),
            put: () => Promise.reject(new Error('quota')),
          }),
      ],
      [
        'the store throws',
        () =>
          Promise.resolve({
            get: () => {
              throw new Error('InvalidStateError');
            },
            put: () => {
              throw new Error('InvalidStateError');
            },
          }),
      ],
    ];
    for (const [why, store] of failing) {
      const cache = new AtlasCache(store(), 'v1', jsonCodec);
      expect(await cache.read('g'), why).toBeNull();
      expect(await cache.write('g', atlas), why).toBe(false);
    }

    // a codec that fails: the record is there but cannot be used, or cannot be made
    const store = memoryStore();
    await new AtlasCache(Promise.resolve(store), 'v1', jsonCodec).write('g', atlas);
    const broken: AtlasCodec = {
      encode: () => Promise.reject(new Error('toBlob gave nothing')),
      decode: () => Promise.reject(new Error('EncodingError')),
    };
    const cache = new AtlasCache(Promise.resolve(store), 'v1', broken);
    expect(await cache.read('g')).toBeNull();
    expect(await cache.write('h', atlas)).toBe(false);
    expect(store.records.has('h')).toBe(false);
  });

  it('gives up on a store that does not answer, after the wait', async () => {
    vi.useFakeTimers();
    const hanging: AtlasStore = { get: () => new Promise(() => {}), put: () => Promise.resolve() };
    const cache = new AtlasCache(Promise.resolve(hanging), 'v1', jsonCodec, 3000);
    let result: AtlasImage | null | 'pending' = 'pending';
    void cache.read('g').then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });
});

/**
 * A stand-in for IndexedDB with the parts `openAtlasStore` uses. Events fire on the microtask
 * queue, so a test needs no timers; `open` decides how opening goes.
 */
function fakeIndexedDb(open: 'ok' | 'throws' | 'error' | 'blocked' | 'hangs' = 'ok') {
  const stores = new Map<string, Map<string, unknown>>();
  const state = { closed: 0, opens: 0, upgrades: 0, failWrites: false, answerLate: () => {} };
  type Handlers = Record<string, (() => void) | null>;
  const request = () =>
    ({ result: undefined as unknown, error: null as unknown }) as Handlers & {
      result: unknown;
      error: unknown;
    };
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => void stores.set(n, new Map()),
    close: () => void state.closed++,
    onversionchange: null as (() => void) | null,
    transaction(name: string) {
      const store = stores.get(name);
      if (!store) throw new Error(`NotFoundError: no ${name}`);
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null } as Handlers & {
        error: unknown;
      };
      return Object.assign(tx, {
        objectStore: () => ({
          get(key: string) {
            const req = request();
            queueMicrotask(() => {
              req.result = store.get(key);
              req.onsuccess?.();
            });
            return req;
          },
          put(value: unknown, key: string) {
            queueMicrotask(() => {
              if (state.failWrites) {
                tx.error = new Error('QuotaExceededError');
                tx.onabort?.();
              } else {
                store.set(key, value);
                tx.oncomplete?.();
              }
            });
            return request();
          },
        }),
      });
    },
  };
  const factory = {
    open(_name: string, version: number) {
      if (open === 'throws') throw new Error('SecurityError');
      state.opens++;
      const req = request();
      const answer = () => {
        req.result = db;
        if (version === 1 && !stores.size) {
          state.upgrades++;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      };
      queueMicrotask(() => {
        if (open === 'error') req.onerror?.();
        else if (open === 'blocked') req.onblocked?.();
        else if (open === 'hangs') state.answerLate = answer;
        else answer();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, stores, state, db };
}

describe('openAtlasStore', () => {
  const record = (version: string): CachedAtlas => ({
    version,
    frames: { 'g/a': { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 1 } },
    width: 1,
    height: 1,
    png: new Blob(['png']),
  });

  it('creates its store once and keeps records by group across opens', async () => {
    const idb = fakeIndexedDb();
    const first = await openAtlasStore(() => idb.factory);
    expect(first).not.toBeNull();
    await first!.put('track', record('v1'));
    await first!.put('wagons', record('v1'));
    await first!.put('track', record('v2'));

    const second = await openAtlasStore(() => idb.factory);
    expect(idb.state.upgrades).toBe(1);
    expect(((await second!.get('track')) as CachedAtlas).version).toBe('v2');
    expect(((await second!.get('wagons')) as CachedAtlas).version).toBe('v1');
    expect(await second!.get('fx')).toBeUndefined();
    expect([...idb.stores.values()].map((s) => s.size)).toEqual([2]);
  });

  it('closes its database when another tab upgrades it', async () => {
    const idb = fakeIndexedDb();
    await openAtlasStore(() => idb.factory);
    idb.db.onversionchange?.();
    expect(idb.state.closed).toBe(1);
  });

  it('is null where there is no IndexedDB, or it throws, fails or is blocked', async () => {
    expect(await openAtlasStore(() => undefined)).toBeNull();
    expect(
      await openAtlasStore(() => {
        throw new Error('SecurityError: storage is blocked');
      }),
    ).toBeNull();
    for (const way of ['throws', 'error', 'blocked'] as const)
      expect(await openAtlasStore(() => fakeIndexedDb(way).factory), way).toBeNull();
  });

  it('is null when opening does not answer within the wait, and closes a late answer', async () => {
    vi.useFakeTimers();
    const idb = fakeIndexedDb('hangs');
    let store: AtlasStore | null | 'pending' = 'pending';
    void openAtlasStore(() => idb.factory, 3000).then((s) => (store = s));
    await vi.advanceTimersByTimeAsync(2999);
    expect(store).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(store).toBeNull();
    // the database turns up after all: it is closed rather than left open
    idb.state.answerLate();
    await vi.advanceTimersByTimeAsync(0);
    expect(idb.state.closed).toBe(1);
  });

  it('rejects a failed write and a read from a database without the store', async () => {
    const idb = fakeIndexedDb();
    const store = await openAtlasStore(() => idb.factory);
    idb.state.failWrites = true;
    await expect(store!.put('g', record('v1'))).rejects.toThrow('QuotaExceededError');
    idb.stores.clear();
    expect(() => store!.get('g')).toThrow('NotFoundError');
    // which the cache turns into a miss and a failed write
    const cache = new AtlasCache(Promise.resolve(store), 'v1', jsonCodec);
    expect(await cache.read('g')).toBeNull();
    expect(await cache.write('g', atlasOf('g'))).toBe(false);
  });

  it('feeds the cache end to end: write, read back, miss at a new version', async () => {
    const idb = fakeIndexedDb();
    const cache = new AtlasCache(
      openAtlasStore(() => idb.factory),
      'v1',
      jsonCodec,
    );
    const atlas = atlasOf('track');
    expect(await cache.write('track', atlas)).toBe(true);
    const back = await cache.read('track');
    expect(back?.frames).toEqual(atlas.frames);
    const next = new AtlasCache(
      openAtlasStore(() => idb.factory),
      'v2',
      jsonCodec,
    );
    expect(await next.read('track')).toBeNull();
  });
});
