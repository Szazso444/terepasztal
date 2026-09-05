import { Game, hashSeed } from './game';
import { STR } from './strings';
import { el } from './ui/dom';

function seedFromUrl(): number {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) return /^\d+$/.test(m[1]) ? Number(m[1]) : hashSeed(m[1]);
  return 1337;
}

async function boot() {
  const loading = el('div', { id: 'loading' }, STR.title, el('small', { text: STR.loading }));
  document.getElementById('ui-root')!.append(loading);
  const game = new Game(seedFromUrl());
  (window as unknown as { game: Game }).game = game;
  await game.init();
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
