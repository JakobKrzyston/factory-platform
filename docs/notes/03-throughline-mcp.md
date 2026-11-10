# 03: Throughline MCP server for factory agents (TL-3)

## Expected

Throughline had no API to wrap: every write is a server action behind its review page. So "an MCP server over Throughline's API" meant building the first slice of Throughline issue #71 in Throughline itself, an `/api/mcp` route with two tools, and registering it here. The two tools sit on code that already existed: `loadRoadmap` for reading, and the same pending-proposal path the link suggestion agent uses for writing.

## Happened

- **Where it lives.** In Throughline, not in `platform/`. A server here would have had to write proposals into Throughline's database directly, skipping the code that validates them. One new proposal source, `mcp`, needed a migration (Throughline's 14th), and the review queue labels it "Proposed by an agent".
- **No approve tool.** `propose_link` creates a pending proposal and returns. Calling it again returns the proposal already waiting, and once the link exists it answers `already_linked`, so an agent that retries cannot fill the queue.
- **Two keys to get in, and one opens everything.** The private instance sits behind Vercel Authentication (note 01), so a client needs the protection bypass secret before Throughline's own bearer token is even checked. `.mcp.json` sends both as headers taken from the shell environment. The code review caught what that means: Throughline has no sign-in of its own, so the bypass secret opens every page, and an agent holding it could approve its own proposal on the review page. "No tool approves anything" is true of the tools, not of the credentials. The decision was to give the secret only to interactive sessions, which already hold a GitHub login that can merge, and to require a token-only way in before an unattended agent gets these tools.
- **Pull requests must be synced first.** `propose_link` reads the repository and number from the PR's address and finds it among Throughline's work items. The GitHub sync adds a PR when it is opened, which took 7 seconds in TL-2, so an agent that calls straight after opening the PR may need to try once more. The skill says so.
- **Most PRs here will not need it.** This repository's PRs say `Implements TL-n`, and Throughline links those the moment they open. `propose_link` is for PRs without the reference, such as the ones an unattended run writes, and the skill tells the agent to skip it otherwise.
- **The review found more than the tests did.** It caught a GET request that held a stream open (a serverless function per agent until timeout), agent proposals that went stale when a reference was added later, approval of a link to an open PR not starting the requirement, and PR addresses that only matched in one exact form. All four are fixed and tested.
- **Not yet in unattended runs.** TL-4's script starts Claude Code with `--bare` in a clone of the target repository, so no `.mcp.json` is loaded. Passing `--mcp-config` would work; what holds it back is the bypass secret above. That belongs to the implementer's agent definition (TL-7).

## What the numbers said

| Check | Result |
| --- | --- |
| Throughline tests | 589 of 589 pass, 15 of them new for the MCP server |
| Local run, SDK client over HTTP | `get_requirement` returned the requirement with its linked PRs; `propose_link` gave `pending`, then `already_pending`, then `already_linked` for a PR that already had the link |
| Request without the token | 401 |
| `GET /api/mcp` after the fix | 405; the SDK client and Claude Code still connect and call both tools |
| `propose_link` with a Files-tab address in other case and key `tl-11` | Found PR #109 and proposed the link to TL-11 |
| Review queue after `propose_link` | The proposal shows "Proposed by an agent" with the agent's rationale |
| Claude Code through this repo's `.mcp.json` | Called `get_requirement` against the local instance and reported the right title and status |
| Against the private instance | Not yet run: needs the Throughline release, migration 0013 on the factory database and `MCP_TOKEN` set |
