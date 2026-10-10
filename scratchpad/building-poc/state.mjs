import { footprint, canPlace } from '../grid-buildings/footprint.mjs';
export class Site {
  constructor() {
    this.size = 10;
    this.buildings = [];
    this.tracks = new Set();
    this.nextId = 1;
  }
  blocked(ignoreId) {
    const cells = new Set(this.tracks);
    for (const b of this.buildings)
      if (b.id !== ignoreId)
        for (const c of footprint(b.x, b.y, b.tiles, b.rotation)) cells.add(c.join(','));
    return cells;
  }
  valid(x, y, tiles, rotation, ignoreId) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      canPlace(x, y, tiles, rotation, this.blocked(ignoreId), this.size)
    );
  }
  place(x, y, tiles, rotation, asset) {
    if (!this.valid(x, y, tiles, rotation)) return false;
    this.buildings.push({
      id: this.nextId++,
      x,
      y,
      tiles,
      rotation: rotation % 4,
      ...(asset ? { asset } : {}),
    });
    return true;
  }
  at(x, y) {
    return this.buildings.find((b) =>
      footprint(b.x, b.y, b.tiles, b.rotation).some((c) => c[0] === x && c[1] === y),
    );
  }
  rotate(x, y) {
    const b = this.at(x, y);
    if (!b) return false;
    const r = (b.rotation + 1) % 4;
    if (!this.valid(b.x, b.y, b.tiles, r, b.id)) return false;
    b.rotation = r;
    return true;
  }
  track(x, y) {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.size ||
      y >= this.size ||
      this.at(x, y)
    )
      return false;
    this.tracks.add(`${x},${y}`);
    return true;
  }
  remove(x, y) {
    const b = this.at(x, y);
    if (b) {
      this.buildings = this.buildings.filter((v) => v.id !== b.id);
      return true;
    }
    return this.tracks.delete(`${x},${y}`);
  }
  served(b) {
    return footprint(b.x, b.y, b.tiles, b.rotation).some(([x, y]) =>
      [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some((c) => this.tracks.has(c.join(','))),
    );
  }
  serialize() {
    return { version: 1, buildings: this.buildings, tracks: [...this.tracks] };
  }
  static restore(data) {
    if (data.version !== 1 || !Array.isArray(data.buildings) || !Array.isArray(data.tracks))
      throw Error('Unsupported POC layout');
    const s = new Site();
    for (const key of data.tracks) {
      const [x, y] = key.split(',').map(Number);
      if (!s.track(x, y)) throw Error('Invalid track');
    }
    for (const b of data.buildings) {
      if (
        ![1, 2].includes(b.tiles) ||
        ![0, 1, 2, 3].includes(b.rotation) ||
        (b.asset !== undefined &&
          (typeof b.asset !== 'string' || !/^[a-z0-9_-]+$/.test(b.asset))) ||
        !s.place(b.x, b.y, b.tiles, b.rotation, b.asset)
      )
        throw Error('Invalid building');
    }
    return s;
  }
}
