'use strict';
// Plantillas HTML con escape automático. `html` devuelve un SafeString; las
// interpolaciones se escapan salvo que ya sean SafeString (o arreglos de ellas).

class SafeString {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escape(v) {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeString) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeString(out);
}

function raw(s) {
  return new SafeString(String(s ?? ''));
}

// Texto con párrafos y listas simples (contenido administrable, sin HTML).
function prose(text) {
  if (!text) return raw('');
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  return raw(
    blocks
      .map((b) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
        }
        if (/^#{1,3}\s/.test(lines[0])) {
          const level = Math.min(lines[0].match(/^#+/)[0].length + 1, 4);
          const head = `<h${level}>${inline(lines[0].replace(/^#+\s*/, ''))}</h${level}>`;
          const rest = lines.slice(1).join(' ').trim();
          return head + (rest ? `<p>${inline(rest)}</p>` : '');
        }
        return `<p>${inline(lines.join(' '))}</p>`;
      })
      .join('')
  );
}
function inline(s) {
  return escape(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

module.exports = { html, raw, escape, render, prose, SafeString };
