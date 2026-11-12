import { reviewAssumptions } from "@/lib/assumption-review";
import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { calcDcf } from "@/lib/dcf";
import { simulateWithJumps,simulationConfigSchema } from "@/lib/jump-simulation";
import { calcSensitivityHeatmap } from "@/lib/valuation-validation";
import type { Comparable } from "@/lib/relative-multiples";
import type { calculatePeerValuation } from "@/lib/peer-valuation-service";
import { syncCompanyAnnouncements } from "@/lib/announcement/sync-service";
import { analyzeCompanyAnnouncements } from "@/lib/announcement/analyze-service";
import { parseFinancialDocument } from "./document-tool";
import type { LlmConfig } from "@/lib/ai-client";
import type { DcfAssumptions,CompanyBasics } from "@/types/dcf";
import { analyzeOperatingValuation, type OperatingAnalysisInput } from "@/lib/operating-scenarios";
import { calculateOperatingValuation } from "@/lib/operating-valuation";
import type { PrimaryValuation } from "@/lib/primary-valuation";
export interface ToolContext {companyId:string;assumptions:DcfAssumptions|null;primary:PrimaryValuation;operatingInput:OperatingAnalysisInput|null;company:CompanyBasics&Comparable&{debt?:number;kd?:number;taxRate?:number};peerValuation:()=>ReturnType<typeof calculatePeerValuation>;cfg:LlmConfig;signal:AbortSignal;announcements:unknown[]}
export function createValuationTools(ctx:ToolContext,observe:(name:string,result:unknown)=>void,status:(text:string)=>void){
  const legacy = ctx.primary.kind === "legacy" ? ctx.assumptions : null;
  const operating = ctx.operatingInput;
  const unavailable = { status: "insufficient_data", message: "缺少可用于此计算的已核验底稿或假设" };
  const execute=<T>(name:string,label:string,fn:(args:T)=>Promise<unknown>|unknown)=>async(args:T)=>{
    ctx.signal.throwIfAborted();status(label);
    try{const result=await fn(args);ctx.signal.throwIfAborted();observe(name,result);return result;}catch{const result={status:"error",message:"工具执行失败或数据不可用，请检查参数与服务配置"};observe(name,result);return result;}
  };
  return {
    get_financial_context:tool({description:"读取公司财务数据、已发布估值、来源和公告。数值解读须引用工具证据。",inputSchema:z.object({}).strict(),execute:execute("get_financial_context","读取已保存财务数据…",()=>({company:ctx.company,primary:ctx.primary,announcements:ctx.announcements,review:legacy?reviewAssumptions(legacy,ctx.company):null}))}),
    calculate_dcf:tool({description:"读取主估值口径。已发布经营底稿用于 FCFF、ReOI 与 AOIG 勾稽，简化模型仅作参考。",inputSchema:z.object({}).strict(),execute:execute("calculate_dcf","正在计算 DCF…",()=>{
      if (operating) {
        const result=calculateOperatingValuation(operating);
        return {primary:ctx.primary,prices:result.prices,bridge:result.bridge,terminal:result.terminal,reconciliation:result.reconciliation};
      }
      return legacy ? { primary: ctx.primary, legacy: calcDcf(legacy,ctx.company) } : { ...unavailable, primary: ctx.primary };
    })}),
    relative_valuation:tool({description:"按同行筛选依据、同日收盘价和同一年度财报计算PE/PB/PS及可用EV倍数，返回均值、中位数、来源与剔除原因。",inputSchema:z.object({}).strict(),execute:execute("relative_valuation","正在交叉验证同行倍数…",async()=>{const {multiples,evidence}=await ctx.peerValuation();return {...multiples,evidence};})}),
    monte_carlo:tool({description:"按已发布经营底稿的配置复放蒙特卡洛。泊松跳跃仅用于简化股东回报模型。",inputSchema:simulationConfigSchema,execute:execute("monte_carlo","正在运行蒙特卡洛模拟…",args=>operating
      ? analyzeOperatingValuation(operating).simulation ?? unavailable : legacy ? simulateWithJumps(legacy,ctx.company,args) : unavailable)}),
    sensitivity_analysis:tool({description:"计算主估值口径的折现率与永续增长率敏感性网格。",inputSchema:z.object({}).strict(),execute:execute("sensitivity_analysis","正在计算敏感性…",()=>operating
      ? {heatmap:analyzeOperatingValuation({...operating,scenarios:{...operating.scenarios,simulation:undefined}}).heatmap,discountRate:"WACC"}
      : legacy ? {heatmap:calcSensitivityHeatmap(legacy,ctx.company),slices:calcDcf(legacy,ctx.company).sensitivity,discountRate:"Ke"} : unavailable)}),
    parse_financial_document:tool({description:"实验性：解析受信任HTTPS PDF/图片URL，以视觉模型提取带页码、单位、证据的财务字段。必须人工核对后使用。",inputSchema:z.object({url:z.string().url().max(2000)}).strict(),execute:execute<{url:string}>("parse_financial_document","正在实验性解析财报…",args=>parseFinancialDocument(args.url,ctx.cfg,ctx.signal))}),
    sync_announcements:tool({description:"仅在用户明确要求同步/拉取公告时采集入库。",inputSchema:z.object({days:z.number().int().min(1).max(90).default(30)}).strict(),execute:execute<{days:number}>("sync_announcements","正在同步公告…",args=>syncCompanyAnnouncements(ctx.companyId,args.days))}),
    analyze_announcements:tool({description:"仅在用户要求分析公告时，分析已存公告，生成信号，不修改估值假设。",inputSchema:z.object({announcementIds:z.array(z.string().max(100)).max(20).optional()}).strict(),execute:execute<{announcementIds?:string[]}>("analyze_announcements","正在分析公告信号…",args=>analyzeCompanyAnnouncements(ctx.companyId,{...args,config:ctx.cfg,signal:ctx.signal}))}),
  };
}
