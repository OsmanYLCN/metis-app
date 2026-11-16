import type { TaskOwner } from '../tasks/client';
export type FinanceTotal={kind:'income'|'expense';category:string;amountCents:number;count:number};
export async function financeTotals(owner:TaskOwner,month:string):Promise<FinanceTotal[]>{
 const value=await window.__TAURI__!.core.invoke('finance_totals',{owner,month});
 if(!Array.isArray(value)||value.some(v=>!v||!['income','expense'].includes(v.kind)||typeof v.category!=='string'||!Number.isSafeInteger(v.amountCents)||v.amountCents<0||!Number.isSafeInteger(v.count)||v.count<0)||!Number.isSafeInteger(value.reduce((n,v)=>n+v.amountCents,0)))throw new Error('Aylık toplamlar okunamadı.');
 return value;
}
