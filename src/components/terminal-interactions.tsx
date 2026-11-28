"use client";
import {useEffect} from "react";
/** Damped spring driven by time steps, with reduced-motion support. */
export default function TerminalInteractions(){
  useEffect(()=>{
    if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const motions=new Map<HTMLElement,{y:number;v:number;target:number}>();let raf=0,last=0;
    const tick=(time:number)=>{const dt=Math.min((time-last)/1000||1/60,.025);last=time;let moving=false;
      motions.forEach((m,el)=>{m.v+=(-240*(m.y-m.target)-24*m.v)*dt;m.y+=m.v*dt;el.style.transform=`translateY(${m.y}px)`;if(Math.abs(m.y-m.target)+Math.abs(m.v)>.01)moving=true;else if(m.target===0){el.style.transform="";motions.delete(el);}});
      raf=moving?requestAnimationFrame(tick):0;
    };
    const start=(event:PointerEvent,target:number)=>{const el=(event.target as HTMLElement).closest<HTMLElement>(".terminal-kpis .ant-card,.fin-card");if(!el||event.relatedTarget instanceof Node&&el.contains(event.relatedTarget))return;const m=motions.get(el)||{y:0,v:0,target:0};m.target=target;motions.set(el,m);if(!raf){last=performance.now();raf=requestAnimationFrame(tick);}};
    const enter=(e:PointerEvent)=>start(e,-2),leave=(e:PointerEvent)=>start(e,0);
    document.addEventListener("pointerover",enter);document.addEventListener("pointerout",leave);
    return()=>{cancelAnimationFrame(raf);document.removeEventListener("pointerover",enter);document.removeEventListener("pointerout",leave);motions.forEach((_,el)=>el.style.transform="");};
  },[]);return null;
}
