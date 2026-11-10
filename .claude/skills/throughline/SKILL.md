---
name: throughline
description: Read the requirement you are implementing from Throughline and propose your pull request's link to it. Use when starting work on a TL-n requirement or issue, and after opening its pull request.
---

# Throughline

The roadmap lives in Throughline's `factory` project. The `throughline` MCP server (see `.mcp.json`) gives you two tools. Neither changes the roadmap: a person approves every proposal.

## Before you start

Call `get_requirement` with `project: "factory"` and the key, e.g. `TL-3`. It shows the requirement's acceptance criteria, its status, and the issues and pull requests already linked to it. `docs/roadmap.ts` is the source of truth: if Throughline's copy disagrees with it, build what `roadmap.ts` says and mention the difference in your summary.

## After the pull request is open

If the pull request body says `Implements TL-n`, Throughline links it as soon as the pull request is opened, so there is nothing to propose.

Otherwise, call `propose_link` with `project: "factory"`, the pull request's URL, the key, and a one- or two-sentence `rationale` a reviewer can check against the diff.

- `pending`, `already_pending` or `already_linked`: done.
- An error saying Throughline has not seen the pull request: the GitHub sync has not delivered it yet. Wait a minute and call once more. If it still fails, say so in your summary rather than retrying.

If the `throughline` tools are not available, say so in your summary.
