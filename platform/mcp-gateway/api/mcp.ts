/** /api/mcp on the gateway: forwards MCP requests to the private Throughline instance, adding the Vercel bypass secret the caller never holds. Exports POST, GET, DELETE. */

// Only what an MCP client over Streamable HTTP needs. Everything else the caller sends is dropped,
// including x-vercel-set-bypass-cookie, which would hand the caller a cookie that opens every page.
const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "mcp-protocol-version",
];

/**
 * Forward one MCP request to `${THROUGHLINE_URL}/api/mcp`.
 *
 * Throughline checks the caller's bearer token itself, so the gateway does not hold MCP_TOKEN.
 *
 * Args:
 *   request: A JSON-RPC message from an MCP client, with `Authorization: Bearer <MCP_TOKEN>`.
 *
 * Returns:
 *   503 when the gateway is not configured, 502 when Throughline cannot be reached or redirects
 *   (a redirect means Vercel protection refused the bypass), otherwise Throughline's status and body
 *   with only its content type.
 */
export async function POST(request: Request): Promise<Response> {
  const base = process.env.THROUGHLINE_URL;
  const bypass = process.env.THROUGHLINE_BYPASS_SECRET;
  if (!base || !bypass) {
    return Response.json(
      { error: "Gateway is off: THROUGHLINE_URL or THROUGHLINE_BYPASS_SECRET is unset" },
      { status: 503 },
    );
  }

  const headers = new Headers({ "x-vercel-protection-bypass": bypass });
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers,
      body: await request.text(),
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "Throughline is unreachable" }, { status: 502 });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return Response.json(
      { error: "Throughline redirected: the bypass secret is wrong or revoked" },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: contentType ? { "content-type": contentType } : {},
  });
}

/**
 * Refuse the stream (GET) and session end (DELETE) requests, as Throughline does: its MCP server is
 * stateless, so there is nothing to stream or end.
 *
 * Returns:
 *   405, which tells MCP clients to use POST only.
 */
function methodNotAllowed(): Response {
  return Response.json(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export { methodNotAllowed as DELETE, methodNotAllowed as GET };
