#!/usr/bin/env node
// Which role owns a path, and whether a change stays inside its role's scope.
//
//   node tools/agents/scope.mjs owner <path>...          the owning role of each path
//   node tools/agents/scope.mjs list --role <role>       the patterns a role may write
//   node tools/agents/scope.mjs check --role <role> [--base <ref>] [--head <ref>] [--cross]
//   node tools/agents/scope.mjs check --event <github event json> --head <ref>
//
// `check` diffs <base>...<head> (default origin/develop...HEAD) and fails when a changed path is
// neither owned by nor granted to the role. With --cross, or the `scope:cross` label on the pull
// request, it lists those paths and passes. A changed gate path (the `gate` list) also needs the
// `gate:approved` label, added in person by one of `gateApprovers`, never through an app; with
// --event the label's history is read from the GitHub API (GITHUB_TOKEN). The map is
// tools/agents/ownership.json.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const GATE_LABEL = 'gate:approved';

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

/** Changed paths that are gate files: they decide what passes, or what agents may do. */
export function gatePaths(paths, ownership) {
  const rules = (ownership.gate ?? []).map(globToRegExp);
  return paths.filter((p) => rules.some((re) => re.test(p)));
}

/**
 * The gate is approved when the `gate:approved` label is on the pull request now and the last
 * time it was added, an approver added it in person: an event performed through a GitHub App
 * (an agent acting with the author's account) does not count.
 */
export function gateApproved({ labels, events }, ownership) {
  if (!labels.includes(GATE_LABEL)) return false;
  const adds = events.filter((e) => e.event === 'labeled' && e.label?.name === GATE_LABEL);
  const last = adds[adds.length - 1];
  if (!last || last.performed_via_github_app) return false;
  return (ownership.gateApprovers ?? []).includes(last.actor?.login);
}

async function githubApi(path) {
  const root = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${root}${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

async function allPages(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await githubApi(`${path}?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

/** Changed paths, NUL-separated so git prints non-ASCII and odd names verbatim, not quoted. */
export function changedPaths(base, head, cwd) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`], {
    cwd,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
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
    const head = arg(rest, '--head') ?? 'HEAD';
    let cross = rest.includes('--cross');
    let approval = null;
    const eventFile = arg(rest, '--event');
    if (eventFile) {
      const pr = JSON.parse(readFileSync(eventFile, 'utf8')).pull_request;
      if (pr.base.ref !== 'develop') {
        console.log(`scope: base is ${pr.base.ref}, not develop; nothing to check`);
        return 0;
      }
      if (pr.head.ref === 'main' && pr.head.repo?.full_name === pr.base.repo.full_name) {
        console.log('scope: main merged back into develop; it passed the release gate already');
        return 0;
      }
      const issue = `/repos/${pr.base.repo.full_name}/issues/${pr.number}`;
      // labels as they are now, not as the event saw them: an earlier step may have removed one
      const labels = (await allPages(`${issue}/labels`)).map((l) => l.name);
      const found = roleOfPullRequest({ labels, headRef: pr.head.ref }, ownership);
      if (found.error) {
        console.error(`scope: ${found.error}`);
        return 1;
      }
      role = found.role;
      base = `origin/${pr.base.ref}`;
      cross = labels.includes('scope:cross');
      approval = async () =>
        gateApproved({ labels, events: await allPages(`${issue}/events`) }, ownership);
    }
    if (!ownership.roles.includes(role)) throw new Error(`unknown role ${role}`);
    const paths = changedPaths(base, head);
    console.log(`scope: ${paths.length} changed path(s) checked as ${role}`);
    let failed = false;

    const outside = outOfScope(role, paths, ownership);
    if (outside.length) {
      const lines = outside.map(
        (p) => `  ${p}  (owner: ${ownersOf(p, ownership).join(', ') || 'none'})`,
      );
      if (cross) {
        console.log(
          `scope:cross — outside ${role}'s scope, accepted by label:\n${lines.join('\n')}`,
        );
      } else {
        console.error(`scope: outside ${role}'s scope:\n${lines.join('\n')}`);
        console.error('Split the change by owner, or ask Core for scope:cross.');
        failed = true;
      }
    }

    const gated = gatePaths(paths, ownership);
    if (gated.length) {
      const lines = gated.map((p) => `  ${p}`).join('\n');
      const who = (ownership.gateApprovers ?? []).join(', ');
      if (!approval) {
        console.log(
          `scope: gate files changed; the pull request will need ${GATE_LABEL} from ${who}:\n${lines}`,
        );
      } else if (await approval()) {
        console.log(`scope: gate files changed, approved in person by ${who}:\n${lines}`);
      } else {
        console.error(`scope: gate files changed and not approved:\n${lines}`);
        console.error(
          `${who} adds the ${GATE_LABEL} label in person after review; a new push withdraws it.`,
        );
        failed = true;
      }
    }
    return failed ? 1 : 0;
  }

  console.error(
    'usage: scope.mjs owner <path>... | list --role <r> | check (--role <r> [--base <ref>] [--cross] | --event <file>) [--head <ref>]',
  );
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`scope: ${err.message}`);
      process.exit(2);
    },
  );
}
