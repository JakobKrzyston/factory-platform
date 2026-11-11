# MCP gateway

A way into Throughline's MCP tools that needs only the MCP token (#35).

The private Throughline instance sits behind Vercel Authentication, so reaching `/api/mcp` takes the Protection Bypass secret as well as the MCP token. The bypass secret opens the whole instance, review queue included, and Throughline has no sign-in of its own. An agent holding it could approve its own proposals. The gateway keeps that secret server-side:

```
agent ── Bearer MCP_TOKEN ──▶ gateway /api/mcp ── + bypass secret ──▶ Throughline /api/mcp
```

- It is its own Vercel project with protection off, and it holds one function, `api/mcp.ts`. There is no other route, so a missing setting cannot expose more of Throughline: the gateway has nothing else to serve. Without its settings it answers 503 and forwards nothing.
- It always forwards to `${THROUGHLINE_URL}/api/mcp`, whatever path or query the caller sends, as a POST with only `Authorization`, `Content-Type`, `Accept` and `Mcp-Protocol-Version`. Throughline checks the token, so the gateway does not hold it. Caller headers such as `x-vercel-set-bypass-cookie` are dropped, and only the response's content type comes back, never a cookie.
- A redirect from Throughline means Vercel refused the bypass. The gateway answers 502 instead of following it.

It cannot run on the runner beside the agent. The agent has a shell there, and anything that holds the secret on the same machine is something the agent could read.

## Setup

One Vercel project, deployed from this directory. `.vercelignore` uploads only `api/`, so the README and tests are not served.

```sh
cd platform/mcp-gateway
vercel link --yes --project throughline-mcp-gateway
vercel env add THROUGHLINE_URL production          # https://<private-host>, no trailing slash
vercel env add THROUGHLINE_BYPASS_SECRET production # the instance's Protection Bypass for Automation secret
vercel deploy --prod
```

Then, in the project's settings, turn Deployment Protection's Vercel Authentication off. With the default scope only previews are protected, but turning it off makes clear the production URL is meant to be public. Redeploy after any change to `api/mcp.ts`; the project is not connected to Git.

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
