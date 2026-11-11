/** Tests the MCP gateway against a local stand-in for Throughline. Run: pnpm test */
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";

import { GET, POST } from "./api/mcp";

type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };
let seen: Seen | null;
let reply: { status: number; headers: Record<string, string>; body: string };

const throughline = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    seen = { method: req.method, url: req.url, headers: req.headers, body };
    res.writeHead(reply.status, reply.headers).end(reply.body);
  });
});

before(async () => {
  await new Promise<void>((resolve) => throughline.listen(0, "127.0.0.1", resolve));
  const { port } = throughline.address() as AddressInfo;
  process.env.THROUGHLINE_URL = `http://127.0.0.1:${port}`;
});

after(() => throughline.close());

beforeEach(() => {
  process.env.THROUGHLINE_BYPASS_SECRET = "bypass-secret";
  seen = null;
  reply = {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "_vercel_jwt=x" },
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
  };
});

function mcpRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://gateway.example/api/mcp?path=/p/factory", {
    method: "POST",
    headers: {
      authorization: "Bearer mcp-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  });
}

test("forwards the MCP request to /api/mcp with the bypass secret added", async () => {
  const response = await POST(mcpRequest());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), reply.body);
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.url, "/api/mcp");
  assert.equal(seen?.body, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
  assert.equal(seen?.headers["x-vercel-protection-bypass"], "bypass-secret");
  assert.equal(seen?.headers.authorization, "Bearer mcp-token");
  assert.equal(seen?.headers["mcp-protocol-version"], "2025-06-18");
});

test("drops caller headers that could turn the bypass into a cookie or replace it", async () => {
  await POST(
    mcpRequest({
      "x-vercel-set-bypass-cookie": "true",
      "x-vercel-protection-bypass": "caller-guess",
      cookie: "a=b",
    }),
  );
  assert.equal(seen?.headers["x-vercel-set-bypass-cookie"], undefined);
  assert.equal(seen?.headers["x-vercel-protection-bypass"], "bypass-secret");
  assert.equal(seen?.headers.cookie, undefined);
});

test("returns only Throughline's content type, never its cookies", async () => {
  const response = await POST(mcpRequest());
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("passes Throughline's refusal of a wrong token straight back", async () => {
  reply = { status: 401, headers: { "content-type": "application/json" }, body: '{"error":"Bad token"}' };
  const response = await POST(mcpRequest({ authorization: "Bearer wrong" }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Bad token" });
});

test("a redirect to Vercel sign-in is a gateway error, not followed", async () => {
  reply = { status: 302, headers: { location: "https://vercel.com/sso" }, body: "" };
  const response = await POST(mcpRequest());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /bypass secret/);
});

test("refuses to forward without its configuration", async () => {
  delete process.env.THROUGHLINE_BYPASS_SECRET;
  const response = await POST(mcpRequest());
  assert.equal(response.status, 503);
  assert.equal(seen, null);
});

test("GET is refused without reaching Throughline", async () => {
  const response = GET();
  assert.equal(response.status, 405);
  assert.equal(seen, null);
});
