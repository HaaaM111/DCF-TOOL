import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { Readable } from "node:stream";

// Node maps IPv4 to IPv6 internally. Keep families separate so the IPv6
// mapped-address deny rule does not also match every normal IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [ip, bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["198.18.0.0",15],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked4.addSubnet(ip,bits,"ipv4");
for (const [ip,bits] of [["::",128],["::1",128],["::ffff:0:0",96],["fc00::",7],["fe80::",10],["ff00::",8]] as const) blocked6.addSubnet(ip,bits,"ipv6");
export function isBlockedAddress(address: string, family: number): boolean {
  if (isIP(address) !== family || (family !== 4 && family !== 6)) return true;
  return family === 4 ? blocked4.check(address,"ipv4") : blocked6.check(address,"ipv6");
}
const hosts = (raw = "") => raw.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);

export function validateRemoteUrl(raw: string, kind: "llm" | "document" = "llm"): URL {
  const u = new URL(raw);
  const allowed = kind === "llm"
    ? ["maas-api.cn-huabei-1.xf-yun.com","api.deepseek.com","api.openai.com", ...hosts(process.env.LLM_ALLOWED_HOSTS)]
    : ["static.cninfo.com.cn", ...hosts(process.env.DOCUMENT_ALLOWED_HOSTS)];
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !allowed.includes(u.hostname.toLowerCase()) || isIP(u.hostname.replace(/^\[|\]$/g,""))) throw new Error("不受信任的服务地址");
  if (u.hash) throw new Error("服务地址不能包含片段");
  return u;
}

export async function safeRemoteFetch(raw: string | URL | Request, init?: RequestInit, kind: "llm" | "document" = "llm"): Promise<Response> {
  const u = validateRemoteUrl(raw instanceof Request ? raw.url : String(raw),kind);
  const addresses = await lookup(u.hostname,{all:true});
  if (!addresses.length || addresses.some(x=>isBlockedAddress(x.address,x.family))) throw new Error("禁止访问内部网络地址");
  // Pin the checked address to the socket lookup; avoid a second DNS resolution.
  const address=addresses[0];
  return new Promise<Response>((resolve,reject)=>{
    const headers=Object.fromEntries(new Headers(init?.headers).entries());
    const outgoing=request(u,{method:init?.method??"GET",headers,signal:init?.signal??undefined,lookup:((_host:unknown,options:unknown,callback:unknown)=>{
      const cb=callback as (...args:unknown[])=>void;
      if((options as {all?:boolean}).all)cb(null,[address]);else cb(null,address.address,address.family);
    }) as import("node:net").LookupFunction},incoming=>{
      if((incoming.statusCode??500)>=300&&(incoming.statusCode??500)<400){incoming.resume();reject(new Error("不允许服务地址重定向"));return;}
      const h=new Headers();for(const [k,v] of Object.entries(incoming.headers))if(v!==undefined)h.set(k,Array.isArray(v)?v.join(","):v);
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>,{status:incoming.statusCode??502,headers:h}));
    });
    outgoing.on("error",reject);
    if(init?.body!==undefined&&init.body!==null){if(typeof init.body!=="string"&&!(init.body instanceof Uint8Array)){outgoing.destroy();reject(Error("不支持的请求体"));return;}outgoing.write(init.body);}
    outgoing.end();
  });
}
