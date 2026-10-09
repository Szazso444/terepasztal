export const meta = {
  name: 'deliver-issue',
  description:
    'Deliver terepasztal issues: Core plans, role agents implement in worktrees, Verification then QA gate each branch, up to three fix rounds',
  whenToUse:
    'Core (the main session) delivering one or more GitHub issues or a request. args: { issues?: number[], request?: string }. Returns questions for the author, or per-task results with branch, sha and verdicts. Opening pull requests and merging stay with the main session.',
  phases: [
    { title: 'Plan', detail: 'core subagent splits the work into role-sized briefs' },
    { title: 'Implement', detail: 'one role agent per ready task, each in its own worktree' },
    { title: 'Gate', detail: 'Verification adds and runs tests, then QA reviews the head' },
    { title: 'Fix', detail: 'findings back to the owning role, at most three rounds' },
  ],
};

// Roles that implement; QA only reviews.
const BUILDERS = [
  'core',
  'engine',
  'world',
  'gameplay',
  'rendering',
  'uiux',
  'art',
  'verification',
];
const MAX_ROUNDS = 3;

const PLAN = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'ambiguities or contradictions the author must settle first; empty if none',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
        required: ['question', 'options', 'recommendation'],
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'short unique id inside this plan' },
          issue: { type: ['number', 'null'] },
          role: { type: 'string', enum: BUILDERS },
          slug: { type: 'string', description: 'kebab-case, a few words' },
          brief: {
            type: 'string',
            description: 'the task brief of docs/process/context.md, filled in',
          },
          verification: { type: 'boolean' },
          blockedBy: {
            type: 'array',
            items: { type: 'string' },
            description: 'keys of tasks in this plan',
          },
        },
        required: ['key', 'issue', 'role', 'slug', 'brief', 'verification', 'blockedBy'],
      },
    },
  },
  required: ['questions', 'tasks'],
};

const REPORT = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    sha: { type: 'string' },
    outcome: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    changed: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, why: { type: 'string' } },
        required: ['path', 'why'],
      },
    },
    gate: { type: 'string', description: 'each gate command and its result' },
    testsAdded: { type: 'array', items: { type: 'string' } },
    questionsForAuthor: {
      type: 'array',
      items: { type: 'string' },
      description: 'product or rule decisions only the author can make; any entry stops the task',
    },
    notesForCore: {
      type: 'array',
      items: { type: 'string' },
      description:
        'choices made inside the brief that Core should confirm; they do not stop the gate',
    },
    outOfScope: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'branch',
    'sha',
    'outcome',
    'changed',
    'gate',
    'testsAdded',
    'questionsForAuthor',
    'notesForCore',
    'outOfScope',
  ],
};

const VERDICT = {
  type: 'object',
  properties: {
    sha: { type: 'string' },
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    gate: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'nit'] },
          problem: { type: 'string' },
          expected: { type: 'string' },
        },
        required: ['location', 'severity', 'problem', 'expected'],
      },
    },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['criterion', 'met', 'evidence'],
      },
    },
    scopeOk: { type: 'boolean' },
    candidateIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['sha', 'verdict', 'gate', 'findings', 'criteria', 'scopeOk', 'candidateIssues'],
};

const VERIFIED = {
  type: 'object',
  properties: {
    sha: { type: 'string' },
    properties: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          property: { type: 'string' },
          testFile: { type: 'string' },
          cases: { type: 'string' },
          pass: { type: 'boolean' },
        },
        required: ['property', 'testFile', 'cases', 'pass'],
      },
    },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          property: { type: 'string' },
          seed: { type: 'string' },
          smallestCase: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
        },
        required: ['property', 'seed', 'smallestCase', 'expected', 'actual'],
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['sha', 'properties', 'failures', 'gaps'],
};

const input = args ?? {};
const branchOf = (t) => `${t.role}/${t.issue ?? t.key}-${t.slug}`;

const HANDOFF = `When you finish: commit on the branch with an "Area: outcome" subject, then run \`git switch --detach\` so the next agent can check the branch out in its own worktree. Do not push.`;

function implementPrompt(t) {
  return `${t.brief}

Branch: if \`${branchOf(t)}\` already exists (\`git branch --list ${branchOf(t)}\`), \`git switch ${branchOf(t)}\` and continue from its head; never reset, recreate or delete it, and if its state is unclear stop and report. Otherwise create it from origin/develop in your worktree (\`git fetch origin develop && git switch -c ${branchOf(t)} origin/develop\`).
Run the local gate of docs/process/lifecycle.md step 4 before you report.
${HANDOFF}
Return the result report of docs/process/context.md.`;
}

function verifyPrompt(t, report) {
  return `Add and run the deterministic tests this task requires.

${t.brief}

The implementation is on branch \`${branchOf(t)}\` at ${report.sha}. Check it out in your worktree (\`git switch ${branchOf(t)}\`). Put the tests in test files that the ${t.role} role owns, next to the code under test; do not change non-test source. If a shared helper in src/testing/ is needed, say so under gaps instead of adding it here.
Implementer's report (a claim, not evidence): ${JSON.stringify(report)}
${HANDOFF}
Return the verification report of docs/process/context.md.`;
}

function qaPrompt(t, report, verified) {
  return `Review this change.

${t.brief}

Branch \`${branchOf(t)}\`. Review its head (\`git rev-parse ${branchOf(t)}\`) in a detached worktree of your own (\`git worktree add --detach .claude/worktrees/qa-${t.key} ${branchOf(t)}\`, removed when you finish) and re-run the gate there.
Implementer's report (a claim, not evidence): ${JSON.stringify(report)}
${verified ? `Verification's report: ${JSON.stringify(verified)}` : 'Verification was not required for this task.'}
Return the QA verdict of docs/process/context.md for the head commit.`;
}

function fixPrompt(t, report, qa, verified) {
  const findings = [
    ...(qa?.findings ?? []).filter((f) => f.severity === 'blocking'),
    ...(qa?.criteria ?? [])
      .filter((c) => !c.met)
      .map((c) => ({ unmetCriterion: c.criterion, evidence: c.evidence })),
    ...(verified?.failures ?? []),
  ];
  return `Fix the findings below on branch \`${branchOf(t)}\` (\`git switch ${branchOf(t)}\` in your worktree). Change only what they need.

${t.brief}

Findings:
${JSON.stringify(findings, null, 2)}
${qa && !qa.scopeOk ? 'QA also found paths outside your scope; move them out of this change.' : ''}
Run the local gate of docs/process/lifecycle.md step 4 before you report.
${HANDOFF}
Return the result report of docs/process/context.md.`;
}

/** An agent call that is retried once when the agent returns nothing. */
async function once(prompt, opts) {
  return (
    (await agent(prompt, opts)) ?? (await agent(prompt, { ...opts, label: `${opts.label}:retry` }))
  );
}

async function gateLoop(t, first) {
  let report = first;
  let qa = null;
  let verified = null;
  const notes = [];
  const result = (status, extra) => ({
    task: t.key,
    issue: t.issue,
    branch: branchOf(t),
    status,
    notesForCore: notes,
    ...extra,
  });
  // Round 0 gates the first implementation; rounds 1 to MAX_ROUNDS gate each fix.
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    if (!report) {
      const who = round ? 'fixing' : 'implementing';
      return result('failed', { reason: `the ${who} agent returned nothing`, round });
    }
    notes.push(...(report.notesForCore ?? []));
    // Only the author's decisions and a role's own stop stop a task; choices made inside the brief
    // go on to the gate and come back to Core with the result.
    if (report.outcome === 'blocked' || report.questionsForAuthor.length) {
      return result('blocked', { report, round });
    }
    qa = null;
    verified = null;
    if (t.verification) {
      verified = await once(verifyPrompt(t, report), {
        agentType: 'verification',
        isolation: 'worktree',
        schema: VERIFIED,
        label: `verify:${t.key}#${round}`,
        phase: 'Gate',
      });
      if (!verified) {
        return result('failed', {
          reason: 'the verification agent returned nothing',
          report,
          round,
        });
      }
    }
    if (!verified || verified.failures.length === 0) {
      qa = await once(qaPrompt(t, report, verified), {
        agentType: 'qa',
        schema: VERDICT,
        label: `qa:${t.key}#${round}`,
        phase: 'Gate',
      });
      if (!qa)
        return result('failed', {
          reason: 'the QA agent returned nothing',
          report,
          verified,
          round,
        });
      if (qa.verdict === 'approve') {
        return result('passed', { sha: qa.sha, rounds: round, report, qa, verified });
      }
      const actionable =
        qa.findings.some((f) => f.severity === 'blocking') ||
        qa.criteria.some((c) => !c.met) ||
        !qa.scopeOk;
      if (!actionable) {
        return result('failed', {
          reason:
            'QA asked for changes without a blocking finding, an unmet criterion or a scope problem',
          report,
          qa,
          verified,
          round,
        });
      }
    }
    if (round === MAX_ROUNDS) break;
    log(`${t.key}: round ${round} found problems, back to ${t.role}`);
    report = await agent(fixPrompt(t, report, qa, verified), {
      agentType: t.role,
      isolation: 'worktree',
      schema: REPORT,
      label: `fix:${t.key}#${round + 1}`,
      phase: 'Fix',
    });
  }
  return result('failed', {
    reason: `not accepted after ${MAX_ROUNDS} fix rounds; file a Bug issue with these findings`,
    report,
    qa,
    verified,
  });
}

phase('Plan');
const plan = await agent(
  `Plan the delivery of this work for terepasztal, as your role file's "Planning a request" says.
${input.issues?.length ? `GitHub issues: ${input.issues.map((n) => `#${n}`).join(', ')} in Szazso444/terepasztal; read them and their parents.` : ''}
${input.request ? `Request: ${input.request}` : ''}
Each task's brief must be complete on its own: the agent that receives it sees nothing else.
Work that changes what the player sees and has no spec the author approved is a question, not a task.
Give every task the number of the GitHub issue it delivers; a task with no issue yet gets issue null, and Core files it before anything is implemented.`,
  { agentType: 'core', schema: PLAN, label: 'plan', phase: 'Plan' },
);
if (!plan) return { error: 'the plan agent returned nothing' };
if (plan.questions.length) return { questions: plan.questions, tasks: plan.tasks };
// Every task is an issue before it is a branch (docs/process/lifecycle.md, step 3).
const unfiled = plan.tasks.filter((t) => t.issue == null);
if (unfiled.length) {
  return {
    fileFirst: plan.tasks,
    note: 'File each task without an issue (Task template, status:ready, Blocked by #n), then run again with { issues }.',
  };
}

const inPlan = new Set(plan.tasks.map((t) => t.key));
const ready = plan.tasks.filter((t) => t.blockedBy.every((k) => !inPlan.has(k)));
const waiting = plan.tasks.filter((t) => !ready.includes(t));
if (waiting.length) {
  log(
    `${waiting.length} task(s) wait for others in this plan to merge first: ${waiting.map((t) => t.key).join(', ')}`,
  );
}

const delivered = await pipeline(
  ready,
  (t) =>
    agent(implementPrompt(t), {
      agentType: t.role,
      isolation: 'worktree',
      schema: REPORT,
      label: `impl:${t.key}`,
      phase: 'Implement',
    }),
  (report, t) => gateLoop(t, report),
);

return {
  delivered: delivered.map(
    (d, i) => d ?? { task: ready[i].key, status: 'failed', reason: 'pipeline stage threw' },
  ),
  waiting: waiting.map((t) => ({
    key: t.key,
    role: t.role,
    issue: t.issue,
    blockedBy: t.blockedBy,
    brief: t.brief,
  })),
};
