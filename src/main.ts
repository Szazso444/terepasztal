import { Game, hashSeed } from './game';
import { STR } from './strings';
import { el } from './ui/dom';
import { readSave } from './sim/save';

function seedFromUrl(): number | null {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) return /^\d+$/.test(m[1]) ? Number(m[1]) : hashSeed(m[1]);
  return null;
}

async function boot() {
  const loading = el('div', { id: 'loading' }, STR.title, el('small', { text: STR.loading }));
  document.getElementById('ui-root')!.append(loading);
  const save = location.hash.includes('new') ? null : readSave();
  const urlSeed = seedFromUrl();
  // a save is resumed when its seed matches the URL (or the URL has no seed)
  const useSave = save && (urlSeed === null || urlSeed === save.seed);
  const game = new Game(useSave ? save.seed : (urlSeed ?? 1337));
  (window as unknown as { game: Game }).game = game;
  await game.init();
  if (useSave) game.applySave(save);
  if (location.hash.includes('new')) history.replaceState(null, '', `#seed=${game.seed}`);
  loading.remove();
}

boot().catch((e) => {
  console.error(e);
  const box = el(
    'pre',
    { style: 'color:#d05a50;padding:20px;font-size:13px' },
    String(e?.stack ?? e),
  );
  document.body.append(box);
});
