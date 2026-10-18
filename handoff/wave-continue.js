export const meta = {
  name: 'wave-continue',
  description: 'Implement, gate and publish already-filed terepasztal tasks as pull requests into develop',
  phases: [
    { title: 'Implement', detail: 'role agents in their own worktrees' },
    { title: 'Gate', detail: 'Verification where required, then QA on the head' },
    { title: 'Fix', detail: 'findings back to the owning role, at most three rounds' },
    { title: 'Publish', detail: 'push the approved branch and open its pull request' },
  ],
}

const REPO = 'Szazso444/terepasztal'
const PREFIX = 'claude/optimistic-thompson-ndc4an-'
const MAX_ROUNDS = 3
const input = args
const tasks = (input.tasks ?? []).filter((t) => t.issue && t.role && t.slug && t.brief)
if (!tasks.length) return { error: 'no tasks given' }

const REPORT = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' },
    outcome: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    changed: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'why'] } },
    gate: { type: 'string' }, testsAdded: { type: 'array', items: { type: 'string' } },
    questionsForAuthor: { type: 'array', items: { type: 'string' } },
    notesForCore: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'sha', 'outcome', 'changed', 'gate', 'testsAdded', 'questionsForAuthor', 'notesForCore', 'outOfScope'],
}
const VERDICT = {
  type: 'object',
  properties: {
    sha: { type: 'string' }, tree: { type: 'string', description: 'git rev-parse <sha>^{tree}' },
    verdict: { type: 'string', enum: ['approve', 'changes'] }, gate: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { location: { type: 'string' }, severity: { type: 'string', enum: ['blocking', 'nit'] }, problem: { type: 'string' }, expected: { type: 'string' } }, required: ['location', 'severity', 'problem', 'expected'] } },
    criteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['criterion', 'met', 'evidence'] } },
    scopeOk: { type: 'boolean' }, candidateIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['sha', 'tree', 'verdict', 'gate', 'findings', 'criteria', 'scopeOk', 'candidateIssues'],
}
const VERIFIED = {
  type: 'object',
  properties: {
    sha: { type: 'string' },
    properties: { type: 'array', items: { type: 'object', properties: { property: { type: 'string' }, testFile: { type: 'string' }, cases: { type: 'string' }, pass: { type: 'boolean' } }, required: ['property', 'testFile', 'cases', 'pass'] } },
    failures: { type: 'array', items: { type: 'object', properties: { property: { type: 'string' }, seed: { type: 'string' }, smallestCase: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' } }, required: ['property', 'seed', 'smallestCase', 'expected', 'actual'] } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['sha', 'properties', 'failures', 'gaps'],
}

const local = (t) => `${t.role}/${t.issue}-${t.slug}`
const remote = (t) => `${PREFIX}${t.role}-${t.issue}-${t.slug}`
const HANDOFF = `When you finish: commit on the branch with an "Area: outcome" subject (end the message with the two trailer lines "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" and "Claude-Session: https://claude.ai/code/session_01PhZXSrZ8qdradU8ZMK8kT3"), then run \`git switch --detach\` so the next agent can check the branch out in its own worktree. Do not push.`

const implementPrompt = (t) => `${t.brief}

Issue: #${t.issue}. Role: ${t.role}.${t.crossReason ? `\nCore allows this task to cross role scope for this reason: ${t.crossReason}. The pull request will carry scope:cross; run the scope check with --cross.` : ''}
Branch: if \`${local(t)}\` already exists, \`git switch ${local(t)}\` and continue from its head; never reset or recreate it. Otherwise \`git fetch origin develop && git switch -c ${local(t)} origin/develop\`.
Worktrees under .claude/worktrees resolve the repository's node_modules; do not run npm install or npm ci.
Run the local gate of docs/process/lifecycle.md step 4 before you report.
${HANDOFF}
Return the result report of docs/process/context.md.`

const verifyPrompt = (t, report) => `Add and run the deterministic tests this task requires.

${t.brief}

The implementation is on branch \`${local(t)}\` at ${report.sha}; \`git switch ${local(t)}\` in your worktree. Put the tests only in test files the ${t.role} role owns, next to the code under test; never change non-test source; name any needed src/testing helper or properties-table row under gaps.
Implementer's report (a claim, not evidence): ${JSON.stringify(report)}
${HANDOFF}
Return the verification report of docs/process/context.md.`

const qaPrompt = (t, report, verified) => `Review this change.

${t.brief}

Branch \`${local(t)}\`. Review its head in a detached worktree of your own (\`git worktree add --detach .claude/worktrees/qa-${t.issue} ${local(t)}\`, removed when you finish) and re-run the gate there, scope check as ${t.role}${t.crossReason ? ' with --cross' : ''}. Report the head sha and its tree (\`git rev-parse <sha>^{tree}\`).
Implementer's report (a claim, not evidence): ${JSON.stringify(report)}
${verified ? `Verification's report: ${JSON.stringify(verified)}` : 'Verification was not required for this task.'}
Return the QA verdict of docs/process/context.md for the head commit.`

const fixPrompt = (t, qa, verified) => `Fix the findings below on branch \`${local(t)}\` (\`git switch ${local(t)}\` in your worktree). Change only what they need.

${t.brief}

Findings:
${JSON.stringify([...(qa?.findings ?? []).filter((f) => f.severity === 'blocking'), ...(qa?.criteria ?? []).filter((c) => !c.met).map((c) => ({ unmetCriterion: c.criterion, evidence: c.evidence })), ...(verified?.failures ?? [])], null, 2)}
${qa && !qa.scopeOk ? 'QA also found paths outside your scope; move them out of this change.' : ''}
Run the local gate of docs/process/lifecycle.md step 4 before you report.
${HANDOFF}
Return the result report of docs/process/context.md.`

// Model per stage: Sonnet by default; Opus for tasks marked heavy (traffic, saves, property-test work)
// on implement, fix and verify, and for any fix after a first failed round. QA and publish stay Sonnet.
const heavy = (t) => t.model === 'opus'
const modelFor = (t, stage, round = 0) =>
  stage === 'publish' ? 'haiku'
  : stage === 'qa' ? 'sonnet'
  : heavy(t) || (stage === 'fix' && round >= 2) ? 'opus'
  : t.model === 'haiku' && stage === 'impl' ? 'haiku'
  : 'sonnet'

async function once(prompt, opts) {
  return (await agent(prompt, opts)) ?? (await agent(prompt, { ...opts, label: `${opts.label}:retry` }))
}

async function gateLoop(t, first) {
  let report = first, qa = null, verified = null
  const notes = []
  const result = (status, extra) => ({ key: t.key, issue: t.issue, role: t.role, branch: local(t), status, notesForCore: notes, ...extra })
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    if (!report) return result('failed', { reason: `the ${round ? 'fixing' : 'implementing'} agent returned nothing`, round })
    notes.push(...(report.notesForCore ?? []))
    if (report.outcome === 'blocked' || (report.questionsForAuthor.length && !t.questionsOk)) return result('blocked', { report, round })
    qa = null; verified = null
    if (t.verification) {
      verified = await once(verifyPrompt(t, report), { agentType: 'verification', isolation: 'worktree', schema: VERIFIED, label: `verify:${t.issue}#${round}`, phase: 'Gate', model: modelFor(t, 'verify', round) })
      if (!verified) return result('failed', { reason: 'verification returned nothing', report, round })
    }
    if (!verified || verified.failures.length === 0) {
      qa = await once(qaPrompt(t, report, verified), { agentType: 'qa', schema: VERDICT, label: `qa:${t.issue}#${round}`, phase: 'Gate', model: modelFor(t, 'qa', round) })
      if (!qa) return result('failed', { reason: 'QA returned nothing', report, verified, round })
      if (qa.verdict === 'approve') return result('passed', { sha: qa.sha, tree: qa.tree, rounds: round, report, qa, verified })
      const actionable = qa.findings.some((f) => f.severity === 'blocking') || qa.criteria.some((c) => !c.met) || !qa.scopeOk
      if (!actionable) return result('failed', { reason: 'QA asked for changes with nothing actionable', report, qa, round })
    }
    if (round === MAX_ROUNDS) break
    log(`#${t.issue}: round ${round} found problems, back to ${t.role}`)
    report = await agent(fixPrompt(t, qa, verified), { agentType: t.role, isolation: 'worktree', schema: REPORT, label: `fix:${t.issue}#${round + 1}`, phase: 'Fix', model: modelFor(t, 'fix', round + 1) })
  }
  return result('failed', { reason: `not accepted after ${MAX_ROUNDS} fix rounds`, report, qa, verified })
}

const publishPrompt = (t, r) => `Publish this QA-approved task branch and open its pull request into develop in ${REPO}.

1. In /home/user/terepasztal: \`git push origin ${local(t)}:refs/heads/${remote(t)}\`. Check that \`git rev-parse ${local(t)}^{tree}\` equals ${r.tree} (the tree QA approved); if it does not, stop and report.
${t.existingPr ? `2. Pull request #${t.existingPr} already has this head branch. Do not create a pull request. Load mcp__github__update_pull_request and mcp__github__issue_write with ToolSearch, rewrite #${t.existingPr}'s body as below, then do step 3 on #${t.existingPr} and return ${t.existingPr}. Skip the rest of this step.\n   ` : ''}2. Load the GitHub MCP tools with ToolSearch ("select:mcp__github__create_pull_request,mcp__github__issue_write") and create the pull request: head ${remote(t)}, base develop, title "${t.title}". Body, following .github/pull_request_template.md: ${t.partOf ? `"Part of #${t.issue} (${t.partOf}); does not close it"` : `"Closes #${t.issue}"${(t.alsoCloses ?? []).map((n) => `, "Closes #${n}" (each on its own line)`).join('')}`}, "**Role:** agent:${t.role}", Outcome (from the report), Acceptance criteria with QA's evidence, Gate (QA's re-run), QA verdict (approve at ${r.sha}, tree ${r.tree}; list QA's nits), Verification (${r.verified ? 'the verification report' : 'not required'}), Notes for Core (${JSON.stringify(r.notesForCore)}), For the author (anything to play-test).${t.gate ? ' Add a line: this pull request changes gate files and waits for the author\'s gate:approved.' : ''}${t.crossReason ? ` Add a "scope:cross" section with this reason: ${t.crossReason}` : ''} End the body with these lines exactly:\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_01PhZXSrZ8qdradU8ZMK8kT3
3. Set labels on the pull request with issue_write update: ["agent:${t.role}"${t.crossReason ? ', "scope:cross"' : ''}${t.gate ? ', "needs:decision"' : ''}]. Never add gate:approved. Then set the labels of issue #${t.issue}${(t.alsoCloses ?? []).map((n) => ` and of issue #${n}`).join('')} to ["type:task","status:in-review","agent:${t.role}"].

Report: ${JSON.stringify({ report: r.report, qa: r.qa, verified: r.verified })}
Return the pull request number.`

log(`${tasks.length} task(s): ${tasks.map((t) => `#${t.issue} ${t.role}`).join(', ')}`)

const delivered = await pipeline(
  tasks,
  (t) => agent(implementPrompt(t), { agentType: t.role, isolation: 'worktree', schema: REPORT, label: `impl:${t.issue}`, phase: 'Implement', model: modelFor(t, 'impl') }),
  (report, t) => gateLoop(t, report),
  async (r, t) => {
    if (!r || r.status !== 'passed') return r
    const pr = await agent(publishPrompt(t, r), {
      label: `publish:${t.issue}`,
      phase: 'Publish',
      model: modelFor(t, 'publish'),
      schema: { type: 'object', properties: { pr: { type: 'number' }, problem: { type: 'string' } }, required: ['pr', 'problem'] },
    })
    return { ...r, pr: pr?.pr ?? null, publishProblem: pr?.problem ?? 'publish agent returned nothing', report: undefined, qa: { verdict: r.qa.verdict, sha: r.qa.sha, nits: r.qa.findings.filter((f) => f.severity === 'nit').length } }
  },
)

return {
  delivered: delivered.map((d, i) => d ?? { key: tasks[i].key, issue: tasks[i].issue, status: 'failed', reason: 'pipeline stage threw' }),
}
