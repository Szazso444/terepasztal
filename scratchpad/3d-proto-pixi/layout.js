// The same test layout for both prototypes: add(tx, ty, heading, pitch, h, extra) places one engine.
import { loadAtlas, drawTrack, straight, circle, num } from './scene.js';

export async function populate({ rails, objects }, add) {
  // a ring of headings
  const CX = 10, CY = 10, R = 4.2, N = num('n', 12);
  drawTrack(rails, circle(CX, CY, R));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    add(CX + R * Math.cos(a), CY + R * Math.sin(a), a + Math.PI / 2);
  }
  // straight track along tile +x: two engines nose to tail, then the game's own sprite on the next track
  drawTrack(rails, straight(3, 17.5, 20, 17.5));
  drawTrack(rails, straight(3, 19, 20, 19));
  add(8, 17.5, 0);
  add(10.05, 17.5, 0);
  // two crossing in one spot
  drawTrack(rails, straight(13.5, 16, 16.5, 19));
  drawTrack(rails, straight(13.5, 19, 16.5, 16));
  add(15, 17.5, Math.PI / 4);
  add(15, 17.5, -Math.PI / 4);
  // a pitched one (25 % grade, exaggerated) and a tinted, half transparent one
  add(18.5, 17.5, 0, Math.atan(0.25), 0.25);
  add(5.5, 19, 0, 0, 0, { tint: 0x9be8ff, alpha: 0.6 });

  // sprites: trees behind and in front of the engines, and the sprite locomotive for the look
  const props = await loadAtlas('props');
  const trees = ['props/tree_0', 'props/tree_1', 'props/tree_2'];
  const spots = [[9.4, 9.4], [10.6, 10.6], [10, 15.2], [12, 13.4], [7.2, 16.8], [9, 18.3], [11.2, 18.2], [14.6, 18.6], [6, 12], [14.8, 9.5]];
  spots.forEach(([x, y], i) => objects.addChild(props.sprite(trees[i % 3], x, y, 10)));
  try {
    const rolling = await loadAtlas('rolling-B');
    objects.addChild(
      rolling.sprite('rolling/loco_black_five_tender_f0', 8.3, 19, 15),
      rolling.sprite('rolling/loco_black_five_engine_f0', 9.3, 19, 15),
    );
  } catch (err) {
    console.warn('no sprite locomotive', err);
  }
}
