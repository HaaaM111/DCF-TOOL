/** Restrict numeric claims to observed values (including display rounding and percentages). */
export function groundedText(text:string,evidence:unknown[]):string{
  const allowed=new Set<string>();
  const add=(n:number)=>{if(!Number.isFinite(n))return;for(const x of [n,n*100])for(let d=0;d<=6;d++)allowed.add(String(Number(x.toFixed(d))));};
  const walk=(v:unknown)=>{if(typeof v==="number")add(v);else if(typeof v==="string")Array.from(v.matchAll(/-?\d+(?:\.\d+)?/g)).forEach(m=>allowed.add(String(Number(m[0]))));else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==="object")Object.values(v).forEach(walk);};
  evidence.forEach(walk);
  return text.replace(/-?\d+(?:\.\d+)?/g,n=>allowed.has(String(Number(n)))?n:"［数值待核验］");
}
