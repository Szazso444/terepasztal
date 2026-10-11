import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forAll, shrinkArray } from '../src/testing/property';

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

  it('looks a path with an unescaped percent sign up as written', () => {
    const exists = (p) => p === resolve(ROOT, 'docs', '100%.md');
    expect(deadLinks('docs/x.md', '[all of it](100%.md)', exists)).toEqual([]);
    expect(deadLinks('docs/x.md', '[all of it](100%.md)', () => false)).toEqual([
      { file: 'docs/x.md', line: 1, target: '100%.md' },
    ]);
  });

  it('keeps a fence open until a line of the same character and at least its length', () => {
    const inside = '[inside](gone.md)';
    const dead = (...lines) => deadLinks(real, lines.join('\n')).map((d) => d.line);
    // a shorter run of the same character does not close it; neither does another character
    expect(dead('````', '```', inside, '````')).toEqual([]);
    expect(dead('~~~', '```', inside, '~~~')).toEqual([]);
    expect(dead('```', '~~~', inside, '```')).toEqual([]);
    // a longer run, or an indented one (up to three spaces), does
    expect(dead('```', '`````', inside)).toEqual([3]);
    expect(dead('```', '   ```', inside)).toEqual([3]);
    // a fence that is never closed runs to the end of the document
    expect(dead('```', inside, inside)).toEqual([]);
  });
});

// The same checker over documents the generator builds line by line, so the expected dead links
// are known by construction and no second parser has to agree with the first.
describe('the link checker over generated documents', () => {
  const FILE = 'docs/gen/doc.md';
  const LIVE = ['live.md', 'sub/live.md', '../up.md', 'dir/', '/README.md', 'img/live.png'];
  // what exists, as the absolute paths the checker will look up (a trailing slash is dropped)
  const present = new Set(
    LIVE.map((t) => (t.startsWith('/') ? resolve(ROOT, `.${t}`) : resolve(ROOT, dirname(FILE), t))),
  );
  const exists = (absolute) => present.has(absolute);
  const SUFFIXES = ['', '#sec', '?plain=1', '#a?b'];
  const EXTERNAL = [
    'https://example.com/gone.md',
    'mailto:me@example.com',
    '#anchor',
    '//cdn.test/x',
  ];
  const FENCE_CHARS = ['`', '~'];

  /** One fence: its character, length and indent, the lines inside it, and how it ends. */
  function fence(rng, id) {
    const c = rng.pick(FENCE_CHARS);
    const other = c === '`' ? '~' : '`';
    const n = rng.int(3, 5);
    const body = Array.from({ length: rng.int(0, 5) }, () =>
      rng.pick([
        { line: `[in the fence ${id}](gone-in-${id}.md)` },
        { line: c.repeat(n - 1) }, // shorter than the opening run: text
        { line: other.repeat(n) }, // another character: text
        { line: 'text' },
      ]),
    );
    // never closed (runs to the end), or closed by a run of at least n
    const close = rng.chance(0.2) ? null : n + rng.int(0, 2);
    return { k: 'fence', c, n, indent: rng.int(0, 3), body, close, closeIndent: rng.int(0, 3) };
  }

  function spec(rng, id) {
    const kind = rng.pick(['text', 'live', 'dead', 'dead', 'external', 'span', 'fence']);
    switch (kind) {
      case 'live':
        return { k: 'live', t: rng.pick(LIVE) + rng.pick(SUFFIXES) };
      case 'dead':
        return {
          k: 'dead',
          form: rng.pick(['inline', 'titled', 'image', 'angle', 'definition']),
          t: `${rng.pick(['', 'sub/', '../'])}gone-${id}.md${rng.pick(SUFFIXES)}`,
        };
      case 'external':
        return { k: 'external', t: rng.pick(EXTERNAL) };
      case 'span':
        return { k: 'span', ticks: rng.int(1, 2), t: `gone-span-${id}.md` };
      case 'fence':
        return fence(rng, id);
      default:
        return { k: 'text' };
    }
  }

  /** The document as lines, and the dead links it holds as [line, target] pairs. */
  function render(specs) {
    const lines = [];
    const expected = [];
    for (const s of specs) {
      switch (s.k) {
        case 'live':
          lines.push(`A link to [live](${s.t}) here.`);
          break;
        case 'external':
          lines.push(`An outside [link](${s.t}) here.`);
          break;
        case 'span':
          lines.push(`Shown as ${'`'.repeat(s.ticks)}[x](${s.t})${'`'.repeat(s.ticks)} only.`);
          break;
        case 'dead': {
          const text = {
            inline: `A [dead](${s.t}) link.`,
            titled: `A [dead](${s.t} "a title") link.`,
            image: `An ![image](${s.t}) here.`,
            angle: `An [angled](<${s.t}>) link.`,
            definition: `[ref]: ${s.t}`,
          }[s.form];
          lines.push(text);
          expected.push([lines.length, s.t]);
          break;
        }
        case 'fence':
          lines.push(`${' '.repeat(s.indent)}${s.c.repeat(s.n)}`);
          for (const b of s.body) lines.push(b.line);
          if (s.close !== null) lines.push(`${' '.repeat(s.closeIndent)}${s.c.repeat(s.close)}`);
          break;
        default:
          lines.push('Plain words with (parentheses) and [brackets] and no link.');
      }
    }
    return { text: lines.join('\n'), expected };
  }

  /** A fence swallows what follows it when it is never closed, so only the last spec may keep that. */
  const settle = (specs) =>
    specs.map((s, i) => (s.k === 'fence' && i < specs.length - 1 ? { ...s, close: s.n } : s));

  function* shrink(specs) {
    yield* shrinkArray(specs, (s) =>
      s.k === 'fence' ? [...shrinkArray(s.body)].map((body) => ({ ...s, body })) : [],
    );
  }

  function gen(rng) {
    const specs = Array.from({ length: rng.int(1, 14) }, (_, i) => spec(rng, i));
    return settle(specs);
  }

  it('reports exactly the dead links outside fences and code spans, with their lines', () => {
    forAll(
      gen,
      (specs) => {
        const { text, expected } = render(specs);
        const found = deadLinks(FILE, text, exists).map((d) => [d.line, d.target]);
        expect(found, text).toEqual(expected);
      },
      { shrink },
    );
  });

  it('reports the same links whatever the line ending', () => {
    forAll(
      gen,
      (specs) => {
        const { text } = render(specs);
        const lf = deadLinks(FILE, text, exists);
        expect(deadLinks(FILE, text.replaceAll('\n', '\r\n'), exists)).toEqual(lf);
      },
      { shrink },
    );
  });

  it('reports nothing for a document whose every link is live, external or shown as code', () => {
    forAll(
      (rng) => gen(rng).filter((s) => s.k !== 'dead'),
      (specs) => {
        const { text } = render(specs);
        expect(deadLinks(FILE, text, exists), text).toEqual([]);
      },
      { shrink },
    );
  });
});
