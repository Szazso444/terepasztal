  // Copy buttons. A per-prompt button copies that prompt; a group button copies all the group's prompts in order.
  const SEP = '\n\n--- next prompt (paste after the previous one finishes) ---\n\n';
  const groupText = (id) => Array.from(document.querySelectorAll('#' + id + ' pre')).map((p) => p.textContent).join(SEP);
  async function copyText(text, node, btn, idle) {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
    catch {
      const t = document.createElement('textarea');
      t.value = text; t.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      document.body.removeChild(t);
      if (ok) btn.textContent = 'Copied';
      else if (node) { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selected: press Ctrl+C'; }
      else btn.textContent = 'Copy failed';
    }
    setTimeout(() => (btn.textContent = idle), 2200);
  }
  for (const b of document.querySelectorAll('.copy')) b.addEventListener('click', () => {
    if (b.dataset.group) copyText(groupText(b.dataset.group), null, b, 'Copy whole conversation');
    else { const pre = document.getElementById(b.dataset.for); copyText(pre.textContent, pre, b, 'Copy prompt'); }
  });
