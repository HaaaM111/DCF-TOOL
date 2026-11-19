import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { validateApiRequest } from "../src/lib/request-schema";
test("password-protected endpoints reject unauthenticated callers and cross-origin writes",async()=>{
  const previous=process.env.APP_ACCESS_PASSWORD;process.env.APP_ACCESS_PASSWORD="verification-password";
  try{const url="http://localhost:3000/api/agent/config";assert.equal((await proxy(new NextRequest(url))).status,401);
    const auth="Basic "+Buffer.from("admin:verification-password").toString("base64");
    assert.equal((await proxy(new NextRequest(url,{headers:{authorization:auth}}))).status,200);
    assert.equal((await proxy(new NextRequest(url,{method:"POST",headers:{authorization:auth,origin:"https://evil.invalid"},body:"{}"}))).status,403);
  }finally{if(previous===undefined)delete process.env.APP_ACCESS_PASSWORD;else process.env.APP_ACCESS_PASSWORD=previous;}
});
test("server Zod gate rejects malicious keys and out-of-range query input",async()=>{
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/announcements?days=-1")),false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/companies",{method:"POST",body:'{"__proto__":{"admin":true}}'})),false);
  assert.equal(await validateApiRequest(new NextRequest("http://localhost/api/agent/chat",{method:"POST",body:'{"messages":[]}'})),true);
});
