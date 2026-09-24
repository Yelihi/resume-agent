function error(status, code, message) {
  return Response.json({ errors: [{ moduleKey: "connection", inputSourceId: null, errorCode: code, userMessage: message, canRetry: status >= 500 }] },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const assertion = request.headers.get("cf-access-jwt-assertion");
    if (!assertion || assertion.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)) {
      return error(401, "AUTHENTICATION_REQUIRED", "로그인이 필요합니다. 화면을 새로고침해 주세요.");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== url.origin) {
      return error(403, "ORIGIN_REJECTED", "같은 서비스 화면에서 다시 요청해 주세요.");
    }
    if (!env.RESUME_API || typeof env.RESUME_API.fetch !== "function") {
      return error(503, "ORIGIN_NOT_CONFIGURED", "서버 연결 설정을 확인해 주세요.");
    }
    // The VPC Service binds only the Mac's loopback:8000, never the whole LAN.
    // HTTP is local to cloudflared and FastAPI; the VPC tunnel transport is encrypted.
    const origin = new URL("http://127.0.0.1:8000");
    origin.pathname = url.pathname;
    origin.search = url.search;
    // Send only the request fields the API uses. Client-supplied identity and service credentials never pass through.
    const headers = new Headers();
    for (const name of ["content-type", "accept", "origin", "sec-fetch-site", "range", "if-range", "last-event-id"]) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    headers.set("x-resume-user-jwt", assertion);
    try {
      const upstream = await env.RESUME_API.fetch(new Request(origin, { method: request.method, headers, body: request.body, redirect: "manual", signal: request.signal, duplex: "half" }));
      // Never follow an Access login or origin redirect with service credentials, or expose its response to the browser.
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return error(502, "ORIGIN_AUTHENTICATION_FAILED", "서버 연결 인증을 확인해 주세요.");
      }
      const responseHeaders = new Headers();
      for (const name of ["content-type", "content-disposition", "content-range", "accept-ranges", "retry-after"]) {
        if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name));
      }
      responseHeaders.set("Cache-Control", "private, no-store");
      responseHeaders.set("X-Content-Type-Options", "nosniff");
      responseHeaders.set("X-Accel-Buffering", "no");
      // Stream SSE/uploads/downloads; never materialize document bodies in the Worker.
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch { return error(502, "ORIGIN_UNAVAILABLE", "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
  },
};
