# CLAUDE.md

Context for Claude Code sessions in this repo.

## What this project is

Factory Platform is a software factory and the platform under it, built one measured stage at a time. A factory turns a labelled GitHub issue into a reviewed pull request without a person watching. This repository is the factory, the shared platform (queue, run log, gates, benchmark) and the record of what each stage cost and changed.

It is a public portfolio project. Every decision must be explainable in an interview, and the evidence for it must be in the run log or a note.

- The plan, with acceptance criteria: `docs/PLAN.md` (rendered from `docs/roadmap.ts`)
- Architecture: `docs/ARCHITECTURE.md`
- Stage notes: `docs/notes/`

## Design rules (do not break these)

1. **Humans merge.** No factory PR merges without a human approval. Factory tokens cannot approve or merge.
2. **One idea per stage.** A PR implements one `TL-n` requirement. Anything else becomes a ticket.
3. **Guidance plus gates.** Prompts and skills make good output likely; hooks and checks make bad output impossible to hand in. Add both or neither.
4. **Every run is logged** once TL-11 exists: factory, role, issue, model, tokens, cost, wall time, checks, review findings, rework.
5. **Factories are data.** Everything under `factories/` is a definition, validated by `pnpm validate-factory`, and is the only thing the meta-factory may change. Nothing under `factories/` contains queue, log or gate code; that lives in `platform/`.
6. **Benchmark before belief.** A change to a prompt, model or gate is judged by a benchmark run, not by one good result.
7. **Secrets never enter the repo.** Keys live in GitHub Actions secrets or `.env.local`; new variables go in `.env.example` with a comment.

## Working conventions

- Branch from `main` as `tl/N-short-name` (`wt new N-short-name` creates it).
- PR title `TL-N: <title>`. Body: what was built, how to try it, risk (one-way or two-way door) and blast radius, evidence (tests, screenshots, checks), and `Implements TL-N` so Throughline reconciles it.
- Write the note the acceptance list asks for under `docs/notes/NN-short-name.md`: expected, happened, what the numbers said.
- Prefer small, readable files over clever abstractions. The repo owner must be able to explain every part.
- When `docs/roadmap.ts` changes, run `npx tsx scripts/render-plan.ts` and commit `docs/PLAN.md` with it.

## Stack

Node 22 and TypeScript for platform code and scripts; shell for the first run script; GitHub Actions for the queue; Claude Code as the agent harness; SQLite locally and Neon Postgres in the cloud for the run log. Package manager: pnpm. Exact choices are settled stage by stage and recorded in `docs/ARCHITECTURE.md`.
