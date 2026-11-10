---
name: throughline
description: Read the requirement you are implementing from Throughline and propose your pull request's link to it. Use when starting work on a TL-n requirement or issue, and after opening its pull request.
---

# Throughline

The roadmap lives in Throughline's `factory` project. The `throughline` MCP server (see `.mcp.json`) gives you two tools. Neither changes the roadmap: a person approves every proposal.

## Before you start

Call `get_requirement` with `project: "factory"` and the key, e.g. `TL-3`. Build what its description and acceptance criteria say; the roadmap is the source of truth, and the issue text can be out of date.

## After the pull request is open

Call `propose_link` with `project: "factory"`, the pull request's URL, the key, and a one- or two-sentence `rationale` a reviewer can check against the diff.

- `pending`: done. The link waits in Throughline's review queue.
- `already_pending` or `already_linked`: done; nothing more to do.
- An error saying Throughline has not seen the pull request: the GitHub sync has not delivered it yet. Wait a minute and call once more. If it still fails, say so in your summary rather than retrying.

If the `throughline` tools are not available, say so in your summary. A pull request body that says `Implements TL-n` is still linked automatically when it merges.
