import test from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV3,simulateReadableStream } from "ai/test";
import { streamText,stepCountIs,tool,createUIMessageStream,readUIMessageStream } from "ai";
import { z } from "zod";
const usage={inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
test("SDK stops repeating tool requests at the configured five rounds",async()=>{
  let calls=0,executions=0;
  const model=new MockLanguageModelV3({doStream:async()=>({stream:simulateReadableStream({chunks:[{type:"stream-start" as const,warnings:[]},{type:"tool-call" as const,toolCallId:`c${++calls}`,toolName:"calculate",input:"{}"},{type:"finish" as const,finishReason:{unified:"tool-calls" as const,raw:undefined},usage}],chunkDelayInMs:null})})});
  const result=streamText({model,prompt:"计算",tools:{calculate:tool({description:"test",inputSchema:z.object({}),execute:async()=>{executions++;return {price:12};}})},stopWhen:stepCountIs(5),maxRetries:0});
  for await(const part of result.fullStream){if(part.type==="error")throw part.error;}
  assert.equal(calls,5);assert.equal(executions,5);
});
test("SDK pairs multiple tool calls with matching results before interpretation",async()=>{
  let turn=0;
  const model=new MockLanguageModelV3({doStream:async(options)=>{
    if(turn++===0)return {stream:simulateReadableStream({chunks:[{type:"stream-start" as const,warnings:[]},{type:"tool-call" as const,toolCallId:"a",toolName:"compute",input:'{"n":1}'},{type:"tool-call" as const,toolCallId:"b",toolName:"compute",input:'{"n":2}'},{type:"finish" as const,finishReason:{unified:"tool-calls" as const,raw:undefined},usage}],chunkDelayInMs:null})};
    const toolMessages=options.prompt.filter(m=>m.role==="tool");assert.equal(toolMessages.flatMap(m=>m.content).length,2);
    return {stream:simulateReadableStream({chunks:[{type:"stream-start" as const,warnings:[]},{type:"text-start" as const,id:"text"},{type:"text-delta" as const,id:"text",delta:"计算完成"},{type:"text-end" as const,id:"text"},{type:"finish" as const,finishReason:{unified:"stop" as const,raw:undefined},usage}],chunkDelayInMs:null})};
  }});
  const result=streamText({model,prompt:"test",tools:{compute:tool({description:"test",inputSchema:z.object({n:z.number()}),execute:async({n})=>({n})})},stopWhen:stepCountIs(5),maxRetries:0});
  for await(const part of result.fullStream){if(part.type==="error")throw part.error;}assert.equal(await result.text,"计算完成");assert.equal(turn,2);
});
test("front-end AI SDK reader accepts tool status plus text stream",async()=>{
  const stream=createUIMessageStream({execute:({writer})=>{writer.write({type:"data-status",data:{label:"正在计算DCF"},transient:true});writer.write({type:"text-start",id:"r"});writer.write({type:"text-delta",id:"r",delta:"真实工具结果"});writer.write({type:"text-end",id:"r"});}});
  let text="";for await(const message of readUIMessageStream({stream}))text=message.parts.filter(p=>p.type==="text").map(p=>p.text).join("");assert.equal(text,"真实工具结果");
});
