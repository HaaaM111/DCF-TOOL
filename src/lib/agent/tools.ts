import { reviewAssumptions } from "@/lib/assumption-review";
import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { calcDcf } from "@/lib/dcf";
import { simulateWithJumps,simulationConfigSchema } from "@/lib/jump-simulation";
import { calcSensitivityHeatmap } from "@/lib/valuation-validation";
import { compareMultiples,type Comparable } from "@/lib/relative-multiples";
import { syncCompanyAnnouncements } from "@/lib/announcement/sync-service";
import { analyzeCompanyAnnouncements } from "@/lib/announcement/analyze-service";
import { parseFinancialDocument } from "./document-tool";
import type { LlmConfig } from "@/lib/ai-client";
import type { DcfAssumptions,CompanyBasics } from "@/types/dcf";
export interface ToolContext {companyId:string;assumptions:DcfAssumptions;company:CompanyBasics&Comparable&{debt?:number;kd?:number;taxRate?:number};peers:Comparable[];cfg:LlmConfig;signal:AbortSignal;announcements:unknown[]}
export function createValuationTools(ctx:ToolContext,observe:(name:string,result:unknown)=>void,status:(text:string)=>void){
  const execute=<T>(name:string,label:string,fn:(args:T)=>Promise<unknown>|unknown)=>async(args:T)=>{
    ctx.signal.throwIfAborted();status(label);
    try{const result=await fn(args);ctx.signal.throwIfAborted();observe(name,result);return result;}catch{const result={status:"error",message:"工具执行失败或数据不可用，请检查参数与服务配置"};observe(name,result);return result;}
  };
  return {
    get_financial_context:tool({description:"读取当前公司已保存财务数据、假设和公告。所有数值解读必须有该工具或计算工具证据。",inputSchema:z.object({}).strict(),execute:execute("get_financial_context","读取已保存财务数据…",()=>({company:ctx.company,assumptions:ctx.assumptions,announcements:ctx.announcements,review:reviewAssumptions(ctx.assumptions,ctx.company),source:"用户保存数据；不等于已审计财报",discountBasis:"股权回报模型使用Ke，兼容wacc字段不代表独立CAPM估计"}))}),
    calculate_dcf:tool({description:"确定性TS估值：使用已保存假设计算正向/逆向DCF和ExitPE镜像警示，模型不能自行更改参数。",inputSchema:z.object({}).strict(),execute:execute("calculate_dcf","正在计算 DCF…",()=>calcDcf(ctx.assumptions,ctx.company))}),
    relative_valuation:tool({description:"对已保存同行计算PE/PB/PS与EV/Revenue、EV/EBITDA、EV/EBIT，同时返回均值和中位数。缺字段明确不可用。",inputSchema:z.object({}).strict(),execute:execute("relative_valuation","正在交叉验证同行倍数…",()=>compareMultiples(ctx.company,ctx.peers))}),
    monte_carlo:tool({description:"运行确定性种子的蒙特卡洛，可选逐年泊松现金流跳跃，比较基础和含跳跃P5/P95。参数是用户指定压力情景，不是经市场校准概率。",inputSchema:simulationConfigSchema,execute:execute("monte_carlo","正在运行蒙特卡洛模拟…",args=>simulateWithJumps(ctx.assumptions,ctx.company,args))}),
    sensitivity_analysis:tool({description:"计算Ke×永续g敏感性网格及折现率/ExitPE/g的一维隐含利润切片。",inputSchema:z.object({}).strict(),execute:execute("sensitivity_analysis","正在计算敏感性…",()=>({heatmap:calcSensitivityHeatmap(ctx.assumptions,ctx.company),slices:calcDcf(ctx.assumptions,ctx.company).sensitivity}))}),
    parse_financial_document:tool({description:"实验性：解析受信任HTTPS PDF/图片URL，以视觉模型提取带页码、单位、证据的财务字段。必须人工核对后使用。",inputSchema:z.object({url:z.string().url().max(2000)}).strict(),execute:execute<{url:string}>("parse_financial_document","正在实验性解析财报…",args=>parseFinancialDocument(args.url,ctx.cfg,ctx.signal))}),
    sync_announcements:tool({description:"仅在用户明确要求同步/拉取公告时采集入库。",inputSchema:z.object({days:z.number().int().min(1).max(90).default(30)}).strict(),execute:execute<{days:number}>("sync_announcements","正在同步公告…",args=>syncCompanyAnnouncements(ctx.companyId,args.days))}),
    analyze_announcements:tool({description:"仅在用户要求分析公告时，分析已存公告，生成信号，不修改估值假设。",inputSchema:z.object({announcementIds:z.array(z.string().max(100)).max(20).optional()}).strict(),execute:execute<{announcementIds?:string[]}>("analyze_announcements","正在分析公告信号…",args=>analyzeCompanyAnnouncements(ctx.companyId,{...args,config:ctx.cfg,signal:ctx.signal}))}),
  };
}
