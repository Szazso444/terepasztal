"""Two expectations of my own that were wrong."""
import io

p = 'tools/building-queue.test.mjs'
s = io.open(p, encoding='utf-8', newline='').read()
pairs = [
    (r"""      expect(about(id).prompt).not.toMatch(/Do not paint/);""",
     r"""      expect(about(id).prompt).not.toMatch(/Do not paint (the|a) reference again/);"""),
    (r"""{ repaint: true }).prompt).not.toMatch(/Do not paint/);""",
     r"""{ repaint: true }).prompt).not.toMatch(
        /Do not paint (the|a) reference again/,
      );"""),
]
for old, new in pairs:
    assert s.count(old) == 1, (old, s.count(old))
    s = s.replace(old, new)
i = s.index("const { turn, away } = fam.references;")
j = s.index("expect(alone.prompt).not.toMatch(/exactly as large/);", i)
s = s[:i] + """const { turn, away } = fam.references;
    const front = fam.families.station.front.split(';')[0];
    expect(alone.prompt.endsWith(`${turn}\\n\\n${away.replace('{front}', front)}`)).toBe(true);
    """ + s[j:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
