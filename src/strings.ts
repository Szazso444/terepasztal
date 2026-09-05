/** All user-facing strings. Keep flat so a Hungarian table can mirror this file later. */
export const STR = {
  title: 'Terepasztal',
  loading: 'Laying the first sleepers...',
  hud: {
    money: 'Funds',
    tickets: 'Tickets',
    reputation: 'Reputation',
    day: (d: number) => `Day ${d}`,
    speed: ['Paused', '1x', '2x', '3x'],
    tier: (t: number) => `Tier ${t}`,
  },
  overview: {
    locked: 'UNCHARTED',
    tierReq: (t: number) => `Reputation tier ${t}`,
    hint: 'Tab / scroll in: return to field view',
  },
  hints: {
    camera: 'WASD / arrows / middle-drag: pan   wheel: zoom   Tab: overview   `: debug',
  },
  debug: {
    title: 'Debug',
    fps: 'FPS',
    seed: 'Seed',
    entities: 'Entities',
    giveMoney: '+10,000 funds',
    giveTickets: '+10 tickets',
    spawnContract: 'Spawn contract',
    depthOverlay: 'Depth-sort overlay',
    zoom: 'Zoom',
    camera: 'Camera',
    tile: 'Tile',
    regenerate: 'New map (seed)',
  },
  minimap: { title: 'Survey' },
} as const;
