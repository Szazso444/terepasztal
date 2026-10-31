/**
 * Age names by index (0 steam, 1 diesel, 2 electric, 3 nuclear, 4 magnetic, 5 hyper); ids match
 * `src/data/ages.json`.
 */
const AGE_NAMES: Record<string, string> = {
  steam: 'Steam Age',
  diesel: 'Diesel Age',
  electric: 'Electric Age',
  nuclear: 'Nuclear Age',
  magnetic: 'Magnetic Age',
  hyper: 'Hyper Age',
};
export const AGE_ORDER = ['steam', 'diesel', 'electric', 'nuclear', 'magnetic', 'hyper'];
function ageLabel(t: number) {
  return AGE_NAMES[AGE_ORDER[t]] ?? `age ${t}`;
}

/** All user-facing strings. Keep flat so a Hungarian table can mirror this file later. */
export const STR = {
  title: 'Terepasztal',
  /** the loading screen (`src/ui/loadingScreen.ts`): one tip is shown, picked at random */
  loadingScreen: {
    /** names the progress bar for a screen reader */
    progress: 'Loading',
    /** the prompt that ends the loading: the click starts the fade, the reveal and the music */
    begin: 'Click to begin',
    tips: [
      'Crews eat wheat every day. Run out and production halves and trains slow.',
      'Space pauses the game, and + and − change the speed.',
      'M switches between the field view and the overview map.',
      'R rotates what you are placing, and Esc cancels it.',
      'WASD, the arrow keys or a middle-button drag move the camera, and the wheel zooms.',
      'Name a town when you place its station. You can rename it any time.',
      'Hover the age beside the date to see what the next age asks for.',
      'A train never starts a leg it could not finish and still reach fuel from.',
      'Single track is handed out in whole sections, so trains never meet head-on inside one.',
    ],
  },
  hud: {
    money: 'Funds',
    weather: (season: string, weather: string) => `${season} · ${weather}`,
    tickets: 'Tickets',
    /** the era widget's progress toward the next age, a whole percent */
    agePercent: (pct: number) => `${pct}%`,
    day: (d: number) => `Day ${d}`,
    /** by `SPEEDS` index; the buttons show them in `SPEED_ORDER` */
    speed: ['❚❚', '1x', '2x', '3x', '½x'],
    /** a speed button's tooltip: its label and the keys that set it */
    speedKey: (label: string, key: string) => `${label} speed (${key})`,
    pause: 'Pause (Space)',
    resume: 'Resume (Space)',
    weatherToggle: 'Weather',
    weatherToggleHint: 'Toggle rain, fog and seasons',
    /** the same, in a narrow top bar: the season and weather it no longer shows come first */
    weatherToggleHintNow: (now: string) => `${now}\nToggle rain, fog and seasons`,
    dayToggle: 'Day/night',
    dayToggleHint: 'Toggle the day and night cycle',
    ageUp: (t: number) =>
      `The ${ageLabel(t)} begins. New works, stations and rolling stock unlocked.`,
    signalGuide: 'Signals?',
  },
  history: {
    undo: 'Undo',
    redo: 'Redo',
    /** the buttons' tooltips: the way, what it takes back, and the key */
    tip: (way: string, what: string, key: string) => `${way}: ${what} · ${key}`,
    idleTip: (what: string, key: string) => `${what} · ${key}`,
    undone: (what: string) => `Undone: ${what}`,
    redone: (what: string) => `Redone: ${what}`,
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
    /** what a step did, in the words its tooltip and toasts use */
    built: (what: string) => `Built ${what}`,
    demolished: (what: string) => `Demolished ${what}`,
    builtTiles: (n: number, what: string) => `Built ${n} ${n === 1 ? 'tile' : 'tiles'} of ${what}`,
    demolishedTiles: (n: number, what: string) =>
      `Demolished ${n} ${n === 1 ? 'tile' : 'tiles'} of ${what}`,
    upgradedTiles: (n: number, line: string) =>
      `Upgraded ${n} ${n === 1 ? 'tile' : 'tiles'} to ${line}`,
    downgradedTiles: (n: number, line: string) =>
      `Downgraded ${n} ${n === 1 ? 'tile' : 'tiles'} to ${line}`,
    upgradedTrack: 'Upgraded track',
    downgradedTrack: 'Downgraded track',
    track: 'track',
    road: 'road',
    upgradedTo: (name: string, level: number) => `Upgraded ${name} to level ${level}`,
    downgradedTo: (name: string, level: number) => `Downgraded ${name} to level ${level}`,
    renamed: (was: string, now: string) => `Renamed ${was} to ${now}`,
    /** why an undo or a redo cannot be done */
    builtOver: 'Something else has been built there since.',
    trainOn: (train: string) => `${train} stands on the track.`,
    routedTo: (train: string, station: string) => `${train} is routed to ${station}.`,
    contractNoTrain: (contract: string) => `No train can take up ${contract} again.`,
    short: (store: string, what: string) => `${store} is short of ${what}.`,
  },
  ages: {
    title: 'Ages',
    name: AGE_NAMES,
    current: 'current',
    reached: 'reached',
    locked: 'not yet',
    start: 'Where every railway begins.',
    goal: {
      depots: 'Depots',
      population: 'Residents',
      earned: 'Earned in total',
      substations: 'Powered batteries',
      wires: 'Live electrified tiles',
      chunks: 'Owned chunks',
    } as Record<string, string>,
    /** heads the goals that are alternatives of one another */
    anyOf: 'One of these:',
    /** the same heading once one of its goals is met */
    anyOfMet: 'One of these: met',
    hint: 'An age begins once every goal listed for it is met; under "One of these", one goal is enough. Goals are checked every hour.',
    /** a locked item of the build bar: the age that opens it, and the one to reach before that */
    unlocksIn: (age: string) => `Locked. Unlocks in the ${age}`,
    reachFirst: (age: string) => `Reach the ${age} first.`,
  },
  overview: {
    locked: 'UNCHARTED',
    price: (v: number) => `$${v.toLocaleString()}`,
    buyHint: 'click to buy',
    buyTitle: 'Buy chunk',
    buyConfirm: (v: string) => `Buy this chunk for ${v}?`,
    bought: 'Chunk charted. Neighbouring land is now visible.',
    growing: 'Charting new land beyond the edge of the map…',
    /** after a loop error the map cannot grow now, since growing stores the game first */
    growHeld:
      'The map grows past its edge once you save the game and reload it. Until then nothing is saved automatically, because of the earlier error.',
    /** growing stores the game first, and that save was refused (storage full, a broken value) */
    growRefused:
      'The map could not grow past its edge: growing saves the game first, and the save was refused. It grows once a save goes through and the game is loaded again.',
    cannotAfford: (v: string) => `Need ${v} to buy this chunk`,
    chunkTitle: 'Uncharted chunk',
    chunkLines: (v: string) => [`Price ${v}`, 'Click to buy'],
    /** the tooltip of a station or train that left the map between the pick and the tooltip */
    gone: (kind: string, id: number) => `${kind} #${id}`,
    recordHint: 'R: record a new route for the selected train',
    recording: (n: string, stops: string) =>
      `Recording route for ${n}: ${stops || '(click stations in order)'} · R / Enter: finish · Esc: cancel`,
    recorded: (n: string, k: number) => `${n}: new route with ${k} stops`,
    selectHint: (n: string) => `${n} selected · click again to go there · R: record route`,
    hint: 'M / scroll in: return to field view',
  },
  tile: {
    /** a land terrain's name, the title of its tile, by `TERRAIN_NAMES` */
    terrain: {
      grass: 'Grass',
      forest: 'Forest',
      hill: 'Hill',
      water: 'Water',
      rock: 'Rock',
      sand: 'Sand',
      mountain: 'Mountain',
    } as Record<string, string>,
    /** the title of a snow tile: its terrain's name, then this */
    snow: (terrain: string) => `${terrain}, snow`,
    /** one dim line under the rows, by `TERRAIN_NAMES`; water has `water` below */
    about: {
      grass: 'Open ground. Most buildings and all track can go here.',
      forest: 'Trees. Lumber yards count it; buildings can stand here; track costs extra clearing.',
      hill: 'Rising ground. Quarries count it; track keeps to the elevation rules.',
      rock: 'Bare rock. Quarries count it; no building stands on it.',
      sand: 'Loose sand. Track and buildings can go here.',
      mountain: 'The raised heart of a rock field. No building stands on it.',
    } as Record<string, string>,
    /** the row of the elevation, and its value (the number is shown bold) */
    elevationRow: 'Elevation',
    level: (level: number) => `level ${level}`,
    /** the row on a snow tile, and its value: snow lies from the level after this one */
    snowLine: 'Snow line',
    aboveLevel: (level: number) => `above level ${level}`,
    /** what stands on the tile, by `PropKind`; a kind not listed shows as its id */
    prop: {
      tree: 'tree',
      pine: 'pine',
      rock: 'rock',
      bush: 'bush',
      birch: 'birch',
      spruce: 'spruce',
      oak: 'oak',
      palm: 'palm',
      cactus: 'cactus',
      deadtree: 'dead tree',
      flowers: 'flowers',
      reeds: 'reeds',
      boulder: 'boulder',
      coal: 'coal seam',
      oil: 'oil seep',
      wheat: 'wheat field',
    } as Record<string, string>,
    uncharted: 'Uncharted: buy the chunk in the overview (M)',
    track: (k: string) => `Track: ${k}`,
    powered: 'Powered rails',
    noTrack: 'No track can be laid here',
    trackCost: (m: number) => `Track costs ×${m}`,
    water: 'Bridges only; pumps draw from it.',
    /** the row that names the tile's biome; its value is the biome as a term (`STR.biome`) */
    biome: 'Biome',
    /**
     * The ground a harvesting station counts, by `StationDef.terrain`, with the singular for one
     * tile and the plural for several (never a plural built by adding an s). Station texts use
     * them, and so does the placing tooltip.
     */
    phrase: {
      grass: { one: 'grass tile', many: 'grass tiles' },
      forest: { one: 'forest tile', many: 'forest tiles' },
      rock: { one: 'rock or hill tile', many: 'rock and hill tiles' },
      sand: { one: 'sand tile', many: 'sand tiles' },
      water: { one: 'water tile', many: 'water tiles' },
    } as Record<string, { one: string; many: string }>,
  },
  /**
   * The biome tooltip and the station tooltip it opens. A template's `{name}` is filled by the
   * tooltip (`fill` in src/ui/tooltipDoc.ts): a resource, a term or a bold number.
   */
  biome: {
    title: (name: string) => `${name} biome`,
    /** a production row: the resource, and the kind of station that makes it, as a term */
    production: '{res} from {station}',
    trackCost: 'Track cost',
    waterUse: "Steam engines' {res} use",
    speed: 'Train speed',
  },
  /**
   * The placing tooltip, the root of the tooltip stack while a harvest station's tool is in hand,
   * and the rows a harvest station's panel shares with it (#336). A template's `{name}` is filled
   * by the tooltip (`fill` in src/ui/tooltipDoc.ts): a bold number, or the ground a station counts
   * (`STR.tile.phrase`).
   */
  placing: {
    title: (station: string) => `${station} here`,
    /** one row per distance with matching ground: how many tiles, of what, how far */
    ring: '{n} {tiles} at {d}',
    placement: 'Placement',
    /** before a Placement held at its ceiling, or at its floor */
    atMost: 'at most',
    atLeast: 'at least',
    /** the Season row, named after the season, shown only when the season changes the yield */
    season: {
      spring: 'Spring',
      summer: 'Summer',
      autumn: 'Autumn',
      winter: 'Winter',
    } as Record<string, string>,
    /** the row of the tuning's production multiplier, shown only when it is not 1 */
    tuning: 'Game tuning',
    /** the total row's value */
    perWeek: '{amount} a week',
    click: 'Click to place.',
    /** the yield label floating over the tile, in whole units a week */
    label: (n: number) => `${n}/wk`,
  },
  decorInfo: {
    reach: (r: number) => `Reach: ${r} tiles`,
    serves: (n: string) => `Serves: ${n}`,
    servesNone: 'No station in reach',
    live: 'Live: connected to a power plant',
    dead: 'Dead: no power plant on this network',
    signal: 'Red while the guarded tile is occupied',
  },
  signals: {
    /** compass words by rotation: 0 north, 1 east, 2 south, 3 west */
    directions: ['north', 'east', 'south', 'west'] as readonly string[],
    blockHint:
      'Guards the track ahead until the next same-direction signal. Select to highlight the block.',
    governs: (dir: string) => `Governs trains travelling ${dir}`,
    governsTravel: (dir: string) => `Governs travel ${dir}`,
    rotate: 'Rotate direction',
    gone: 'That signal is no longer there',
    guideButton: 'Semaphore guide',
    guideTitle: 'Semaphores and track blocks',
    guidePlace:
      'Place semaphores on the rails from Tools. Press R before placement, or use Rotate direction after selecting a post. The direction shown in the selection panel is the direction of travel it governs.',
    guideDiagram:
      '→ A  ═════ protected block ═════  → B  ═════ next block ═════  → C\n       one train at a time                  another train may follow',
    guideAspects:
      'Red / horizontal arm: stop before entering the protected block. Yellow: this block is clear, but the next is occupied. Green / raised arm: both are clear. A block ends at the next signal facing the same travel direction.',
    guideFence:
      'Fence a stretch by putting posts at its entry and exit. Leave at least your longest train plus one tile between posts. Select a signal to highlight its protected stretch. Posts work in Automatic mode as soon as you place them; unsignalled track still uses traffic reservations.',
    guideJunction:
      'Before a junction, put the entry signal on its approach and exit signals beyond each branch, leaving room for a complete train. Junction reservations still require a clear exit, so a green signal alone cannot force a train into a blocked crossing.',
    guideSingleLine:
      'On a two-way single line, put signals on both approaches to a passing loop, facing into the shared line. Keep the loop long enough for the entire train. Token working in Settings allows one train per shared plain section. Signals regulate entry; they cannot create a missing siding.',
  },
  hints: {
    camera: 'WASD / arrows / middle-drag: pan   wheel: zoom   M: overview   `: debug',
  },
  debug: {
    title: 'Debug',
    fps: 'FPS',
    seed: 'Seed',
    entities: 'Entities',
    giveMoney: '+10,000 funds',
    giveTickets: '+10 tickets',
    nextAge: 'Next age',
    giveResources: '+200 resources',
    spawnContract: 'Spawn contract',
    offer: (name: string) => `Offer: ${name}`,
    depthOverlay: 'Depth-sort overlay',
    zoom: 'Zoom',
    camera: 'Camera',
    traffic: 'Traffic',
    recovery: 'Recovery',
    junctions: 'Junctions',
    tile: 'Tile',
    regenerate: 'New map (seed)',
    /**
     * toast for an error the game loop caught; shown once per distinct message. From the first one
     * the game stores nothing on its own until the page reloads; a save the player makes still does
     */
    frameError: (message: string) =>
      `Something went wrong: ${message}. The game keeps running, but nothing is saved automatically until the game is reloaded, and your last save is kept. The browser console has details.`,
    /** the painted landscape's status: loading, active, or failed with the reason */
    landscape: 'Landscape',
    landscapeLoading: 'loading',
    landscapeActive: 'active',
    landscapeFailed: (reason: string) => `failed: ${reason}`,
    /** toast when the painted landscape fails for the session and the per-tile ground stands in */
    landscapeLost:
      'The detailed terrain could not load, so simple ground is shown for this session. The browser console has details.',
  },
  traffic: {
    pullingAside: 'Pulling aside on a reserved escape route',
    /** an idle train leaves the track another train needs */
    makingWay: 'Nothing to haul: moving out of the way',
    /** an idle train has parked off every other train's route */
    madeWay: 'Parked out of the way',
    /** an idle train in another train's way waits for that train to clear its way aside */
    waitAside: 'In the way: waiting for room to move aside',
    /**
     * an idle train another train needs to pass has nowhere it can go: no siding or platform is
     * free and long enough, or it could get into one only by reversing partway, which no train does
     */
    noWayAside: 'In the way, with no siding or free platform it can pull into',
    /**
     * a train held in a jam none of its trains can pull aside from: no siding or loop off the
     * others' way holds one of them and leaves it a way on to its stop (a counted deadlock)
     */
    jammed: 'Jammed: no siding it can pull into to let the other train by',
    /**
     * a working train backed off again for the train it last backed off for, before reaching its
     * stop: the line has no siding or loop free for the two to pass (a counted deadlock)
     */
    keptBack: 'Kept back: it gives way to the same train each time, with nowhere free to pass it',
    /** a train waiting where it pulled aside has no track on to its next stop from there */
    noWayOn: 'Pulled aside, with no track on to its next stop',
    replan: 'Escape route unavailable; waiting for a new plan',
    stalled: (name: string) => `${name}: escape stalled; released for replanning`,
    released: (name: string) => `${name}: escape route released`,
    recoverySummary: (groups: number, owners: string) =>
      `${groups} blocking groups · ${owners || 'no active escape'}`,
  },
  minimap: { title: 'Survey' },
  build: {
    offMap: 'Outside the map',
    locked: 'Uncharted region',
    rock: 'Cannot lay track on rock',
    /** track tried on rock or a mountain where none of its ends joins a line already there */
    mountainLine: 'Mountain track must continue an existing line',
    needBridge: 'Water needs a bridge',
    tooSteep: 'Too steep for rails: straight track climbs one level per tile at most',
    notLevel: 'Needs level ground: only straight track can climb a slope',
    notSmooth:
      'Curves and switches need smooth ground: only straights and crossings climb a slope, unless bridge platforms support every tile of the piece',
    deckLevels:
      'A supported piece must meet its rails at one level, no lower than the ground under it',
    trackInWay: 'Track in the way: remove it first',
    needWaterside: 'Must stand next to water',
    needTerrain: (t: string) => `Must stand on ${t}`,
    sameSupply: 'Already electrified this way',
    gaugeBreak: 'Narrow Gauge does not join the standard lines: cross them with a crossing piece',
    narrowLocked: 'Narrow gauge is not unlocked yet',
    /** a dragged run meets a curve or a switch: no crossing piece meets a line at an angle */
    crossAngle: 'Lines cross only at right angles',
    crossBridge: 'No crossing on a bridge: lines cross off the water',
    /** a straight over the very crossing or straight it would lay */
    standsAlready: 'Already laid here',
    /** a dragged run meets a line of a class it has no crossing piece with */
    crossApart: (run: string, line: string) =>
      `${run} track cannot cross ${line} track: it needs a bridge or an underpass`,
    /** crossings a dragged run lays by itself where it meets a line at right angles */
    autoCrossings: (n: number) =>
      `+${n} crossing${n === 1 ? '' : 's'}, laid automatically, turned to the run`,
    reclassCost: (what: string, cost: string) => `${what}: ${cost}`,
    reclassFree: (what: string) => `${what}: free`,
    reclassIdle: (what: string) => `${what}: click a piece or drag along the line`,
    reclassSize: (line: string, need: number, n: number) =>
      `${line} curves and switches are ${need}×${need}, this one is ${n}×${n}: lay it again with Track`,
    reclassLeft: (what: string, n: number) =>
      `${what}: ${n === 1 ? 'one piece' : `${n} pieces`} left as ${n === 1 ? 'it was' : 'they were'} (red)`,
    reclass: {
      separate: 'Only Branch, Main and Trunk Line convert into each other',
      size: 'This curve or switch is too small or too big for that line: lay it again',
      noLine: 'No line to convert to that way',
      nothing: 'Nothing to convert here',
    } as Record<string, string>,
    bridgeOnWater: 'Bridges only span water',
    occupied: 'Tile occupied',
    funds: 'Not enough funds',
    tierLocked: (t: number) => `Requires the ${ageLabel(t)}`,
    supplyLocked: "Not part of this game's production chain",
    needDeposit: (k: string) => `Needs a ${k} deposit on the tile`,
    /**
     * Why nothing can be built on a terrain (`unbuildable` in src/sim/build.ts), by
     * `TERRAIN_NAMES`: one line per terrain, as the article differs.
     */
    nothingOn: {
      water: 'Nothing can be built on water.',
      rock: 'Nothing can be built on rock.',
      mountain: 'Nothing can be built on a mountain.',
    },
    /**
     * A station with `standOn` tried on other ground, by `StationDef.id`: one line per station,
     * as its name and the ground it takes differ. One without a line here says `needGround`.
     */
    standOn: { pump: 'A water pump goes only on grass or forest.' } as Record<string, string>,
    /** a station with `standOn` and no line of its own there, tried on other ground */
    needGround: (grounds: readonly string[]) => `Must stand on ${grounds.join(' or ')}`,
    /**
     * A station that `needsWater` tried with no water on any of its four sides, by
     * `StationDef.id`. One without a line here says `needWaterside`.
     */
    besideWater: { pump: 'A water pump needs water right beside it.' } as Record<string, string>,
    needTrack: 'Must touch track',
    depotLocked: (n: number) => `Next depot unlocks at ${n} owned chunks`,
    townTooClose: (d: number) => `Town stations keep ${d} tiles apart`,
    needTrackHere: 'Signals stand on track',
    /** a road tried on a tile that has one (src/sim/roads.ts) */
    roadHere: 'There is a road here already',
    /**
     * a road tried on a tile of a station, a works, a house or a service stop: a road meets a
     * building only at its street door, from the tile outside it (#408). A bridge platform is no
     * such building: it carries a road where it carries no rail (`bridgeCarriesRail`)
     */
    roadOnBuilding: 'A road goes round a building and meets it only at its door',
    /** a station, a works, a house or a service stop tried on a tile that holds a road (#408) */
    roadInWay: 'A road is in the way: remove it first',
    /** a road tried on a bridge platform that carries rail: a platform holds rail or a road (#493) */
    bridgeCarriesRail: 'This bridge carries rail: remove the track to lay a road on it',
    /** rail tried on a bridge platform that carries a road (#493) */
    bridgeCarriesRoad: 'This bridge carries a road: remove the road to lay track on it',
    /** the road tool over a bridge platform that takes a road: a road goes on the bridge (#495) */
    roadOnBridge: 'A road on the bridge',
    /**
     * A road and track on one tile make a level crossing: the road crosses a plain straight of
     * a line with level crossings at right angles (src/sim/roads.ts), whichever of the two is laid
     * second.
     */
    crossingStraight: 'A road crosses only plain straight track: no curve, switch or crossing',
    crossingLine: 'No level crossings on this line',
    crossingAlong: 'A road crosses track at right angles, never along it',
    /** the road tool's drag (#328): how many tiles its release lays, and `cost` (`fmtCost`) */
    roadLine: (tiles: number, cost: string) =>
      `${tiles} road ${tiles === 1 ? 'tile' : 'tiles'}: ${cost}`,
    /** the road tool's drag: how many of its tiles are not laid, and each reason once */
    roadNotLaid: (tiles: number, reasons: readonly string[]) =>
      `${tiles} ${tiles === 1 ? 'tile' : 'tiles'} not laid: ${reasons.join(' · ')}`,
    needResources: (m: string) => `Need ${m}`,
    /** building: no store within the reach holds the cost; `missing` is the nearest one's shortfall */
    noStoreInReach: (range: number, missing: string) =>
      `No store within ${range} tiles holds ${missing}`,
    /** the build card: the store that pays for the work on the hovered tile (`Builder.payerAt`) */
    paidFrom: (label: string) => `Paid from ${label}`,
    replace: (what: string, net: string) => `Replace ${what}: net ${net}`,
    levelOpens: (level: number, age: string) => `Level ${level} opens in the ${age}`,
    upgradingNow: 'Already being upgraded',
    cost: (v: string) => `Cost ${v}`,
    refund: (v: string) => `Refund ${v}`,
    free: 'free',
    rotate: 'R: rotate',
    dragHint: 'drag to lay a line',
    /** a dragged run's straights, its crossings and curves told apart */
    runPieces: (n: number, kind: string) => `${n} x ${kind}`,
    runCurves: (n: number) => `+${n} curve${n === 1 ? '' : 's'}`,
    /** while a drag turns: R swaps which leg runs first */
    dragTurn: 'R: turn at the other corner',
  },
  toolbar: {
    /** the categories of the build bar */
    track: 'Track',
    buildings: 'Buildings',
    tools: 'Tools',
    works: 'Works',
    /** the types of Buildings */
    stations: 'Stations',
    town: 'Town',
    services: 'Services',
    /** the types of Tools */
    trackTools: 'Track',
    electrification: 'Electrification',
    /** the types of Works */
    rawMaterials: 'Raw materials',
    processing: 'Processing',
    power: 'Power',
    demolish: 'Demolish',
    /**
     * What comes back is `rules.refundRate` of the listed cost (`Builder.refund`), so neither what a
     * level, a dear tile or a repeat added nor anything in the level editor, where `percent` is null.
     */
    demolishTip: (percent: number | null) =>
      percent === null
        ? 'Click what you built to take it down.'
        : `Click what you built to take it down. ${percent}% of its listed cost comes back.`,
    /** the line over the bar while Demolish is on */
    demolishOn: (percent: number | null) =>
      percent === null
        ? 'Demolish: click what you built · X or Esc: stop'
        : `Demolish: click what you built · ${percent}% of its listed cost comes back · X or Esc: stop`,
    demolishKeys: 'X · Right-click or Delete removes with any tool',
    upgrade: 'Upgrade',
    downgrade: 'Downgrade',
    upgradeHint: 'Raises track one line: Branch to Main, Main to Trunk. Costs the difference.',
    downgradeHint: 'Lowers track one line: Trunk to Main, Main to Branch. Free.',
    /** Upgrade's cost line: the price depends on the piece */
    upgradeCost: 'the difference',
    select: 'Select',
    /** the toolbar category of roads, and the road tool in it (#328) */
    roads: 'Roads',
    road: 'Road',
    roadDesc:
      'Walkers prefer roads and go faster along them. A street door near a road is joined to it for free. Drag to lay a run.',
    cycleHint: '1–9 item · Shift+Q / E category · Tab next · R turn · Esc close',
    typeHint: '1–9 piece · Q / E type · Shift+Q / E category · Tab next · R turn · Esc close',
    /** the last line of a tooltip of the bar */
    keyHint: (key: string) => `Key ${key}`,
    typeKeys: 'Q / E',
    prevType: 'Previous type',
    nextType: 'Next type',
    typeStep: 'Steps through the types of this category; locked ones are skipped.',
    /** the headings of the build card */
    secCost: 'Cost',
    secMakes: 'Makes',
    secWhere: 'Where it goes',
    secRun: 'The run you are laying',
    /** `BuildingDef.perWeek` counts runs of the recipe, not units of its output */
    batches: (n: number) => `${n} batches a week`,
    runSize: (tiles: number, curves: number) =>
      `${tiles} tile${tiles === 1 ? '' : 's'} · ${curves} curve${curves === 1 ? '' : 's'}`,
    /** the foot of the build card */
    foot: {
      run: 'Drag: lay a run, with a curve where it turns',
      drag: 'Drag: lay a run',
      /** Upgrade and Downgrade lay nothing: they work on track that stands */
      reclass: 'Click: one piece · Drag: along the line',
      click: 'Click: place',
      paint: 'Drag: paint',
      turn: 'R: turn',
      cancel: 'Right-click: remove or cancel',
    },
    bridges: 'Bridges',
    bridgeDesc: (capacity: number, flavor: string) => `${capacity} t capacity. ${flavor}`,
    place: {
      track: 'On grass, forest, sand or hill. Not on rock; water needs a bridge.',
      bridge: 'Only on a water tile, joining track on both banks.',
      bridgePlatform: 'On water. Lay track on the platform after building it.',
      station:
        'On grass, forest, sand or a level hill tile with track touching one side; that track becomes the platform.',
      /**
       * A station held to its own ground (`standOn`, `needsWater`), by `StationDef.id`; one
       * without a line here says `station`.
       */
      stationOn: {
        pump: 'On grass or forest with water right beside it, and track touching one side; that track becomes the platform.',
      } as Record<string, string>,
      depot:
        'Two by two tiles, free. R rotates: the four gates lie on two opposite sides; lay track up to them. One depot per nine owned chunks.',
      town: 'On grass, forest, sand or a level hill tile with track touching one side, at least 25 tiles from any other Townhouse.',
      onTrack: 'On an existing track tile. R rotates.',
      service: (r: number) => `On a free tile within ${r} tiles of the stations it should serve.`,
      powerLine:
        'On track or any free tile. Poles link within 2 tiles of each other and of a Power Plant; rails within 1 tile of a live pole are powered.',
      building: 'On a free grass, forest, sand or level hill tile.',
      works:
        'On a free grass, forest, sand or level hill tile. Runs from the nearest store; no track needed.',
      deposit: (k: string) =>
        `Only on a tile with a ${k} deposit (marked on the map). Runs from the nearest store; no track needed.`,
      plant:
        'On a free grass, forest, sand or level hill tile. Chain Power Line poles from it to reach the rails.',
      reclass:
        'Click a piece or drag along the line. A piece that does not fit stays as it was, shown in red.',
      road: 'On grass, forest, sand or hill, never on a building: it meets one at its street door. Crosses plain straight Narrow Gauge, Branch or Main Line track at right angles, as a level crossing; never Trunk Line.',
    },
    trackDesc: {
      straight_branch: 'Branch Line straight. Drag to lay a run of straights.',
      curve_branch:
        'Two by two tiles, radius one and a half: room for long trains to turn. The inner corner tile is blocked. R rotates.',
      switch_branch:
        'Two by two tiles: one line splits into two. Lay a straight beside its far end and the branch bends into a parallel track. R rotates through both handings.',
      crossing_branch_branch: 'Two Branch Lines cross without connecting.',
      bridge_branch: 'Spans one tile of water. Only on water.',
      straight_narrow: 'Narrow Gauge straight. Only narrow trains run on it. Drag to lay a run.',
      curve_narrow: 'Narrow Gauge quarter turn on one tile: for tight spaces. R rotates.',
      switch_narrow: 'Narrow Gauge switch on one tile. R rotates through both handings.',
      crossing_narrow_narrow: 'Two Narrow Gauge lines cross at grade.',
      crossing_narrow_branch:
        'A Narrow Gauge line crosses a Branch Line at grade without joining it. R swaps which line runs which way.',
      straight_main:
        'Main Line straight: concrete sleepers on a wide bed, for Destroyers and smaller. Joins Branch and Trunk Line directly. Drag to lay a run.',
      curve_main:
        'Three by three tiles, radius two and a half: long trains take it faster. The inner tiles are blocked. R rotates.',
      switch_main:
        'Three by three tiles: a Main Line splits into two. Lay a straight beside its far end and the branch bends into a parallel track. R rotates through both handings.',
      crossing_main_main: 'Two Main Lines cross without connecting.',
      crossing_branch_main:
        'A Branch Line crosses a Main Line without connecting. R swaps which line runs which way.',
      straight_trunk:
        'Trunk Line straight: heavy rail on wide concrete sleepers and dark basalt, for every class. Joins Branch and Main Line directly. Drag to lay a run.',
      curve_trunk:
        'Four by four tiles, radius three and a half: room for the longest trains. The inner tiles are blocked. R rotates.',
      switch_trunk:
        'Four by four tiles: a Trunk Line splits into two. Lay a straight beside its far end and the branch bends into a parallel track. R rotates through both handings.',
      crossing_trunk_trunk: 'Two Trunk Lines cross without connecting.',
      crossing_branch_trunk:
        'A Branch Line crosses a Trunk Line without connecting. R swaps which line runs which way.',
      crossing_main_trunk:
        'A Main Line crosses a Trunk Line without connecting. R swaps which line runs which way.',
    } as Record<string, string>,
    trackClass: {
      narrow: 'Narrow Gauge',
      branch: 'Branch Line',
      main: 'Main Line',
      trunk: 'Trunk Line',
      maglev: 'Maglev Guideway',
      hyperloop: 'Hyperloop Tube',
    } as Record<string, string>,
    supply: {
      third_rail: 'Third rail',
      catenary: 'Catenary',
      hv_catenary: 'HV catenary',
    } as Record<string, string>,
    supplyDesc: {
      third_rail:
        'A live rail beside the track. Cheap, no masts, slow: contact-shoe stock only. Drag along track.',
      catenary:
        'Mast and wire per tile. The standard pantograph supply; high-speed sets run under it at the standard ceiling. Drag along track.',
      hv_catenary:
        'Heavier masts and wire for high-speed pantographs. Standard electrics cannot draw from it unless multi-system. Drag along track.',
    } as Record<string, string>,
    placeSupply: 'On track within six tiles of a powered battery to be live. R does nothing here.',
  },
  building: {
    title: (name: string, level: number) => `${name} · Level ${level}`,
    recipe: 'Recipe',
    rate: 'Current rate',
    maxRate: 'Full rate',
    status: 'Status',
    progress: 'Batch progress',
    crew: 'Crew',
    made: 'Produced so far',
    inStock: (n: string) => `${n} in store`,
    running: 'Running',
    full: 'Stopped: store full',
    starved: (n: string) => `Waiting for ${n}`,
    /**
     * The same status for the works tooltip, which shows the resource as an icon with its name
     * (`{res}`). Keep the two worded alike; a test holds them together.
     */
    waiting: 'Waiting for {res}',
    /** shown where the input a works waits for cannot be named */
    unknownInput: '?',
    or: 'or',
    bridgeCapacity: 'Bridge capacity',
    /** "half speed" is `BRIDGE_SLOW_FACTOR` in src/sim/bridges.ts; reword it if that changes. */
    bridgeLimit: (capacity: number, slowAbove: number) =>
      `${capacity} t · half speed above ${slowAbove} t`,
    /** the works tooltip's recipe line, each side a list of amounts and resources */
    recipeLine: '{input} → {output}',
    recipeAlt: '{input} (or {alt}) → {output}',
    bridgeHint:
      'Lay track on this platform. Connected straight rails form a continuous span. The weakest platform sets the route limit; upgrade every platform for a heavier train.',
  },
  upgrade: {
    /**
     * `hours` is rounded up to a whole hour; with none left the time is not shown. An empty `cost`
     * (nothing to pay) is left out the same way.
     */
    button: (level: number, cost: string, hours: number) =>
      `Upgrade to level ${level}${cost ? ` · ${cost}` : ''}${hours > 0 ? ` · ${Math.ceil(hours)} h` : ''}`,
    /** Rounded up and never "0 h left": an upgrade still running has at least an hour to go. */
    running: (level: number, hours: number) =>
      `Upgrading to level ${level} · ${Math.max(1, Math.ceil(hours))} h left`,
    closed: 'Closed while it is upgraded',
    done: (name: string, level: number) => `${name} is now level ${level}`,
  },
  notice: {
    more: (n: number) => `+${n} more`,
    outOfFuel: (n: string) => `${n}: out of fuel or water`,
    noPower: (n: string) => `${n}: no power on this line`,
    overweight: (n: string) => `${n}: too heavy for its engines`,
    noRoute: (n: string) => `${n}: no route to its next stop`,
    stuck: (n: string, sec: number) => `${n}: has not moved for ${sec} s`,
    ecoMode: (n: string) => `${n}: low on fuel, crawling to save it`,
    held: (n: string) => `${n}: held by traffic`,
    junction: (level: string, x: number, y: number, trains: number, wait: number) =>
      `${level} junction at ${x},${y}: ${trains} trains, ${wait} s lost`,
    junctionLevel: {
      info: 'Busy',
      minor: 'Congested',
      major: 'Jammed',
      critical: 'Gridlocked',
    } as Record<string, string>,
    orphaned: (n: string) => `${n}: no platform track`,
    unwired: (n: string) => `${n}: no power line connected`,
    starved: (n: string, r: string) => `${n}: waiting for ${r}`,
    noStore: (n: string, range: number) => `${n}: no store within ${range} tiles`,
    full: (n: string) => `${n}: store full, output stopped`,
    storeFull: (n: string, goods: string) => `${n}: store full of ${goods}`,
    contractFailed: (n: string) => `Contract failed: ${n}`,
    contractDone: (n: string) => `Contract completed: ${n}`,
    contractAtRisk: (n: string) => `Contract running out of time: ${n}`,
    contractOffered: (n: string) => `New contract offered: ${n}`,
    arrived: (train: string, station: string) => `${train} arrived at ${station}`,
    contractNoTrain: (n: string) => `No train can work "${n}": wrong wagons, no rails or no range`,
    famine: 'Crews are out of food',
  },
  alerts: {
    title: 'Notifications',
    open: 'Open',
    matrix: 'Alerts and notices',
    defaults: 'Defaults',
    defaultsHint: 'Back to the starting channels and switches',
    close: 'Close',
    goTo: 'Go to',
    criticalPause: 'Always pause on a critical alert',
    group: 'Group the same alert from many trains into one icon',
    /** a click cycling through the instances: what one says and its place among them */
    cycle: (text: string, at: number, of: number) => `${text} (${at}/${of})`,
    hidden: (n: number) => `${n} more`,
    plus: (n: number) => `+${n}`,
    type: {
      nofuel: 'Out of fuel or power',
      stuck: 'Train stuck',
      ctfail: 'Contract failed',
      noroute: 'No route',
      full: 'Storage full',
      starved: 'Works short of input',
      contract: 'Contract at risk',
      jam: 'Junction congested',
      slow: 'Train running slow',
      note: 'Note',
      done: 'Contract completed',
      offer: 'New contract offered',
      goal: 'Age goal reached',
      arrived: 'Train arrived',
    },
    severity: {
      critical: 'Critical',
      problem: 'Problem',
      attention: 'Needs attention',
      info: 'Info',
    },
    channel: {
      popup: 'Popup',
      pause: 'Pause',
      icon: 'Alert icon',
      pin: 'Map pin',
      toast: 'Toast',
    },
  },
  advisor: {
    button: 'Advisor',
    title: 'Advisor',
    silence: 'Silence',
    unsilence: 'Unsilence',
    silencedHint: 'The advisor is silenced. Unsilence it to see tips again.',
    allGood: 'Nothing to advise right now. Keep the trains rolling.',
    tips: {
      noStations:
        'Build a producing station (farm, lumber yard, quarry or pump) and a second station, joined by track.',
      oneStation:
        'Build a second station and connect the two with track so a train has somewhere to go.',
      noPlatform: (n: string) =>
        `${n} has no track next to it. Lay a straight piece touching the station.`,
      noTrain:
        'Open the Depot (F), pick the locomotive and wagons and press Dispatch. The route is automatic.',
      idleStock: (n: number) =>
        `${n} locomotive(s) sit idle in the depot. Dispatch them to earn more.`,
      lowWheat: (store: string) =>
        `Food is running low at ${store}. Bring wheat from a farm and build a Windmill, or buy food on the Market (K).`,
      famine:
        'The crews need food: production halved. Supply a Windmill or buy food on the Market (K).',
      outOfFuel: (n: string) =>
        `${n} is out of fuel. Fill the store (Market K, a kiln or a lumber yard for wood) or use Emergency refuel in the train details.`,
      lowCoal:
        'Coal is short. Build a Charcoal Kiln (Works) to turn wood into coal, or buy coal on the Market.',
      noWater:
        'No water source. Build a Water Pump station or a Water Tower so steam engines can refill.',
      unwired: (n: string) =>
        `${n} is not connected. Chain Power Line poles from it to the rails (Tools).`,
      noPower: (n: string) =>
        `${n} needs powered rails: build a Power Plant and Power Line poles along its route.`,
      chunk: (v: string) =>
        `You can afford a new chunk (${v}). Press M and click an Uncharted chunk to expand.`,
      offers: (n: number) => `${n} contract offer(s) are waiting in Contracts (C).`,
      failed: (n: string) =>
        `Contract "${n}" failed. Accept only contracts your trains already pass through, and watch the deadline.`,
      capFull: (r: string, store: string) =>
        `${store} is full of ${r}. A Warehouse raises a town's cap and holds goods of its own; or sell on the Market.`,
      blocked: (n: string) =>
        `${n} is stuck behind another train. Add a passing loop with switches or a second track.`,
    },
  },
  trainSide: {
    title: 'Trains in view',
    titleAll: 'All trains',
    none: 'No trains in service.',
    noneVisible: 'No trains on screen.',
    tilesPerSec: 'tiles/s',
    speed: 'Speed',
    capacity: 'Capacity',
    tanks: 'Tanks',
    fuel: 'Fuel',
    engines: 'Engines',
    perTile: '/ tile',
    perWeek: 'Per week',
    consumes: 'Consumes',
    collects: 'Collects',
    delivers: 'Delivers',
    noData: 'after first loop',
    hoverHint: 'Hover a train to trace its path',
    onContract: (n: string, dest: string) => `on contract: ${n} → ${dest}`,
    queuedContracts: (n: number) => `+${n} queued`,
    refuelAll: 'Refuel all · 2×',
    refuelAllHint: 'Fill every train at twice the resource cost',
    refuelViewHint: 'Fill trains in view at twice the resource cost',
    refuelled: 'Trains refuelled to full at twice the resource cost',
    refuelShort: 'Not enough fuel and water to fill this group; no resources spent',
  },
  depot: {
    title: 'Depot',
    trains: 'Trains in service',
    consist: 'Consist',
    route: 'Route (looped)',
    newTrain: 'New train',
    noTrains: 'No trains yet. Pick a locomotive and wagons; the route is automatic.',
    routeAuto: 'Automatic route',
    routeCustom: 'Custom route',
    routeDynamic: 'Dynamic',
    from: 'Roll out of',
    rollOut: 'Roll-out',
    gateAt: (d: string, x: number, y: number, first: string) =>
      `${d}: gate at ${x},${y}, first stop ${first}`,
    show: 'Show',
    servedBy: (n: number) => `${n} station${n === 1 ? '' : 's'} on this depot's rails`,
    groupStatic: 'Static',
    groupDynamic: 'Dynamic',
    routeMode: {
      auto: 'Schedule (auto)',
      custom: 'Schedule (custom)',
      transport: 'Transport',
      contract: 'Contract',
      freight: 'Freight',
    } as Record<string, string>,
    routeHint: {
      auto: 'Static: visits every station with platform track, nearest first, and empties into the depot. Edit stops, dwell times and conditions later in the train details.',
      custom:
        'Static: your stop list, in order. Per stop: what to load and unload, wait for full wagons, minimum and maximum dwell, refuel, departure direction. The train never changes the plan by itself.',
      transport:
        'Dynamic: carries passengers. Heads for the Station with the most people waiting and takes them to the nearest other town. Needs coaches. Re-plans at every stop and refuels on its own.',
      contract:
        'Dynamic: works contracts. Waits on its platform until a contract it can carry is accepted, is chosen for it ahead of busier trains, runs it origin to destination and returns to waiting. Refuels on its own.',
      freight:
        'Dynamic: heads for the producer with the fullest, biggest pile within reach, then tops up at another producer while room is left, and takes the goods to the nearest store with room: a depot, a warehouse or a Townhouse. Never takes goods out of a store, and a producer in a town puts its goods into the town store itself. Re-plans at every stop and refuels on its own.',
    } as Record<string, string>,
    dynamicTag: 'dynamic',
    routeAutoHint:
      'The train visits every station with platform track, nearest first, and empties into the depot. Change stops later in the train details.',
    locate: 'Locate',
    editRoute: 'Route',
    recall: 'Recall',
    locomotive: 'Locomotive',
    wagons: 'Wagons',
    noFreeLoco: 'No free locomotives. Recall a train or craft one in the works.',
    noFreeWagons: 'No free wagons.',
    speed: 'Speed',
    power: 'Power',
    weight: 'Weight',
    empty: 'Empty',
    pickLoco: 'Pick a locomotive',
    maxWagons: (n: number) => `This locomotive pulls at most ${n} wagons`,
    stops: 'Stops',
    noStops: 'No stops. Add stations below.',
    addStop: 'Add stop',
    noStations: 'Build stations first.',
    applyRoute: 'Apply route',
    dispatch: 'Dispatch',
    namePlaceholder: 'Train name',
    needTwoStops: 'Route needs at least two stops',
    routeApplied: (n: string) => `${n}: route updated`,
    dispatched: (n: string) => `${n} dispatched`,
    editingConsist: (n: string) => `Editing route of ${n}. Recall it to change its consist.`,
    cargo: (n: number) => `${n}u aboard`,
    fuelHint: (v: string) => `Running cost per tile from ${v}`,
    details: 'Details',
    haul: (w: number, p: number) => `Wagons ${w} t of ${p} t the engines can haul (before cargo)`,
    physics: (effort: number, mass: number, accel: number, vmax: number) =>
      `Effort ${effort} · mass ${mass} t · ${accel.toFixed(2)} tiles/s² · top ${vmax.toFixed(2)} tiles/s`,
    deadWeight: (type: string) => `dead weight: no ${type.toLowerCase()} locomotive`,
    controlClass: (c: string) => `control class ${c}`,
    scheduleHint: 'Stops, loading and departure direction are edited in the train details.',
    scheduleLiveHint:
      'Changes apply at once. Each stop: what to load and unload, wait for full wagons, refuel, and which way to leave.',
    fuelTag: 'refuel',
    waterTag: 'water',
    opt: {
      loadAuto: 'Load: auto',
      loadNone: 'Load: nothing',
      unloadAuto: 'Unload: depot / warehouse / buyer',
      unloadAll: 'Unload: all',
      unloadNone: 'Unload: nothing',
      departAuto: 'Depart: auto',
      departForward: 'Depart: forward',
      departReverse: 'Depart: reverse',
      waitFull: 'Wait full',
      minDwell: 'Stay at least (s)',
      maxDwell: 'Leave after (s)',
      refuel: 'Refuel',
      pass: 'Pass through',
      plain: 'stop, load, unload',
    },
    salvaged: (v: string) => `Cargo aboard salvaged for ${v}`,
    state: {
      moving: 'En route',
      loading: 'At platform',
      waiting: 'Waiting for platform',
      yielding: 'Pulled aside for traffic',
      idle: 'Idle: nothing worth hauling yet',
      held: 'Held behind a train',
      noRoute: 'No route',
      stranded: 'Stranded',
      noFuel: 'Out of fuel',
      noPower: 'No power',
      overweight: 'Overweight',
    } as Record<string, string>,
  },
  modes: {
    leading: 'Leading',
    multiple: 'Multiple',
    doubleHeaded: 'Double-headed',
    standby: 'Standby',
    /** a standby unit that has stepped in */
    rescuing: 'standby, pulling',
    /** a working unit without usable power */
    dormant: 'no usable power',
    hint: 'Multiple: same control class as the leader, full effort. Double-headed: 82% of the summed effort. Standby: dead weight until the pulling units lose fuel or the wire.',
  } as Record<string, string>,
  contracts: {
    title: 'Contracts',
    sideTitle: 'Contracts',
    offers: 'Offers',
    active: 'Active',
    history: 'Recent',
    accept: 'Accept',
    decline: 'Decline',
    deadline: 'Deadline once accepted',
    timeLeft: 'Time left',
    offerExpires: (t: string) => `offer expires in ${t}`,
    noOffers: 'No offers right now. New ones arrive every few hours.',
    needStations: 'Offers appear once a station produces something another station accepts.',
    noActive: 'No active contracts.',
    noHistory: 'Nothing delivered yet.',
    done: 'Delivered',
    failed: 'Deadline missed',
    expired: 'Expired',
    accepted: (n: string) => `${n} accepted`,
    activeFull: (n: number) =>
      `Your land supports ${n} active contract${n === 1 ? '' : 's'}. Finish one or buy land to take on more.`,
    completed: (n: string, pay: string) => `${n} delivered: ${pay}`,
    failedMsg: (n: string, fine: string) => `${n} failed: fined ${fine}`,
    autoOn: 'Auto-accept: on',
    autoOff: 'Auto-accept: off',
    autoHint:
      'On: offers are accepted as they come, while your land has room for another active contract; the rest wait here. Off: offers wait here for you. Finer control per rarity is in Settings.',
    stats: (done: number, failed: number) => `${done} delivered · ${failed} failed`,
    offersBadge: (n: number) => `${n} new`,
    sideEmpty: 'No active contracts.',
    sideEmptyOffers: 'Offers waiting on the board.',
    dailyTicket: "Daily bonus: +1 ticket for yesterday's deliveries",
    cancelFine: (fine: string) => `Cancel (fine ${fine})`,
    cancelled: 'Cancelled',
    cancelledMsg: (n: string, fine: string) => `${n} cancelled: fined ${fine}`,
    cancelTitle: 'Cancel contract',
    confirmCancel: (n: string, fine: string) => `Cancel "${n}"? The fine is ${fine}.`,
    /** The no of that question: the contract stays. */
    keepContract: 'Keep',
    train: 'Train',
    noTrain: 'No train can work this',
    rarity: {
      common: 'Common',
      uncommon: 'Uncommon',
      rare: 'Rare',
      epic: 'Epic',
      legendary: 'Legendary',
    } as Record<string, string>,
  },
  gacha: {
    title: 'Rolling Stock Works',
    banners: 'Banners',
    pull: 'Pull',
    rates: 'Rates',
    rules: (pity: number) => `SSR guaranteed within ${pity} pulls. 10x guarantees at least one R.`,
    pity: (n: number, max: number) => `Pity ${n} / ${max}`,
    pull1: (c: number) => `Pull x1 (${c} ticket)`,
    pull10: (c: number) => `Pull x10 (${c} tickets)`,
    poolSize: (n: number) => `${n} items in the pool`,
    idleHint: 'Tickets come from contracts and daily deliveries. No real money, ever.',
    noTickets: 'Not enough tickets',
    loco: 'Locomotive',
    wagon: 'Wagon',
    newItem: 'NEW',
    dupe: (n: number, need: number) => `Duplicate: ${n} / ${need} to next level`,
    levelUp: (l: number) => `Level up! Now Lv ${l}`,
    guaranteed: 'guaranteed',
    collect: 'Collect',
    ssrToast: (n: number) => `${n} SSR pulled!`,
    featured: (days: number, pct: number) =>
      `Featured (rate-up ${pct}% of their rarity) · rotates in ${days}d`,
    featuredBadge: 'featured',
  },
  craft: {
    title: 'Crafting',
    recipes: 'Recipes',
    unlock: 'Unlock a recipe',
    kind: 'Kind',
    age: 'Age',
    ages: ['Age of Steam', 'Diesel Era', 'Electric Line'] as string[],
    quality: {
      N: 'Common',
      R: 'Uncommon',
      SR: 'Rare',
      SSR: 'Epic',
      L: 'Legendary',
    } as Record<string, string>,
    known: (have: number, total: number) => `${have} / ${total} recipes known`,
    noPool: 'No models of this kind in this age.',
    unlockHint: (n: number) =>
      `Pay once, choose one of ${n} recipe cards. A card you already know pays back in materials instead.`,
    unlockBtn: (price: string) => `Unlock recipe (${price})`,
    drawPending: 'Choose a card first',
    pickTitle: 'Choose one recipe to keep',
    pickHint: 'The other cards are gone once you choose.',
    ownedBadge: (refund: string) => `Known: refunds ${refund}`,
    newBadge: 'New recipe',
    keep: 'Keep',
    recipeLearned: (name: string) => `Recipe learned: ${name}`,
    recipeRefund: (name: string, refund: string) => `${name} was already known: ${refund} refunded`,
    cost: 'Cost',
    failChance: (pct: number) => `${pct}% chance to fail`,
    copies: (n: number) => `${n} in the roster`,
    craftBtn: 'Craft',
    missing: (what: string) => `Missing: ${what}`,
    noRecipes: 'No recipes yet. Unlock one on the left.',
    crafted: (name: string) => `${name} built and added to the roster`,
    failed: (name: string, refund: string) => `${name} failed on the bench: ${refund} recovered`,
    failedNothing: (name: string) => `${name} failed on the bench; the materials are lost`,
    stats: (recipes: number, crafts: number, failures: number) =>
      `${recipes} recipes · ${crafts} built · ${failures} failed`,
    /** the workshop's foot: the materials of the selected store, named */
    resources: (label: string) => `Materials at ${label}`,
    filterLabel: 'Vehicle type',
    filter: {
      all: 'All railcraft',
      steam: 'Steam',
      diesel: 'Diesel',
      electric: 'Electric',
      bulk: 'Bulk wagons',
      mineral: 'Mineral wagons',
      liquid: 'Tank wagons',
      people: 'Passenger coaches',
    } as Record<string, string>,
    search: 'Find model…',
    searchLabel: 'Find model',
    inspect: 'Inspect 3D',
  },
  vehicle: {
    body: (size: string, tiles: number, plan: string) =>
      `${size} · ${tiles} tile${tiles === 1 ? '' : 's'} · ${plan}`,
    weight: (t: number) => `${t} t empty`,
    loco: (type: string, speed: number, haul: number) =>
      `${type} · ${speed.toFixed(2)} tiles/s · ${haul} t haul`,
    bogie: (bogies: number, wheels: number) => `${bogies} × ${wheels} wheels`,
    axles: '2 axles · 4 wheels',
    fuel: (cap: number, perTile?: number) => `Fuel ${cap} · ${perTile} per tile`,
    water: (cap: number, perTile?: number) => `Water ${cap} · ${perTile} per tile`,
    wagon: (carries: string, units: number) => `${carries} · ${units} units`,
    /** the body plans of `src/sim/body.ts`, by id */
    plan: {
      rigid: 'Rigid body',
      tender: 'Engine and tender',
      garratt: 'Garratt articulated',
      meyer: 'Meyer articulated',
    } as Record<string, string>,
    angle: 'Viewing angle',
    pause: 'Pause rotation',
    rotate: 'Rotate',
    hint: 'Rotating isometric preview · drag to turn',
  },
  roster: {
    help: 'Everything you own. Filter and sort; a spare copy can level a model; locomotives without in-cab signalling can be fitted with it here, for the in-cab signalling level. Trains are put together in the Depot.',
    sizeLabel: 'Size',
    sizes: { tiny: 'Tiny', small: 'Small', medium: 'Medium', large: 'Large' } as Record<
      string,
      string
    >,
    fitInCab: (cost: number) => `Fit in-cab signalling ($${cost.toLocaleString()})`,
    fitInCabHint:
      'Where the line is worked by in-cab signalling, an equipped locomotive may follow closer behind the train ahead.',
    fitted: (n: string) => `${n} fitted with in-cab signalling`,
    hasInCab: 'in-cab signalling fitted',
    alreadyFitted: 'Already fitted with in-cab signalling',
    noMoney: 'Not enough money',
    size: {
      tiny: 'tiny (half a tile)',
      small: 'small',
      medium: 'medium (2 tiles)',
      large: 'large (3 tiles)',
    } as Record<string, string>,
    title: 'Roster',
    kind: 'Kind',
    rarity: 'Rarity',
    sort: 'Sort',
    all: 'All',
    name: 'Name',
    level: 'Level',
    newest: 'Newest',
    freeOnly: 'Unassigned only',
    count: (n: number) => `${n} items`,
    empty: 'Nothing matches.',
    copies: (n: number) => `${n} copies`,
    lv: (l: number) => `Lv ${l}`,
    levelUp: 'Level up',
    levelUpHint: 'Consumes one spare unassigned copy of this model',
    leveled: (name: string, level: number) => `${name} is now Lv ${level}`,
    capacity: 'Capacity',
    crew: 'crew',
    type: { steam: 'Steam', diesel: 'Diesel', electric: 'Electric' } as Record<string, string>,
    carries: {
      liquid: 'Liquids (water, oil, diesel)',
      mineral: 'Minerals (coal, stone, iron, ores, sand)',
      bulk: 'Bulk (wood, wheat, wire)',
      people: 'Passengers',
    } as Record<string, string>,
    fuelLine: (l: {
      type: string;
      fuelCap?: number;
      fuelPerTile?: number;
      waterCap?: number;
      waterPerTile?: number;
      powerPerTile?: number;
    }) =>
      l.type === 'steam'
        ? `Steam · ${l.fuelCap} fuel, ${l.waterCap} water · ${l.fuelPerTile}/${l.waterPerTile} per tile`
        : l.type === 'diesel'
          ? `Diesel · ${l.fuelCap} oil · ${l.fuelPerTile} per tile`
          : `Electric · ${l.powerPerTile} power per tile`,
    serviceLine: (service: string, cap: number) =>
      `Refuelling cart: +${cap} ${service === 'battery' ? 'power' : service === 'fuel' ? 'oil' : 'coal'}, 10% less use per cart (${service === 'coal' ? 'steam' : service === 'fuel' ? 'diesel' : 'electric'} engines only)`,
    maxLevel: 'Max level',
    dupeProgress: (n: number, need: number) => `Duplicates ${n} / ${need} to next level`,
    assignedTo: (n: string) => `In service: ${n}`,
    inDepot: 'In depot',
  },
  settings: {
    signalling: 'Signalling',
    signalLevel: {
      auto: 'Automatic',
      token: 'Token',
      absolute_block: 'Absolute block',
      ctc: 'CTC',
      in_cab: 'In-cab',
    } as Record<string, string>,
    signalHint: {
      auto: 'Keeps trains apart as before.',
      token: 'One train per plain section, whichever way it runs.',
      absolute_block:
        'Semaphores hold trains out of an occupied block; trains keep 10 tiles apart.',
      ctc: 'Trains keep 6 tiles apart.',
      in_cab: 'Trains keep 3 tiles apart; equipped stock only.',
    } as Record<string, string>,
    signallingNote: 'Semaphores work under every level above Token.',
    title: 'Settings',
    saves: 'Saves',
    /** The tab of the contract offers; the well in it says the rest. */
    contractsTab: 'Contracts',
    appliesAtOnce: 'Settings apply at once.',
    thisGame: 'This game',
    audio: 'Audio',
    master: 'Master volume',
    sfx: 'Effects',
    music: 'Music',
    ambient: 'Nature and weather',
    audioNote:
      'Pastoral Pulse opens each session, then its four arrangements play in shuffled order. Nature sounds follow the weather and time of day.',
    gameplay: 'Gameplay',
    edgeScroll: 'Edge scrolling',
    autosave: 'Autosave (every minute)',
    dayNight: 'Day / night cycle',
    smoke: 'Locomotive smoke',
    weather: 'Weather and seasons',
    showFps: 'Show FPS',
    controls: 'Controls',
    /**
     * The key table of the Controls tab, by group. `short` rows take half a line. Every key of the
     * keymap has its place here (`settingsKeys.test.ts`).
     */
    keyGroups: [
      {
        title: 'Camera',
        rows: [
          { keys: ['W A S D'], text: 'Pan the map; the arrow keys too' },
          { keys: ['Middle-drag'], text: 'Pan the map' },
          { keys: ['Wheel'], text: 'Zoom in and out' },
          { keys: ['M'], text: 'Overview map, and back' },
          { keys: ['R', 'Enter'], text: 'Overview: record stops for the picked train, finish' },
        ],
      },
      {
        title: 'Time',
        rows: [
          { keys: ['Space'], text: 'Pause and resume' },
          { keys: ['+', '−'], text: 'Faster, slower' },
        ],
      },
      {
        title: 'Screens',
        short: [
          { keys: ['F'], text: 'Depot' },
          { keys: ['C'], text: 'Contracts' },
          { keys: ['G'], text: 'Crafting' },
          { keys: ['V'], text: 'Roster' },
          { keys: ['K'], text: 'Market' },
          { keys: ['`'], text: 'Debug panel' },
        ],
        rows: [
          { keys: ['Esc'], text: 'Close the top screen or panel; with nothing open, the Menu' },
        ],
      },
      {
        title: 'Building',
        rows: [
          { keys: ['1–5'], text: 'Open a build category' },
          { keys: ['1–9'], text: 'Pick an item of the open category' },
          { keys: ['Tab'], text: 'Next item; Shift+Tab the previous' },
          { keys: ['Q', 'E'], text: 'Previous and next type' },
          { keys: ['Shift+Q', 'Shift+E'], text: 'Previous and next category' },
          { keys: ['R'], text: 'Turn the piece' },
          { keys: ['U', 'Shift+U'], text: 'Upgrade and downgrade track' },
          { keys: ['X'], text: 'Demolish' },
          { keys: ['Right-click', 'Delete'], text: 'Remove' },
          { keys: ['Esc'], text: 'Close the tool' },
        ],
      },
      {
        title: 'Undo',
        rows: [
          { keys: ['Ctrl+Z'], text: 'Undo the last step' },
          { keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], text: 'Redo it' },
        ],
      },
    ],
    controlsText:
      'WASD / arrows / middle-drag pan · wheel zoom · M overview · 1-5 build category, then 1-9 item · Tab next item · Q / E type · Shift+Q / E category · R rotate · U upgrade track, Shift+U downgrade · X demolish · Right-click / Delete remove · Ctrl+Z undo · Ctrl+Y redo · Esc cancel · Space pause · + / − speed · F depot · C contracts · G craft · V roster · K market · ` debug',
    contractPolicy: 'Contract offers by rarity',
    contractPolicyHint:
      'Auto-accept takes the offer at once while your land has room for another active contract, and otherwise leaves it on the board; Ask leaves it on the board; Auto-deny drops it (free).',
    policy: { accept: 'Auto-accept', prompt: 'Ask', deny: 'Auto-deny' } as Record<string, string>,
    slots: 'Named saves',
    slotName: 'Save name',
    saveAs: 'Save as',
    loadSlot: 'Load',
    deleteSlot: 'Delete',
    noSlots: 'No named saves yet. Type a name and press Save as.',
    slotSaved: (n: string) => `Saved as "${n}"`,
    saveAsTitle: 'Save game as',
    saveAsHint: 'Name for this save. An existing save with the same name is replaced.',
    /** Why Save now and Save as are off at the title screen with no game under it. */
    saveOff: 'No game is being played yet: Continue or start a new game, then save.',
    diagnostics: 'Copy diagnostics',
    diagnosticsHint:
      'Diagnostics = this save plus the traffic log (stuck episodes, blocked time, junctions). Paste it into a bug report.',
    copied: 'Copied to the clipboard',
    slotDeleted: (n: string) => `Deleted "${n}"`,
    confirmDelete: (n: string) => `Delete the save "${n}"?`,
    version: 'Save format',
    save: 'Save now',
    load: 'Load last save',
    newGame: 'New game',
    newGameNote: 'Generates a fresh map. Leave the seed empty for a random one.',
    seedPlaceholder: 'seed (optional)',
    confirmNew: 'Start a new game? The current save will be replaced on the next autosave.',
    supply: 'Production chain',
    transfer: 'Transfer',
    transferHint:
      'Export, Import and Copy diagnostics share this box: paste a save here to import it.',
    exportSave: 'Export to text',
    formatNote:
      'Every save carries a format version. Older saves are upgraded step by step on load; newer ones load as they are. Fields this build does not know are kept and written back.',
    olderToast: (v: number) => `Save converted from format v${v}: check the Notices`,
    newerToast: (v: number) => `Save from a newer build (format v${v}) loaded with defaults`,
    olderSave: (from: number, to: number, notes: string[]) =>
      `Deprecated save: written as format v${from}, loaded as v${to}. ${notes.length ? 'Filled in: ' + notes.join('; ') : 'Nothing needed filling in'}. Saving writes v${to}.`,
    newerSave: (from: number, to: number) =>
      `Save from a newer build: format v${from}, this build reads v${to}. Data it does not understand is kept and written back; features it relies on may be missing or defaulted.`,
    importSave: 'Import from text',
    confirmImport: 'Replace the current game with the pasted save?',
    saved: 'Game saved',
    migrated:
      'The map grew: your land now sits in the middle of a larger world. Trains returned to the depot.',
    loaded: 'Save loaded',
    saveFailed: 'Could not save (storage full or blocked)',
    /** A save the player asked for (Save now, Save as), refused because the game holds a NaN. */
    saveBroken: 'Could not save: the game holds a broken value. Your last save is kept.',
    /** An autosave refused for the same reason; shown once until some save has gone through. */
    autosaveBroken: 'Autosave stopped: the game holds a broken value. Your last save is kept.',
    /**
     * A save the game made on its own (the minute autosave, the ground stored on load) refused by
     * storage; shown once until some save has gone through.
     */
    autosaveFailed:
      'Autosave failed: storage is full or blocked, so progress since your last save is not kept. Deleting a named save can free space.',
    noSave: 'No save found',
    badSave: 'Save data unreadable',
  },
  saves: {
    autosave: 'Autosave',
    detail: (day: number, age: string, money: string) => `Day ${day} · ${age} · ${money}`,
    /** How long ago a save was written, from milliseconds; whole units, rounded down. */
    ago: (ms: number) => {
      if (!(ms >= 60_000)) return 'just now';
      const min = Math.floor(ms / 60_000);
      if (min < 60) return `${min} min ago`;
      const h = Math.floor(min / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.floor(h / 24);
      return `${d} day${d === 1 ? '' : 's'} ago`;
    },
    saved: (ago: string) => `saved ${ago}`,
    /**
     * Continue's time line at the title screen: it loads the stored game, which the minute
     * autosave and the pause menu's Save both write. A named save's row says `saved` instead.
     */
    lastAutosave: (ago: string) => `last autosave ${ago}`,
    /**
     * Continue over a game being played goes back to that game, not to a save; `ago` is when it
     * was last stored, null when it has not been.
     */
    inProgress: (ago: string | null) =>
      ago ? `in progress · last autosave ${ago}` : 'in progress',
    autosaveStatus: (on: boolean, ago: string | null) =>
      !on ? 'off' : ago ? `on · last saved ${ago}` : 'on · not saved yet',
    confirmOverwrite: (n: string) => `A save named "${n}" already exists. Replace it?`,
    /** Titles of the in-game dialog that asks before a save is replaced, deleted or loaded. */
    overwriteTitle: 'Replace save',
    deleteTitle: 'Delete save',
    loadTitle: 'Load save',
    importTitle: 'Import save',
    /** Asked before the settings screen's Load replaces a game in progress with the stored one. */
    confirmLoadLast: 'Load the last save? Unsaved progress in the current game is lost.',
    olderFormat: (v: number) => `format v${v}, upgraded on load`,
    newerFormat: (v: number) => `format v${v}, from a newer game`,
    refused: {
      json: 'That text is not save data.',
      notSave: 'That is not a Terepasztal save.',
      damaged: 'That save is damaged and was not loaded. Your game is unchanged.',
      storage: 'Could not store that save (storage full or blocked). Your game is unchanged.',
      tooLarge: "This save's map is larger than the game can build.",
    },
    /** `refund` is the text of `saves.refund`; with nothing refunded its sentence is left out. */
    pruned: (list: string, refund: string) =>
      `This save held things the game no longer has. Removed: ${list}.${refund ? ` Refunded ${refund}.` : ''}`,
    /** Money and tickets given back; `money` is already formatted, empty when none. */
    refund: (money: string, tickets: number) => {
      const t = `${tickets} ticket${tickets === 1 ? '' : 's'}`;
      if (tickets <= 0) return money;
      return money ? `${money} and ${t}` : t;
    },
    /**
     * A loaded save stores the ground of `n` chunks in a form this game cannot read (damaged, or
     * written by a newer game): that land is generated again for this session, and the stored
     * ground is kept as it was.
     */
    groundUnreadable: (n: number) =>
      `The stored ground of ${n} chunk${n === 1 ? '' : 's'} of this map could not be read. That land was generated again for this session and may not match what was built on it; the stored ground is kept.`,
    /** The ground generated as a save loaded (an older save's, land the map grew) was not stored. */
    groundUnsaved:
      'Could not store the ground of the land just generated. It is stored with the next save that goes through.',
    /**
     * At start-up, `n` saves from before saves kept their ground could not be stored with it
     * (storage full or blocked); each gets it when it is loaded.
     */
    groundRefused: (n: number) =>
      `Storage is full or blocked: ${n} saved game${n === 1 ? '' : 's'} could not store the ground of ${n === 1 ? 'its' : 'their'} map. ${n === 1 ? 'It gets' : 'Each gets'} it when loaded.`,
  },
  menu: {
    tagline: 'Rails, contracts and the luck of the draw',
    continue: 'Continue',
    newGame: 'New game',
    tuning: 'Game tuning',
    content: 'Content editor',
    credits: 'Credits',
    modified: '(modified)',
    levels: 'Levels',
    noLevels: 'No saved levels yet. Create one below or import a level.',
    levelStations: (n: number) => `${n} stations`,
    play: 'Play',
    edit: 'Edit',
    delete: 'Delete',
    deleteLevelTitle: 'Delete level',
    confirmDelete: (n: string) => `Delete level "${n}"?`,
    playLevelTitle: 'Play level',
    editLevelTitle: 'Edit level',
    /** The editor's play test: its question replaces the stored game. */
    playTestTitle: 'Play test',
    newLevel: 'New level',
    blank: 'Blank',
    generated: 'Generated',
    importLevel: 'Import level',
    importHint: 'Paste a level JSON here',
    paused: 'Paused',
    resume: 'Resume',
    saveAs: 'Save as...',
    loadGame: 'Load game',
    savedGames: 'Saved games',
    noSaves: 'No named saves yet. Use "Save as..." in the pause menu.',
    day: (d: number) => `Day ${d}`,
    confirmLoad: (n: string) => `Load "${n}"? Unsaved progress in the current game is lost.`,
    /** Loading a named save when no game is being played: it still replaces the stored game. */
    confirmLoadStored: (n: string) =>
      `Load "${n}"? It replaces the saved game that Continue goes back to.`,
    backToEditor: 'Back to editor',
    mainMenu: 'Main menu',
    /** New game, Play level and the editor's play test over a stored game, with none being played. */
    confirmReplace: 'This replaces the current saved game. Continue?',
    /**
     * New game and Play level over a game being played: it is replaced, whether or not a stored
     * game exists (`stored`), and only a stored game may be called saved.
     */
    confirmReplaceGame: (stored: boolean) =>
      stored
        ? 'This replaces the game in progress and the saved game. Progress since the last save or autosave is lost. Continue?'
        : 'This replaces the game in progress, which has not been saved or autosaved. Its progress is lost. Continue?',
    /** Edit level and New level over a game being played: it is left, the stored game is kept. */
    confirmLeaveGame:
      'This leaves the game in progress. Progress that is not saved or autosaved is lost. Continue?',
    menuButton: 'Menu',
    menuKeyHint: 'Esc opens and closes the menu when no tool is in hand',
    supply: 'Production chain',
    /** The New game block's choice of the rules the game starts with, shown once a tuning is saved. */
    newGameTuning: 'Tuning',
    newGameTuningHint:
      'The rules the new game starts with: the shipped rules, or a tuning kept in Game tuning',
    shippedRules: 'Shipped rules',
    /** `n` is the pick as it was named; the game was not started. */
    tuningUnusable: (n: string) =>
      `The tuning "${n}" could not be used, so no new game was started`,
    supplyModes: { simple: 'Simple', full: 'Full' } as Record<string, string>,
    supplyHint: {
      simple:
        'Kiln, grinder and refinery make coal, iron and oil from stored goods; diesels burn oil; the stores on one rail network share their goods.',
      full: 'Collieries on coal seams, iron and copper mines, ironworks, oil derricks on seeps, a refinery making diesel, sand for grip and copper wire. Warehouses refuel only from what trains bring.',
    } as Record<string, string>,
  },
  credits: {
    title: 'Credits',
    intro: 'Terepasztal is built with the work of these creators. Thank you!',
    required: 'Used under a licence that asks for credit',
    requiredNote:
      "Changes: each model was cleaned up, scaled, repainted where needed and rendered into the game's sprites.",
    thanks: 'With thanks',
    thanksNote: 'These licences ask for no credit; their creators are listed here with our thanks.',
    by: (author: string) => `by ${author}`,
    usedFor: (names: string) => `In the game: ${names}`,
    source: 'Source',
    licence: 'Licence',
  },
  prompt: {
    ok: 'OK',
    keep: 'Keep',
    yes: 'Yes',
    no: 'No',
    /** The answers of the dialog name what they do. */
    delete: 'Delete',
    load: 'Load',
    replace: 'Replace',
    import: 'Import',
    start: 'Start',
    play: 'Play',
    edit: 'Edit',
    leave: 'Leave',
    discard: 'Discard',
    buy: 'Buy',
  },
  kit: {
    esc: 'Esc',
    back: 'Back',
    done: 'Done',
    backHint: 'Back · Esc',
    /** The × of a screen, with the hotkey that closes it too. */
    closeHint: (key: string | null) =>
      key && key !== 'Esc' ? `Close · Esc or ${key}` : 'Close · Esc',
    hotkey: (key: string) => `Hotkey: ${key}`,
    pausedHint: 'The clock stands still while a menu is open.',
    clear: 'Clear',
  },
  editor: {
    terrainDesc: 'Paint this terrain. Anything built on the tile is cleared.',
    title: 'Level editor',
    name: 'Name',
    size: 'Size',
    description: 'Description shown in the level list',
    start: 'Player start',
    startTier: 'Start age (0 steam, 1 diesel, 2 electric, 3 nuclear, 4 magnetic, 5 hyper)',
    brush: 'Terrain brush',
    brushHint:
      'Pick a terrain in the toolbar, drag to paint. Painting clears anything built on the tile.',
    fill: (t: string) => `Fill ${t}`,
    regenerate: 'Regenerate map',
    file: 'Level',
    save: 'Save level',
    saveAs: 'Save as...',
    playTest: 'Play test',
    exit: 'Exit to menu',
    saved: (n: string) => `Level "${n}" saved`,
    saveFailed: 'Could not save the level (storage full?)',
    badLevel: 'That is not a level file',
    unsaved: 'Unsaved changes will be lost. Continue?',
    unsavedTitle: 'Unsaved changes',
    hint: 'Editor: free building, all regions open, clock stopped. Esc for the menu.',
    terrain: 'Terrain',
    levelDown: 'Level -',
    levelUp: 'Level +',
    newName: 'Level name',
  },
  tuning: {
    title: 'Game tuning',
    newGameOnly: 'new game',
    note: 'Values tagged new game count only when a new game starts from a tuning that sets them.',
    reset: 'Reset this game to shipped rules',
    scope:
      'Changes apply to the game in play and are saved with it; they do not change what new games start from. A tuning kept as a preset can be picked under New game on the title screen.',
    presets: 'Presets',
    presetName: 'Preset name',
    savePreset: 'Save as preset',
    loadPreset: 'Load',
    deletePreset: 'Delete',
    noPresets: 'No presets yet. Save the current rules under a name to keep them.',
    overwritePresetTitle: 'Replace preset',
    confirmOverwritePreset: (n: string) => `A preset named "${n}" already exists. Replace it?`,
    deletePresetTitle: 'Delete preset',
    confirmDeletePreset: (n: string) => `Delete the preset "${n}"?`,
    presetSaved: (n: string) => `Preset "${n}" saved`,
    presetSaveFailed: (n: string) => `Could not save the preset "${n}" (storage full or blocked)`,
    loadPresetTitle: 'Load preset',
    confirmLoadPreset: (n: string) =>
      `Load the preset "${n}"? It replaces the tuning of the game in play and changes nothing for new games.`,
    presetLoaded: (n: string) => `Preset "${n}" loaded`,
    presetDeleted: (n: string) => `Preset "${n}" deleted`,
  },
  content: {
    title: 'Content editor',
    tabs: {
      locomotives: 'Locomotives',
      wagons: 'Wagons',
      cargo: 'Cargo',
      stations: 'Stations',
      contracts: 'Contracts',
      decor: 'Decor',
      buildings: 'Buildings',
      gacha: 'Gacha',
      track: 'Track',
      crafting: 'Crafting',
      houses: 'Houses',
    } as Record<string, string>,
    customActive: 'Custom content active',
    shipped: 'Shipped content',
    /** tooltip of a tab whose table this session loaded from a stored edit */
    customTab: 'Runs on your stored edit of this table',
    setAsideTitle: 'Stored edits not applied this session. Apply or Reset deletes them for good.',
    setAsideStale: (tab: string) => `${tab}: the shipped table changed after this edit was made`,
    setAsideInvalid: (tab: string, problems: string) =>
      problems ? `${tab}: the edit is invalid (${problems})` : `${tab}: the edit is invalid`,
    levels: 'Level table',
    entries: 'Entries',
    config: 'Configuration',
    duplicate: 'Duplicate',
    remove: 'Remove',
    add: 'Add entry',
    /** an optional field the entry leaves out: the game's own default applies */
    unset: 'default',
    /** a locomotive without its own length is as long as its size */
    unsetLength: 'from size',
    /** an optional flag set on the entry */
    flagOn: 'yes',
    flagOff: 'no',
    export: 'Export JSON',
    import: 'Import JSON',
    jsonHint: 'bundle JSON',
    badJson: 'Invalid JSON',
    reset: 'Reset to shipped data',
    resetTitle: 'Discard custom content',
    confirmReset: 'Discard all custom content and reload?',
    apply: 'Apply and reload',
    applyNote: 'Applying reloads the page; the current game is saved first.',
  },
  train: {
    title: 'Train',
    consist: 'Consist and tanks',
    tripStats: 'Loop statistics',
    gone: 'This train is no longer in service.',
    state: 'State',
    note: 'Note',
    speed: 'Top speed',
    crew: 'Crew',
    haul: 'Hauled weight / engine power (t)',
    engines: 'Engines',
    fuel: 'Fuel',
    water: 'Water',
    oil: 'Oil',
    power: 'Power',
    stockPower: (n: number) => `${n} on the grid`,
    battery: 'Battery carts',
    effort: 'Tractive effort',
    mass: 'Mass',
    acceleration: 'Acceleration',
    pulling: (n: number) => `${n} pulling`,
    locoLevel: (name: string, level: number) => `${name} Lv${level}`,
    standby: 'Standby',
    engage: 'Engage',
    perTile: 'Use per tile',
    range: 'Range on current tanks',
    tiles: 'tiles',
    prefer: 'Steam fuel:',
    routing: 'Routing',
    /** the crew owes more than a day of food (`Train.hungry`) */
    hungry: 'Crew hungry: runs slower until it reaches a store with food',
    clickHint: 'Click to select',
    /** the train tooltip's state and the station the train heads for */
    toward: '{state} → {station}',
    weightPower: (weight: number, power: number) => `${weight} / ${power} t`,
    mode: {
      schedule: 'Schedule',
      transport: 'Transport',
      contract: 'Contract',
      freight: 'Freight',
    } as Record<string, string>,
    modeHint: {
      schedule: 'Static: follows the stop list below exactly.',
      transport: 'Dynamic: passengers between Stations.',
      contract: 'Dynamic: carries accepted contracts from origin to destination.',
      freight:
        'Dynamic: fullest producer first, tops up at another producer while room is left. The goods go to the nearest store with room (depot, warehouse or Townhouse); nothing is taken out of a store. Re-plans at every stop and refuels on its own.',
    } as Record<string, string>,
    coal: 'Coal',
    wood: 'Wood',
    lastLoop: 'Last loop',
    currentLoop: 'Current loop',
    noTrip: 'No completed loop yet.',
    distance: 'Distance',
    fuelUsed: 'Consumed',
    refuelled: 'Refuelled',
    gathered: 'Gathered',
    delivered: 'Delivered',
    income: 'Income',
    emergency: 'Emergency refuel (2x cost)',
    emergencyHint:
      "Fills the tanks at double cost from the store in reach of the train: its town's, or the " +
      'nearest one within building reach. Its crew pays what it owes there.',
    emergencyDone: (s: string) => `Delivered by road: ${s}`,
    emergencyNone: 'Nothing to send in the store in reach',
    emergencyNoStore: 'No store in reach of the train to send from',
  },
  market: {
    title: 'Market',
    resource: 'Resource',
    have: 'In store',
    buyPrice: 'Buy',
    sellPrice: 'Sell',
    buy: 'Buy',
    sell: 'Sell',
    full: 'The store is full',
    nothingToBuy: 'Nothing to buy',
    nothingToSell: 'None in the store to sell',
    /** the market's head: the store it buys into and sells from (the selected one) */
    store: (label: string) => `Trading at ${label}. Pick another store on the top bar.`,
    /** the store the standing deals settle with (`TradeDesk.storeKey`) */
    dealsAt: (label: string) => `Deals settle at ${label}`,
    trend: 'Trend',
    driftPct: (p: number) => `${p >= 0 ? '+' : ''}${p}%`,
    driftHint: 'Fuel prices (oil, diesel, crude) wander up to ±40 % on a slow weekly walk.',
    hint: 'Prices are per unit. A store holds up to its cap of each good.',
    deals: 'Standing deals',
    dealsHint: (d: number) =>
      `Buy or sell a set amount every ${d} day${d === 1 ? '' : 's'}, settled automatically at a slightly better rate than the spot market. Buying stops at the store's cap or when funds run out; selling takes what is on hand.`,
    dealBuy: 'Buy / cycle',
    dealSell: 'Sell / cycle',
    perCycle: 'Money / cycle',
    dealSummary: (v: string, days: number) =>
      `Net ${v} per cycle · next settlement in ${days} day${days === 1 ? '' : 's'}`,
    settled: (lines: string) => `Trade deals settled: ${lines}`,
  },
  res: {
    power: 'Power (battery)',
    population: 'Population',
    populationHint:
      'Residents live within the capacity of finished Houses. Residents and crews eat food each week; Windmills turn wheat into food.',
    people: 'People',
    /** the population tooltip: food eaten, as "Eats: 12.0 food / week" */
    eats: 'Eats',
    perWeek: '/ week',
    /** the passengers tooltip: travellers waiting at the player's stations */
    waiting: 'Waiting at stations',
    famine: 'NO WHEAT',
    openMarket: 'Open the market',
    have: 'In store / cap',
    /** the top bar's card: the good in every store together */
    allStores: (n: number) => `All stores: ${n}`,
    /** the top bar's store button: what a click does */
    nextStore: 'The store the bar shows. Click: the next store',
    producedDay: 'Received / last week',
    consumedDay: 'Spent / last week',
    /** the resource tooltip's links: what makes it, what uses it, where trains take it */
    madeBy: 'Made by',
    usedBy: 'Used by',
    takenAt: 'Trains take it at',
    funds: 'Funds',
    fundsHint: 'Earned by deliveries and contracts. Pays for engines and wagons.',
    info: {
      water: 'From Water Pumps. Steam engines drink it; the refinery and power plant use it.',
      wheat: 'From farms. A Windmill turns each wheat into at least 5 food.',
      food: 'Bread from Windmills. Feeds residents and crews weekly; upgrades improve the wheat-to-food ratio.',
      stone: 'From quarries. Builds track and buildings; the grinder turns it into iron.',
      wood: 'From lumber yards. Builds almost everything; the kiln turns it into coal; steam engines can burn it.',
      coal: 'From charcoal kilns or the Market. Steam engine fuel and power plant feed.',
      oil: 'From the refinery or the Market. Diesel engine fuel; the power plant can burn it too.',
      iron: 'From the stone grinder or the Market. Switches, signals, power lines and works.',
      power:
        'From power plants, stored in the battery. Electric engines draw it while on powered rails.',
      iron_ore: 'From iron mines on stony ground. The ironworks smelts it with coal into iron.',
      crude: 'From oil derricks on oil seeps. The refinery distils it into diesel.',
      diesel: 'From the refinery or the Market. What diesel engines burn.',
      sand: 'From sand pits. Every train spreads a little on the rails for grip.',
      copper_ore: 'From copper mines on stony ground. The wire mill draws it into wire.',
      wire: 'From the wire mill. Electrification is strung from it.',
    } as Record<string, string>,
  },
  /** train classes (specs/track-classes.md): the smallest track line a vehicle runs on */
  trainClass: {
    corvette: 'Corvette',
    frigate: 'Frigate',
    destroyer: 'Destroyer',
    cruiser: 'Cruiser',
    carrier: 'Carrier',
    hydrofoil: 'Hydrofoil',
    submarine: 'Submarine',
  } as Record<string, string>,
  /** tooltips of the line and class badges (src/ui/lineBadge.ts) */
  badge: {
    line: (cls: string) => `Built for ${cls} class trains.`,
    cls: (cls: string) => `${cls} class`,
    step: (step: number, of: number, line: string) =>
      `Size ${step} of ${of}. Needs ${line} or bigger.`,
    carrier: (step: number, of: number, line: string) =>
      `Size ${step} of ${of}, reactor-powered. Needs ${line}.`,
    ownNetwork: (line: string) => `Runs only on ${line}.`,
    age: 'Available from this age.',
    rarity: 'How rare the model is.',
    contractRarity: 'How rare the contract is.',
  },
  compat: {
    wrongNetwork: (line: string) => `not built for ${line}`,
    tooBig: (cls: string, line: string) => `a ${cls} is too big for ${line}`,
    runsOn: (cls: string, lines: string[]) =>
      lines.length ? `${cls} · runs on ${lines.join(', ')}` : `${cls} · runs on no track yet`,
    foreAft: (v: number, t: number) =>
      `bogies slide ${v.toFixed(2)} tiles along the body, limit ${t.toFixed(2)}`,
    gap: (v: number, t: number) =>
      `body sits ${v.toFixed(2)} tiles off the rail, limit ${t.toFixed(2)}`,
    lateral: (v: number, t: number) =>
      `centre bogie sits ${v.toFixed(2)} tiles off its socket, limit ${t.toFixed(2)}`,
    cannotUse: (name: string, cls: string, why: string) => `${name} cannot run on ${cls}: ${why}`,
    gateClass: (x: number, y: number, present: string, name: string, needs: string) =>
      `Gate ${x},${y}: ${present}; ${name} needs ${needs}`,
    gateNoTrack: (x: number, y: number) => `Gate ${x},${y}: no track`,
    gateStub: (x: number, y: number) => `Gate ${x},${y}: the track ends right after the gate`,
    gateRoom: (x: number, y: number, run: number, need: number) =>
      `Gate ${x},${y}: ${run.toFixed(1)} tiles of run, the consist is ${need.toFixed(1)} long`,
    gateBusy: (x: number, y: number) => `Gate ${x},${y}: a train stands on it`,
    gateNoRoute: (x: number, y: number, s: string) =>
      `Gate ${x},${y}: no route to ${s} the consist may use`,
    blockedAt: (name: string, x: number, y: number, cls: string) =>
      `${name} cannot pass ${cls} at ${x},${y}`,
    deployable: 'Can roll out here',
  },
  fleet: {
    noDepot: 'Build a depot first: trains roll out of one',
    mixedGauge: 'A train cannot mix Narrow Gauge and standard stock.',
    mixedGaugeTrain: 'Narrow Gauge and standard stock in one train: recall it and build it again',
    wrongDepot: (name: string) => `${name} builds only trains of its own gauge.`,
    noNarrowDepot: 'Build a Narrow Depot first: Narrow Gauge trains roll out of one',
    depotBusy: (n: string) => `Every gate at ${n} has a train on it`,
    depotNoGate: (n: string) => `${n} has no track at its gates`,
    depotNoRoute: (d: string, s: string) =>
      `No free gate at ${d} connects to ${s}. Lay track from a gate, or wait for a gate to clear.`,
    needLoco: 'A train needs at least one locomotive',
    tooManyLocos: (n: number) => `At most ${n} locomotives`,
    tooManyWagons: (n: number) => `At most ${n} wagons`,
    locoUnavailable: 'Locomotive unavailable',
    wagonUnavailable: 'Wagon unavailable',
    tooHeavy: (w: number, p: number) => `Wagons weigh ${w} t, engines haul ${p} t`,
    needTwoStops: 'Route needs at least two stations',
    missingStation: 'Missing station',
    noPlatform: (n: string) => `${n} has no platform track`,
    platformBusy: (n: string) => `A train stands on every platform at ${n}`,
    cannotPlace: 'Could not place train',
  },
  topbar: {
    depot: 'Depot',
    contracts: 'Contracts',
    gacha: 'Gacha',
    craft: 'Crafting',
    roster: 'Roster',
    market: 'Market',
    settings: 'Settings',
    cheat: 'Cheat',
    cheated: '+$10,000 and every resource topped up',
  },
  stores: {
    grid: 'Power grid',
    /** the eaters at a store went short for too long (`StoreRegistry.tickUpkeep`) */
    famine: (name: string) => `${name}: the crews are out of food: production halved`,
    /** a store in famine has food again, or nobody left to feed */
    fed: (name: string) => `${name}: food is back; crews are fed again`,
    /** a works with no store in reach (`StoreRegistry.worksStore`) */
    noStoreNear: (range: number) => `No store within ${range} tiles`,
  },
  town: {
    title: 'Towns',
    none: 'No towns yet. Place a Townhouse, then a House and a warehouse within 7 tiles of it.',
    people: 'people',
    summary: (st: number, works: number, houses: number) =>
      `${st} station${st === 1 ? '' : 's'}, ${works} works, ${houses} house${houses === 1 ? '' : 's'}`,
    needs: (house: boolean, wh: boolean) =>
      `Not founded yet: needs ${[house ? 'a House' : '', wh ? 'a warehouse' : ''].filter(Boolean).join(' and ')} within 7 tiles`,
    /** the town store's fullest good against its cap per good */
    store: (fullest: number, cap: number) => `Store: up to ${fullest} of a good, cap ${cap} each`,
    makes: 'Makes / week',
    uses: 'Uses / week',
    /** power among what a town makes or uses, lowercase like the cargo names beside it */
    power: 'power',
    go: 'Go',
    rename: 'Rename',
    namePrompt: 'Name the town',
    nameHint:
      'Every station inside the town carries this name. Change it any time from the town panel.',
    renamed: (n: string) => `Town renamed to ${n}`,
    founded: (n: string) => `${n} is a town now`,
    housing: (res: number, cap: number, building: number) =>
      `Housing: ${res} / ${cap}${building ? ` (+${building} under construction)` : ''}`,
    growth: (perWeek: number) => `Growth: +${perWeek} people / week`,
    noGrowth: 'Growth: none (no food)',
    growthCapped: 'Growth stops at available housing capacity; food is required',
    capacityHint: 'Build or upgrade Houses to increase capacity',
    nextHouse: (at: number, mul: number) =>
      `Next house at ${at} residents${mul > 1 ? ` (traffic ×${mul})` : ''}`,
    fullHousing: 'Housing full; build or upgrade Houses to provide room',
    spawned: (town: string, n: number) =>
      `${town} is building ${n === 1 ? 'a new house' : `${n} new houses`}`,
    newcomers: (town: string, n: number) => `${n} newcomers moved into ${town}`,
    firstTrain: (town: string, n: number) =>
      `The first train reached ${town}: ${n} newcomers moved in`,
  },
  house: {
    level: (l: number) => `Level ${l}`,
    residents: 'Residents',
    building: 'Under construction',
    stages: ['Foundations', 'Framing', 'Roofed'] as readonly string[],
    stage: (name: string, pct: number) => `${name} (${pct}%)`,
    finishedIn: (days: number) => `${days} day${days === 1 ? '' : 's'} to go`,
    growth: 'Next resident',
    growthIn: (days: number) => `in ${days} day${days === 1 ? '' : 's'}`,
    growthNoFood: 'no food, nobody moves in',
    full: 'full',
    makeRoom: 'Upgrade this House to make room for more residents',
    autoUpgrade: (days: number) => `Upgrade to provide more homes (construction: ${days} days)`,
    maxed: 'Largest house',
    finished: 'A House is finished',
  },
  station: {
    depotName: 'Depot',
    renameTown: 'Rename town',
    town: 'Town',
    level: (l: number) => `Level ${l}`,
    biome: 'Biome',
    produces: 'Produces',
    accepts: 'Accepts',
    storage: 'Storage',
    platforms: 'Platforms',
    loadRate: 'Loading',
    perWeek: (v: number) => `${v} / week`,
    perSec: (v: number) => `${v} / s`,
    maxed: 'Max level',
    unlocks: (c: string) => `Next: ${c}`,
    demolish: 'Demolish',
    rename: 'Rename',
    renameTitle: 'Rename station',
    renameHint: 'The new name of this station.',
    nameEmpty: 'A station needs a name',
    noPlatform: 'No adjacent track!',
    orphaned: (n: string) => `${n} lost its platform track`,
    boost: (pct: number) => `Water tower: loading +${pct}%`,
    market: 'Spot market',
    marketHint: 'Paid for cargo without a contract. Demand recovers over a week.',
    contracts: 'Contracts here',
    /**
     * A harvesting station's kind in the plural, by `StationDef.id`: written out, because adding
     * an s spells "quarrys". Every station with a `terrain` needs one, and so does every station
     * a biome's `production` names.
     */
    plural: {
      farm: 'farm halts',
      lumber: 'lumber yards',
      quarry: 'quarries',
      pump: 'water pumps',
      mine: 'iron mines',
      sand_pit: 'sand pits',
      copper_mine: 'copper mines',
    } as Record<string, string>,
    /**
     * The station tooltip a biome tooltip opens: what the station makes at level 1 on bare
     * ground (`{amount}` a week, `{level}` 1), and what makes it more (`{tiles}` the ground it
     * counts, `{radius}` how far it looks).
     */
    makes:
      'Makes {res}: {amount} a week at level {level}, more with {tiles} within {radius} tiles (nearer ones count more) and in a biome that suits it.',
    /** the same for a station that counts no ground */
    makesAnywhere: 'Makes {res}: {amount} a week at level {level}.',
  },
} as const;
