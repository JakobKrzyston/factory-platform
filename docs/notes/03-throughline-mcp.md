# 03: Throughline MCP server for factory agents (TL-3)

## Expected

Throughline had no API to wrap: every write is a server action behind its review page. So "an MCP server over Throughline's API" meant building the first slice of Throughline issue #71 in Throughline itself, an `/api/mcp` route with two tools, and registering it here. The two tools sit on code that already existed: `loadRoadmap` for reading, and the same pending-proposal path the link suggestion agent uses for writing.

## Happened

- **Where it lives.** In Throughline, not in `platform/`. A server here would have had to write proposals into Throughline's database directly, skipping the code that validates them. One new proposal source, `mcp`, needed a migration (Throughline's 14th), and the review queue labels it "Proposed by an agent".
- **No approve tool.** `propose_link` creates a pending proposal and returns. Calling it again returns the proposal already waiting, and once the link exists it answers `already_linked`, so an agent that retries cannot fill the queue.
- **Two keys to get in.** The private instance sits behind Vercel Authentication (note 01), so a client needs the protection bypass secret before Throughline's own bearer token is even checked. `.mcp.json` sends both as headers taken from the shell environment.
- **Pull requests must be synced first.** `propose_link` finds the PR among Throughline's work items by URL. The GitHub sync adds a PR when it is opened, which took 7 seconds in TL-2, so an agent that calls straight after opening the PR may need to try once more. The skill says so.
- **Not yet in unattended runs.** TL-4's script starts Claude Code with `--bare` and no network, so it loads neither `.mcp.json` nor anything outside the clone. The tools work for an interactive session in this repo; giving them to the unattended implementer belongs to its agent definition (TL-7).

## What the numbers said

| Check | Result |
| --- | --- |
| Throughline tests | 584 of 584 pass, 10 of them new for the MCP server |
| Local run, SDK client over HTTP | `get_requirement` returned the requirement with its linked PRs; `propose_link` gave `pending`, then `already_pending`, then `already_linked` for a PR that already had the link |
| Request without the token | 401 |
| Review queue after `propose_link` | The proposal shows "Proposed by an agent" with the agent's rationale |
| Claude Code through this repo's `.mcp.json` | Called `get_requirement` against the local instance and reported the right title and status |
| Against the private instance | Not yet run: needs the Throughline release, migration 0013 on the factory database and `MCP_TOKEN` set |
