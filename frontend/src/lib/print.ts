/** Opens the browser's print dialog for a table, so lecturers can print or "Save as PDF" a class list. */
export function printTable(opts: { title: string; subtitle?: string; header: string[]; rows: (string | number | null)[][] }): void {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
  body{font:13px/1.4 system-ui,sans-serif;color:#111;margin:28px}
  h1{font:600 20px Georgia,serif;margin:0 0 4px}
  p{margin:0 0 16px;color:#555}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
  th{background:#eee}
  tr{break-inside:avoid}
  footer{margin-top:18px;color:#777;font-size:11px}
</style></head><body>
<h1>${esc(opts.title)}</h1><p>${esc(opts.subtitle ?? '')}</p>
<table><thead><tr>${opts.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${opts.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
<footer>Printed from Elimu on ${esc(new Date().toLocaleString())}</footer>
</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow!.focus();
  window.setTimeout(() => {
    frame.contentWindow!.print();
    window.setTimeout(() => frame.remove(), 2000);
  }, 150);
}
