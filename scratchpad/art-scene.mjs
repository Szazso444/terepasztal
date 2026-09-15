// A built scene on one seed, so the art can be judged in play rather than on a contact sheet:
// a line through plains and forest, a stone bridge over the river, a station and its village,
// a farm, a lumber yard, a windmill, services, and a steam train standing at the platform.
// The same script runs against any revision, so before/after shots line up tile for tile.
// usage: node scratchpad/art-scene.mjs <label>
import { launch, openGame } from './runtime.mjs';
import { mkdirSync } from 'node:fs';

const label = process.argv[2] ?? 'after';
const out = new URL(`./shots/scene-${label}/`, import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await launch();
try {
  const page = await openGame(browser, label, 900);
  page.on('pageerror', (e) => {
    console.error(e);
    process.exitCode = 1;
  });
  const report = await page.evaluate(async () => {
    const g = window.game;
    const { Train } = await import('/src/sim/trains.ts');
    const { content } = await import('/src/data/content.ts');
    const { idx } = await import('/src/world/tiles.ts');
    const { Dir } = await import('/src/engine/iso.ts');
    g.closeMenus();
    g.settings.autosave = false;
    g.settings.weather = false; // neutral light, so before/after differ only in the art
    g.settings.dayNight = false;
    g.clock.setSpeed(0);
    g.builder.free = true;
    // own the chunks the scene stands on, so no fog darkens it
    for (let i = 0; i < g.regions.unlocked.length; i++) g.regions.own(i);
    g.world.rebuildFog();
    const WATER = 3;
    const log = { track: 0, bridge: 0, placed: [], failed: [] };

    // the line runs east-west through the forest edge, crossing the river on a stone bridge
    const Y = 110;
    const RIVER = 127;
    const X0 = RIVER - 18;
    const X1 = RIVER + 14;
    for (let x = X0; x <= X1; x++) {
      if (g.map.terrain[idx(g.map, x, Y)] === WATER) {
        if (g.builder.placeBuilding(x, Y, 'bridge_stone')) log.bridge++;
      }
      if (g.builder.placeTrackKind(x, Y, 'straight', 1)) log.track++;
    }
    // a siding into the yard
    g.builder.placeTrackKind(RIVER - 9, Y, 'switch', 1);
    for (let y = Y + 1; y <= Y + 4; y++) g.builder.placeTrackKind(RIVER - 9, y, 'straight', 0);

    const put = (what, fn) => {
      const r = fn();
      (r ? log.placed : log.failed).push(what);
      return r;
    };
    /** Place on the first tile near (cx, cy) the build rules accept, so the scene always fills in. */
    const near = (what, cx, cy, place, check) => {
      for (let r = 0; r <= 6; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (!check(x, y)) continue;
            const made = place(x, y);
            if (made) {
              log.placed.push(`${what}@${x},${y}`);
              return made;
            }
          }
      log.failed.push(what);
      return null;
    };
    const okStation = (id) => (x, y) => g.builder.checkStation(x, y, id).ok;
    const okBuilding = (id) => (x, y) => g.builder.checkBuilding(x, y, id).ok;
    const okDecor = (id) => (x, y) => !g.builder.canPlaceDecor(x, y, id);
    // station and its village on the north side, works on the south
    const S = RIVER - 11; // the village sits west of the river
    const station = put('station', () => g.builder.placeStation(S, Y - 1, 'station', 0));
    near(
      'town',
      S - 5,
      Y - 4,
      (x, y) => g.builder.placeStation(x, y, 'town', 0),
      okStation('town'),
    );
    near(
      'farm',
      S + 8,
      Y - 4,
      (x, y) => g.builder.placeStation(x, y, 'farm', 0),
      okStation('farm'),
    );
    near(
      'lumber',
      S - 7,
      Y + 3,
      (x, y) => g.builder.placeStation(x, y, 'lumber', 0),
      okStation('lumber'),
    );
    near(
      'warehouse',
      S + 4,
      Y + 3,
      (x, y) => g.builder.placeStation(x, y, 'warehouse', 0),
      okStation('warehouse'),
    );
    near(
      'windmill',
      S + 3,
      Y - 5,
      (x, y) => g.builder.placeBuilding(x, y, 'windmill'),
      okBuilding('windmill'),
    );
    near('kiln', S - 5, Y + 5, (x, y) => g.builder.placeBuilding(x, y, 'kiln'), okBuilding('kiln'));
    for (const [hx, hy] of [
      [S - 2, Y - 4],
      [S + 1, Y - 5],
      [S - 6, Y - 2],
      [S + 5, Y - 5],
      [S - 4, Y - 6],
      [S + 2, Y - 3],
    ])
      near(
        'house',
        hx,
        hy,
        (x, y) => g.builder.placeDecor(x, y, 'townhouse', 0),
        okDecor('townhouse'),
      );
    near(
      'water_tower',
      S + 3,
      Y + 1,
      (x, y) => g.builder.placeDecor(x, y, 'water_tower', 0),
      okDecor('water_tower'),
    );
    near(
      'fuel_stop',
      S + 5,
      Y + 1,
      (x, y) => g.builder.placeDecor(x, y, 'fuel_stop', 0),
      okDecor('fuel_stop'),
    );
    for (const [sx, sy] of [
      [S - 3, Y - 1],
      [S + 7, Y + 1],
    ])
      near('signal', sx, sy, (x, y) => g.builder.placeDecor(x, y, 'signal', 0), okDecor('signal'));
    near(
      'power_line',
      S - 8,
      Y + 2,
      (x, y) => g.builder.placeDecor(x, y, 'power_line', 0),
      okDecor('power_line'),
    );

    // upgrades, so the sheet shows more than level 1
    for (const s of g.builder.stations)
      if (s.def.id === 'station' || s.def.id === 'town')
        for (let i = 0; i < 2; i++) g.builder.upgradeStation?.(s);

    // a steam train at the platform: locomotive, tender is part of the definition, plus stock
    const loco = content.locomotives.find((d) => d.id === 'mav424') ?? content.locomotives[0];
    const coach = content.wagons.find((d) => d.id === 'wooden_coach');
    const boxcar = content.wagons.find((d) => d.id === 'boxcar');
    const hopper = content.wagons.find((d) => d.id === 'wood_hopper');
    const cars = [
      { uid: 9001, def: loco, level: 0 },
      { uid: 9002, def: coach, level: 0 },
      { uid: 9003, def: coach, level: 0 },
      { uid: 9004, def: boxcar, level: 0 },
      { uid: 9005, def: hopper, level: 0 },
    ].filter((c) => c.def);
    const train = new Train(cars, 'Willowline', 9001);
    train.spawnAt(g.track, S + 2, Y, Dir.E);
    train.oil = train.coal = train.water = 1e6;
    g.fleet.trains.push(train);
    log.train = train.trail.length;

    // frame the village
    const { tileToWorld } = await import('/src/engine/iso.ts');
    const p = tileToWorld(S + 0.5, Y - 0.5);
    g.camera.centerOn(p.x, p.y);
    g.camera.zoomIndex = 3;
    g.camera.zoom = 2;
    return log;
  });
  console.log(report);
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
    console.log('wrote', name);
  };
  // close whatever the placements opened, and take the art shots without the overlay
  await page.evaluate(() => {
    const g = window.game;
    g.closeMenus();
    g.screens?.close?.();
    g.stationPanel?.close?.();
    g.buildingPanel?.close?.();
    g.decorPanel?.close?.();
    g.trainSide?.close?.();
  });
  await page.mouse.move(20, 880);
  const ui = async (visible) =>
    page.evaluate((v) => {
      document.getElementById('ui-root').style.visibility = v ? 'visible' : 'hidden';
    }, visible);
  await ui(false);
  await shot('village');
  await ui(true);
  await shot('village-ui');
  await ui(false);
  await page.evaluate(() => {
    const g = window.game;
    g.camera.zoomIndex = 2;
    g.camera.zoom = 1;
  });
  await shot('village-wide');
  // dusk, with the lamps lit
  await page.evaluate(async () => {
    const g = window.game;
    const { daySeconds } = await import('/src/sim/rules.ts');
    g.settings.dayNight = true;
    g.applySettings();
    const d = daySeconds();
    g.clock.time = Math.floor(g.clock.time / d) * d + d * 0.84;
    g.camera.zoomIndex = 3;
    g.camera.zoom = 2;
  });
  await shot('village-dusk');
} finally {
  await browser.close();
}
