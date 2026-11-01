import { HU } from './data/strings.hu';

/** The languages of the game. English is the default; the setting lives with the settings. */
export const LANGUAGES = ['en', 'hu'] as const;
export type Language = (typeof LANGUAGES)[number];
/** Each language under its own name, as the language control shows it. */
export const LANGUAGE_NAME: Record<Language, string> = { en: 'English', hu: 'Magyar' };
/** A stored value as a language: anything else, an older settings file's nothing, is English. */
export function languageOf(v: unknown): Language {
  return LANGUAGES.find((l) => l === v) ?? 'en';
}
/** Where the settings are stored (`readSettings`); read here for the one field the strings need. */
export const SETTINGS_KEY = 'terepasztal.settings';
function storedLanguage(): Language {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? languageOf((JSON.parse(raw) as { language?: unknown } | null)?.language) : 'en';
  } catch {
    return 'en';
  }
}
/**
 * The language of this page load. The strings are chosen once, here, before any module reads them,
 * so changing the language reloads the page (`Game.switchLanguage`). Nothing in the world or the
 * save depends on it: what the simulation keeps is in English, in `ENGLISH` and the data's names.
 */
export const LANGUAGE: Language = storedLanguage();

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

/**
 * All user-facing strings, in English. `data/strings.hu.ts` mirrors this table: the same keys and the
 * same functions (`Strings`). Read them through `STR`, in the language of the page load.
 */
const EN = {
  title: 'Terepasztal',
  /** how numbers read in this language (`src/ui/numberFormat.ts`) */
  format: {
    decimalMark: '.',
    thousandsMark: ',',
    money: (amount: string) => `$${amount}`,
    days: (days: string) => `${days}d`,
    hoursMinutes: (hours: number, minutes: string) => `${hours}h ${minutes}m`,
  },
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
    /** the era widget's progress toward the next age, a whole percent */
    agePercent: (pct: number) => `${pct}%`,
    day: (d: number) => `Day ${d}`,
    /** by `SPEEDS` index; the buttons show them in `SPEED_ORDER` */
    speed: ['❚❚', '1x', '2x', '3x', '½x'],
    /** a speed button's tooltip: its label and the keys that set it */
    speedKey: (label: string, key: string) => `${label} speed (${key})`,
    pause: 'Pause (Space)',
    resume: 'Resume (Space)',
    /** the weather words of the top bar, by `WeatherKind` */
    sky: { clear: 'Clear', rain: 'Rain', fog: 'Fog' } as Record<string, string>,
    weatherToggle: 'Weather',
    weatherToggleHint: 'Toggle rain, fog and seasons',
    /** the same, in a narrow top bar: the season and weather it no longer shows come first */
    weatherToggleHintNow: (now: string) => `${now}\nToggle rain, fog and seasons`,
    dayToggle: 'Day / night',
    dayToggleHint: 'Toggle the day and night cycle',
    ageUp: (t: number) =>
      `The ${ageLabel(t)} begins. New works, stations and rolling stock unlocked.`,
  },
  /** the now-playing widget of the top bar (src/ui/nowPlaying.ts) */
  nowPlaying: {
    pause: 'Pause the music',
    play: 'Play the music',
    back: 'Previous track',
    /** the first track: there is nothing to go back to */
    noBack: 'No track played before this one',
    forward: 'Next track',
    /** no music file could be played, and the game's own loop plays */
    noTrack: 'Game loop',
    /** in the title's place: Music is off or at 0, or Master is */
    silent: 'Music off',
    /** the buttons say it while they are off */
    silentTip: 'Nothing to hear: Music or Master is off in Audio',
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
    recoloured: (train: string, colour: string) => `Marked ${train} ${colour}`,
    /** why an undo or a redo cannot be done */
    builtOver: 'Something else has been built there since.',
    trainOn: (train: string) => `${train} stands on the track.`,
    trainAt: (train: string, station: string) => `${train} is at the platform of ${station}.`,
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
    /** read through `ageHint` (src/ui/ruleText.ts), which passes the hours between two checks */
    hint: (hours: number) =>
      `An age begins once every goal listed for it is met; under "One of these", one goal is enough. Goals are checked every ${hours === 1 ? 'hour' : `${hours} hours`}. Engines and wagons are sorted by age, but no age locks them; an engine still needs a line that takes its class.`,
    /** a locked item of the build bar: the age that opens it, and the one to reach before that */
    unlocksIn: (age: string) => `Locked. Unlocks in the ${age}`,
    reachFirst: (age: string) => `Reach the ${age} first.`,
    /**
     * What is new in an age (src/ui/ageNews.ts), one line per kind: `{list}` is filled with the
     * things, named or, for a long list, as the count of its `...Count`.
     */
    news: {
      track: 'Track: {list}',
      stations: 'Stations: {list}',
      services: 'Town and services: {list}',
      tools: 'Tools: {list}',
      works: 'Works: {list}',
      electric: 'Electrification: {list}',
      engines: 'Engine recipes: {list}',
      wagons: 'Wagon recipes: {list}',
      contracts: 'Contracts: {list}',
      /** the level the buildings of the first age may reach: later ones start lower */
      level: (age: string, n: number) => `${age} buildings rise to level ${n}`,
      trackCount: (n: number) => `${n} kinds of track`,
      stationsCount: (n: number) => `${n} stations`,
      servicesCount: (n: number) => `${n} kinds of building`,
      toolsCount: (n: number) => `${n} tools`,
      worksCount: (n: number) => `${n} works`,
      electricCount: (n: number) => `${n} supplies`,
      enginesCount: (n: number) => `${n} engines`,
      wagonsCount: (n: number) => `${n} wagons`,
      contractsCount: (n: number) => `${n} kinds`,
    },
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
      'Both arms level: the protected block is occupied, and a train stops at the post before entering it. Red arm raised, yellow arm level: this block is clear but the next is occupied, so a train slows to a crawl at the post, then runs on. Red arm raised, yellow arm lowered: both are clear. A block ends at the next signal facing the same travel direction; with none, it runs to the end of the rails.',
    guideFence:
      'Fence a stretch by putting posts at its entry and exit. Leave at least your longest train plus one tile between posts. Select a signal to highlight its protected stretch. Posts work as soon as you place them, at every signalling level except Token; all track, signalled or not, still uses traffic reservations.',
    guideJunction:
      'Before a junction, put the entry signal on its approach and exit signals beyond each branch, leaving room for a complete train. A train reads a signal along its own route; the arms and the highlight follow the straight road through a switch. Junction reservations still require the exit clear for the whole train plus one tile, so a clear signal alone cannot force a train into a blocked crossing.',
    guideSingleLine:
      'On a two-way single line, put signals on both approaches to a passing loop, facing into the shared line. Keep the loop long enough for the entire train. The Token level above allows one train per shared plain section, but while Token is chosen trains ignore the signals, so use one or the other. Signals regulate entry; they cannot create a missing siding.',
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
  /**
   * A train's note where it is not one of `traffic`'s: the simulation keeps a note in English, and
   * the save holds it; `noteText` (src/ui/noteText.ts) puts it in the language on screen.
   */
  trainNote: {
    service: 'Heading to nearby fuel / water service',
    onContract: (name: string) => `on contract: ${name}`,
    regularRun: 'back on the regular run',
    noTrackToStop: 'no track to the chosen stop',
    noPlatform: (name: string) => `${name} has no platform`,
    parked: 'parked: no way to the chosen stop',
    detouring: 'detouring around an oncoming train',
    rerouted: 'rerouted around traffic',
    ranDry: 'Out of fuel or water',
    outOfFuel: 'out of fuel or water',
    noPower: 'no power on this line',
    tooHeavy: 'too heavy for the engines',
    movingAway: 'moving out of the way',
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
      `+${n} crossing${n === 1 ? '' : 's'}, laid automatically, turned to the line`,
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
      'Walkers prefer roads and go faster along them. A street door near a road is joined to it for free. Drag to lay a stretch of road.',
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
    secRun: 'The stretch you are laying',
    /** `BuildingDef.perWeek` counts runs of the recipe, not units of its output */
    batches: (n: number) => `${n} batches a week`,
    runSize: (tiles: number, curves: number) =>
      `${tiles} tile${tiles === 1 ? '' : 's'} · ${curves} curve${curves === 1 ? '' : 's'}`,
    /** the foot of the build card */
    foot: {
      run: 'Drag: lay a stretch, with a curve where it turns',
      drag: 'Drag: lay a stretch',
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
      straight_branch: 'Branch Line straight. Drag to lay a stretch of track.',
      curve_branch:
        'Two by two tiles, radius one and a half: room for long trains to turn. The inner corner tile is blocked. R rotates.',
      switch_branch:
        'Two by two tiles: one line splits into two. Lay a straight beside its far end and the branch bends into a parallel track. R rotates through both handings.',
      crossing_branch_branch: 'Two Branch Lines cross without connecting.',
      bridge_branch: 'Spans one tile of water. Only on water.',
      straight_narrow:
        'Narrow Gauge straight. Only narrow trains run on it. Drag to lay a stretch of track.',
      curve_narrow: 'Narrow Gauge quarter turn on one tile: for tight spaces. R rotates.',
      switch_narrow: 'Narrow Gauge switch on one tile. R rotates through both handings.',
      crossing_narrow_narrow: 'Two Narrow Gauge lines cross at grade.',
      crossing_narrow_branch:
        'A Narrow Gauge line crosses a Branch Line at grade without joining it. R swaps which line runs which way.',
      straight_main:
        'Main Line straight: concrete sleepers on a wide bed, for Destroyers and smaller. Joins Branch and Trunk Line directly. Drag to lay a stretch of track.',
      curve_main:
        'Three by three tiles, radius two and a half: long trains take it faster. The inner tiles are blocked. R rotates.',
      switch_main:
        'Three by three tiles: a Main Line splits into two. Lay a straight beside its far end and the branch bends into a parallel track. R rotates through both handings.',
      crossing_main_main: 'Two Main Lines cross without connecting.',
      crossing_branch_main:
        'A Branch Line crosses a Main Line without connecting. R swaps which line runs which way.',
      straight_trunk:
        'Trunk Line straight: heavy rail on wide concrete sleepers and dark basalt, for every class. Joins Branch and Main Line directly. Drag to lay a stretch of track.',
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
    /** `slowPct` is `BRIDGE_SLOW_FACTOR` in src/sim/bridges.ts as a percent (`bridgeLimit`) */
    bridgeLimit: (capacity: number, slowAbove: number, slowPct: number) =>
      `${capacity} t · ${slowPct}% speed above ${slowAbove} t`,
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
  outliner: {
    tab: { trains: 'Trains', stations: 'Stations', contracts: 'Contracts', works: 'Works' },
    scopeView: 'In view',
    scopeAll: 'All',
    inView: (n: number) => `${n} in view`,
    inAll: (n: number) => `${n} in all`,
    nothingInView: 'Nothing here in view. Pan the map or switch to All.',
    noTrains: 'No trains in service.',
    noStations: 'No stations yet.',
    noWorks: 'No works yet.',
    ungrouped: 'Ungrouped',
    colourGroup: (colour: string) => `${colour[0].toUpperCase()}${colour.slice(1)}`,
    stripeTip: 'Colour code: click to change',
    renameTip: 'Double-click to rename',
    contractTip: 'Open it in Contracts (C)',
    empty: 'empty',
    storage: 'Storage',
    load: 'Load',
    nextStop: 'Next stop',
    perWeek: (amount: string) => `${amount} / wk`,
    level: (n: number) => `Lv ${n}`,
    /** a status in a word or two, where `depot.state` has the sentence */
    status: {
      moving: 'En route',
      loading: 'Loading',
      waiting: 'Waiting',
      yielding: 'Giving way',
      idle: 'Idle',
      held: 'Held',
      noRoute: 'No route',
      stranded: 'Stranded',
      noFuel: 'Out of fuel',
      noPower: 'No power',
      overweight: 'Overweight',
    },
    stuck: 'Stuck',
    atRisk: 'At risk',
    closed: 'Closed',
    full: 'Full',
    noInput: 'No input',
    noStore: 'No store',
  },
  trainPanel: {
    tab: { overview: 'Overview', stops: 'Stops', consist: 'Consist' },
    follow: 'Follow with the camera',
    following: 'Following: the camera stays on this train until you move it. Click to stop.',
    close: 'Close',
    details: 'Open the Train screen; Esc comes back here',
    topSpeed: (speed: string) => `top speed ${speed}`,
    nextStop: 'Next stop',
    noStop: 'no stop',
    arrival: (tiles: number, time: string) =>
      `${tiles} ${tiles === 1 ? 'tile' : 'tiles'} · ≈ ${time}`,
    cargo: 'Cargo',
    runningEmpty: 'Running empty.',
    supplies: 'Supplies',
    tilesLeft: (n: number) => `≈ ${n} tiles left`,
    range: 'Range',
    unlimited: '∞',
    tiles: (n: number) => `${n} tiles`,
    electric: 'Power',
    week: 'A week, by the last loop',
    income: 'Income',
    afterFirstLoop: 'after the first loop',
    stops: 'Stops',
    repeats: 'repeats',
    engine: 'Engine',
    pulls: 'Pulls',
    train: 'Train',
    wagons: 'Wagons',
    length: 'Length',
    weight: 'Weight',
    noWagons: 'no wagons',
    tons: (n: number) => `${n} t`,
    climb: (speed: string) => `On a climb it slows to ${speed}.`,
    openDepot: 'Open the Depot',
    editStops: 'Edit stops',
    problem: {
      noFuel: 'Its tanks ran dry on the line.',
      noPower: 'No power reaches the line under it.',
      noRoute: 'No track leads to the next stop.',
      stranded: 'The track under it is gone. Lay it again and the train runs on.',
      overweight: 'Its load is more than the engines can pull.',
      stuck: 'It has not moved for a long time.',
      stuckFor: (hours: number) => `Stuck for ${hours} h`,
      hungry: 'Crew hungry',
    },
  },
  stationPanel: {
    tab: {
      overview: 'Overview',
      cargo: 'Cargo',
      trains: 'Trains',
      expansion: 'Expansion',
      timetable: 'Timetable',
    },
    picture: (name: string, level: string, season: string) => `${name} · ${level} · ${season}`,
    stored: (stored: string, cap: string) => `${stored} / ${cap}`,
    /** a store's cap is per good: what the fullest good holds of it */
    storedAGood: (stored: string, cap: string) => `${stored} / ${cap} a good`,
    crew: 'Crew',
    /** whose week's ledger it is: a store's, never one station's */
    storeWeek: (store: string) => `${store}, this week`,
    townStore: (town: string) => `${town} town store`,
    ownStore: 'This store',
    networkStore: 'Rail network store',
    nothingMoved: 'Nothing yet',
    production: 'Production in reach',
    perWeek: 'per week',
    tilesAway: (n: number) => `${n} ${n === 1 ? 'tile' : 'tiles'}`,
    residents: 'Residents in reach',
    waitingNow: 'Waiting now',
    nothingWaiting: 'Nothing is waiting.',
    cargoHere: 'Cargo at this station',
    thisWeek: 'this week',
    waiting: 'Waiting',
    inWeek: 'In',
    outWeek: 'Out',
    noCargo: 'No goods here yet.',
    carriedTo: (place: string) => `Its workers carry what it makes to the store of ${place}.`,
    accepts: 'Takes',
    calling: 'Trains calling here',
    noTrains: 'No train calls here yet.',
    atPlatform: 'At the platform',
    queued: 'Waiting for a platform',
    arrives: (time: string) => `Arrives in ≈ ${time}`,
    onItsWay: 'On its way here',
    boundFor: (stop: string) => `Now bound for ${stop}`,
    onItsRoute: 'On its route',
    nextLevel: (level: number) => `Next: level ${level}`,
    topLevel: 'Top level',
    levels: 'Levels',
    levelShort: 'Lv',
    loadPerSec: 'Loading / s',
    makesAWeek: 'Makes a week',
    makesShort: 'Makes / wk',
    /** a passenger station's: the people around it can hold it lower */
    atMostAWeek: 'At most a week',
    atMostShort: 'At most / wk',
    adds: (goods: string) => `Adds ${goods}`,
    arrivals: 'Arrivals',
    noArrivals: 'No train is on its way here.',
    now: 'Now',
    inQueue: 'Queued',
    inAbout: (time: string) => `≈ ${time}`,
    leavesFor: (stop: string) => `then ${stop}`,
    platformUse: 'Platform use',
    inUse: 'In use',
    waitingForOne: 'Waiting for one',
  },
  trainSide: {
    tilesPerSec: 'tiles/s',
    speed: 'Speed',
    perTile: '/ tile',
    consumes: 'Consumes',
    collects: 'Collects',
    delivers: 'Delivers',
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
    freeCount: (n: number) => `${n} free`,
    clearConsist: 'Clear',
    clearHint: 'Take every vehicle off the train',
    useDepot: (n: string) => `Use ${n}`,
    barredFold: (n: number) => `${n} more cannot roll out of this depot`,
    barredHide: 'Hide what cannot roll out',
    again: 'Build another',
    againHint:
      'A new train like this one: the same models from the free stock, its route and depot',
    againTitle: 'Replace the train being built?',
    againText: (n: string) =>
      `Build another like ${n}? What the draft holds now goes back to the stock.`,
    againYes: 'Replace',
    likeMissing: (list: string) => `Not free: ${list}`,
    likeDiffers: (list: string) => `Another level or fitting: ${list}`,
    inCabTag: 'In-cab',
    customShort: 'With fewer than two stops it runs the automatic route.',
    toRoster: 'Roster',
    toRosterHint: 'Open this vehicle in the Roster, over the Depot; Back returns here',
    scopeHere: (n: number) => `This depot (${n})`,
    scopeAll: (n: number) => `All (${n})`,
    noTrainsHere: 'No train has rolled out of this depot yet.',
    noHome: 'No depot',
    gaugeName: { regular: 'Standard gauge', narrow: 'Narrow gauge' } as Record<string, string>,
    trainCount: (n: number) => `${n} train${n === 1 ? '' : 's'}`,
    gateOpen: 'Gate free',
    gateShut: 'Cannot roll out',
    stripHint: 'A click takes it off · drag or ← → moves it',
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
    inService: (n: string) => `${n} is in service: recall it to change its consist.`,
    wagonsCount: (n: number) => `${n} wagon${n === 1 ? '' : 's'}`,
    routeTab: 'Route',
    recallTitle: 'Recall train',
    confirmRecall: (n: string) => `Recall "${n}" to the depot?`,
    recallDetail: (units: number) =>
      `It leaves the line; its locomotives and wagons go back to the free stock. ${
        units > 0 ? `The cargo aboard (${units} u) is salvaged for money.` : 'Nothing is aboard.'
      }`,
    recallHint: 'Back to the depot; the cargo aboard is salvaged for money',
    locateHint: 'Close the Depot and follow the train on the map',
    detailsHint: 'Open the Train screen over the Depot; Back returns here',
    showHint: 'Look at the depot behind the screen and mark the gate the train would leave by',
    nameHint: 'Train name, 24 characters. Left empty, the game names it.',
    cartLine: (resource: string, cap: number) => `Refuelling cart · +${cap} ${resource}`,
    dynamicPlans: 'It plans its own stops; the list applies under Schedule.',
    stopSum: {
      loadNone: 'loads nothing',
      unloadAll: 'unloads all',
      unloadNone: 'unloads nothing',
      waitFull: 'waits for full wagons',
      refuel: 'refuels',
      pass: 'passes through',
      departForward: 'leaves forward',
      departReverse: 'leaves in reverse',
      atLeast: (s: number) => `at least ${s} s`,
      leaveAfter: (s: number) => `leaves after ${s} s`,
      plain: 'stops, loads, unloads',
    },
    next: 'next',
    moveUp: 'Move up',
    firstStop: 'Already the first stop',
    removeStop: 'Remove the stop',
    add: 'Add',
    noPlatformHint: (n: string) => `${n} has no platform track`,
    stopLoad: 'Load',
    stopUnload: 'Unload',
    stopDepart: 'Depart',
    auto: 'Auto',
    nothing: 'Nothing',
    all: 'All',
    forward: 'Forward',
    reverse: 'Reverse',
    dwellMin: 'Stay at least',
    dwellMax: 'Leave after',
    dwellUnit: 's',
    dwellMinHint: 'Stay at least this many seconds, 0 to 600',
    dwellMaxHint: 'Leave after this many seconds at the latest, 0 to 600; 0: the usual limit',
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
    /** {doubled}: the percent `modesHint` reads from `physics.doubleHeadEfficiency` */
    hint: 'Multiple: same control class as the leader, full effort. Double-headed: {doubled}% of the summed effort. Standby: dead weight until the pulling units lose fuel or the wire.',
  } as Record<string, string>,
  contracts: {
    title: 'Contracts',
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
    autoLabel: 'Auto-accept',
    autoSubOn: 'On: offers are accepted as they come.',
    autoSubOff: 'Off: offers wait here for you.',
    seeOffers: 'See offers',
    autoSubMixed: 'Each rarity follows its own setting.',
    perRarity: 'Per rarity: Settings',
    perRarityHint: 'Open the offer policy of each rarity on the Settings tab.',
    /** the tab with the offer policy of each rarity */
    settingsTab: 'Settings',
    autoAllTitle: 'Auto-accept every rarity?',
    autoAllText:
      'Each rarity now follows its own setting. This sets all five to Auto-accept and replaces what you chose for each.',
    autoAllYes: 'Set all five',
    /** an order's size: units and cargo */
    cargoAmount: (n: number, cargo: string) => `${n} u ${cargo}`,
    autoHint:
      'On: offers are accepted as they come, while your land has room for another active contract; the rest wait here. Off: offers wait here for you. Finer control per rarity is on the Settings tab.',
    stats: (done: number, failed: number) => `${done} delivered · ${failed} failed`,
    offersBadge: (n: number) => `${n} new`,
    sideEmpty: 'No active contracts.',
    sideEmptyOffers: 'Offers waiting on the board.',
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
  rollingStock: {
    loco: 'Locomotive',
    wagon: 'Wagon',
  },
  craft: {
    title: 'Crafting',
    recipes: 'Recipes',
    unlock: 'Unlock a recipe',
    kind: 'Kind',
    age: 'Age',
    quality: {
      N: 'Common',
      R: 'Uncommon',
      SR: 'Rare',
      SSR: 'Epic',
      L: 'Legendary',
    } as Record<string, string>,
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
    poolKnown: 'Recipe known',
    poolUnknown: 'Not known yet',
    /** the filter's short labels, for the strip; the long ones above are their tooltips */
    filterShort: {
      all: 'All',
      steam: 'Steam',
      diesel: 'Diesel',
      electric: 'Electric',
      bulk: 'Bulk',
      mineral: 'Mineral',
      liquid: 'Tank',
      people: 'Passenger',
    } as Record<string, string>,
    count: (n: number) => `${n} recipe${n === 1 ? '' : 's'}`,
    countOf: (shown: number, all: number) => `${shown} of ${all} recipes`,
    /** what the draw's head says: its kind and its age */
    drawOf: (kind: string, age: string) => `${kind} · ${age}`,
    heldHint: 'A draw is waiting: choose a card first',
    recipesKnown: 'Recipes known',
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
    /** what the fuel and water lines say after their label, for a row that has the label itself */
    tank: (cap: number, perTile?: number) => `${cap} · ${perTile} per tile`,
    /** the labels of the data sheet's rows, by what the row is */
    fact: {
      body: 'Body',
      weight: 'Weight',
      pulls: 'Pulls',
      wheels: 'Wheels',
      fuel: 'Fuel',
      water: 'Water',
      carries: 'Carries',
      takes: 'Takes',
      track: 'Track',
    } as Record<string, string>,
    wagon: (carries: string, units: number) => `${carries} · ${units} units`,
    /** the body plans of `src/sim/body.ts`, by id */
    plan: {
      rigid: 'Rigid body',
      tender: 'Engine and tender',
      garratt: 'Garratt articulated',
      meyer: 'Meyer articulated',
    } as Record<string, string>,
    quality: 'Quality',
    kind: 'Kind',
    preview: 'Preview',
    properties: 'Properties',
    degrees: (n: number) => `${n}°`,
    note: (kind: string) => `Inspect 3D · ${kind}`,
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
    countOf: (n: number, all: number) => `${n} of ${all} items`,
    empty: 'Nothing matches.',
    copies: (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`,
    lv: (l: number) => `Lv ${l}`,
    levelUp: 'Level up',
    levelUpHint: 'Consumes one spare unassigned copy of this model',
    levelUpNeedsSpare: 'Needs a spare unassigned copy of this model',
    levelUpTitle: (name: string, from: number, to: number) =>
      `Level up ${name}: Lv ${from} → Lv ${to}?`,
    levelUpText: (loco: boolean, pct: number) =>
      `It gains ${pct}% ${loco ? 'speed and power' : 'capacity'}. A spare copy is used up: two copies become one.`,
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
    /** `gap`: the level's `HEADWAY`; `others`: what stock without in-cab keeps (`signalHint`) */
    signalHint: {
      auto: () => 'Trains close up behind the train ahead, with no set distance.',
      token: () => 'One train per plain section, whichever way it runs. Trains ignore semaphores.',
      absolute_block: (gap: number) => `Trains keep ${gap} tiles apart.`,
      ctc: (gap: number) => `Trains keep ${gap} tiles apart.`,
      in_cab: (gap: number, others: number) =>
        `Trains with an in-cab locomotive keep ${gap} tiles apart; the others keep ${others}.`,
    } as Record<string, (gap: number, others: number) => string>,
    signallingNote: 'Semaphores work at every level except Token.',
    title: 'Settings',
    saves: 'Saves',
    appliesAtOnce: 'Settings apply at once.',
    thisGame: 'This game',
    audio: 'Audio',
    master: 'Master volume',
    sfx: 'Effects',
    music: 'Music',
    /** the rows under Effects, each with what it covers */
    soundGroups: {
      weather: { label: 'Weather', covers: 'The wind' },
      environment: { label: 'Environment', covers: 'Birds and crickets' },
      ui: { label: 'UI', covers: 'Buttons and screens' },
      building: { label: 'Building', covers: 'Laying and removing' },
      trains: { label: 'Trains', covers: 'Departures, whistles, arrivals' },
      events: { label: 'Events', covers: 'Contracts, ages, upgrades, crafting' },
    },
    audioNote:
      'Pastoral Pulse opens the game, then all eight tracks play in shuffled rounds. A row switched off keeps its level.',
    gameplay: 'Gameplay',
    language: 'Language',
    languageNote: 'Changing the language reloads the page; a game in play is saved first.',
    /** the game or the setting could not be stored, so nothing changed */
    languageHeld: 'The language stays as it is: the game or the setting could not be saved.',
    edgeScroll: 'Edge scrolling',
    autosave: 'Autosave (every minute)',
    dayNight: 'Day / night cycle',
    smoke: 'Locomotive smoke',
    buildingLife: 'Building life',
    buildingLifeHint: "Chimney smoke, the quarry crane and the windmill's sails",
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
    contractPolicy: 'Contract offers by rarity',
    contractPolicyHint:
      'Auto-accept takes the offer at once while your land has room for another active contract, and otherwise leaves it on the board; Ask leaves it on the board; Auto-deny drops it (free).',
    policy: { accept: 'Auto-accept', prompt: 'Ask', deny: 'Auto-deny' } as Record<string, string>,
    slots: 'Named saves',
    loadSlot: 'Load',
    deleteSlot: 'Delete',
    noSlots: 'No named saves yet. Use Save as... to make one.',
    saveAsOpens: 'Name this save in Saved games (32 characters)',
    slotSaved: (n: string) => `Saved as "${n}"`,
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
    /** `refund` is the money given back, formatted; with none its sentence is left out. */
    pruned: (list: string, refund: string) =>
      `This save held things the game no longer has. Removed: ${list}.${refund ? ` Refunded ${refund}.` : ''}`,
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
  /** The Saved games screen: one place to save under a name and to load. */
  savedGames: {
    title: 'Saved games',
    save: 'Save',
    load: 'Load',
    saveOff: 'No game is being played yet: Continue or start a new game, then save.',
    saveOffEditor: 'The level editor has no game to save: save the level from its own panel.',
    saveAsWell: 'Save as',
    nameField: 'Save name',
    nameHint:
      'Click and type: 32 characters at most. Enter ends the typing, Esc gives the default back.',
    nameNote: 'Name for this save. An existing save with the same name is replaced.',
    clashNote: (n: string) => `Replaces the save "${n}" (asks first).`,
    pickNote: 'Click a save to use its name.',
    saveAsAction: 'Save as',
    saveAsHint: 'Save this game under the name',
    saveAsClash: 'Replace that save with this game; asks first',
    saveAsNoName: 'Type a name first',
    named: 'Named saves',
    autosave: 'Autosave',
    autosaveEvery: 'every minute',
    autosaveOff: 'off',
    noNamedPick: 'No named saves yet: this one will be the first.',
    /** The footer's line and the Load buttons' tips: what a load does where it is picked. */
    loadNote: {
      game: 'Loading replaces the game in progress (asks first).',
      stored:
        'Loading a named save replaces the saved game that Continue goes back to (asks first).',
      none: 'Loading starts the game at once.',
    },
    loadTip: {
      game: 'it replaces the game in progress, so it asks first',
      stored: 'it replaces the saved game that Continue goes back to, so it asks first',
      none: 'it starts the game at once',
    },
    loadThis: (effect: string) => `Load this save; ${effect}`,
    loadLastNone: 'No save found',
    loadLastStored: 'Load the autosave and play: what Continue loads',
    loadLastOver: 'Load the last save; it replaces the game in progress, so it asks first',
    deleteHint: 'Delete this save; asks first',
  },
  /** The New game screen. */
  newGameScreen: {
    title: 'New game',
    map: 'Map',
    seed: 'Seed',
    seedNote: 'Generates a fresh map. Leave the seed empty for a random one.',
    seedHint: 'Click and type: a number, or any text. Enter ends the typing.',
    start: 'Start',
    startHint: 'Start the new game',
    startAsks: 'Start the new game; it replaces the saved game, so it asks first',
    startAsksOver: 'Start the new game; it replaces the game in progress, so it asks first',
    chain: 'Production chain',
  },
  menu: {
    tagline: 'Rails, contracts and industry',
    continue: 'Continue',
    newGame: 'New game',
    tuning: 'Game tuning',
    content: 'Content editor',
    credits: 'Credits',
    /** The title screen's button that opens Settings on its Controls tab. */
    controls: 'Controls',
    controlsHint: 'The keys, in Settings',
    newGameHint: 'A fresh map: a seed, the production chain',
    savedGamesHint: 'Load the autosave or a named save; delete named saves',
    levelsHint: 'Hand-made maps: play, edit, create or import one',
    /** The Continue button's tips: at boot, over a game in play, and with no save. */
    continueStored: 'Load the saved game and play on, at 1×',
    continueLive: 'Back to the game in progress, as you left it: the same speed, paused or running',
    continueNone: 'No save found. Start a new game, or load a saved one.',
    noSaveLine: 'No save found',
    modified: '(modified)',
    levels: 'Levels',
    noLevels: 'No saved levels yet. Create one below or import a level.',
    levelStations: (n: number) => `${n} station${n === 1 ? '' : 's'}`,
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
    /** The Import level well's tooltip, for the box. */
    importBoxHint:
      'A level exported from the level editor; a level with the same id is replaced. Click, then paste (Ctrl+V) or type. Enter ends the typing.',
    importButtonHint: 'Add the level to the list',
    importEmptyHint: 'Paste a level JSON first',
    /** Asked before a pasted level takes the place of one of the same id. */
    replaceLevelTitle: 'Replace level',
    confirmReplaceLevel: (n: string) =>
      `A level with this id is already in the list ("${n}"). Replace it?`,
    /** The import could not be kept: storage is full or blocked. */
    importFailed: 'Could not keep the level (storage full or blocked)',
    levelSize: 'Size',
    levelMap: 'Map',
    levelBlankNote: 'A blank map of grass to paint and build on in the level editor.',
    levelGeneratedNote: 'A generated map from the seed, to change in the level editor.',
    newLevelHint: 'Open the level editor on the new map',
    playLevelHint: 'Play this level',
    playLevelAsks: 'Play this level; it replaces the saved game, so it asks first',
    playLevelOver: 'Play this level; it replaces the game in progress, so it asks first',
    editLevelHint: 'Open it in the level editor',
    deleteLevelHint: 'Delete this level; asks first',
    /** A new level's name until it is given one; `date` as the browser writes it. */
    levelDefaultName: (date: string) => `Level ${date}`,
    /** The Map choice of New level: size is "64 x 64", as the list's "64x64" is the game's own. */
    levelSizeOption: (n: number) => `${n} x ${n}`,
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
      full: 'Collieries on hills, iron and copper mines, ironworks, oil derricks on seeps, a refinery making diesel, sand for grip and copper wire. Warehouses refuel only from what trains bring.',
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
    /** a credit's kind, as `src/data/credits.json` names it */
    kind: { '3D model': '3D model', Music: 'Music', Icons: 'Icons' } as Record<string, string>,
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
    close: 'Close',
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
    transfer: 'Transfer',
    /** After Import JSON: how many of the bundle's tables came in; Apply keeps them. */
    imported: (n: number) =>
      `${n} table${n === 1 ? '' : 's'} imported into the editor. Apply keeps them.`,
    export: 'Export JSON',
    import: 'Import JSON',
    jsonHint: 'bundle JSON',
    badJson: 'Invalid JSON',
    reset: 'Reset to shipped data',
    resetTitle: 'Discard custom content',
    confirmReset: 'Discard all custom content and reload?',
    apply: 'Apply and reload',
    /** The footer's line while nothing is wrong: what Apply does. */
    applyNote: 'Applying reloads the page; a game in play is saved first.',
    /** Apply waits: `n` boxes hold a value the form could not read, framed red. */
    refusedValues: (n: number) =>
      `${n} value${n === 1 ? '' : 's'} could not be read (the red box${n === 1 ? '' : 'es'}): fix ${n === 1 ? 'it' : 'them'} first`,
    /** After Import JSON: tables whose shape the editor cannot read were left out. */
    skipped: (n: number) =>
      `${n} table${n === 1 ? '' : 's'} left out: not in the shape the editor reads.`,
    /** In place of a table the editor cannot draw. */
    badShape:
      'This table is not in the shape the editor reads. Reset to shipped data, or import a corrected one.',
  },
  train: {
    title: 'Train',
    consist: 'Consist and tanks',
    tripStats: 'Loop statistics',
    gone: 'This train is no longer in service.',
    overview: 'Overview',
    performance: 'Performance',
    status: 'Status',
    tanks: 'Tanks',
    tilesPerSecond: 'tiles/s',
    tilesPerSecondSq: 'tiles/s²',
    tile: 'tile',
    staticTag: 'static',
    engineModes: 'Engine modes',
    engineMode: 'Mode',
    engineOf: (i: number, n: number) => `engine ${i} of ${n}`,
    wagonOf: (i: number, n: number) => `wagon ${i} of ${n}`,
    speedAndPower: 'speed and power',
    capacity: 'capacity',
    type: 'Type',
    carries: 'Carries',
    size: 'Size',
    refuelCart: 'Refuelling cart',
    cargoAboard: 'Cargo aboard',
    runningEmpty: 'Running empty.',
    controlClassLabel: 'Control class',
    levelBase: 'Lv 1 · the model as built',
    levelGain: (level: number, pct: number, what: string) => `Lv ${level} · +${pct} % ${what}`,
    noTanks: 'No fuel or water tanks: an electric train runs on the wire.',
    tanksFull: 'The tanks are full.',
    nameEmpty: 'A train needs a name.',
    noColour: 'That is not one of the colour codes.',
    /** the colour codes, in the order of `TRAIN_COLOURS` */
    colour: ['grey', 'red', 'amber', 'green', 'blue', 'violet'],
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
    store: (label: string) => `Trading at ${label}. Pick another store in Fleet or on the map.`,
    /** the store the standing deals settle with (`TradeDesk.storeKey`) */
    dealsAt: (label: string) => `Deals settle at ${label}`,
    trend: 'Trend',
    driftPct: (p: number) => `${p >= 0 ? '+' : ''}${p}%`,
    /** read through `driftHint`: the fuels of this game's chain, the band of `DRIFT_MAX` */
    driftHint: (goods: string, pct: number) =>
      `Fuel prices (${goods}) wander up to ±${pct}% on a slow weekly walk.`,
    hint: 'Prices are per unit. A store holds up to its cap of each good.',
    deals: 'Standing deals',
    spot: 'Spot prices',
    noStore: 'There is no store yet. Build a depot, a warehouse or a townhouse.',
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
    /** the same card: whose stock the bar shows, which Fleet picks */
    shownStore: (name: string) => `The bar shows: ${name}`,
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
    /** the menu bar's entries (src/ui/menuBarModel.ts) */
    menuTip: 'Menu · Esc',
    audio: 'Audio',
    fleet: 'Fleet',
    economy: 'Economy',
    view: 'View',
    guide: 'Guide',
    /** their rows */
    save: 'Save',
    depot: 'Depot',
    /** the Fleet menu's line of a depot, right of its name */
    depotDetail: (gauge: string, trains: number) =>
      `${gauge} · ${trains} ${trains === 1 ? 'train' : 'trains'}`,
    depotHint: 'Open the Depot on this one and show its store on the resource bar',
    signals: 'Signals',
    contracts: 'Contracts',
    contractSettings: 'Contract settings',
    crafting: 'Crafting',
    roster: 'Roster',
    market: 'Market',
    overview: 'Overview map',
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
    gone: 'That town is gone',
    nameEmpty: 'A town needs a name',
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
    fullHousing: 'Housing full; build or upgrade Houses to provide room',
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
    storage: 'Storage',
    platforms: 'Platforms',
    loadRate: 'Loading',
    perWeek: (v: number) => `${v} / week`,
    perSec: (v: number) => `${v} / s`,
    maxed: 'Max level',
    demolish: 'Demolish',
    rename: 'Rename',
    renameTitle: 'Rename station',
    renameHint: 'The new name of this station.',
    nameEmpty: 'A station needs a name',
    noPlatform: 'No adjacent track!',
    orphaned: (n: string) => `${n} lost its platform track`,
    boost: (pct: number) => `Water tower: loading +${pct}%`,
    contracts: 'Contracts here',
    /**
     * A harvesting station's kind in the plural, by `StationDef.id`: written out, because adding
     * an s spells "quarrys". Every station with a `terrain` needs one, and so does every station
     * a biome's `production` names and every works tied to its ground (`tileGoods`).
     */
    plural: {
      farm: 'farm halts',
      lumber: 'lumber yards',
      quarry: 'quarries',
      pump: 'water pumps',
      mine: 'iron mines',
      sand_pit: 'sand pits',
      copper_mine: 'copper mines',
      colliery: 'collieries',
      oil_derrick: 'oil derricks',
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
  /**
   * The in-game Guide (src/ui/guideContent.ts). The words around what the data says: a `{name}` is
   * filled there (`fill` in src/ui/tooltipDoc.ts) with a number, a resource or a name from the data,
   * so no cost, count or name is typed here.
   */
  guide: {
    title: 'Guide',
    search: 'Search…',
    searchLabel: 'Search the Guide',
    noMatch: 'No page has that.',
    /** the note under the list: the chain the pages are written for */
    chain: (name: string) => `Production chain of this game: ${name}`,
    /** the last join of a list, and between alternatives */
    and: 'and',
    or: 'or',
    /** an empty table cell */
    none: '–',
    /** keys that do not read as their code, by `KeyboardEvent.code` */
    keyNames: {
      Space: 'Space',
      Escape: 'Esc',
      Tab: 'Tab',
      Enter: 'Enter',
      Backquote: '`',
    } as Record<string, string>,
    pages: {
      first: 'First minutes',
      track: 'Track and lines',
      stations: 'Stations, depots and towns',
      trains: 'Trains',
      signals: 'Signals',
      goods: 'Goods and production',
      contracts: 'Contracts',
      market: 'Market and crafting',
      ages: 'Ages',
      keys: 'Keys and controls',
    },
    /** what each action of `KEYMAP` does */
    keyAction: {
      debug: 'Debug panel',
      menuBack: 'Back',
      pauseOrClose: 'Close the top screen or tool; with nothing open, the Menu',
      overviewBack: 'Stop the recording, drop the picked train, or leave the map',
      depot: 'Depot',
      contracts: 'Contracts',
      crafting: 'Crafting',
      roster: 'Roster',
      market: 'Market',
      overview: 'Overview map, and back',
      nextTool: 'Next item of the open category',
      prevTool: 'Previous item of the open category',
      upgradeTrack: 'Upgrade track',
      downgradeTrack: 'Downgrade track',
      prevType: 'Previous type',
      nextType: 'Next type',
      prevCategory: 'Previous category',
      nextCategory: 'Next category',
      demolish: 'Demolish',
      pause: 'Pause and resume',
      pieceOrCategory: 'An item of the open category',
      /** the same digits with no category open: not an action of its own (`keyRows`) */
      category: 'A build category, with none open',
      speedStep: 'Faster, slower',
      record: 'Record stops for the picked train',
      finishRoute: 'Finish the recording',
      undo: 'Undo the last step',
      redo: 'Redo it',
    } as Record<string, string>,
    first: {
      intro:
        'A new game gives you {money}, a {depot} with goods in its store, and a few engines and wagons for {line}. That is enough to get a first train earning.',
      haveHead: 'What you start with',
      goods: 'In the store: {list}.',
      copies: 'You hold {engines} of each engine and {wagons} of each wagon.',
      stepsHead: 'Your first train',
      look: 'Rest the pointer on the ground. The tooltip says what each tile gives.',
      lookGoods: 'You get {forest} on forest, {rock} on rock and hills, {grass} on grass.',
      lay: 'Open {category} (key {key}) and pick {line}. Drag from the track at a gate of the {depot} to lay a stretch of track. Press {esc} to put the track tool down.',
      place:
        'Open {category} (key {key}), then {type}, and place a harvesting station ({list}) with the track touching one side. That track becomes its platform.',
      train:
        'Press {key} for the {depot}. Pick a locomotive, add wagons that carry the good, and press {dispatch}.',
      sell: 'What the train brings goes into the depot store. Press {key} for the {market} and sell some of it: that is your first income.',
      nextHead: 'What comes next',
      money:
        'Money comes from the {market}, from passengers and from {contracts}. Goods in a store earn nothing until they are sold.',
      reach: 'Building is paid from a store within {reach} tiles of the work.',
      food: 'Crews and residents eat {food} every week. A {windmill} makes it from {wheat}.',
      land: 'Press {key} for the overview map and click an uncharted chunk beside your land to buy it. The first ring costs {price}.',
      age: 'Rest on the age beside the date to see what each age asks for and what it brings.',
      advisor: 'The {advisor} ({view} menu) tells you what to do next.',
    },
    track: {
      intro:
        'Track comes in lines. A line sets the size of its curves, its price, its speed and the trains it takes.',
      colLine: 'Line',
      colClass: 'Trains',
      colCurve: 'Curve',
      colCurveSpeed: 'Speed in a curve',
      colCost: 'Cost',
      colSpeed: 'Top speed, tiles/s',
      colAge: 'Opens in',
      noLimit: 'no limit',
      gaugeHead: 'Gauges and networks',
      narrow:
        '{narrow} is a network of its own. Only narrow trains run on it, and it joins no other line. It crosses {crossed} with a crossing piece.',
      standard: '{lines} are one network and join each other directly.',
      classes: 'A train runs on the line of its class and on every bigger line of its network.',
      curvesHead: 'Curves and switches',
      curves:
        'A curve or a switch fills a square of tiles, the size in the table, and the inner tiles of a curve stay blocked. A train takes a wide curve faster: the table gives the share of its speed it keeps.',
      pieces:
        'On {line} a straight costs {straight}, a curve {curve} and a switch {switch}. The table gives the other lines against it.',
      slopesHead: 'Slopes',
      straights: 'Straight track and crossings may climb, one level per tile at most.',
      smooth: 'Curves and switches need smooth ground, or a bridge platform under every tile.',
      level: 'Stations, works, houses and services need level ground.',
      climb:
        'A train slows on a climb and runs faster coming down. Its panel says how slow it gets.',
      groundHead: 'Ground',
      ground:
        'The ground multiplies what track costs. Water needs a bridge. Rock and mountain take track only where it continues a line already there.',
      colGround: 'Ground',
      bridgesHead: 'Bridges',
      bridges:
        'Bridge platforms carry straight rails over water or a dip. Above {share} of its capacity a train crosses at {speed} of its speed, and a train too heavy finds another route.',
      colBridge: 'Bridge',
      colCapacity: 'Capacity',
      colPrice: 'Cost',
      upgradeHead: 'Upgrading a line',
      upgrade: '{name} (key {key}):',
      upgradeSize:
        'Upgrading or downgrading a curve or switch to a line whose curves are another size needs the piece laid again.',
    },
    stations: {
      intro:
        'Trains call at stations. Every station but a depot must touch track when you place it: that track is its platform.',
      colStation: 'Station',
      colCost: 'Cost of the first',
      colMakes: 'Makes',
      colGround: 'Counts',
      colAge: 'Age',
      repeat:
        'Every further station, service, works, house, semaphore or pole of a kind costs more: {pct} of the first price for each one that stands, rounded up. Depots, track and bridges keep their price. The ground multiplies what a station costs, as it does for track.',
      depotsHead: 'Depots',
      depots:
        'Trains are built in a depot and roll out of its gates. A {depot} builds standard trains and a {narrow} narrow ones.',
      depotCount:
        'How many depots you may own follows your land: more chunks allow more, each gauge counted on its own.',
      depotStore: 'Goods unloaded at a gate enter its store, which holds {cap} of each good.',
      producersHead: 'What stations make',
      harvest:
        'A harvesting station counts its ground within {radius} tiles, nearer tiles more. At level 1 it makes {base} a week on plenty of ground; bare ground still gives {floor} of that, and a dense patch up to {ceil}.',
      placing:
        'The biome and the season change it too. The placing tooltip shows all of it before you click.',
      levelsHead: 'Levels',
      levels:
        'Stations, works and houses rise one level per age, from the age they appear in. A building being upgraded is closed until it is done; a depot upgrades at once.',
      stopsAt: 'Some stop earlier: {list}.',
      stopsAtOne: '{name} at level {level}',
      colLevel: 'Level',
      colStorage: 'Storage',
      colLoad: 'Loading / s',
      colPlatforms: 'Platforms',
      colWeek: 'Makes / week',
      storesHead: 'Stores',
      stores:
        'Goods are kept in stores: one for each town, one for each depot and one for each warehouse outside a town.',
      storesSimple: 'In this production chain the stores on one rail network share their goods.',
      storesFull:
        'In this production chain every store stands alone: goods move between stores only by train.',
      townStore:
        'A town store holds {town} of each good, and every warehouse level in the town adds {warehouse}. A warehouse outside a town holds {warehouse} of each good per level.',
      reach:
        'Works and crews use their town store, or else the nearest store within {reach} tiles. Building is paid from the nearest store in that reach that holds the whole cost.',
      outlet:
        'A harvesting station inside a town carries what it makes straight to the town store.',
      townsHead: 'Towns',
      found:
        'Place a {townhouse}, then a {house} and a {warehouse} within {radius} tiles of it: that founds a town. Townhouses keep {spacing} tiles apart.',
      growth:
        "A house takes {built} days to build and opens with {first} residents. After that one resident moves in every {days} days while the town store has {food}, up to the house's capacity. Towns do not build houses themselves: place a {house}, or raise its level.",
      houses: 'A house holds, level by level: {list} residents.',
      passengers:
        'A {station} serves the homes within {reach} tiles. Join two of them with coaches and people travel; the fare grows with the distance.',
      servicesHead: 'Services',
      services:
        'A service building fills trains at the stations in its reach, from a store within {reach} tiles of it.',
      colService: 'Service',
      colReach: 'Reach, tiles',
      colGives: 'Gives',
    },
    trains: {
      consistHead: 'Consists',
      build:
        'A new train is put together in the {depot}: the depot it rolls out of, its engines and wagons, its route and, if you like, its name. {dispatch} sends it out through a gate.',
      picked:
        'The Depot then shows the new train, and {again} starts another like it: the same models from the free stock, its route and depot.',
      limits: 'A train has at least one engine, and at most {locos} engines and {wagons} wagons.',
      haul: 'Engines haul a set weight, and the wagons must stay under it. A train takes on only the load its engines can haul.',
      speed:
        'A train runs at the speed of its slowest vehicle. More engines pull harder; they do not go faster.',
      colClass: 'Class',
      colRuns: 'Runs on',
      colWagons: 'Wagons',
      colGoods: 'Carry',
      fuelHead: 'Fuel and water',
      colEngine: 'Engine',
      colUses: 'Uses',
      steamUses: '{coal} or {wood}, and {water}',
      fillUp:
        'A train fills up at a stop with a store ({list}) and at a station in reach of a service building.',
      seek: 'A train running low looks for the nearest service or depot that holds what it needs, and goes there by itself.',
      carts:
        'A refuelling cart adds to the tanks of engines of its kind and cuts their use by {saving}, up to {cap} in all.',
      emergency: '{name}:',
      crew: 'Each crew member eats {n} {food} a week. A train pays at the next store where it fills up; owing more than a day of food, it runs at {pct} of its speed.',
      sand: 'In this production chain every train spreads {sand} on the rails and pays for it at the next store where it fills up.',
      electricHead: 'Electric running',
      electric:
        'Electric engines need live wire. Chain {pole} poles from a power source ({plant}) to a {battery}, then lay wire along the track: it is live within {radius} tiles of a powered battery.',
      colSupply: 'Supply',
      colCeiling: 'Speed limit, tiles/s',
      colAbout: 'What it is',
      routesHead: 'Routes and schedules',
      routes:
        'A train follows a schedule or plans its own stops. You pick the route in the Depot, and can change it later in the train details.',
      colRoute: 'Route',
      colWhat: 'What it does',
      record:
        'On the overview map (key {overview}) pick a train, press {record} and click stations to record new stops; {finish} finishes.',
      levelsHead: 'Levels',
      levels:
        'A spare copy of a model raises another one level, up to level {cap}. Each level adds {pct} to speed and power, or to capacity.',
      weather: 'Rain and fog slow trains a little, and so do some biomes.',
    },
    signals: {
      intro:
        'On track with no signals trains keep apart by themselves. How close they may follow is the signalling level, set in {fleet} › {signals}.',
      colLevel: 'Level',
      colHeadway: 'Gap, tiles',
      colWhat: 'What it does',
      inCab: 'Fitting it costs {cost}, in the {roster}.',
      postCost: 'The first semaphore costs {cost}; each one more adds {pct} of that, rounded up.',
    },
    goods: {
      intro: 'This game runs the {chain} production chain.',
      rawHead: 'Raw goods',
      colGood: 'Good',
      colMaker: 'Made by',
      colGround: 'From',
      worksHead: 'Works',
      works:
        'A works needs no track: it runs from its town store, or else the nearest store within {reach} tiles.',
      worksLevels: 'Each level adds {pct} to the batches a works makes in a week.',
      windmillLevels: 'A {windmill} also gets {n} more {food} out of each batch with every level.',
      colWorks: 'Works',
      colRecipe: 'Recipe',
      colBatches: 'Batches a week',
      colAge: 'Age',
      allHead: 'Every good',
      colMadeBy: 'Made by',
      colUsedBy: 'Used by',
      foodHead: 'Food',
      food: 'Residents and crews each eat {n} {food} a week from their store.',
      famine:
        'A store that runs out goes hungry: what is made around it falls to {pct} until food comes back.',
    },
    contracts: {
      intro:
        'A contract asks you to carry an amount of one good from one station to another by a deadline, for a payout. Offers wait on the board until you accept them or they run out.',
      ends: 'Offers come from what your stations make and what another station takes, and both need platform track. Only {ends} can end a contract: {shut} never do.',
      limit:
        'Your land limits open offers and active contracts alike: {base} on the start chunk, {per} more for each further chunk, rounded down, and {max} at most.',
      timing: 'The board looks for new offers every {days} days. An offer stays {life} days.',
      trains:
        'When you accept, the game hands the contract to the train best placed to work it, and a train on the Contract route is picked ahead of the rest. It goes back to its work afterwards.',
      policy: 'Each rarity has its own policy for new offers, set in {economy} › {settings}.',
      payHead: 'Pay and fines',
      pay: 'The payout grows with the amount, the price of the good, the distance, the rarity and the age.',
      ageScale:
        'The tables give the numbers of the {first}. Each age after it, up to the {last}, adds {amount} to the amounts and {pay} to the pay.',
      deadlineKinds:
        "Only a {kinds}'s deadline shortens with rarity, by the Deadline column; other deadlines stay as they are.",
      fines:
        'Missing the deadline costs {fail} of the payout, and cancelling costs {cancel}. Declining an offer is free.',
      lapse: 'If a station of a contract is demolished, the contract lapses with no fine.',
      colRarity: 'Rarity',
      colChance: 'Chance',
      colReward: 'Pay',
      colAmount: 'Amount',
      colDeadline: 'Deadline',
      colKind: 'Kind',
      colAge: 'From',
      colSize: 'Units',
      colPay: 'Pay',
    },
    market: {
      marketHead: 'The Market',
      where:
        'The {market} buys into and sells from the store shown on the resource bar. Pick a depot in {fleet} or on the {depot} screen, or select a townhouse, a depot or a warehouse on the map, and the bar shows its store.',
      whereSimple:
        'In this production chain the stores on one rail network count as one: the bar shows the same goods whichever of them you pick.',
      prices:
        "You pay {buy} of a good's base price and get {sell} of it. The table gives the prices a game starts with.",
      colGood: 'Good',
      colBuy: 'Buy',
      colSell: 'Sell',
      craftHead: 'Crafting',
      craft:
        'The engines and wagons you own are in the {roster}. New ones come from {crafting}, in two steps.',
      unlock:
        'Unlock a recipe: pay money for {cards} cards of one kind and age, and keep one. A card you already know gives {refund} back instead.',
      build:
        'Craft it: spend goods from the store shown on the resource bar. Rarer models cost more and can fail; a failure gives back {pct} of the goods.',
      anyAge:
        'Recipes are sorted by age, but you may draw any of them at any time. An engine still needs its fuel or its wire, and a line that takes its class.',
      starters: 'Key {key} opens the {roster}.',
      colAge: 'Age',
      colEngine: 'Engine',
      colWagon: 'Wagon',
      colQuality: 'Quality',
      colCostMul: 'Cost',
      colFail: 'Fails',
      colSize: 'Size',
    },
    ages: {
      intro: 'Each age opens new things.',
      goals: 'To reach it: {goals}.',
    },
    keys: {
      fieldHead: 'In the field',
      overviewHead: 'On the overview map',
      menuHead: 'In the Menu and on the title screen',
      pointerHead: 'Camera and pointer',
    },
  },
} as const;

/**
 * The strings the simulation keeps in its state, which reach the save, and compares: a train's
 * note. The screen shows them through `noteText`. Everything else reads `STR`.
 */
export const ENGLISH = EN;

/** A literal's type as what it is: a text that a translation may word its own way. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;
/** The shape of a translation: every key of the English table, each function with its arguments. */
export type Strings = Widen<typeof EN>;

/** All user-facing strings, in the language of this page load. */
export const STR: typeof EN = LANGUAGE === 'hu' ? (HU as unknown as typeof EN) : EN;
