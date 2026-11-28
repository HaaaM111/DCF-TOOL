import test, { before } from "node:test";
import assert from "node:assert/strict";

let NextRequest: typeof import("next/server").NextRequest;
let middleware: typeof import("../src/middleware").middleware;
let guardRequest: typeof import("../src/lib/api").guardRequest;
let validateApiRequest: typeof import("../src/lib/request-schema").validateApiRequest;
let attachAuthenticatedUser: typeof import("../src/lib/auth").attachAuthenticatedUser;
let companyAccessWhere: typeof import("../src/lib/auth").companyAccessWhere;
let hashPassword: typeof import("../src/lib/auth").hashPassword;
let isAdministrator: typeof import("../src/lib/auth").isAdministrator;
let isSameOriginRequest: typeof import("../src/lib/auth").isSameOriginRequest;
let SESSION_COOKIE: typeof import("../src/lib/auth").SESSION_COOKIE;
let verifyPassword: typeof import("../src/lib/auth").verifyPassword;
let signOut: typeof import("../src/app/api/auth/signout/route").POST;

before(async () => {
  process.env.DATABASE_URL ??= "file:./prisma/user.db";
  process.env.BASELINE_DATABASE_URL ??= "file:./prisma/baseline.db?mode=ro";
  ({ NextRequest } = await import("next/server"));
  ({ middleware } = await import("../src/middleware"));
  ({ guardRequest } = await import("../src/lib/api"));
  ({ validateApiRequest } = await import("../src/lib/request-schema"));
  ({
    attachAuthenticatedUser,
    companyAccessWhere,
    hashPassword,
    isAdministrator,
    isSameOriginRequest,
    SESSION_COOKIE,
    verifyPassword,
  } = await import("../src/lib/auth"));
  ({ POST: signOut } = await import("../src/app/api/auth/signout/route"));
});

test("public pages stay open and terminal pages redirect to account sign-in", () => {
  const base = "https://localhost:3000";
  for (const path of ["/", "/sign-in", "/sign-up", "/admin-setup"]) {
    assert.equal(middleware(new NextRequest(base + path)).status, 200);
  }
  for (const path of ["/dashboard", "/company/603786.SH/sensitivity?x=1", "/valuation/new", "/settings", "/home"]) {
    const response = middleware(new NextRequest(base + path));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location")!, base);
    assert.equal(location.pathname, "/sign-in");
    assert.equal(location.searchParams.get("next"), new URL(path, base).pathname);
  }
  assert.equal(middleware(new NextRequest(base + "/dashboard", {
    headers: { cookie: `${SESSION_COOKIE}=present` },
  })).status, 200);
});

test("API guard rejects missing sessions and sign-out clears the account cookie", async () => {
  const base = "https://localhost:3000";
  const unauthenticated = await guardRequest(new NextRequest(base + "/api/agent/config"));
  assert.equal(unauthenticated?.status, 401);
  assert.deepEqual(await unauthenticated?.json(), { error: "请先登录后继续", code: "UNAUTHENTICATED" });

  const signedOut = await signOut(new NextRequest(base + "/api/auth/signout", {
    method: "POST",
    headers: { origin: base, host: "localhost:3000" },
  }));
  assert.equal(signedOut.status, 200);
  assert.match(signedOut.headers.get("set-cookie")!, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.match(signedOut.headers.get("set-cookie")!, /HttpOnly/i);
  assert.equal((await signOut(new NextRequest(base + "/api/auth/signout", {
    method: "POST",
    headers: { origin: "https://evil.invalid", host: "localhost:3000" },
  }))).status, 403);
});

test("password hashes use scrypt and constant-time verification", async () => {
  const stored = await hashPassword("verification-password");
  assert.match(stored, /^scrypt\$/);
  assert.equal(await verifyPassword("verification-password", stored), true);
  assert.equal(await verifyPassword("wrong", stored), false);
  assert.equal(await verifyPassword("verification-password", "invalid"), false);
});

test("company access is scoped to the account except for administrators", () => {
  const request = new NextRequest("https://localhost:3000/api/companies/c1");
  attachAuthenticatedUser(request, { id: "user-1", role: "user" });
  assert.deepEqual(companyAccessWhere(request, "c1"), { id: "c1", userId: "user-1" });
  assert.equal(isAdministrator(request), false);

  const adminRequest = new NextRequest("https://localhost:3000/api/companies/c1");
  attachAuthenticatedUser(adminRequest, { id: "admin-1", role: "admin" });
  assert.deepEqual(companyAccessWhere(adminRequest, "c1"), { id: "c1" });
  assert.equal(isAdministrator(adminRequest), true);
});

test("same-origin checks reject cross-site mutations", () => {
  const request = new NextRequest("https://localhost:3000/api/auth/signout", {
    headers: { origin: "https://evil.invalid", host: "localhost:3000" },
  });
  assert.equal(isSameOriginRequest(request, request.headers.get("origin")), false);
  assert.equal(isSameOriginRequest(request, null), true);
  assert.equal(isSameOriginRequest(new NextRequest(request.url, {
    headers: { origin: "https://localhost:3000", host: "localhost:3000" },
  }), "https://localhost:3000"), true);
});

test("server Zod gate rejects malicious keys and out-of-range query input", async () => {
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/announcements?days=-1")), false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/companies", {
    method: "POST",
    body: '{"__proto__":{"admin":true}}',
  })), false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/agent/chat", {
    method: "POST",
    body: '{"messages":[]}',
  })), true);
});
