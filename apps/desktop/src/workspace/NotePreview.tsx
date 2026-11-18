import { Fragment } from 'react';
function inline(text:string){
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('*')&&part.endsWith('*')?<em key={i}>{part.slice(1,-1)}</em>:part.startsWith('`')&&part.endsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:<Fragment key={i}>{part}</Fragment>);
}
export function NotePreview({body,onToggle,disabled=false}:{body:string;onToggle?:(line:number)=>void;disabled?:boolean}){
 if(!body.trim())return <div className="note-preview"><p>Önizlenecek içerik yok.</p></div>;
 const lines=body.split('\n');
 const headings=lines.map((line,index)=>({line,index})).filter(({line})=>/^#{1,3} /.test(line));
 const checks=lines.filter(line=>/^[-*] \[[ xX]\] /.test(line));
 const done=checks.filter(line=>/^[-*] \[[xX]\] /.test(line)).length;
 return <div className="note-preview" aria-label="Not önizlemesi">
 {checks.length>0&&<p className="section-description">{done}/{checks.length} madde tamamlandı · İşaretlemeler Kaydet ile uygulanır.</p>}
 {headings.length>1&&<nav aria-label="Not başlıkları" className="note-outline">{headings.map(({line,index})=><button type="button" className="text-button" key={index} onClick={()=>{const el=document.getElementById(`note-line-${index}`);el?.scrollIntoView({block:'nearest',behavior:'smooth'});el?.focus({preventScroll:true})}}>{line.replace(/^#+ /,'')}</button>)}</nav>}
 {lines.map((line,index)=>{
 const id=`note-line-${index}`;
 if(line.startsWith('### '))return <h4 id={id} tabIndex={-1} key={index}>{inline(line.slice(4))}</h4>;
 if(line.startsWith('## '))return <h3 id={id} tabIndex={-1} key={index}>{inline(line.slice(3))}</h3>;
 if(line.startsWith('# '))return <h2 id={id} tabIndex={-1} key={index}>{inline(line.slice(2))}</h2>;
 if(/^[-*] \[[ xX]\] /.test(line))return <label className="note-check" key={index}><input type="checkbox" checked={/[xX]/.test(line.slice(3,4))} disabled={disabled||!onToggle} onChange={()=>onToggle?.(index)}/><span>{inline(line.slice(6))}</span></label>;
 if(/^[-*] /.test(line))return <p className="note-bullet" key={index}><span>•</span>{inline(line.slice(2))}</p>;
 return <p key={index}>{inline(line||' ')}</p>
 })}</div>
}
