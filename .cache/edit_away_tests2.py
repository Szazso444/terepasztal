"""Review round on the rear-view paragraph: the tests first."""
import io


def sub(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)


sub('tools/building-queue.test.mjs', [
    (r"""    // side on a visible wall: four of six attempts at an r1 repeated the front view, three of
    // three at an r2 repeated r3. The View line says that nothing of the front is in the picture,
    // but not what the front is, nor that the reference shows it. So the prompt of a rear view
    // ends with the family's own front, the wall it has in each reference that shows it, and
    // that the reference is not to be repeated
""",
     r"""    // side on a visible wall: three of six attempts at an r1 were the front view again and a
    // fourth was half turned, three of three at an r2 were r3 again. The View line says that
    // nothing of the front is in the picture, but not what the front is, nor that the reference
    // shows it. So the prompt of a rear view ends with the family's own front, the wall it has
    // in each reference that shows it, and that the reference is not to be painted again
"""),
    (r"""    expect(away).toMatch(/^Do not repeat the reference as it stands\./);
    expect(away).toMatch(/There the lower-left wall is the front: \{front\}\./);
    expect(awayRound).toMatch(/^Do not repeat a reference as it stands\./);
    expect(awayRound).toMatch(
      /The front \(\{front\}\) is the lower-left wall of the second reference and the lower-right wall of the fourth\./,
    );
""",
     r"""    // "as it stands" is what the paragraph before says of the walls that are to be copied
    expect(away).toMatch(/^Do not paint the reference again\./);
    expect(away).toMatch(/There, in view r0, the lower-left wall is the front: \{front\}\./);
    expect(awayRound).toMatch(/^Do not paint a reference again\./);
    expect(awayRound).toMatch(
      /The front \(\{front\}\) is the lower-left wall of the second reference, view r0, and the lower-right wall of the fourth, view r3\./,
    );
    for (const words of [away, awayRound]) expect(words).not.toMatch(/as it stands/);
"""),
    (r"""      expect(about(id).prompt).not.toMatch(/Do not repeat/);
    for (const id of ['quarry-a0-r1', 'quarry-a0-r2'])
      expect(describeEntry(id, inv, fam, { repaint: true }).prompt).not.toMatch(/Do not repeat/);
""",
     r"""      expect(about(id).prompt).not.toMatch(/Do not paint/);
    for (const id of ['quarry-a0-r1', 'quarry-a0-r2'])
      expect(describeEntry(id, inv, fam, { repaint: true }).prompt).not.toMatch(/Do not paint/);
"""),
    (r"""        expect(last).toMatch(/^Do not repeat (the|a) reference as it stands\./);
        expect(last).toContain(fam.families[f.family].front);
        expect(last).not.toContain('{front}');
      }
""",
     r"""        expect(last).toMatch(/^Do not paint (the|a) reference again\./);
        expect(last).toContain(fam.families[f.family].front.split(';')[0]);
        expect(last).not.toContain('{front}');
        expect(last).not.toContain(';');
      }
    // only the wall is named: what a family's front says after it is not on the front wall, and
    // may well show from behind (a windmill's sails, the track beside a station)
    expect(fam.families.windmill.front).toBe('the wall with the door; the sails face the front');
    const mill = about('windmill-a0-r1').prompt.split('\n\n').at(-1);
    expect(mill).toContain('the lower-left wall is the front: the wall with the door.');
    expect(mill).not.toMatch(/sails/);
    expect(about('depot_narrow-a0-r2').prompt.split('\n\n').at(-1)).not.toMatch(/track/);
"""),
    (r"""    // a later attempt is not: three attempts sent with the same words came back as the same
    // picture three times (the quarry's rear views), so the tool asks for the words itself
    expect(second.out).toMatch(
      /^attempts so far: 1\n +if the last attempt failed for what it shows, not for its camera: add a paragraph after the prompt\n +that begins "Correction:" and says what was wrong and where it belongs in this view\.\n +The same words sent again give the same picture again \(guide, section 7\)\.$/m,
    );
""",
     r"""    // a later attempt is not: the quarry's rear views were sent three times with the same words
    // and given up, so the tool asks for the words itself
    expect(second.out).toMatch(
      /^attempts so far: 1\n +if the last attempt failed for what it shows, not for its camera: add a paragraph after the prompt\n +that begins "Correction:" and says what was wrong and where it belongs in this view\.\n +The same words sent again are likely to bring the same fault again \(guide, section 7\)\.$/m,
    );
"""),
    (r"""    expect(ok.out).toMatch(/^then: +node tools\/building-queue\.mjs set depot-a0-r0 generated$/m);
    expect(ok.out).not.toMatch(/^note:/m);
""",
     r"""    expect(ok.out).toMatch(/^then: +node tools\/building-queue\.mjs set depot-a0-r0 generated$/m);
    // and what to do if it is not right, said here: between two attempts the agent runs `take`
    // and nothing else, so this is the one place it reads before it makes the picture again
    expect(ok.out).toMatch(
      /^or: +if it fails on looking \(guide, section 6\), make it again: the printed prompt, and after it a paragraph\n +that begins "Correction:" and says what was wrong and where it belongs in this view\.\n +The same words sent again are likely to bring the same fault again\.$/m,
    );
    expect(ok.out).not.toMatch(/^note:/m);
"""),
])
sub('tools/building-docs.test.mjs', [
    (r"""    // the quarry's rear views: three attempts sent with the same words came back as the same
    // picture three times. The guide asked for what was wrong to be said, and in two other
    // places for the prompt to be used "as printed", which is what was done
    expect(guide).toMatch(/begins "Correction:"/);
    expect(guide).toMatch(/The same words sent again give the same picture again/);
""",
     r"""    // the quarry's rear views were sent three times with the same words and given up. The
    // guide asked for what was wrong to be said, and in two other places for the prompt to be
    // used "as printed", which is what was done
    expect(guide).toMatch(/begins "Correction:"/);
    expect(guide).toMatch(/The same words sent again are likely to bring the same fault again/);
    // a rear view is judged for a repeated reference whatever its prompt ends with
    expect(guide).not.toMatch(/where the prompt ends with the paragraph on size and walls/);
"""),
])
print('tests edited')
