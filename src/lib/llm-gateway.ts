import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { safeRemoteFetch, validateRemoteUrl } from "@/lib/security/urls";
export interface ToolCall { id:string; type:"function"; function:{name:string;arguments:string} }
export interface ToolDef { type:"function"; function:{name:string;description:string;parameters:unknown} }
export interface ChatMessage { role:"system"|"user"|"assistant"|"tool"; content?:string|null;tool_call_id?:string;tool_calls?:ToolCall[] }
export interface LlmConfig {baseUrl:string;apiKey:string;model:string;thinking?:"disabled"|"auto"|"enabled"}
export interface ChatResult {content:string|null;toolCalls:ToolCall[]}
export const SERVICE_UNAVAILABLE="分析服务暂时不可用，请稍后重试";
export function llmTimeoutMs(){const n=Number(process.env.LLM_TIMEOUT_MS);return Number.isFinite(n)&&n>=1000&&n<=120000?n:30000;}
export function getLlmConfigFromEnv():Partial<LlmConfig>{return {
  baseUrl:process.env.LLM_BASE_URL||process.env.DEEPSEEK_BASE_URL,
  apiKey:process.env.LLM_API_KEY||process.env.DEEPSEEK_API_KEY,
  model:process.env.LLM_MODEL_NAME||process.env.LLM_MODEL||process.env.DEEPSEEK_MODEL,
  thinking:process.env.LLM_THINKING as LlmConfig["thinking"],
};}
export function resolveLlmConfig(db?:Partial<LlmConfig>|null):LlmConfig|null {
  const env=getLlmConfigFromEnv();
  // Pick credentials and endpoint together: never send an env key to a DB URL.
  const source=env.apiKey?env:db;
  if(!source?.apiKey)return null;
  const baseUrl=(source.baseUrl||"https://maas-api.cn-huabei-1.xf-yun.com/v2").replace(/\/+$/,"");
  validateRemoteUrl(baseUrl);
  return {baseUrl,apiKey:source.apiKey,model:source.model||"spark-x2.6-4b",thinking:source.thinking||(/xf-yun\.com/.test(baseUrl)?"disabled":undefined)};
}
export function llmReady(db?:Partial<LlmConfig>|null){try{return !!resolveLlmConfig(db);}catch{return false;}}
export function hasDeepSeekCredentials(){return !!(process.env.LLM_API_KEY||process.env.DEEPSEEK_API_KEY);}
export function sanitizeAiText(text:string){return text.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<iframe[\s\S]*?<\/iframe>/gi,"").replace(/javascript:/gi,"").trim();}
export function createLlmModel(cfg:LlmConfig){
  const provider=createOpenAICompatible({name:"valuation",baseURL:cfg.baseUrl.replace(/\/chat\/completions$/,""),apiKey:cfg.apiKey,
    fetch:async(input,init)=>{
      const body=typeof init?.body==="string"?JSON.parse(init.body):undefined;
      if(body&&cfg.thinking)body.thinking={type:cfg.thinking};
      const signal=init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(llmTimeoutMs())]):AbortSignal.timeout(llmTimeoutMs());
      return safeRemoteFetch(input,{...init,signal,body:body?JSON.stringify(body):init?.body});
    }});
  return provider.chatModel(cfg.model);
}
export async function chatCompletion(opts:{config?:Partial<LlmConfig>|null;messages:ChatMessage[];temperature?:number;maxTokens?:number;tools?:ToolDef[];signal?:AbortSignal}):Promise<ChatResult|null>{
  const cfg=resolveLlmConfig(opts.config);if(!cfg)return null;
  const endpoint=cfg.baseUrl.endsWith("/chat/completions")?cfg.baseUrl:`${cfg.baseUrl}/chat/completions`;
  try {
    const res=await safeRemoteFetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${cfg.apiKey}`},signal:opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(llmTimeoutMs())]):AbortSignal.timeout(llmTimeoutMs()),
      body:JSON.stringify({model:cfg.model,messages:opts.messages,temperature:opts.temperature??0.2,max_tokens:opts.maxTokens??1500,...(cfg.thinking?{thinking:{type:cfg.thinking}}:{}),...(opts.tools?.length?{tools:opts.tools,tool_choice:"auto"}:{})})});
    if(!res.ok)throw new Error(SERVICE_UNAVAILABLE);
    const data=await res.json();const message=data.choices?.[0]?.message;
    return {content:typeof message?.content==="string"?sanitizeAiText(message.content):null,toolCalls:Array.isArray(message?.tool_calls)?message.tool_calls:[]};
  }catch{throw new Error(SERVICE_UNAVAILABLE);}
}
export async function chatWithDeepSeek(systemPrompt:string,userPrompt:string):Promise<string|null>{
  try{return (await chatCompletion({messages:[{role:"system",content:systemPrompt},{role:"user",content:userPrompt}]}))?.content??null;}catch{return null;}
}
