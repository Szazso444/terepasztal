import { isFrameDef, type AtlasImage, type FrameDef } from './atlas';

/**
 * The cache of generated atlas groups, so that a boot after the first one reuses the pictures the
 * generators in `src/art` drew last time instead of drawing them again (#558). Each group the
 * generator supplied is stored in IndexedDB as a PNG with its frame table, under the content
 * version it was drawn at. A record of any other version is a miss: the generator runs and the
 * record is replaced.
 *
 * The content version is everything a generator's output depends on (`atlasCacheVersion`):
 *
 * - the source the build was made from (`__ATLAS_SOURCE_VERSION__`, a hash of every file under
 *   `src`, written by `vite.config.ts`): the generators, the packer, the palette and the shipped
 *   content JSON are all source, so any change to them is a new version. The dev server defines
 *   none, so it never caches: art edited under it always shows at once.
 * - the content bundle the session runs on, overrides from the content editor included: rolling
 *   stock is drawn from it.
 * - the browser: pictures are drawn with its canvas, so its user agent, and a fingerprint of what
 *   its canvas draws (`canvasFingerprint`). The same browser can rasterise a path differently on
 *   another day, on the GPU or in software, which moves the anti-aliased edge of a track sprite and
 *   with it the sprite's trimmed size: such a browser draws a new version, as it would without a
 *   cache.
 * - `ATLAS_CACHE_FORMAT`, the layout of a stored record.
 *
 * The shipped `public/assets` files are not part of it: they are never cached. A partial file is
 * fetched and layered over the generated frames on every boot as before, so a changed file shows
 * at once and still wins over the generator.
 *
 * Whatever goes wrong (no IndexedDB, a blocked or failing database, a broken record, a PNG that
 * does not decode, a write that fails) costs only the cache: the group is generated as it was
 * before there was one.
 */

/** The layout of a stored record; part of the version, so a new layout misses every old record. */
export const ATLAS_CACHE_FORMAT = 1;

const DB_NAME = 'terepasztal-atlas-cache';
/** The database schema version: one object store keyed by group. Record layout is versioned above. */
const DB_VERSION = 1;
const STORE = 'groups';
/** How long opening the database or reading a record may take before the boot generates instead. */
export const CACHE_WAIT_MS = 3000;
/**
 * How long a stored picture may take to decode. Generous, as the track sheet is a few megabytes and
 * a busy machine decodes slowly; it is there so that a decode that never settles cannot hold the boot.
 */
export const DECODE_WAIT_MS = 10_000;

/** One generated group as stored. */
export interface CachedAtlas {
  version: string;
  frames: Record<string, FrameDef>;
  resolution?: number;
  width: number;
  height: number;
  png: Blob;
}

/** Where records live: IndexedDB in the browser, a map in the tests. */
export interface AtlasStore {
  get(group: string): Promise<unknown>;
  put(group: string, record: CachedAtlas): Promise<void>;
}

/** Turns an atlas picture into stored bytes and back. */
export interface AtlasCodec {
  encode(image: AtlasImage['image']): Promise<Blob>;
  decode(png: Blob): Promise<AtlasImage['image']>;
}

/**
 * A 64-bit hash of a string as 16 hex digits: two cyrb53-style lanes with different seeds. Not
 * cryptographic; it tells content versions apart. Pure JavaScript, so it works where
 * `crypto.subtle` does not (a page served over plain http on the local network).
 */
export function hashString(text: string): string {
  return hashUnits(text.length, (i) => text.charCodeAt(i));
}

/** `hashString` over bytes, such as a canvas's pixels. */
export function hashBytes(bytes: ArrayLike<number>): string {
  return hashUnits(bytes.length, (i) => bytes[i]);
}

function hashUnits(length: number, at: (i: number) => number): string {
  const lane = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < length; i++) {
      const c = at(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0).toString(16).padStart(8, '0');
  };
  return lane(0x9e3779b9) + lane(0x85ebca6b);
}

/** The content version a generated group is stored and looked up under (see the header). */
export function atlasCacheVersion(parts: {
  /** the build's source hash */
  source: string;
  /** the content bundle the session runs on */
  content: unknown;
  /** the browser's user agent */
  agent: string;
  /** what the browser's canvas draws (`canvasFingerprint`) */
  canvas: string;
}): string {
  return [
    `f${ATLAS_CACHE_FORMAT}`,
    parts.source,
    hashString(JSON.stringify(parts.content) ?? ''),
    hashString(parts.agent),
    parts.canvas,
  ].join(':');
}

/**
 * A hash of what this browser's canvas draws for the strokes the track art is made of: a clipped,
 * scaled frame of the track sprites' size with a translucent fill, a fractional polygon and a
 * round-joined line. Two browsers that rasterise these alike draw the generators' pictures alike.
 * Empty where there is no canvas to ask, which only a browser without one would be.
 */
export function canvasFingerprint(
  create: () => HTMLCanvasElement | null = () =>
    typeof document === 'undefined' ? null : document.createElement('canvas'),
): string {
  try {
    const canvas = create();
    if (!canvas) return '';
    // the size of a track sprite's canvas (`src/art/trackIllustrated.ts`): the browser may choose
    // its rasteriser by canvas size
    canvas.width = 288;
    canvas.height = 176;
    const c = canvas.getContext('2d');
    if (!c) return '';
    c.scale(4, 4);
    c.beginPath();
    c.moveTo(36, 3.7);
    c.lineTo(68.6, 20);
    c.lineTo(36, 36.3);
    c.lineTo(3.4, 20);
    c.closePath();
    c.clip();
    c.globalAlpha = 0.37;
    c.fillStyle = '#6b5a3e';
    c.fillRect(0, 0, 72, 44);
    c.globalAlpha = 1;
    c.beginPath();
    c.moveTo(10.3, 12.15);
    c.lineTo(61.7, 27.85);
    c.lineTo(58.2, 31.1);
    c.lineTo(13.9, 17.45);
    c.closePath();
    c.fillStyle = '#8a8478';
    c.fill();
    c.beginPath();
    c.moveTo(7.25, 25.5);
    c.lineTo(36.6, 11.2);
    c.lineTo(64.1, 24.75);
    c.strokeStyle = '#3b3229';
    c.lineWidth = 1.35;
    c.lineJoin = 'round';
    c.stroke();
    return hashBytes(c.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return '';
  }
}

/** `work`, or `fallback` once `ms` have passed without it settling. */
function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** A request's result, or its error as a rejection. */
function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * The IndexedDB store, or null where there is none to be had: no `indexedDB` (an old browser, a
 * worker, Node), one that throws when touched (a sandboxed frame, storage blocked by the user),
 * one that fails or is blocked opening, or one that does not answer within `waitMs`.
 */
export async function openAtlasStore(
  factory: () => IDBFactory | undefined = () => globalThis.indexedDB,
  waitMs = CACHE_WAIT_MS,
): Promise<AtlasStore | null> {
  let idb: IDBFactory | undefined;
  try {
    idb = factory();
  } catch {
    return null;
  }
  if (!idb) return null;
  const opened = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading the database: let it, this session simply stops caching
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  const db = await within(opened, waitMs, null);
  if (!db) {
    // an open that answers after the wait gets its database closed rather than leaked
    void opened.then((late) => late?.close());
    return null;
  }
  return {
    get: (group) => settle(db.transaction(STORE, 'readonly').objectStore(STORE).get(group)),
    put: (group, record) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        tx.objectStore(STORE).put(record, group);
      }),
  };
}

/** A JSON object, as opposed to an array, null or a primitive. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** A stored value with every field a cached group needs, at the given version. */
export function isCachedAtlas(v: unknown, version: string): v is CachedAtlas {
  if (!isRecord(v) || v.version !== version || !isRecord(v.frames)) return false;
  if (!finite(v.width) || !finite(v.height) || v.width < 1 || v.height < 1) return false;
  if (v.resolution !== undefined && !(finite(v.resolution) && v.resolution >= 1)) return false;
  if (typeof Blob === 'undefined' || !(v.png instanceof Blob)) return false;
  return Object.values(v.frames).every(isFrameDef);
}

/** Generated groups read from and written to a store under one content version. */
export class AtlasCache {
  /** the store, or null once it failed to open */
  private readonly store: Promise<AtlasStore | null>;

  constructor(
    store: Promise<AtlasStore | null>,
    readonly version: string,
    private readonly codec: AtlasCodec,
    private readonly waitMs = CACHE_WAIT_MS,
    private readonly decodeWaitMs = DECODE_WAIT_MS,
  ) {
    this.store = store.catch(() => null);
  }

  /** The group as the generator drew it at this version, or null for any miss or failure. */
  async read(group: string): Promise<AtlasImage | null> {
    try {
      const store = await this.store;
      if (!store) return null;
      const record = await within(store.get(group), this.waitMs, undefined);
      if (!isCachedAtlas(record, this.version)) return null;
      const image = await within(this.codec.decode(record.png), this.decodeWaitMs, null);
      if (!image) return null;
      // a picture that decodes to another size is not the one the frame table was packed on
      if (image.width !== record.width || image.height !== record.height) return null;
      return {
        image,
        frames: record.frames,
        ...(record.resolution !== undefined ? { resolution: record.resolution } : {}),
      };
    } catch {
      return null;
    }
  }

  /** Store a generated group for the next boot; false when it could not be. Never throws. */
  async write(group: string, atlas: AtlasImage): Promise<boolean> {
    try {
      const store = await this.store;
      if (!store) return false;
      const png = await this.codec.encode(atlas.image);
      await store.put(group, {
        version: this.version,
        frames: atlas.frames,
        ...(atlas.resolution !== undefined ? { resolution: atlas.resolution } : {}),
        width: atlas.image.width,
        height: atlas.image.height,
        png,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/** PNG through the canvas and an image element: the browser's own encoder and decoder. */
export const browserAtlasCodec: AtlasCodec = {
  encode: (image) =>
    new Promise((resolve, reject) => {
      if (!(image instanceof HTMLCanvasElement)) {
        reject(new Error('only a canvas is encoded'));
        return;
      }
      image.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob gave nothing'))));
    }),
  decode: async (png) => {
    const url = URL.createObjectURL(png);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

/**
 * Names the build's source version; undefined where nothing defines it (the Node tests) and null
 * under the dev server (`vite.config.ts`).
 */
declare const __ATLAS_SOURCE_VERSION__: string | null | undefined;

/**
 * The browser's cache for this build and content bundle, or null where there is no build version
 * to key it by (the dev server, the tests): those always generate.
 */
export function browserAtlasCache(content: unknown): AtlasCache | null {
  const source = typeof __ATLAS_SOURCE_VERSION__ === 'string' ? __ATLAS_SOURCE_VERSION__ : null;
  if (!source) return null;
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return new AtlasCache(
    openAtlasStore(),
    atlasCacheVersion({ source, content, agent, canvas: canvasFingerprint() }),
    browserAtlasCodec,
  );
}
