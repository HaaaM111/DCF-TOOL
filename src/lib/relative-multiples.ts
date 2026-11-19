/** Pure deterministic comparable engine. All monetary inputs share currency, period and units. */
export interface Comparable {ticker:string;name:string;marketCap:number;e0:number;revenue:number;bookValue:number;netCash?:number;ebit?:number;ebitda?:number}
export const median=(values:number[])=>{const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};
const ratio=(a:number|undefined,b:number|undefined)=>a!==undefined&&b!==undefined&&Number.isFinite(a)&&Number.isFinite(b)&&a>0&&b>0?a/b:null;
export function compareMultiples(subject:Comparable,peers:Comparable[]){
  const ev=(p:Comparable)=>p.netCash===undefined?undefined:p.marketCap-p.netCash;
  const specs=[
    {name:"P/E",den:(p:Comparable)=>p.e0,numerator:(p:Comparable)=>p.marketCap,enterprise:false},
    {name:"P/B",den:(p:Comparable)=>p.bookValue,numerator:(p:Comparable)=>p.marketCap,enterprise:false},
    {name:"P/S",den:(p:Comparable)=>p.revenue,numerator:(p:Comparable)=>p.marketCap,enterprise:false},
    {name:"EV/Revenue",den:(p:Comparable)=>p.revenue,numerator:ev,enterprise:true},
    {name:"EV/EBITDA",den:(p:Comparable)=>p.ebitda,numerator:ev,enterprise:true},
    {name:"EV/EBIT",den:(p:Comparable)=>p.ebit,numerator:ev,enterprise:true},
  ];
  const methods=specs.map(m=>{
    const values=peers.filter(p=>p.ticker!==subject.ticker).map(p=>ratio(m.numerator(p),m.den(p))).filter((v):v is number=>v!==null);
    const med=median(values),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,den=m.den(subject);
    const available=values.length>=3&&med!==null&&den!==undefined&&den>0&&(!m.enterprise||subject.netCash!==undefined);
    const bridge=m.enterprise?(subject.netCash??0):0;
    return {name:m.name,count:values.length,mean,median:med,current:ratio(m.numerator(subject),den),equityValue:available?med!*den!+bridge:null,meanEquityValue:available?mean!*den!+bridge:null,status:available?"available":"insufficient_data",reason:available?null:"需至少三家有效同行及同口径财务字段；缺失值不按零处理"};
  });
  const valid=methods.map(m=>m.equityValue).filter((v):v is number=>v!==null);
  return {methods,relativeValue:median(valid),meanValue:valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null,status:valid.length?"available":"insufficient_data",primaryBasis:"peer_median" as const};
}
