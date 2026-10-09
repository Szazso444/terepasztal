#!/usr/bin/env node
// Which role owns a path, and whether a change stays inside its role's scope.
//
//   node tools/agents/scope.mjs owner <path>...          the owning role of each path
//   node tools/agents/scope.mjs list --role <role>       the patterns a role may write
//   node tools/agents/scope.mjs check --role <role> [--base <ref>] [--cross]
//   node tools/agents/scope.mjs check --event <github event json>
//
// `check` diffs <base>...HEAD (default origin/develop) and fails when a changed path is neither
// owned by nor granted to the role. With --cross, or the `scope:cross` label on the pull request,
// it lists those paths and passes. The map is tools/agents/ownership.json.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadOwnership(file = join(here, 'ownership.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Glob to a regular expression anchored at the repository root: `**`, `*`, `?` and `{a,b}`. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) throw new Error(`unclosed brace in ${glob}`);
      const alts = glob.slice(i + 1, end).split(',');
      re += `(?:${alts.map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else {
      re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function compile(map) {
  const out = [];
  for (const [role, patterns] of Object.entries(map ?? {})) {
    for (const pattern of patterns) out.push({ role, pattern, re: globToRegExp(pattern) });
  }
  return out;
}

/** Every role whose owned patterns match the path. Exactly one is the invariant. */
export function ownersOf(path, ownership) {
  const rules = compile(ownership.owners);
  return [...new Set(rules.filter((r) => r.re.test(path)).map((r) => r.role))];
}

/** True when the role owns the path or holds a grant for it. */
export function mayWrite(role, path, ownership) {
  const own = compile({ [role]: ownership.owners[role] ?? [] });
  const grant = compile({ [role]: ownership.grants?.[role] ?? [] });
  return own.some((r) => r.re.test(path)) || grant.some((r) => r.re.test(path));
}

/** The role a pull request works as: its one `agent:<role>` label, else its branch prefix. */
export function roleOfPullRequest({ labels = [], headRef = '' }, ownership) {
  const roles = labels
    .filter((l) => l.startsWith('agent:'))
    .map((l) => l.slice('agent:'.length))
    .filter((r) => ownership.roles.includes(r));
  if (roles.length > 1) return { error: `more than one agent label: ${roles.join(', ')}` };
  if (roles.length === 1) return { role: roles[0] };
  const prefix = headRef.split('/')[0];
  if (ownership.roles.includes(prefix)) return { role: prefix };
  return { error: `no agent:<role> label and branch '${headRef}' has no <role>/ prefix` };
}

/** Changed paths outside the role's scope. */
export function outOfScope(role, paths, ownership) {
  return paths.filter((p) => !mayWrite(role, p, ownership));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedPaths(base) {
  const out = git(['diff', '--name-only', '--no-renames', `${base}...HEAD`]);
  return out ? out.split('\n') : [];
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const ownership = loadOwnership();
  const [cmd, ...rest] = argv;

  if (cmd === 'owner') {
    for (const p of rest) {
      const owners = ownersOf(p, ownership);
      console.log(`${p}\t${owners.length ? owners.join(', ') : '(no owner)'}`);
    }
    return 0;
  }

  if (cmd === 'list') {
    const role = arg(rest, '--role');
    if (!ownership.roles.includes(role)) throw new Error(`unknown role ${role}`);
    console.log(`owns:\n${(ownership.owners[role] ?? []).map((p) => `  ${p}`).join('\n')}`);
    const grants = ownership.grants?.[role] ?? [];
    if (grants.length) console.log(`grants:\n${grants.map((p) => `  ${p}`).join('\n')}`);
    return 0;
  }

  if (cmd === 'check') {
    let role = arg(rest, '--role');
    let base = arg(rest, '--base') ?? 'origin/develop';
    let cross = rest.includes('--cross');
    const eventFile = arg(rest, '--event');
    if (eventFile) {
      const pr = JSON.parse(readFileSync(eventFile, 'utf8')).pull_request;
      if (pr.base.ref !== 'develop') {
        console.log(`scope: base is ${pr.base.ref}, not develop; nothing to check`);
        return 0;
      }
      const labels = pr.labels.map((l) => l.name);
      const found = roleOfPullRequest({ labels, headRef: pr.head.ref }, ownership);
      if (found.error) {
        console.error(`scope: ${found.error}`);
        return 1;
      }
      role = found.role;
      base = `origin/${pr.base.ref}`;
      cross = labels.includes('scope:cross');
    }
    if (!ownership.roles.includes(role)) throw new Error(`unknown role ${role}`);
    const paths = changedPaths(base);
    const outside = outOfScope(role, paths, ownership);
    console.log(`scope: ${paths.length} changed path(s) checked as ${role}`);
    if (!outside.length) return 0;
    const lines = outside.map((p) => `  ${p}  (owner: ${ownersOf(p, ownership).join(', ') || 'none'})`);
    if (cross) {
      console.log(`scope:cross — outside ${role}'s scope, accepted by label:\n${lines.join('\n')}`);
      return 0;
    }
    console.error(`scope: outside ${role}'s scope:\n${lines.join('\n')}`);
    console.error('Split the change by owner, or ask Core for scope:cross.');
    return 1;
  }

  console.error('usage: scope.mjs owner <path>... | list --role <r> | check (--role <r> [--base <ref>] [--cross] | --event <file>)');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
