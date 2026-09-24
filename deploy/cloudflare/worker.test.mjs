import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.mjs";

const headers = { "cf-access-jwt-assertion": "header.payload.signature", origin: "https://resume.example.workers.dev" };
const assets = { fetch: () => new Response("SPA") };

test("VPC proxy checks authentication/CSRF, strips credentials, and streams POST/SSE", async () => {
  const requested = [];
  const env = { ASSETS: assets, RESUME_API: { fetch: async request => {
    requested.push(request);
    return new Response("event: completed\ndata: {}\n\n", { headers: { "content-type": "text/event-stream", "set-cookie": "do-not-forward", "x-secret": "private" } });
  } } };
  assert.equal((await worker.fetch(new Request("https://resume.example.workers.dev/api/workspace"), env)).status, 401);
  assert.equal((await worker.fetch(new Request("https://resume.example.workers.dev/api/workspace", { method: "POST", headers: { ...headers, origin: "https://evil.example" } }), env)).status, 403);
  assert.equal(requested.length, 0);
  const response = await worker.fetch(new Request("https://resume.example.workers.dev/api/reviews?stream=1", { method: "POST", body: "{}", headers: { ...headers, "x-resume-user-jwt": "forged", cookie: "private-cookie", authorization: "attacker", "cf-access-client-secret": "forged-secret" } }), env);
  assert.equal(requested[0].url, "http://127.0.0.1:8000/api/reviews?stream=1");
  assert.equal(requested[0].headers.get("x-resume-user-jwt"), headers["cf-access-jwt-assertion"]);
  for (const name of ["authorization", "cookie", "cf-access-client-secret"]) assert.equal(requested[0].headers.get(name), null);
  assert.equal(await requested[0].text(), "{}");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-secret"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(await response.text(), /event: completed/);
});

test("API never falls back to SPA or public fetch; VPC failures/redirects fail closed", async () => {
  const request = new Request("https://resume.example.workers.dev/api/missing", { headers });
  const env = { ASSETS: assets, RESUME_API: { fetch: async request => {
    assert.equal(request.redirect, "manual");
    return new Response("upstream secret", { status: 302, headers: { location: "https://evil.example" } });
  } } };
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /upstream secret/);
  assert.equal(await (await worker.fetch(new Request("https://resume.example.workers.dev/contexts"), env)).text(), "SPA");
  assert.equal((await worker.fetch(request, { ASSETS: assets })).status, 503);
  assert.equal((await worker.fetch(request, { RESUME_API: { fetch() { throw new Error("private failure"); } } })).status, 502);
});
