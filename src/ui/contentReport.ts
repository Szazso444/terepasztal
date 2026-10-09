import { STR } from '../strings';
import type { ContentKey, ContentOverrideReport } from '../data/content';

/** Problems an invalid set-aside table shows; the rest are counted. */
const SET_ASIDE_PROBLEMS = 3;

/** One stored table that did not load: its tab, how bad it is, and what the player reads. */
export interface SetAsideLine {
  key: ContentKey;
  /** `warn` for a stale edit (made for older shipped data), `bad` for an invalid one */
  kind: 'warn' | 'bad';
  text: string;
}

/** The first `max` problems, then how many more there are. */
export function problemSummary(problems: string[], max: number): string {
  return (
    problems.slice(0, max).join(' · ') +
    (problems.length > max ? ` (+${problems.length - max})` : '')
  );
}

/** A line per stored table the content loaded without, in the report's order. */
export function setAsideLines(report: ContentOverrideReport): SetAsideLine[] {
  return report.setAside.map(({ key, reason, problems }) => {
    const tab = STR.content.tabs[key] ?? key;
    return reason === 'stale'
      ? { key, kind: 'warn', text: STR.content.setAsideStale(tab) }
      : {
          key,
          kind: 'bad',
          text: STR.content.setAsideInvalid(tab, problemSummary(problems, SET_ASIDE_PROBLEMS)),
        };
  });
}
