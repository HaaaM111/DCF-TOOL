/** Compatibility entry: all callers share the corrected paired simulation engine. */
import { simulateWithJumps } from "./jump-simulation";
import type { CompanyBasics,DcfAssumptions } from "@/types/dcf";
export type { MonteCarloResult } from "@/types/dcf";
export interface MonteCarloConfig {samples:number;seed?:number;jump?:{enabled?:boolean;lambda?:number;mean?:number;std?:number}}
export function runMonteCarlo(a:DcfAssumptions,b:CompanyBasics,config:MonteCarloConfig={samples:10000}){return simulateWithJumps(a,b,config);}
