import { z } from "zod";
import { calcForwardDcf } from "./dcf";
import { seededRandom as rng, standardNormal as normal, summarizePrices } from "./simulation-statistics";
import type { CompanyBasics,DcfAssumptions,MonteCarloResult } from "@/types/dcf";
export const jumpSchema=z.object({enabled:z.boolean().default(false),lambda:z.number().min(0).max(5).default(0.1),mean:z.number().min(-2).max(1).default(-0.2),std:z.number().min(0).max(1).default(0.1)});
export const simulationConfigSchema=z.object({samples:z.number().int().min(100).max(20000).default(3000),seed:z.number().int().min(0).max(4294967295).default(42),jump:jumpSchema.optional()});
function poisson(r:()=>number,lambda:number){const l=Math.exp(-lambda);let k=0,p=1;do{k++;p*=r();}while(p>l);return k-1;}
function summary(prices:number[],currentPrice:number):MonteCarloResult{
  const stats = summarizePrices(prices);
  if (!stats) throw Error("没有有效模拟样本");
  return {...stats,pricePercentile:prices.filter(p=>p<=currentPrice).length/stats.samples*100};
}
/** Annual compound-Poisson log cash-flow shocks. Uncompensated stress scenario, not a calibrated price process. */
export function simulateWithJumps(a:DcfAssumptions,b:CompanyBasics,raw:unknown):MonteCarloResult{
  const config=simulationConfigSchema.parse(raw),r=rng(config.seed),jr=rng(config.seed^0xdeadbeef);
  const base:number[]=[],jump:number[]=[];let rejected=0;
  for(let i=0;i<config.samples;i++){
    const sampled={...a,g1:a.g1+normal(r)*Math.max(.005,Math.abs(a.g1)*.3),g2:a.g2+normal(r)*Math.max(.005,Math.abs(a.g2)*.3),g3:a.g3+normal(r)*Math.max(.005,Math.abs(a.g3)*.3),perpetualG:a.perpetualG+normal(r)*Math.max(.003,Math.abs(a.perpetualG)*.3),ke:a.ke+normal(r)*.015};
    if(sampled.ke<=sampled.perpetualG+.001||sampled.ke<=0||Math.min(sampled.g1,sampled.g2,sampled.g3)<=-1){rejected++;continue;}
    const value=calcForwardDcf(sampled,b).adjustedTargetPrice;
    const shocks=Array.from({length:20},()=>{if(!config.jump?.enabled||config.jump.lambda===0)return 1;const n=poisson(jr,config.jump.lambda);let sum=0;for(let j=0;j<n;j++)sum+=config.jump.mean+config.jump.std*normal(jr);return Math.exp(sum);});
    const shocked=calcForwardDcf(sampled,b,{cashFlowMultipliers:shocks}).adjustedTargetPrice;
    if(!Number.isFinite(value)||!Number.isFinite(shocked)){rejected++;continue;}base.push(value);jump.push(shocked);
  }
  const bs=summary(base,b.currentPrice),js=summary(jump,b.currentPrice);
  return {...(config.jump?.enabled?js:bs),base:{p5:bs.p5,p95:bs.p95,median:bs.median},...(config.jump?.enabled?{jump:{p5:js.p5,p95:js.p95,median:js.median}}:{}),seed:config.seed,rejected};
}
