import "server-only";
import { prisma } from "./prisma";
import { calcDcf } from "./dcf";
import { calcRelativeValuation,calcHistoricalPercentiles,calcSensitivityHeatmap,crossValidate } from "./valuation-validation";
import { compareMultiples,type Comparable } from "./relative-multiples";
import { readMetrics } from "./financial-metrics";
import { assumptionsSchema,companySchema } from "./validation";
import { resolveCompanyData } from "./data-source";
import { getIndustryPeers } from "./ifind-client";

export async function validateCompany(companyId:string){
  const raw=await prisma.company.findUnique({where:{id:companyId}}),saved=await prisma.assumption.findUnique({where:{companyId}});
  const company=companySchema.parse(raw),a=assumptionsSchema.parse(saved),ownMetrics=await readMetrics(companyId);
  const local=company.industry?await prisma.company.findMany({where:{industry:company.industry,id:{not:companyId}},take:20}):[];
  const warnings=["同行必须在币种、报告期和会计口径上可比；已保存输入仍需人工复核。"],excluded:string[]=[];
  const peers:Comparable[]=await Promise.all(local.map(async p=>{const m=await readMetrics(p.id);const aligned=ownMetrics&&m?.period===ownMetrics.period;return {...p,ebit:aligned?m?.ebit??undefined:undefined,ebitda:aligned?m?.ebitda??undefined:undefined};}));
  if(peers.length<3&&company.industry){
    const tickers=getIndustryPeers(company.industry,company.ticker).filter(p=>!peers.some(x=>x.ticker===p.ticker)).slice(0,6);
    // Bounded batches preserve upstream capacity; mock data never enters formal comparisons.
    for(let i=0;i<tickers.length;i+=3){const batch=await Promise.allSettled(tickers.slice(i,i+3).map(async p=>{const result=await resolveCompanyData(p.ticker);if(result.source==="mock"||result.data.incomplete){excluded.push(p.ticker);return;}peers.push({...result.data,marketCap:result.data.marketCap});}));batch.forEach((r,j)=>{if(r.status==="rejected")excluded.push(tickers[i+j].ticker);});}
  }
  const subject={...company,ticker:company.ticker,ebit:ownMetrics?.ebit??undefined,ebitda:ownMetrics?.ebitda??undefined};
  const multiples=compareMultiples(subject,peers),legacy=calcRelativeValuation(company.marketCap,company.e0,company.revenue,company.bookValue,peers);
  const output=calcDcf(a,company),absoluteValue=output.forward.adjustedEquityValue;
  const history=await prisma.historicalValuation.findMany({where:{companyId},orderBy:{year:"asc"}});
  const percentiles=calcHistoricalPercentiles({pe:legacy.currentPe,pb:legacy.currentPb,ps:legacy.currentPs},history);
  const check=crossValidate(absoluteValue,multiples.relativeValue??0);
  const heatmap=calcSensitivityHeatmap(a,company);
  const validation={companyId,absoluteValue,...legacy,...percentiles,relativeValue:multiples.relativeValue??0,...check,aiAttribution:null as string|null,sensitivityHeatmap:heatmap,multiples,hasHistory:history.length>0,warnings,excluded};
  const latest=await prisma.valuationReport.findFirst({where:{companyId},orderBy:{createdAt:"desc"}});
  if(latest && check.diffRate!==null){const {peers:unusedPeers,...core}=legacy;void unusedPeers;const data={...core,...percentiles,companyId,reportId:latest.id,absoluteValue,relativeValue:validation.relativeValue,diffRate:check.diffRate,conclusion:check.conclusion,sensitivityHeatmap:JSON.parse(JSON.stringify(heatmap)),aiAttribution:null};await prisma.validationResult.upsert({where:{reportId:latest.id},create:data,update:data});}
  if(latest){const key=`validation_details:${latest.id}`;await prisma.appSetting.upsert({where:{key},create:{key,value:JSON.stringify(validation)},update:{value:JSON.stringify(validation)}});}
  return {validation,peers:legacy.peers,hasHistory:history.length>0,aiEnabled:true,attributionPending:check.diffRate!==null&&check.diffRate>=20};
}
