# Agent rules

**These rules are identical in every repository.** The canonical source is
`hotrocketdev/repo-template:AGENTS.md` — this file. Edit it there, then run
`sh scripts/sync-agent-rules.sh` from `servicecam` (dry run first, then `--apply`),
which opens one PR per stale repo, and confirm afterwards with
`sh scripts/verify-agent-rules.sh`. Never hand-edit the copy in another repo: that
is what produced the drift between repos in the first place.

They apply to every agent on every project: Codex, OMP, Claude Code, Antigravity,
or anything that comes later.

---

## You own your slice — including landing it

You take a slice from prompt to merged. Code, its quality, the PR, and landing it.

**Landing is a routine repo action, not a decision you make alone.** The gate is
verified by a script before anything merges, so the review is always visible:
if you are landing a PR, the checks below have already passed.

**You do not wait mid-slice for another agent or for Hermes.** Finish the slice you
were given and land it. But a block is
a legitimate outcome, not a failure — it is how the orchestrator learns what needs a
decision. When you are blocked, do not poll, do not retry the same thing, and do not
invent a workaround. Emit a BLOCKED record and stop:

```
BLOCKED
  category:  <ci-infra | review-finding | product-decision | dependency | other>
  what:      <one sentence — what cannot proceed>
  evidence:  <the actual command and output, file:line, or run URL. Not a summary.>
  attempted: <what you tried and what each attempt returned>
  owner:     <hermes | jorge | another-lane | external>
  next:      <the single action that unblocks it, and who takes it>
```

Waiting on CI, on a runner, or on a product decision is a normal block. A block that
is yours to clear — a failing check, an unresolved finding, a branch behind main — is
not: fix that yourself.

**One reproducible diagnosis, then stop.** Do not retry CI, Docker, or an unclear
product question hoping for a different answer. Work it until you can state it
reproducibly — the command, the output, the cause — then hand it over with the BLOCKED
record above. Repeated retries burn tokens, occupy the runner the whole fleet shares,
and bury the diagnosis you already have.

**But "fix it yourself" has a boundary, and it is your job to notice it.** If
clearing a finding, a test failure or an error would mean changing **architecture, a
database schema or migration, a payment flow, CI, or server configuration**, that is
**not a block you fix** — that is a decision. Stop, leave the finding in place, and
report it with what you found and what the options are. The same applies if a fix
needs a product decision. Being blocked there is correct; guessing is not.

**When the blocker is external, the PR is still yours — but you do not wait on it.** If CI
capacity, billing, a dead runner or production access is what is stopping you, that is not a
block you fix and not a reason to walk away. Report the exact constraint in **one line**,
naming the failing check, keep the PR and the worktree exactly as they are, and stop your
session. Do not poll it, do not sit on it, and do not start another slice. When the
orchestrator tells you the blocker is cleared, re-check the failed condition and **land the PR
yourself.** Hermes never resolves your review threads and never lands your PR.

## The flow

```
1.  Work in your own worktree. Never in the shared checkout.
      sh scripts/new-worktree <branch>
      sh scripts/claim-branch <branch>

2.  Read your prompt — that is the brief. Do not go reading historical handoffs
    or broad PRDs to work out what to do (see "Your prompt is the brief" below).
    Code only that slice.

3.  Verify locally — **by scope, cheapest first**. Do NOT run the whole monorepo for
    a change that touches one lane: that costs minutes and buys no extra signal.

      # 1. the changed test file / the focused test, first
      pnpm --filter=<package> exec vitest run <path-to-changed-test>

      # 2. then the checks for the package(s) you touched AND every package that
      #    depends on them. A shared package (contracts, db) is consumed by the
      #    apps: the leading `...` selects the dependents, so a contract change
      #    that breaks mobile or web fails here instead of in production.
      #    Verified: `...@servicecam/contracts` selects contracts + api, mobile,
      #    web, worker; the bare form selects contracts only.
      pnpm --filter='...<package>' run lint
      pnpm --filter='...<package>' run typecheck
      pnpm --filter='...<package>' run test -- --run

      # 3. CI repeats the full affected lane. That is CI's job, not yours.

    Then run the reviewer yourself, in merge-base mode, BEFORE you open the PR —
    local passes cost no CI job, so blocking findings get fixed while they are
    cheap to fix:

      git fetch origin main
      ocr review --from origin/main --to HEAD --audience agent

    `--from/--to` is merge-base mode: it reviews what the PR will actually show,
    never a bare `git diff origin/main`, which is two-dot and drags in everything
    everyone else merged since your branch point. Max 2 local passes, then open the
    PR regardless — CI runs the reviewer once more as an independent opinion on a
    different model. A docs, lockfile or test-only diff that returns
    "0 files reviewed" is clean, not broken.

    Then confirm the range is YOUR slice and nothing else:

      git fetch origin main
      BASE=$(git merge-base origin/main HEAD)
      git diff --stat "$BASE" HEAD

    If that file list is much larger than your slice, STOP — you have the wrong
    base and would be working from other people's merged work. Report it.

4.  Commit, push, open the PR. Body must contain "Closes #<issue>".

5.  Wait for CI green on the head commit.

6.  Resolve every review thread. Fix the finding, or disprove it with file/line
    evidence and say so in the thread. Then resolve it. Nobody else does this
    for you — this is what makes the PR reviewable.
    (If a finding falls under the boundary above, report it instead of fixing it.)

7.  Land the PR with the repo script:

      sh scripts/land-pr.sh <pr-number>

    It verifies the review is complete — zero unresolved threads, no failing
    checks, branch up to date — and only then merges. Do NOT run `gh pr merge`
    directly: some harnesses block it, and it skips these checks.
    NEVER resolve a thread you did not actually fix, to get past the gate.

8.  Verify the deploy actually happened. A merge is not a deploy.

9.  Clean up: remove your worktree, delete the merged branch. Leave nothing behind.

10. Report briefly: what changed, PR number, CI status, landed or not.
    Then PARK. Your assignment is one slice: do not take another one, do not
    start work you were not given. Say you are ready and wait for the
    orchestrator to hand you the next slice.
```

**Two reviews, and they are not the same review — run both.** The **local pass** in
step 3 happens before the PR exists: it costs no CI job and it is where blocking
findings get fixed cheaply. The **CI review** is the review of record — visible on
the diff, logged, label-triggered where the repo uses labels, and not skippable. It
runs on a deliberately different model, so treat disagreement between the two as
information rather than as one of them being wrong.

**Attempt both reviews. If either reviewer is unavailable — an outage, a rate limit, a
model that will not answer — record the outage in the PR and proceed: the review fails
open and never blocks a merge.**

When the CI review returns findings: fix **critical and high**; record medium and
below in the PR body rather than fixing them here. **ONE pass** — a second pass only
over files you changed since, never the whole diff again. Skip that second pass for
docs, lockfile or test-only diffs, but still open the PR. The reviewer is fail-open
and never blocks a merge.

**Record the outcome of every finding — fixed, or disproved.** The false-positive rate
is what tells us whether the reviewer earns its cost. Without it we are guessing, and
the last full scan produced 1,248 findings, which is more likely to be review noise
than 1,248 real defects.

**Slice size is part of the job.** If an issue number looks like a work queue
("39 security findings"), it is one — take 3-5 findings, land them, take the next.
A large PR is not a fast PR; it is one nobody can review.

## What a valid assignment contains

Work arrives as a prompt from the orchestrator. If it is missing any of these, say so
before you start rather than guessing — an under-specified assignment is the most
expensive kind, because it costs a whole slice to discover what it should have said.

- **one outcome** — a single, testable change
- **owned paths** — the files and areas you may touch
- **non-goals / forbidden paths** — what is out of bounds even if it looks related
- **dependencies** — what must land first
- **acceptance test** — the exact command(s) that prove it works
- **stop condition** — when to stop and report instead of continuing

**Your prompt is the brief. Do not go reading large historical handoffs or broad PRDs
to work out what to do.** Those exist for a human or an orchestrator picking up
mid-stream. Reading them per slice costs an enormous amount of context and produces
drift, because they describe states that have since changed — a handoff written
yesterday may name commits, PR numbers and blockers that no longer exist. If your
ticket is unclear, name which of the six items above is missing and stop. Ask for one
specific section when you need it, never a whole document by default.

**One in-flight PR per lane.** Do not open a second PR while one is open, unless the
work is genuinely file-disjoint from the first and the assignment says so explicitly.
Two open PRs in one lane is how a lane stops being a lane.

## Never

- Never commit directly to `main`. A PR is required.
- Never resolve a thread you did not fix. If a finding is wrong, disprove it with
  evidence in the thread and resolve it — that is how the gate is cleared.
- Never clear a finding by deleting the check, loosening the assertion, or
  skipping the test. A fix makes the finding go away **and keeps tests green**.
- Never commit secrets, `.env` files, keys, tokens or client data.
- Never leave worktrees, branches or folders behind after you merge.
- Never hand a finished PR to Hermes or another agent to land. Clearing an
  infrastructure blocker is theirs; landing the PR is yours.

## Don't change without being asked

Architecture, UI design, database schemas or migrations, payment flows, CI
workflows, `scripts/`, or server configuration. Not in this file, not in the repo.
If a task seems to require one of these, stop and report it.

## The server

- Production is `ssh ovh`. Other people's apps run there.
- **`ports.txt` on the server is the source of truth for ports.** Never guess one.
- **Deploy scripts run as `jorge`, never with sudo** — sudo changes HOME and
  breaks the deploy's git identity.
- **Merging to `main` is what deploys.** GitHub merges, the VPS pulls. That
  pipeline is not yours to change; don't touch it.
- Verify a deploy by reading the running system back. A merge is not a deploy.

## Reporting

Brief. Outcomes, not narration. What changed, PR number, CI status, landed or not.
Verify claims against the artifact — a green tick is not evidence.
