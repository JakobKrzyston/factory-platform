---
issue: 35
pr: 47
base_sha: 78479d9ce683fbb6a9a0036df58ad6f283425d07
role: triage
stages: triage
files: .env.example,.gitignore,README.md,docs/ARCHITECTURE.md,docs/notes/03-mcp-gateway.md,platform/mcp-gateway/.vercelignore,platform/mcp-gateway/README.md,platform/mcp-gateway/api/mcp.ts,platform/mcp-gateway/gateway.test.ts
checks:
---
## Issue

Token-only Throughline access before unattended agents get the MCP tools

````markdown
TL-3 gives Claude Code sessions in this repository Throughline's MCP tools (`get_requirement`, `propose_link`). To reach the private instance, a client sends the MCP token and the Vercel Protection Bypass secret.

The bypass secret opens the whole instance, not just `/api/mcp`. Throughline has no sign-in of its own, so whoever holds the secret can open the review queue and approve proposals. That includes an agent approving its own link, which design rule 1 forbids for factory tokens.

For now only interactive sessions the owner watches get the secret (see `.env.example` and the TL-3 stage note). Before an unattended implementer (TL-7) is given these tools, it needs a way in that carries only the MCP token.

**Options considered**

- An MCP-only Vercel deployment with protection off, where a proxy serves `/api/mcp` and 404s everything else. It is fail-open if its flag is ever missing.
- Throughline's own sign-in (throughline-roadmap issue #11), so the bypass secret no longer equals full access.

**Done when**

An unattended run can call both tools holding no credential that can approve a proposal.
````

## Expected outcome

Triage ends with `QUESTION:`. An unattended run cannot finish this issue, for two reasons:

- Done means a deployed service that an unattended run can call. That needs a Vercel project, its settings and the bypass secret, all outside the repository.
- The issue offers two designs with different failure modes: a proxy that fails open if its flag goes missing, and a sign-in that lives in another repository. Choosing between them is a security decision for the owner.

A good question names that choice, or the deployment the owner has to make. A triage note that passes the issue to the spec agent is a miss.

Reference: the owner chose a third shape, a separate gateway project that holds nothing but `api/mcp.ts` and so fails closed. They deployed it by hand (PR #47).
