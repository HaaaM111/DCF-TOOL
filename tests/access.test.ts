import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { validateApiRequest } from "../src/lib/request-schema";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { createSession, loginDestination, SESSION_COOKIE, verifySession } from "../src/lib/session";

test("internal pages and APIs require a signed session", async () => {
  const password = process.env.APP_ACCESS_PASSWORD;
  const secret = process.env.APP_SESSION_SECRET;
  process.env.APP_ACCESS_PASSWORD = "verification-password";
  process.env.APP_SESSION_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  try {
    const base = "https://localhost:3000";
    const url = base + "/api/agent/config";
    for (const path of ["/dashboard", "/company/603786.SH/sensitivity?x=1", "/valuation/new", "/settings", "/report/test"]) {
      const response = await proxy(new NextRequest(base + path));
      assert.equal(response.status, 303);
      assert.equal(new URL(response.headers.get("location")!, base).searchParams.get("next"), path);
    }
    assert.equal((await proxy(new NextRequest(base + "/login"))).status, 200);
    assert.equal((await proxy(new NextRequest(url))).status, 401);
    const authorization = "Basic " + Buffer.from("admin:verification-password").toString("base64");
    assert.equal((await proxy(new NextRequest(url, { headers: { authorization } }))).status, 401);

    const signIn = (password: string, origin = base) => login(new NextRequest(base + "/api/auth/login", {
      method: "POST", headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password }),
    }));
    const wrong = await signIn("wrong");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);
    assert.equal((await signIn("verification-password", "https://evil.invalid")).status, 403);
    const ok = await signIn("verification-password");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const setCookie = ok.headers.get("set-cookie")!;
    for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Path=\//i]) assert.match(setCookie, attribute);
    assert.doesNotMatch(setCookie, /Domain=/i);
    const cookie = setCookie.split(";")[0];
    assert.equal((await proxy(new NextRequest(url, { headers: { cookie } }))).status, 200);
    assert.equal((await proxy(new NextRequest(url, { headers: { cookie, "sec-fetch-site": "cross-site" } }))).status, 403);
    assert.equal((await proxy(new NextRequest(url, { headers: { cookie: SESSION_COOKIE + "=forged" } }))).status, 401);
    assert.equal((await proxy(new NextRequest(url, { method: "POST", headers: { cookie, origin: "https://evil.invalid" }, body: "{}" }))).status, 403);
    const signedOut = await logout(new NextRequest(base + "/api/auth/logout", { method: "POST", headers: { cookie, origin: base } }));
    assert.match(signedOut.headers.get("set-cookie")!, /Max-Age=0/i);
    delete process.env.APP_SESSION_SECRET;
    assert.equal((await proxy(new NextRequest(url))).status, 503);
    assert.equal((await proxy(new NextRequest(base + "/dashboard"))).status, 503);
  } finally {
    if (password === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = password;
    if (secret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = secret;
  }
});

test("signed sessions expire and reject tampering and credential changes", () => {
  const config = { password: "verification-password", secret: "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  const now = 1800000000000;
  const token = createSession(config, now);
  assert.equal(verifySession(token, config, now), true);
  assert.equal(verifySession(token, config, now + 8 * 60 * 60 * 1000), false);
  assert.equal(verifySession(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), config, now), false);
  assert.equal(verifySession(token, { ...config, password: "changed" }, now), false);
});

test("login return destinations are restricted to terminal paths", () => {
  assert.equal(loginDestination("/company/603786.SH/sensitivity?mode=fcff"), "/company/603786.SH/sensitivity?mode=fcff");
  for (const invalid of ["//evil.invalid/dashboard", "/\\evil.invalid", "/company/%2f%2fevil.invalid",
    "/company/../login", "https://evil.invalid", "/api/companies"]) {
    assert.equal(loginDestination(invalid), "/dashboard");
  }
});
test("server Zod gate rejects malicious keys and out-of-range query input",async()=>{
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/announcements?days=-1")),false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/companies",{method:"POST",body:'{"__proto__":{"admin":true}}'})),false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/agent/chat",{method:"POST",body:'{"messages":[]}'})),true);
});
