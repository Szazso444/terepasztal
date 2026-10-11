import io
def sub(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:60], s.count(old))
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)

sub('tools/building-queue.test.mjs', [
    ("expect(words).toMatch(/faces away, hidden behind the building: neither visible wall is it/);",
     "expect(words).toMatch(\n        /In this picture the front faces away, hidden behind the building: neither visible wall is the front, and what the front has does not show on them\.$/,\n      );"),
])
fam = 'assets/source/buildings-v2/families.json'
s = io.open(fam, encoding='utf-8', newline='').read()
nl = '\r\n' if '\r\n' in s else '\n'
key = '    "round": '
i = s.index(key)
j = s.index(nl, i)
line = s[i:j]
assert line.endswith(','), line[-40:]
add = (nl + '    "away": "Do not repeat the reference as it stands. There the lower-left wall is the front: {front}. In this picture the front faces away, hidden behind the building: neither visible wall is the front, and what the front has does not show on them.",'
       + nl + '    "awayRound": "Do not repeat a reference as it stands. The front ({front}) is the lower-left wall of the second reference and the lower-right wall of the fourth. In this picture the front faces away, hidden behind the building: neither visible wall is the front, and what the front has does not show on them.",')
s = s[:j] + add + s[j:]
io.open(fam, 'w', encoding='utf-8', newline='').write(s)

sub('tools/building-queue.mjs', [
    ("""  const view = (r) => pictureFile(f.family, age, r);
  if (rot === 2 && !alone)
    return {
      files: [STYLE_BOARD, view(0), view(1), view(3)],
      optional: [view(1), view(3)],
      text: text.turn,
      more: text.round,
    };
  if (rot === 1) {
    const back = families.families[f.family].back === 'wall' ? text.backWall : text.backOther;
    return {
      files: [STYLE_BOARD, view(0)],
      text: text.turn,
      more: text.behind.replace('{back}', back),
    };
  }
  if (rot > 0) return { files: [STYLE_BOARD, view(0)], text: text.turn };
""".replace('\n', nl if False else '\n'),
     """  const view = (r) => pictureFile(f.family, age, r);
  const away = (words) => words.replace('{front}', families.families[f.family].front);
  if (rot === 2 && !alone)
    return {
      files: [STYLE_BOARD, view(0), view(1), view(3)],
      optional: [view(1), view(3)],
      text: text.turn,
      more: `${text.round}\n\n${away(text.awayRound)}`,
    };
  if (rot === 1) {
    const back = families.families[f.family].back === 'wall' ? text.backWall : text.backOther;
    return {
      files: [STYLE_BOARD, view(0)],
      text: text.turn,
      more: `${text.behind.replace('{back}', back)}\n\n${away(text.away)}`,
    };
  }
  // an r2 painted alone is shown the front view only, as an r1 is
  if (rot === 2) return { files: [STYLE_BOARD, view(0)], text: text.turn, more: away(text.away) };
  if (rot > 0) return { files: [STYLE_BOARD, view(0)], text: text.turn };
"""),
    ("""      `attempts so far: ${entry.attempts}${entry.note && !d.repaint ? ` (${entry.note})` : ''}`,
""",
     """      `attempts so far: ${entry.attempts}${entry.note && !d.repaint ? ` (${entry.note})` : ''}`,
      // sent again as printed, a prompt gives the same picture again
      ...(entry.attempts > 0
        ? [
            '  if the last attempt failed for what it shows, not for its camera: add a paragraph after the prompt',
            '  that begins "Correction:" and says what was wrong and where it belongs in this view.',
            '  The same words sent again give the same picture again (guide, section 7).',
          ]
        : []),
"""),
])
print('edited')
