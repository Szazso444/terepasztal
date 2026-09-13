import { launch, openGame } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await launch();
try {
  const page = await openGame(browser, 'after');
  const result = await page.evaluate(async () => {
    const g = window.game;
    g.closeMenus();
    g.settings.autosave = false;
    g.settings.dayNight = false;
    g.settings.weather = false;
    g.clock.setSpeed(0);
    g.builder.free = true;
    const { content } = await import('/src/data/content.ts');
    const { spriteDataUrl, frameForItem } = await import('/src/ui/spritePreview.ts');
    const items = [
      'j94',
      'rocket',
      'mallard',
      'f7',
      'dda40x',
      ...content.wagons
        .filter((w) => (w.size ?? 'small') === 'small')
        .map((w) => w.id)
        .slice(0, 4),
    ];
    const gallery = document.createElement('div');
    gallery.id = 'evidence-gallery';
    gallery.style =
      'position:fixed;inset:0;background:#14242b;z-index:1000;padding:30px;color:#ece6ce;font:16px Georgia;overflow:auto';
    gallery.innerHTML =
      '<h1>Railcraft & building upgrades</h1><p>Complete vehicle previews · two fixed axles on small stock · independent bogies on longer stock</p>';
    const row = document.createElement('div');
    row.style = 'display:grid;grid-template-columns:repeat(5,1fr);gap:14px';
    gallery.append(row);
    const add = (label, url) => {
      const box = document.createElement('div');
      box.style =
        'background:#243840;border:1px solid #46616b;padding:10px;text-align:center;min-height:130px';
      box.innerHTML =
        '<div style="height:105px;display:flex;align-items:center;justify-content:center"><img style="max-width:100%;max-height:105px;image-rendering:pixelated" src="' +
        url +
        '"></div><p>' +
        label +
        '</p>';
      row.append(box);
    };
    for (const id of items) {
      const d = [...content.locomotives, ...content.wagons].find((x) => x.id === id);
      if (d) add(d.name, spriteDataUrl(g.atlas, frameForItem(id, 0), 2));
    }
    for (let l = 1; l <= 4; l++)
      add(
        ['House · 20', 'Apartments · 60', 'High-rise · 140', 'Skyscraper · 300'][l - 1],
        spriteDataUrl(g.atlas, 'structures/townhouse' + (l > 1 ? '_' + l : ''), 1),
      );
    for (let l = 1; l <= 4; l++)
      add(
        'Windmill ' + l + ' · 1 wheat → ' + (3 + 2 * l) + ' food',
        spriteDataUrl(g.atlas, 'structures/windmill' + (l > 1 ? '_lv' + l : ''), 1),
      );
    add('Food', spriteDataUrl(g.atlas, 'icons/food', 4));
    document.body.append(gallery);
    return { frames: g.atlas.keys('').length, items: items.length };
  });
  await page.screenshot({ path: 'scratchpad/expansion-assets.png' });
  await page.evaluate(() => document.getElementById('evidence-gallery').remove());
  const scene = await page.evaluate(async () => {
    const g = window.game;
    g.regions.unlocked.fill(true);
    g.world.rebuildFog();
    const terrain = (x, y, t) => {
      g.map.terrain[y * g.map.w + x] = t;
      g.map.props.delete(y * g.map.w + x);
      g.world.removeProps(x, y);
      g.world.retile(x, y);
    };
    for (let y = 40; y < 62; y++) for (let x = 40; x < 67; x++) terrain(x, y, 0);
    for (const y of [45, 53]) {
      for (let yy = y - 1; yy <= y + 1; yy++) for (let x = 42; x < 50; x++) terrain(x, yy, 3);
      for (let x = 40; x <= 51; x++) {
        if (x >= 42 && x < 50)
          g.builder.placeBuilding(x, y, y === 45 ? 'bridge_wood' : 'bridge_stone');
        g.builder.placeTrack(x, y, { kind: 'straight', cls: 'regular' }, 1);
      }
    }
    g.builder.placeTrack(58, 47, { kind: 'straight', cls: 'regular' }, 1);
    const anchor = g.builder.placeStation(58, 48, 'town');
    g.builder.placeStation(59, 48, 'warehouse');
    const housePositions = [];
    for (let y = 49; y < 54; y += 2)
      for (let x = 55; x < 61; x += 2) {
        g.builder.spawnDecor(x, y, 'townhouse', 0);
        const h = g.houses.at(x, y);
        h.level = ((x + y) % 4) + 1;
        h.progress = 1;
        h.residents = g.houses.capacity(h);
        g.houses.onChanged(h);
        housePositions.push([x, y, h.level, h.residents]);
      }
    g.builder.placeBuilding(62, 50, 'windmill');
    const mill = g.builder.buildingAt(62, 50);
    mill.level = 4;
    g.onBuildingChanged(mill, false);
    g.builder.placeTrack(59, 46, { kind: 'straight', cls: 'regular' }, 1);
    g.builder.placeStation(59, 47, 'station');
    g.towns.refresh();
    g.refreshCity();
    g.refreshBridges();
    g.camera.update = () => {};
    g.camera.zoom = 1.65;
    g.camera.centerOn((52 - 48) * 32, (52 + 48) * 16);
    return {
      anchor: !!anchor,
      houses: housePositions,
      bridges: [...g.builder.buildings.values()].filter((b) => b.id.startsWith('bridge')).length,
    };
  });
  assert.equal(scene.bridges, 16);
  assert.equal(scene.anchor, true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'scratchpad/expansion-city-bridges.png' });
  await page.evaluate(() => {
    const g = window.game;
    g.build.selectBuilding(g.builder.buildingAt(45, 45));
  });
  await page
    .locator('#station-panel:visible')
    .getByRole('button', { name: /^Upgrade/ })
    .click();
  const bridgeUpgrade = await page.evaluate(() => {
    const g = window.game;
    return {
      level: g.builder.buildingAt(45, 45).level,
      capacity: g.track.get(45, 45).bridgeCapacity,
      reinforced: !!g.world.getStructure('bridge-detail:45,45'),
    };
  });
  assert.deepEqual(bridgeUpgrade, { level: 2, capacity: 225, reinforced: true });
  await page.screenshot({ path: 'scratchpad/expansion-bridge-upgrade.png' });
  await page.evaluate(() => window.game.build.selectBuilding(null));
  const refuelBefore = await page.evaluate(async () => {
    const g = window.game;
    const { Train } = await import('/src/sim/trains.ts');
    const { content } = await import('/src/data/content.ts');
    const d = content.locomotives.find((l) => l.id === 'f7');
    const near = new Train([{ uid: 9001, level: 0, def: d }]);
    near.name = 'Visible test train';
    near.spawnAt(g.track, 45, 45, 3);
    near.oil = 10;
    for (let x = 96; x < 107; x++) g.track.place(x, 100, 'straight', 1);
    const far = new Train([{ uid: 9002, level: 0, def: d }]);
    far.name = 'Off-screen test train';
    far.spawnAt(g.track, 100, 100, 3);
    far.oil = 20;
    g.fleet.trains.push(near, far);
    g.stock.add('oil', 10000);
    g.updateTrainSide(0);
    return {
      ids: [near.id, far.id],
      oil: g.stock.get('oil'),
      cap: near.oilCap,
      shown: g.trainSide.root.querySelectorAll('.ts-card').length,
    };
  });
  assert.equal(refuelBefore.shown, 1);
  await page.getByRole('button', { name: 'Refuel all · 2×', exact: true }).click();
  const refuelVisible = await page.evaluate((ids) => {
    const g = window.game;
    return { tanks: ids.map((id) => g.fleet.byId(id).oil), oil: g.stock.get('oil') };
  }, refuelBefore.ids);
  assert.deepEqual(refuelVisible.tanks, [refuelBefore.cap, 20]);
  assert.ok(Math.abs(refuelBefore.oil - refuelVisible.oil - 2 * (refuelBefore.cap - 10)) < 1e-6);
  await page.screenshot({ path: 'scratchpad/expansion-refuel-visible.png' });
  await page.evaluate(() => {
    const g = window.game;
    g.setView(1);
    g.updateTrainSide(0);
  });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Refuel all · 2×', exact: true }).click();
  const refuelOverview = await page.evaluate((ids) => {
    const g = window.game;
    return {
      tanks: ids.map((id) => g.fleet.byId(id).oil),
      oil: g.stock.get('oil'),
      shown: g.trainSide.root.querySelectorAll('.ts-card').length,
    };
  }, refuelBefore.ids);
  assert.equal(refuelOverview.shown, 2);
  assert.deepEqual(refuelOverview.tanks, [refuelBefore.cap, refuelBefore.cap]);
  assert.ok(Math.abs(refuelVisible.oil - refuelOverview.oil - 2 * (refuelBefore.cap - 20)) < 1e-6);
  await page.screenshot({ path: 'scratchpad/expansion-refuel-overview.png' });
  await page.evaluate(() => {
    const g = window.game;
    g.setView(0);
    g.builder.placeDecor(41, 45, 'signal', 1);
    g.decorPanel.open(g.builder.decorAt(41, 45));
  });
  await page.getByRole('button', { name: 'Rotate direction', exact: true }).click();
  assert.equal(await page.evaluate(() => window.game.builder.decorAt(41, 45).rot), 2);
  await page.getByRole('button', { name: 'Semaphore guide', exact: true }).click();
  await page.screenshot({ path: 'scratchpad/expansion-signals.png' });
  await page.getByRole('button', { name: '×', exact: true }).click();
  await page.evaluate(() => window.game.closeMenus());
  await page.evaluate(async () => {
    const g = window.game;
    const { content } = await import('/src/data/content.ts');
    for (const d of [...content.locomotives, ...content.wagons]) g.crafting.recipes.add(d.id);
    g.screens.open(g.craftingScreen);
  });
  await page.locator('select[aria-label="Vehicle type"]').selectOption('steam');
  assert.ok((await page.locator('.craft-recipe').count()) > 0);
  await page.screenshot({ path: 'scratchpad/expansion-crafting.png' });
  await page.getByRole('button', { name: 'Inspect 3D', exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'scratchpad/expansion-preview.png' });
  await page.close();
  const chunks = await openGame(browser, 'after');
  const chunkBefore = await chunks.evaluate(() => {
    const g = window.game;
    g.closeMenus();
    g.settings.autosave = false;
    g.economy.money = 1e8;
    g.builder.free = true;
    for (const [x, y, t] of [
      [70, 65, 3],
      [71, 67, 0],
      [73, 68, 0],
    ]) {
      g.map.terrain[y * g.map.w + x] = t;
      g.world.retile(x, y);
    }
    g.builder.placeBuilding(70, 65, 'bridge_stone');
    g.builder.placeTrack(70, 65, { kind: 'straight', cls: 'high_speed' }, 1);
    const bridge = g.builder.buildingAt(70, 65);
    g.builder.upgradeBuilding(bridge);
    g.builder.upgradeBuilding(bridge);
    g.builder.placeSupply(70, 65, 'catenary');
    g.builder.spawnDecor(71, 67, 'townhouse', 0);
    const house = g.houses.at(71, 67);
    house.level = 4;
    house.progress = 1;
    house.residents = 300;
    g.builder.placeBuilding(73, 68, 'windmill');
    g.builder.upgradeBuilding(g.builder.buildingAt(73, 68));
    g.clock.setSpeed(2);
    const start = performance.now();
    g.buyChunk(6, true);
    return { ms: performance.now() - start, w: g.map.w, speed: g.clock.speedIndex };
  });
  assert.equal(chunkBefore.speed, 2);
  await chunks.evaluate(() => {
    window.game.buyChunk(0, true);
  });
  await chunks.waitForFunction(() => window.game?.map?.w === 224 && window.game?.fleet, {
    timeout: 45000,
  });
  await chunks.waitForTimeout(1800);
  const chunkAfter = await chunks.evaluate(() => ({
    w: window.game.map.w,
    speed: window.game.clock.speedIndex,
    time: window.game.clock.time,
  }));
  assert.equal(chunkAfter.speed, 2);
  const time = chunkAfter.time;
  const restored = await chunks.evaluate(() => {
    const g = window.game;
    return {
      bridge: g.builder.buildingAt(102, 97)?.level,
      capacity: g.track.get(102, 97)?.bridgeCapacity,
      cls: g.track.get(102, 97)?.cls,
      wire: g.catenary.supplyAt(102, 97),
      house: g.houses.at(103, 99)?.residents,
      mill: g.builder.buildingAt(105, 100)?.level,
      water: g.map.terrain[97 * g.map.w + 102] === 3,
    };
  });
  assert.deepEqual(restored, {
    bridge: 3,
    capacity: 975,
    cls: 'high_speed',
    wire: 'catenary',
    house: 300,
    mill: 2,
    water: true,
  });
  await chunks.waitForTimeout(1000);
  assert.ok(await chunks.evaluate((t) => window.game.clock.time > t, time));
  await chunks.screenshot({ path: 'scratchpad/expansion-chunk-purchase.png' });
  await writeFile(
    'scratchpad/expansion-browser.json',
    JSON.stringify(
      {
        result,
        scene,
        bridgeUpgrade,
        refuelBefore,
        refuelVisible,
        refuelOverview,
        chunkBefore,
        chunkAfter,
        restored,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        result,
        scene,
        bridgeUpgrade,
        refuelBefore,
        refuelVisible,
        refuelOverview,
        chunkBefore,
        chunkAfter,
        restored,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
