# 03: A token-only way into Throughline's MCP tools (#35)

## Expected

TL-3 left one condition before an unattended agent could have Throughline's tools: reaching `/api/mcp` took the Vercel bypass secret, and that secret opens the review page too (note 03). The issue listed two ways out. The first was an MCP-only Throughline deployment with protection off, which fails open if its flag is ever missing. The second was sign-in for Throughline (its issue #11), which is far larger. A third option fails closed: a separate Vercel project, `throughline-mcp-gateway`, holding one function that adds the bypass secret on the server and forwards only to `/api/mcp`. A missing setting cannot expose anything, because the project contains nothing else to serve. It cannot run on the runner, where the agent has a shell and could read the secret.

## Happened

- **The gateway is `platform/mcp-gateway/api/mcp.ts`.** It forwards a POST and four headers to the fixed URL, returns only the content type, and does not hold the MCP token, since Throughline checks it. `.vercelignore` uploads only `api/`: the deploy log shows one file, and `/README.md` gets 404.
- **The first values were for the wrong instance.** `.env.local` held the public demo's host, without `https://`, and a bypass secret that Vercel rejected on `throughline-factory`. The demo answered signed-out requests with 200, and its `/api/mcp` replied "this is a public deployment". `vercel inspect` named the project, as the App slug did in note 25. `.env.example` now says which project the address belongs to.
- **Vercel refuses a POST with 401, not a redirect.** The gateway first treated only a redirect as a refused bypass, so a wrong secret would have reached the caller as a 401 that looks like a bad token. Vercel's 401 sets a `_vercel_sso_nonce` cookie and Throughline's never does. The gateway now answers 502 for either, with a test that failed before the change and a local run against the real instance.
- **`vercel link` connected the project to this repository.** That was not asked for. With production on `main` and no root directory, the next push would have deployed the repository root over the gateway. It is disconnected now (`link: null`), and the README's setup includes the disconnect.
- **The default protection is right as it is.** Standard Protection leaves the production address public and keeps per-deployment URLs behind sign-in, so nothing was changed.

## What the numbers said

| Check | Result |
| --- | --- |
| Gateway unit tests | 8 of 8 pass; the Vercel-401 test failed against the first version |
| Signed-out `GET /`, `/README.md`, `/p/factory` on the gateway | 404 |
| `GET /api/mcp` | 405 |
| POST with a wrong token | 401 `{"error":"Bad token"}` from Throughline, so the bypass got through |
| POST with the MCP token plus `x-vercel-set-bypass-cookie: true` | 200, both tools listed, no `set-cookie` in the response |
| Handler run locally against the private instance, wrong bypass secret | 502, not 401 |
| `claude -p`, environment `PATH HOME USER LOGNAME THROUGHLINE_GATEWAY_URL THROUGHLINE_MCP_TOKEN` | `get_requirement` TL-3 `done`; `propose_link` PR #36 `already_linked`; 4 turns, $0.0012 on Haiku 5.5 |
