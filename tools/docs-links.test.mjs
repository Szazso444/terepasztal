import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A relative link in the documentation must point at a path that exists. The checker lives here
// because nothing else uses it; the last case below feeds it a synthetic document so that a
// checker that finds nothing cannot pass for one that works.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Markdown files whose links are checked: `docs/**` and the root `*.md` files. */
function documents(root = ROOT) {
  const rootFiles = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);
  const docFiles = readdirSync(join(root, 'docs'), { recursive: true })
    .filter((p) => p.endsWith('.md'))
    .map((p) => `docs/${p.split('\\').join('/')}`);
  return [...rootFiles, ...docFiles].sort();
}

/** Remove inline code spans, so a link shown as an example is not taken for a link. */
function withoutCodeSpans(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (span) => ' '.repeat(span.length));
}

/** The raw targets of the inline links and reference definitions on one line. */
function targetsOf(line) {
  const out = [];
  const text = withoutCodeSpans(line);
  const definition = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(text);
  if (definition) out.push(definition[1]);
  for (let at = text.indexOf(']('); at !== -1; at = text.indexOf('](', at + 2)) {
    let i = at + 2;
    while (text[i] === ' ') i++;
    let target = '';
    if (text[i] === '<') {
      const close = text.indexOf('>', i);
      if (close === -1) continue;
      target = text.slice(i + 1, close);
    } else {
      // the destination ends at whitespace (a title follows) or at the closing parenthesis;
      // parentheses inside it must balance
      let depth = 0;
      for (; i < text.length; i++) {
        const c = text[i];
        if (/\s/.test(c)) break;
        if (c === '(') depth++;
        if (c === ')') {
          if (depth === 0) break;
          depth--;
        }
        target += c;
      }
    }
    out.push(target);
  }
  return out;
}

/** Whether a target is for the reader's browser rather than for a file in the repository. */
function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

/**
 * Relative links in `text` (the content of `file`, a path from the repository root) whose target
 * does not exist. `exists` takes an absolute path.
 */
function deadLinks(file, text, exists = existsSync, root = ROOT) {
  const dead = [];
  let fence = null; // the opening fence while inside fenced code
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker[1];
      return;
    }
    for (const raw of targetsOf(line)) {
      if (!raw || raw.startsWith('#') || isExternal(raw)) continue;
      const path = raw.replace(/[#?].*$/, '');
      if (!path) continue;
      let decoded = path;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // an unescaped percent sign: look the path up as written
      }
      const absolute = decoded.startsWith('/')
        ? resolve(root, `.${decoded}`)
        : resolve(root, dirname(file), decoded);
      if (!exists(absolute)) dead.push({ file, line: index + 1, target: raw });
    }
  });
  return dead;
}

/** The dead links of every file in `files`, each read with `read`. */
const check = (files, read) => files.flatMap((file) => deadLinks(file, read(file)));

const describeDead = (d) => `${d.file}:${d.line} -> ${d.target}`;

describe('relative links in the documentation', () => {
  it('finds the documents it is meant to check', () => {
    // a walker that finds nothing would pass every link
    const files = documents();
    for (const f of ['README.md', 'AGENTS.md', 'docs/art-direction/README.md'])
      expect(files, f).toContain(f);
    expect(files.filter((f) => f.startsWith('docs/')).length).toBeGreaterThan(10);
  });

  it('all point at a path that exists', () => {
    const dead = check(documents(), (file) => readFileSync(join(ROOT, file), 'utf8'));
    expect(dead.map(describeDead)).toEqual([]);
  });
});

describe('the link checker', () => {
  const real = 'docs/art-direction/README.md';

  it('reports a dead link with its file, line and target', () => {
    const doc = ['# Title', '', 'Some text with [a dead link](../missing/page.md) in it.'].join(
      '\n',
    );
    const dead = deadLinks(real, doc);
    expect(dead).toEqual([{ file: real, line: 3, target: '../missing/page.md' }]);
    expect(describeDead(dead[0])).toBe(`${real}:3 -> ../missing/page.md`);
  });

  it('fails the check over documents when one holds a dead link', () => {
    // the link the art guide once carried, in a document that is not in the repository
    const doc = 'See [the old note](../../scratchpad/illustrated-hd/README.md).';
    const dead = check([real, 'docs/synthetic.md'], (file) => (file === real ? '# Fine' : doc));
    expect(dead.map(describeDead)).toEqual([
      'docs/synthetic.md:1 -> ../../scratchpad/illustrated-hd/README.md',
    ]);
  });

  it('resolves a link from the directory of the file that holds it', () => {
    // the same target is live from one directory and dead from another
    const doc = '[guide](README.md)';
    expect(deadLinks('docs/art-direction/x.md', doc)).toEqual([]);
    expect(deadLinks('docs/x.md', doc)).toEqual([
      { file: 'docs/x.md', line: 1, target: 'README.md' },
    ]);
  });

  it('accepts a link to a directory and a link rooted at the repository', () => {
    const doc = ['[folder](../../src/art/)', '[rooted](/src/art/index.ts)'].join('\n');
    expect(deadLinks(real, doc)).toEqual([]);
  });

  it('strips the fragment and the query before looking the path up', () => {
    const doc = ['[heading](terrain-production.md#runtime)', '[query](terrain-v4.md?plain=1)'].join(
      '\n',
    );
    expect(deadLinks(real, doc)).toEqual([]);
    expect(deadLinks(real, '[heading](nothing.md#runtime)').map((d) => d.target)).toEqual([
      'nothing.md#runtime',
    ]);
  });

  it('ignores URLs, mailto and same-file anchors', () => {
    const doc = [
      '[web](https://example.com/nothing.md)',
      '[plain](http://example.com/nothing.md)',
      '[protocol relative](//example.com/nothing.md)',
      '[mail](mailto:someone@example.com)',
      '[here](#a-heading)',
      '<https://example.com/nothing.md>',
    ].join('\n');
    expect(deadLinks(real, doc)).toEqual([]);
  });

  it('ignores fenced code and code spans', () => {
    const doc = [
      '```md',
      '[in a fence](gone.md)',
      '```',
      '~~~~',
      '[in a tilde fence](gone.md)',
      '```',
      '[still in it](gone.md)',
      '~~~~',
      'An example `[in a span](gone.md)` is not a link.',
      '[after the fence](gone.md)',
    ].join('\n');
    expect(deadLinks(real, doc)).toEqual([{ file: real, line: 10, target: 'gone.md' }]);
  });

  it('reads images, titles, angle brackets, reference definitions and nested links', () => {
    const doc = [
      '![picture](images/none.png)',
      '[titled](gone.md "A title")',
      '[spaced](<gone with spaces.md>)',
      '[ref]: gone-ref.md',
      '[![badge](images/none.png)](gone-outer.md)',
      '[balanced](gone_(1).md)',
    ].join('\n');
    expect(deadLinks(real, doc).map((d) => [d.line, d.target])).toEqual([
      [1, 'images/none.png'],
      [2, 'gone.md'],
      [3, 'gone with spaces.md'],
      [4, 'gone-ref.md'],
      [5, 'images/none.png'],
      [5, 'gone-outer.md'],
      [6, 'gone_(1).md'],
    ]);
  });

  it('decodes a percent-escaped path', () => {
    const exists = (p) => p === resolve(ROOT, 'docs', 'a b.md');
    expect(deadLinks('docs/x.md', '[spaced](a%20b.md)', exists)).toEqual([]);
  });
});
