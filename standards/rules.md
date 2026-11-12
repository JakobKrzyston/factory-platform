# Standing rules

The rules the review agent applies, and cites by ID when it flags a finding. Each rule is a comment a human should never have to leave twice. Its `Source:` says where it came from: a review comment's link, or for the first rules, `CLAUDE.md`, where the owner wrote them down before any review happened.

A new rule takes the next free ID. An ID is never reused: delete a rule that no longer holds and leave its number unused, so old citations stay unambiguous.

## R-1: Secrets never enter the repository

No key, token, password or connection string in a committed file, including tests and examples. Keys live in GitHub Actions secrets or `.env.local`. A new environment variable goes in `.env.example` with a comment saying what it is for.

Source: CLAUDE.md, design rule 7

## R-2: Factories are data

Everything under `factories/` is a definition: agents, triggers, scorers and skills as files. Queue, run log and gate code belongs in `platform/`, never under `factories/`.

Source: CLAUDE.md, design rule 5

## R-3: One idea per pull request

A pull request implements one requirement. A fix or improvement outside it, however small, becomes its own ticket instead of riding along.

Source: CLAUDE.md, design rule 2

## R-4: The rendered plan moves with the roadmap

A change to `docs/roadmap.ts` comes with `docs/PLAN.md` re-rendered by `npx tsx scripts/render-plan.ts` in the same pull request.

Source: CLAUDE.md, working conventions
