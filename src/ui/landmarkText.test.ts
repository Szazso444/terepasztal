import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ENGLISH } from '../strings';

/** Every string a landmark says in English, from the names and stories to the button labels. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

/** The text of every string literal of a source file. */
function literals(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('landmark text', () => {
  // the words themselves live in src/strings.ts and src/data/strings.hu.ts: no other file holds one
  it('is typed nowhere outside the strings files', () => {
    const said = leaves(ENGLISH.landmarks).filter((s) => s.length >= 6);
    expect(said.length).toBeGreaterThan(40);
    const set = new Set(said);
    const found: string[] = [];
    for (const f of sources('src')) {
      const own = f.replace(/\\/g, '/');
      if (own === 'src/strings.ts' || own === 'src/data/strings.hu.ts') continue;
      for (const l of literals(f)) if (set.has(l)) found.push(`${own}: ${l}`);
    }
    expect(found, 'take it from STR.landmarks').toEqual([]);
  }, 30_000);

  it('is not typed in the landmark panel or its view either', () => {
    for (const f of ['landmarkPanel.ts', 'landmarkView.ts']) {
      const text = literals(`src/ui/${f}`).filter(
        (l) => /[A-Za-z]/.test(l) && !l.startsWith('.') && (/^[A-Z]/.test(l) || /[.,:?!]/.test(l)),
      );
      expect(text, f).toEqual([]);
    }
  });

  it('asks the commands, and only the commands, to choose', () => {
    const src = readFileSync('src/ui/landmarkPanel.ts', 'utf8');
    for (const c of ['startLandmark', 'salvageLandmark', 'cancelLandmark'])
      expect(src, c).toContain(`.${c}(`);
    // the registry is read for the panel and never driven
    expect(src).not.toMatch(/landmarks\.(start|salvage|cancel|credit|tick|onArrive|load)\(/);
  });
});
