# MCP gateway

A way into Throughline's MCP tools that needs only the MCP token (#35).

The private Throughline instance sits behind Vercel Authentication, so reaching `/api/mcp` takes the Protection Bypass secret as well as the MCP token. The bypass secret opens the whole instance, review queue included, and Throughline has no sign-in of its own. An agent holding it could approve its own proposals. The gateway keeps that secret server-side:

```
agent ── Bearer MCP_TOKEN ──▶ gateway /api/mcp ── + bypass secret ──▶ Throughline /api/mcp
```

- It is its own Vercel project with protection off, and it holds one function, `api/mcp.ts`. There is no other route, so a missing setting cannot expose more of Throughline: the gateway has nothing else to serve. Without its settings it answers 503 and forwards nothing.
- Every other path is a 404 from Vercel. `/api/mcp` always forwards to `${THROUGHLINE_URL}/api/mcp`, dropping any query, as a POST with only `Authorization`, `Content-Type`, `Accept` and `Mcp-Protocol-Version`. Throughline checks the token, so the gateway does not hold it. Caller headers such as `x-vercel-set-bypass-cookie` are dropped, and only the response's content type comes back, never a cookie.
- When Vercel refuses the bypass, the gateway answers 502 so the caller cannot mistake it for a bad token. Vercel refuses a POST with a 401 that sets a `_vercel_sso_nonce` cookie, which Throughline's own 401 never does, and anything else with a redirect, which the gateway does not follow.

It cannot run on the runner beside the agent. The agent has a shell there, and anything that holds the secret on the same machine is something the agent could read.

## Setup

One Vercel project, deployed from this directory. `.vercelignore` uploads only `api/`, so the README and tests are not served.

```sh
cd platform/mcp-gateway
vercel link --yes --project throughline-mcp-gateway
vercel git disconnect --yes                         # link connects the repository, which would deploy its root on every push
vercel env add THROUGHLINE_URL production           # https://throughline-factory.vercel.app, no trailing slash
vercel env add THROUGHLINE_BYPASS_SECRET production --sensitive  # that project's Protection Bypass for Automation secret
vercel deploy --prod
```

The default Deployment Protection, Standard Protection, leaves the production address public and keeps per-deployment URLs behind Vercel sign-in. That is what the gateway needs; there is nothing to change. Redeploy after any change to `api/mcp.ts`. The build log reports `Cannot find name 'process'` because the upload has no `@types/node`; it is a type-check warning and the function still builds.

To check a deploy, a signed-out `GET /` should get 404, a POST to `/api/mcp` with a wrong token should get Throughline's 401 `{"error":"Bad token"}`, and one with the MCP token should list `get_requirement` and `propose_link`. A 502 means the bypass secret is wrong.

## Use

Give a client the gateway's address and the MCP token, nothing else:

```json
{
  "mcpServers": {
    "throughline": {
      "type": "http",
      "url": "${THROUGHLINE_GATEWAY_URL}/api/mcp",
      "headers": { "Authorization": "Bearer ${THROUGHLINE_MCP_TOKEN}" }
    }
  }
}
```

Passed with `--mcp-config`, this is what an unattended run uses. Which runs get it belongs to their agent definition (TL-7).
