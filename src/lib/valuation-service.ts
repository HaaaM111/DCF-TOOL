import "server-only";
import { prisma } from "./prisma";
import { calcRelativeValuation,calcHistoricalPercentiles,calcSensitivityHeatmap,crossValidate } from "./valuation-validation";
import { calculatePeerValuation } from "./peer-valuation-service";
import { assumptionsSchema,companySchema } from "./validation";
import { getOperatingPublication, getOperatingRevision } from "./operating-model-store";
import { selectPrimaryValuation } from "./primary-valuation";
import { analyzeOperatingValuation } from "./operating-scenarios";

export async function validateCompany(companyId:string){
  const [raw, saved, snapshot, publication] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }), prisma.assumption.findUnique({ where: { companyId } }),
    prisma.companySnapshot.findUnique({ where: { companyId } }), getOperatingPublication(companyId),
  ]);
  const company=companySchema.parse(raw), assumptions=assumptionsSchema.safeParse(saved);
  const primary = selectPrimaryValuation({ ...company, targetPrice: snapshot?.targetPrice }, publication);
  const { subject, peers, multiples, evidence: peerSelection } = await calculatePeerValuation({ ...company, id: companyId });
  const legacy=calcRelativeValuation(subject.marketCap,subject.e0,subject.revenue,subject.bookValue,peers);
  const published = primary.kind === "operating" ? primary.publication : null;
  const absoluteValue = published && published.currency === peerSelection.currency ? published.equityValueUnits / 1e8 : null;
  const history=await prisma.historicalValuation.findMany({where:{companyId},orderBy:{year:"asc"}});
  const percentiles=calcHistoricalPercentiles({pe:legacy.currentPe,pb:legacy.currentPb,ps:legacy.currentPs},history);
  const aligned = published && !published.retrospective && published.valuationDate === peerSelection.quoteDate;
  const check=crossValidate(aligned ? absoluteValue ?? NaN : NaN,multiples.relativeValue??0);
  const input = published ? await getOperatingRevision(companyId, published.revision) : null;
  const heatmap = input ? analyzeOperatingValuation({ ...input, scenarios: { ...input.scenarios, simulation: undefined } }).heatmap
    .map(({ wacc, g, coherentPrice }) => ({ wacc, g, targetPrice: coherentPrice }))
    : primary.kind === "legacy" && assumptions.success ? calcSensitivityHeatmap(assumptions.data, company) : [];
  const validation={companyId,absoluteValue,...legacy,...percentiles,relativeValue:multiples.relativeValue??0,...check,
    aiAttribution:null as string|null,sensitivityHeatmap:heatmap,sensitivityRate:input ? "WACC" : "Ke",
    sensitivityCurrency:input?.currency ?? "CNY",primaryValuation:primary,multiples,hasHistory:history.length>0,peerSelection};
  const latest=await prisma.valuationReport.findFirst({where:{companyId},orderBy:{createdAt:"desc"}});
  if(latest && absoluteValue!==null && check.diffRate!==null){const {peers:unusedPeers,...core}=legacy;void unusedPeers;const data={...core,...percentiles,companyId,reportId:latest.id,absoluteValue,relativeValue:validation.relativeValue,diffRate:check.diffRate,conclusion:check.conclusion,sensitivityHeatmap:JSON.parse(JSON.stringify(heatmap)),aiAttribution:null};await prisma.validationResult.upsert({where:{reportId:latest.id},create:data,update:data});}
  if(latest){const key=`validation_details:${latest.id}`;await prisma.appSetting.upsert({where:{key},create:{key,value:JSON.stringify(validation)},update:{value:JSON.stringify(validation)}});}
  return {validation,peers:legacy.peers,hasHistory:history.length>0,aiEnabled:true,attributionPending:check.diffRate!==null&&check.diffRate>=20};
}
