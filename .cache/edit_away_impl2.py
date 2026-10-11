"""Review round on the rear-view paragraph: one more test line, then the tool, the words, the guide."""
import io
import sys


def sub(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)


if sys.argv[1] == 'test':
    sub('tools/building-queue.test.mjs', [
        (r"""    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(true);
    expect(run(root, 'status').out).toMatch(/depot +1\/24 made, 1 kept with the camera off/);
""",
         r"""    expect(existsSync(at(pictureFile('depot', 0, 0)))).toBe(true);
    expect(run(root, 'status').out).toMatch(/depot +1\/24 made, 1 kept with the camera off/);
    // a picture that is made has no next attempt to be reminded of
    const done = run(root, 'show', 'depot-a0-r0').out;
    expect(done).toMatch(/^attempts so far: 3/m);
    expect(done).not.toMatch(/Correction/);
"""),
    ])
    print('test edited')
else:
    sub('assets/source/buildings-v2/families.json', [
        ('"away": "Do not repeat the reference as it stands. There the lower-left wall is the front: {front}. In this picture',
         '"away": "Do not paint the reference again. There, in view r0, the lower-left wall is the front: {front}. In this picture'),
        ('"awayRound": "Do not repeat a reference as it stands. The front ({front}) is the lower-left wall of the second reference and the lower-right wall of the fourth. In this picture',
         '"awayRound": "Do not paint a reference again. The front ({front}) is the lower-left wall of the second reference, view r0, and the lower-right wall of the fourth, view r3. In this picture'),
    ])
    sub('tools/building-queue.mjs', [
        ("""  const away = (words) => words.replace('{front}', families.families[f.family].front);
""",
         """  // the front wall only: what a family's `front` says after a semicolon is not on that wall
  // and may show from behind (a windmill's sails, the track beside a station)
  const away = (words) =>
    words.replace('{front}', families.families[f.family].front.split(';')[0].trim());
"""),
        ("""      // sent again as printed, a prompt gives the same picture again
      ...(entry.attempts > 0
        ? [
            '  if the last attempt failed for what it shows, not for its camera: add a paragraph after the prompt',
            '  that begins "Correction:" and says what was wrong and where it belongs in this view.',
            '  The same words sent again give the same picture again (guide, section 7).',
          ]
        : []),
""",
         """      // sent again as printed, a prompt is likely to bring the same fault again
      ...(entry.attempts > 0 && entry.status === 'pending'
        ? [
            '  if the last attempt failed for what it shows, not for its camera: add a paragraph after the prompt',
            '  that begins "Correction:" and says what was wrong and where it belongs in this view.',
            '  The same words sent again are likely to bring the same fault again (guide, section 7).',
          ]
        : []),
"""),
        ("""        `then:      node tools/building-queue.mjs set ${e.id} generated`,
      );
""",
         """        `then:      node tools/building-queue.mjs set ${e.id} generated`,
        // between two attempts at a picture the agent runs `take` and nothing else: what a
        // second attempt needs is said where it is read
        'or:        if it fails on looking (guide, section 6), make it again: the printed prompt, and after it a paragraph',
        '           that begins "Correction:" and says what was wrong and where it belongs in this view.',
        '           The same words sent again are likely to bring the same fault again.',
      );
"""),
        (""" * A rear view's references show the front it does not: r0 on its lower-left wall, r3 on its
 * lower-right. Shown them, the generator repeated them (the quarry's hopper came back on a
 * visible wall in seven attempts of nine), so the last paragraph of a rear view's prompt names
 * the family's own front, the wall it has in the references, and that it is out of sight here.
""",
         """ * A rear view's references show the front it does not: r0 on its lower-left wall, r3 on its
 * lower-right. Shown them, the generator painted them again (the quarry's hopper came back on a
 * visible wall in seven attempts of nine, six of them a reference over again), so the last
 * paragraph of a rear view's prompt names the family's own front, the wall it has in the
 * references, and that it is out of sight here. Whether that turns the building is not known
 * yet: no picture has been painted with it.
"""),
    ])
    print('tool edited')
