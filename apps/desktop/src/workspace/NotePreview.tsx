export function NotePreview({ body }: { body: string }) {
  if (!body.trim()) return <div className="note-preview"><p>Önizlenecek içerik yok.</p></div>;
  return <div className="note-preview" aria-label="Not önizlemesi">{body.split('\n').map((line, index) => {
    if (line.startsWith('### ')) return <h4 key={index}>{line.slice(4)}</h4>;
    if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
    if (line.startsWith('# ')) return <h2 key={index}>{line.slice(2)}</h2>;
    if (/^[-*] \[[ xX]\] /.test(line)) return <p className="note-check" key={index}><span>{/[xX]/.test(line.slice(3, 4)) ? '☑' : '☐'}</span>{line.slice(6)}</p>;
    if (/^[-*] /.test(line)) return <p className="note-bullet" key={index}><span>•</span>{line.slice(2)}</p>;
    return <p key={index}>{line || '\u00a0'}</p>;
  })}</div>;
}
