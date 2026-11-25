import { contractTitle } from '../sim/contracts';
import type { Station } from '../sim/stations';
import { ENGLISH, LANGUAGE, STR } from '../strings';

/** The notes of a table, English to the language on screen, the ones that are plain text. */
function plainNotes(english: Record<string, unknown>, shown: Record<string, unknown>) {
  const out: [string, string][] = [];
  for (const [key, text] of Object.entries(english))
    if (typeof text === 'string') out.push([text, shown[key] as string]);
  return out;
}
const NOTES = new Map<string, string>([
  ...plainNotes(ENGLISH.traffic, STR.traffic),
  ...plainNotes(ENGLISH.trainNote, STR.trainNote),
  [ENGLISH.fleet.mixedGaugeTrain, STR.fleet.mixedGaugeTrain],
]);

/** What a note written by `template` holds in its slot, or null when it is not such a note. */
function slotOf(template: (name: string) => string, note: string): string | null {
  const [before, after] = template('\0').split('\0');
  const fits = note.length > before.length + after.length;
  if (!fits || !note.startsWith(before) || !note.endsWith(after)) return null;
  return note.slice(before.length, note.length - after.length);
}

/** The world's stations, which a note can name only by what they store. */
let stations: () => readonly Pick<Station, 'storedName' | 'name'>[] = () => [];
/** Called once the world stands: the panels say where the stations are. */
export function noteStationsFrom(list: typeof stations) {
  stations = list;
}

/**
 * A train's note in the language on screen. The simulation keeps a note in English (`ENGLISH`), as
 * it compares notes and the save holds them, and a note in the save must not depend on the language.
 */
export function noteText(note: string): string {
  if (LANGUAGE === 'en' || !note) return note;
  const known = NOTES.get(note);
  if (known !== undefined) return known;
  const job = slotOf(ENGLISH.trainNote.onContract, note);
  if (job !== null) return STR.trainNote.onContract(contractTitle(job));
  const stop = slotOf(ENGLISH.trainNote.noPlatform, note);
  if (stop !== null) {
    const shown = stations().find((s) => s.storedName === stop)?.name;
    return STR.trainNote.noPlatform(shown ?? stop);
  }
  return note;
}
