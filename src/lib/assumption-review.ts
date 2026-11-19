import type { DcfAssumptions } from "@/types/dcf";
export function reviewAssumptions(a:DcfAssumptions,c:{marketCap:number;debt?:number;kd?:number;taxRate?:number}){
  const applicable=c.marketCap>0&&c.debt!==undefined&&c.debt>=0&&c.kd!==undefined&&c.taxRate!==undefined;
  const wacc=applicable?(a.ke*c.marketCap+c.kd!*(1-c.taxRate!)*c.debt!)/(c.marketCap+c.debt!):null;
  return {ke:a.ke,wacc,waccBasis:"用户输入Ke、债务账面值及市场股权权重；不是独立CAPM校准",discountBasis:"现有股东回报估值仍按Ke折现，WACC仅作资本结构诊断",growth:{g1:a.g1,g2:a.g2,g3:a.g3,perpetualG:a.perpetualG},terminalSpread:a.ke-a.perpetualG,requiresReview:a.ke<=a.perpetualG||a.g3<a.perpetualG,limitations:["缺少多期经营驱动与独立无风险利率/β证据，不自动生成新的数值假设"]};
}
