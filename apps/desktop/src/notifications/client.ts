import type { TaskOwner } from '../tasks/client';
export type Reminder={kind:'task'|'event'|'goal';id:string;title:string;due:string;time:string;isRead:boolean;snoozedUntil:string|null};
export type ReminderPage={items:Reminder[];total:number;unread:number;hasMore:boolean};
export function dateOffset(days=0){const d=new Date();d.setDate(d.getDate()+days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export const route=(item:Reminder)=>`${{task:'Tasks',event:'Calendar',goal:'Goals'}[item.kind]}:record:${item.id}`;
export const label=(item:Reminder)=>({task:'Görev',event:'Etkinlik',goal:'Hedef'}[item.kind]);
export const itemKey=(item:Reminder)=>`${item.kind}:${item.id}:${item.due}`;
export async function reminders(owner:TaskOwner,query='',kind='all',mode='new',offset=0):Promise<ReminderPage>{
 const v=await window.__TAURI__!.core.invoke('notifications_page',{owner,today:dateOffset(),to:dateOffset(30),query,kind,mode,offset}) as ReminderPage;
 if(!v||!Array.isArray(v.items)||v.items.length>50||!Number.isSafeInteger(v.total)||v.total<0||!Number.isSafeInteger(v.unread)||v.unread<0||typeof v.hasMore!=='boolean'||v.items.some(i=>!i||!['task','event','goal'].includes(i.kind)||!/^[a-f0-9]{32}$/.test(i.id)||typeof i.title!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.due)||typeof i.time!=='string'||typeof i.isRead!=='boolean'||!(i.snoozedUntil===null||typeof i.snoozedUntil==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(i.snoozedUntil))))throw new Error('Hatırlatmalar okunamadı.');
 return v;
}
export async function updateReminder(owner:TaskOwner,item:Reminder,isRead:boolean,snoozedUntil:string|null){await window.__TAURI__!.core.invoke('notifications_set',{owner,sourceKind:item.kind,sourceId:item.id,dueDate:item.due,isRead,snoozedUntil});window.dispatchEvent(new Event('metis:reminders-changed'))}
