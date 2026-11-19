import { z } from "zod";
import { NextRequest } from "next/server";
const querySchema=z.record(z.string().max(80),z.string().max(2000));
const jsonSchema=z.json();
export async function validateApiRequest(req:NextRequest):Promise<boolean>{
  if(!req.nextUrl.pathname.startsWith("/api/"))return true;
  const path=z.array(z.string().max(100).regex(/^[A-Za-z0-9_.-]+$/)).max(12);
  if(!path.safeParse(req.nextUrl.pathname.split("/").filter(Boolean)).success)return false;
  if(!querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams)).success)return false;
  for(const [key,max] of [["days",3650],["page",100000],["pageSize",100]] as const){const v=req.nextUrl.searchParams.get(key);if(v!==null&&!z.coerce.number().int().min(1).max(max).safeParse(v).success)return false;}
  if(["GET","HEAD","OPTIONS"].includes(req.method)||!req.body)return true;
  if(Number(req.headers.get("content-length")||0)>1024*1024)return false;
  const reader=req.clone().body?.getReader();if(!reader)return true;
  let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1024*1024)return false;chunks.push(value);}}finally{void reader.cancel();}
  if(!length)return true;
  try{
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    // Bound depth and collections before recursive schema validation.
    const bounded=(v:unknown,depth=0):boolean=>{if(depth>12)return false;if(typeof v==="string")return v.length<=20000;if(Array.isArray(v))return v.length<=5000&&v.every(x=>bounded(x,depth+1));if(v&&typeof v==="object")return Object.entries(v).length<=200&&Object.entries(v).every(([k,x])=>!["__proto__","prototype","constructor"].includes(k)&&k.length<=100&&bounded(x,depth+1));return true;};
    return bounded(data)&&jsonSchema.safeParse(data).success;
  }catch{return false;}
}
