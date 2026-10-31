import { content, dataName } from '../data/content';
import { contractTitle } from '../sim/contracts';
import { localStationName } from '../sim/stations';
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

/** A station's stored name, from nothing but the name: a note keeps no station. */
function stationText(stored: string) {
  for (const def of content.stations.defs) {
    const kind = ` ${dataName(def)}`;
    const at = stored.lastIndexOf(kind);
    const shown = localStationName(stored, def, at > 0 ? stored.slice(0, at) : null);
    if (shown !== stored) return shown;
  }
  return stored;
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
  if (stop !== null) return STR.trainNote.noPlatform(stationText(stop));
  return note;
}
