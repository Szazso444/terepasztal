import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GATE_LABEL,
  changedPaths,
  gateApproved,
  gatePaths,
  globToRegExp,
  loadOwnership,
  mayWrite,
  outOfScope,
  ownersOf,
  roleOfPullRequest,
} from './scope.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ownership = loadOwnership();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

/** The backticked patterns listed under an agent file's `## Scope` heading. */
function scopeOf(agentFile) {
  const text = readFileSync(agentFile, 'utf8');
  const start = text.indexOf('\n## Scope');
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

function frontmatter(agentFile) {
  const text = readFileSync(agentFile, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(
    m[1]
      .split('\n')
      .map((l) => /^(\w+):\s*(.*)$/.exec(l))
      .filter(Boolean)
      .map((x) => [x[1], x[2]]),
  );
}

describe('globToRegExp', () => {
  it('matches across directories only with **', () => {
    expect(globToRegExp('src/world/**').test('src/world/a/b.ts')).toBe(true);
    expect(globToRegExp('tools/*.mjs').test('tools/agents/scope.mjs')).toBe(false);
    expect(globToRegExp('tools/*.mjs').test('tools/pack-atlas.mjs')).toBe(true);
    expect(globToRegExp('src/**/*.test.ts').test('src/x.test.ts')).toBe(true);
    expect(globToRegExp('public/assets/*.{png,json}').test('public/assets/props.json')).toBe(true);
    expect(globToRegExp('public/assets/*.{png,json}').test('public/assets/audio/a.mp3')).toBe(
      false,
    );
  });
});

describe('ownership', () => {
  it('gives every tracked file exactly one owner', () => {
    const problems = tracked
      .map((p) => ({ p, owners: ownersOf(p, ownership) }))
      .filter((x) => x.owners.length !== 1)
      .map((x) => `${x.p}: ${x.owners.length ? x.owners.join(', ') : 'no owner'}`);
    expect(problems, 'add the path to one role in tools/agents/ownership.json').toEqual([]);
  });

  it('names only known roles', () => {
    for (const role of [...Object.keys(ownership.owners), ...Object.keys(ownership.grants)]) {
      expect(ownership.roles).toContain(role);
    }
  });

  it('leaves QA without write access', () => {
    expect(ownership.owners.qa).toEqual([]);
    expect(ownership.grants.qa ?? []).toEqual([]);
  });

  it('lets a role write what it owns and what it is granted, and nothing else', () => {
    expect(mayWrite('world', 'src/world/pathfinding.ts', ownership)).toBe(true);
    expect(mayWrite('world', 'src/sim/trains.ts', ownership)).toBe(false);
    expect(mayWrite('verification', 'src/world/pathfinding.test.ts', ownership)).toBe(true);
    expect(mayWrite('verification', 'src/world/pathfinding.ts', ownership)).toBe(false);
    expect(outOfScope('uiux', ['src/ui/hud.ts', 'src/game.ts'], ownership)).toEqual([
      'src/game.ts',
    ]);
  });
});

describe('agent files', () => {
  const agentsDir = join(root, '.claude', 'agents');
  const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

  it('exist for every role and only for roles', () => {
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual([...ownership.roles].sort());
  });

  for (const role of ownership.roles) {
    it(`${role}: frontmatter name matches and Scope lists exactly the map's patterns`, () => {
      const file = join(agentsDir, `${role}.md`);
      expect(existsSync(file)).toBe(true);
      expect(frontmatter(file).name).toBe(role);
      const listed = scopeOf(file);
      expect(listed, `${role}.md needs a "## Scope" section`).not.toBeNull();
      const expected = [...(ownership.owners[role] ?? []), ...(ownership.grants[role] ?? [])];
      expect([...listed].sort()).toEqual([...expected].sort());
    });
  }
});

describe('gate', () => {
  it('names approvers and only patterns that match tracked files', () => {
    expect(ownership.gateApprovers.length).toBeGreaterThan(0);
    for (const pattern of ownership.gate) {
      const re = globToRegExp(pattern);
      expect(
        tracked.some((p) => re.test(p)),
        `${pattern} matches nothing`,
      ).toBe(true);
    }
  });

  it('covers the files that decide what passes', () => {
    const gated = gatePaths(
      [
        'tools/agents/scope.mjs',
        '.github/workflows/scope.yml',
        '.claude/agents/qa.md',
        'AGENTS.md',
        'src/world/mapgen.test.ts',
        'src/world/pathfinding.ts',
        'CORE.md',
      ],
      ownership,
    );
    expect(gated).toEqual([
      'tools/agents/scope.mjs',
      '.github/workflows/scope.yml',
      '.claude/agents/qa.md',
      'AGENTS.md',
      'src/world/mapgen.test.ts',
    ]);
  });

  const approver = ownership.gateApprovers[0];
  const added = (login, app) => ({
    event: 'labeled',
    label: { name: GATE_LABEL },
    actor: { login },
    performed_via_github_app: app ? { slug: app } : null,
  });

  it('counts the label only when an approver added it in person', () => {
    const labels = [GATE_LABEL];
    expect(gateApproved({ labels, events: [added(approver)] }, ownership)).toBe(true);
    expect(gateApproved({ labels, events: [added(approver, 'claude')] }, ownership)).toBe(false);
    expect(gateApproved({ labels, events: [added('someone-else')] }, ownership)).toBe(false);
    expect(gateApproved({ labels: [], events: [added(approver)] }, ownership)).toBe(false);
  });

  it('judges by the last time the label was added', () => {
    const labels = [GATE_LABEL];
    const events = [
      added(approver),
      { event: 'unlabeled', label: { name: GATE_LABEL } },
      added(approver, 'claude'),
    ];
    expect(gateApproved({ labels, events }, ownership)).toBe(false);
  });
});

describe('labels', () => {
  const labels = JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8')).map(
    (l) => l.name,
  );

  it('have an agent label for every role, and the gate label', () => {
    for (const role of ownership.roles) expect(labels).toContain(`agent:${role}`);
    expect(labels).toContain(GATE_LABEL);
  });

  it('are unique', () => {
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('changedPaths', () => {
  it('reads names git would quote, so a non-ASCII path is judged by its real name', () => {
    const repo = mkdtempSync(join(tmpdir(), 'scope-'));
    const run = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    run('init', '-q', '-b', 'base');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
    run('switch', '-q', '-c', 'task');
    mkdirSync(join(repo, 'src', 'world'), { recursive: true });
    writeFileSync(join(repo, 'src', 'world', 'vasút.ts'), '');
    writeFileSync(join(repo, 'a "b".md'), '');
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'task');
    const paths = changedPaths('base', 'HEAD', repo).sort();
    expect(paths).toEqual(['a "b".md', 'src/world/vasút.ts']);
    expect(ownersOf('src/world/vasút.ts', ownership)).toEqual(['world']);
  });
});

describe('roleOfPullRequest', () => {
  it('prefers the one agent label, falls back to the branch prefix', () => {
    expect(roleOfPullRequest({ labels: ['agent:world'], headRef: 'claude/x' }, ownership)).toEqual({
      role: 'world',
    });
    expect(roleOfPullRequest({ labels: [], headRef: 'gameplay/12-save' }, ownership)).toEqual({
      role: 'gameplay',
    });
    expect(roleOfPullRequest({ labels: [], headRef: 'claude/x' }, ownership).error).toBeTruthy();
    expect(
      roleOfPullRequest({ labels: ['agent:world', 'agent:art'], headRef: 'x' }, ownership).error,
    ).toBeTruthy();
  });
});
