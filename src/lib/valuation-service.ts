import "server-only";
import { prisma } from "./prisma";
import { calcDcf } from "./dcf";
import { calcRelativeValuation,calcHistoricalPercentiles,calcSensitivityHeatmap,crossValidate } from "./valuation-validation";
import { calculatePeerValuation } from "./peer-valuation-service";
import { assumptionsSchema,companySchema } from "./validation";

export async function validateCompany(companyId:string){
  const raw=await prisma.company.findUnique({where:{id:companyId}}),saved=await prisma.assumption.findUnique({where:{companyId}});
  const company=companySchema.parse(raw),a=assumptionsSchema.parse(saved);
  const { subject, peers, multiples, evidence: peerSelection } = await calculatePeerValuation({ ...company, id: companyId });
  const legacy=calcRelativeValuation(subject.marketCap,subject.e0,subject.revenue,subject.bookValue,peers);
  const output=calcDcf(a,company),absoluteValue=output.forward.adjustedEquityValue;
  const history=await prisma.historicalValuation.findMany({where:{companyId},orderBy:{year:"asc"}});
  const percentiles=calcHistoricalPercentiles({pe:legacy.currentPe,pb:legacy.currentPb,ps:legacy.currentPs},history);
  const check=crossValidate(absoluteValue,multiples.relativeValue??0);
  const heatmap=calcSensitivityHeatmap(a,company);
  const validation={companyId,absoluteValue,...legacy,...percentiles,relativeValue:multiples.relativeValue??0,...check,aiAttribution:null as string|null,sensitivityHeatmap:heatmap,multiples,hasHistory:history.length>0,peerSelection};
  const latest=await prisma.valuationReport.findFirst({where:{companyId},orderBy:{createdAt:"desc"}});
  if(latest && check.diffRate!==null){const {peers:unusedPeers,...core}=legacy;void unusedPeers;const data={...core,...percentiles,companyId,reportId:latest.id,absoluteValue,relativeValue:validation.relativeValue,diffRate:check.diffRate,conclusion:check.conclusion,sensitivityHeatmap:JSON.parse(JSON.stringify(heatmap)),aiAttribution:null};await prisma.validationResult.upsert({where:{reportId:latest.id},create:data,update:data});}
  if(latest){const key=`validation_details:${latest.id}`;await prisma.appSetting.upsert({where:{key},create:{key,value:JSON.stringify(validation)},update:{value:JSON.stringify(validation)}});}
  return {validation,peers:legacy.peers,hasHistory:history.length>0,aiEnabled:true,attributionPending:check.diffRate!==null&&check.diffRate>=20};
}
