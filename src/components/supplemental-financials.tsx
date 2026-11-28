"use client";
import { useEffect,useState } from "react";
import { Card,InputNumber,Input,Button,App,Alert } from "antd";
export default function SupplementalFinancials({companyId}:{companyId?:string}){
  const {message}=App.useApp();const [ebit,setEbit]=useState<number|null>(null),[ebitda,setEbitda]=useState<number|null>(null),[period,setPeriod]=useState(""),[source,setSource]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{if(!companyId)return;const c=new AbortController();fetch(`/api/companies/${companyId}/metrics`,{signal:c.signal}).then(r=>r.json()).then(({metrics:m})=>{if(m){setEbit(m.ebit);setEbitda(m.ebitda);setPeriod(m.period);setSource(m.source);}}).catch(()=>{});return()=>c.abort();},[companyId]);
  if(!companyId)return null;
  async function save(){setSaving(true);try{const res=await fetch(`/api/companies/${companyId}/metrics`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ebit,ebitda,period,source,currency:"CNY",unit:"亿元"})});if(!res.ok)throw Error();message.success("补充财务指标已保存");}catch{message.error("请检查指标、来源及报告期（例如2025-FY或2026-TTM）");}finally{setSaving(false);}}
  return <Card title="可比估值补充指标" className="mb-4"><Alert type="info" title="EBIT/EBITDA 必须来自可核验财报，统一人民币亿元；同业报告期需一致。留空表示缺失。" showIcon/><div className="metrics-form"><label>EBIT<InputNumber value={ebit} onChange={setEbit}/></label><label>EBITDA<InputNumber value={ebitda} onChange={setEbitda}/></label><label>报告期<Input value={period} onChange={e=>setPeriod(e.target.value)} placeholder="2025-FY"/></label><label>来源/页码<Input value={source} onChange={e=>setSource(e.target.value)} maxLength={500}/></label><Button onClick={save} loading={saving}>保存补充指标</Button></div></Card>;
}
