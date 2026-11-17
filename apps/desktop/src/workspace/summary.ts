import type { TaskOwner } from '../tasks/client';
export type WorkspaceSummary={total:number;completed:number;overdue:number;today:number;upcoming:number;unscheduled:number;activeProjects:number;pausedProjects:number;doneProjects:number;todayEvents:number};
export const dayKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function summaryDates(){const now=new Date(),future=new Date(now);future.setDate(now.getDate()+7);return {today:dayKey(now),week:dayKey(future)}}
export async function workspaceSummary(owner:TaskOwner):Promise<WorkspaceSummary>{
 const bridge=window.__TAURI__?.core.invoke;if(!bridge)throw new Error('Windows uygulamasını aç.');
 let value:unknown;try{value=await bridge('workspace_summary',{owner,...summaryDates()})}catch{throw new Error('Çalışma alanı özeti okunamadı.')}
 if(typeof value!=='object'||value===null)throw new Error('Özet yanıtı okunamadı.');
 const v=value as Record<string,unknown>;
 if(!['total','completed','overdue','today','upcoming','unscheduled','activeProjects','pausedProjects','doneProjects','todayEvents'].every(k=>Number.isSafeInteger(v[k])&&Number(v[k])>=0)||Number(v.completed)>Number(v.total))throw new Error('Özet yanıtı okunamadı.');
 return v as WorkspaceSummary;
}
