"""Review round on the rear-view paragraph: the guide and the production document."""
import io


def sub(path, pairs):
    s = io.open(path, encoding='utf-8', newline='').read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, old[:70], s.count(old))
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8', newline='').write(s)


sub('assets/source/buildings-v2/GUIDE.md', [
    ("""- Seen from behind (`r1`, `r2`), where the prompt ends with the paragraph on size and walls: is
  it still that building? No taller than in the front view and with no storey more; the same form
  of roof, its ridge running the way that paragraph says; the side as the reference shows it; the
  back as that paragraph asks for it (one straight wall only where it says so); and nothing of the
  front (a canopy, a porch, the open side of a shed, the side where a hopper discharges) on a
  side where the front is not. A rear view that is a reference repeated, the front where the
  reference has it, is the commonest fault here. In an `r2` with four pictures attached, the
  back is the one `r1` shows and the left-hand side the one `r3` shows. A picture that fails
  here is made again from the printed prompt, whatever its camera, with what was wrong said
  after it (section 7).
""",
     """- Seen from behind (`r1`, `r2`), any picture that is not marked `(to paint again: the same
  building)`: is the front out of sight? Nothing of it (a canopy, a porch, the open side of a
  shed, the side where a hopper discharges) is on a visible wall. A rear view that is a
  reference painted again, the front where the reference has it, is the commonest fault of
  these views.
- Seen from behind, where the prompt has the paragraph on size and walls ("About the building's
  size and roof", "About the two extra references"): is it still that building? No taller than
  in the front view and with no storey more; the same form of roof, its ridge running the way
  that paragraph says; the side as the reference shows it; the back as that paragraph asks for
  it (one straight wall only where it says so). In an `r2` with four pictures attached, the
  back is the one `r1` shows and the left-hand side the one `r3` shows.
- A picture that fails either of these two is made again from the printed prompt, whatever its
  camera, with what was wrong said after it (section 7).
"""),
    ("""- A picture marked `(to paint again: the same building)` is painted from its own earlier self,
  whichever view it is: two pictures to attach, and no such paragraph.
- An `r2` whose `r1` or `r3` was given up is painted from the front view alone: two pictures to
  attach, and no such paragraph.
""",
     """- A picture marked `(to paint again: the same building)` is painted from its own earlier self,
  whichever view it is: two pictures to attach, and neither paragraph.
- An `r2` whose `r1` or `r3` was given up is painted from the front view alone: two pictures to
  attach, and only the paragraph that names the front.
"""),
    ("""The same words sent again give the same picture again: three attempts without a correction are
one attempt made three times. `next` and `show` remind you of this from the second attempt on.
""",
     """The same words sent again are likely to bring the same fault again. `take` says so under every
picture it takes, and `next` and `show` from the second attempt on.
"""),
    ("""the tool sets the faulty file aside, and `next` hands the picture out the way it was being made.
Do not use `redo` for this.
""",
     """the tool sets the faulty file aside, and `next` hands the picture out the way it was being made.
Its count of attempts starts again, so nothing reminds you: say what the fault was after the
printed prompt, as for a second attempt. The same holds for a picture that was given up and is
put back with `redo <family>`. Do not use `redo` for a fault found after recording.
"""),
])

sub('docs/art-direction/building-production.md', [
    ("""  had the hopper's discharge side on a visible wall, and two pictures were given up. Each of
  those seven is a reference repeated: an `r1` that is the front view again, an `r2` that is
  `r3` again. Two causes, both put right in the tools since, neither tried on a picture yet.
  One: the agent sent the printed prompt unchanged on every attempt. The guide asked it to say
  what was wrong, and in two other places to use the prompt "as printed", and a hand-over text
  of mine had said "add no paragraph of your own about size, roof or walls"; it followed
  those. The guide now says it one way, and `next` and `show` print a reminder from the second
  attempt on. Two: the prompt of a rear view now ends with a paragraph of its own
  (`references.away`, `references.awayRound`) that names the family's `front`, says which wall
  it has in each reference that shows it, and that the reference is not to be repeated.
""",
     """  had the hopper's discharge side on a visible wall, and two pictures were given up (a third,
  an `r2` painted alone, soon after). Six of those seven are a reference painted again, each
  time the last picture attached: an `r1` that is the front view again, an `r2` that is `r3`
  again; the seventh is half turned. Two things were changed in the tools for it, neither
  tried on a picture yet, so neither is known to be the cause. One: the agent had sent the
  printed prompt unchanged on every attempt (its call adds only the output size and which
  picture is which), and the word "Correction" is nowhere in its record. The guide asked it to
  say what was wrong, and in two other places to use the prompt "as printed", and a hand-over
  text of mine had said "add no paragraph of your own about size, roof or walls"; it followed
  those. The same words did not always bring the same picture (of eight unchanged second and
  third attempts in the record three came out right), and every first attempt at these rear
  views failed before a correction was possible. The guide now says it one way, and the tool
  says it where the agent reads between two attempts: under every picture `take` takes, and
  in `next` and `show` from the second attempt on. Two: the prompt of a rear view now ends
  with a paragraph of its own (`references.away`, `references.awayRound`) that names the
  family's front wall (its `front` up to the first semicolon: a windmill's sails and the track
  beside a station are not on that wall, and show from behind), says which wall it is in each
  reference that shows it, and that the reference is not to be painted again. Not tried: to
  attach `r3` before `r1` for an `r2`, so that the last picture attached shows no front.
"""),
])
print('guide and doc edited')
