Closes #

**Role:** agent:<role> — one label; `scope:cross` only with a reason below. Gate files changed?
They wait for the author's `gate:approved`.

## Outcome

<!-- What changed for the player or the project, in a few lines. -->

## Acceptance criteria

<!-- Copied from the issue; each one met, with the evidence. -->

- [ ]

## Gate

<!-- Run on the head commit. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npx vite build`
- [ ] `npx prettier --check "src/**/*.{ts,json,css}" index.html`
- [ ] `node tools/agents/scope.mjs check --role <role>`

## QA verdict

<!-- approve | changes, at <sha>; findings and how each was resolved. -->

## Verification

<!-- Properties checked, test files, seeds; or "not required" with the reason. -->

## For the author

<!-- Anything to play-test, decide or know before release. "Nothing" if nothing. -->
