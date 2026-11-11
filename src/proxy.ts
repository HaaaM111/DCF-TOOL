import { NextRequest, NextResponse } from "next/server";
import { validateApiRequest } from "@/lib/request-schema";

/** Private single-user terminal. Browser Basic Auth keeps the secret out of JS/storage. */
export async function proxy(req: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "production") return new NextResponse("请先配置 APP_ACCESS_PASSWORD",{status:503});
    if (/\/api\/agent\/config/.test(req.nextUrl.pathname)) return NextResponse.json({error:"配置管理需设置 APP_ACCESS_PASSWORD"},{status:403});
    return await validateApiRequest(req)?NextResponse.next():NextResponse.json({error:"输入参数无效或超过限制"},{status:422});
  }
  let supplied = "";
  try {
    const [scheme, encoded] = (req.headers.get("authorization") || "").split(" ");
    if(scheme === "Basic") { const decoded=atob(encoded); if(decoded.slice(0,decoded.indexOf(":"))==="admin") supplied=decoded.slice(decoded.indexOf(":")+1); }
  } catch { /* reject malformed credentials */ }
  const hash = async (s:string) => new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([hash(supplied),hash(password)]);
  let mismatch=0; for(let i=0;i<a.length;i++) mismatch |= a[i]^b[i];
  if(!supplied || mismatch) return new NextResponse("需要登录",{status:401,headers:{"WWW-Authenticate":'Basic realm="ValueInsight", charset="UTF-8"',"Cache-Control":"no-store"}});
  if(!["GET","HEAD","OPTIONS"].includes(req.method)) {
    const origin=req.headers.get("origin");
    const allowed=[req.nextUrl.origin,...(process.env.CORS_ORIGIN || "").split(",").map(s=>s.trim())];
    if(origin && !allowed.includes(origin)) return NextResponse.json({error:"请求来源无效"},{status:403});
  }
  return await validateApiRequest(req)?NextResponse.next():NextResponse.json({error:"输入参数无效或超过限制"},{status:422});
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};
