/**
 * YG-1390, YG-1391: tercih dili İngilizce olan kullanıcıda ekran sabit metinleri onaylı çeviri kütüphanesinden gösterilir (/arayuz-metinleri).
 * Yalnız birebir eşleşen sabit metin çevrilir; onaylı karşılığı olmayan metin Türkçe kalır. Seçim kutusu seçenekleri, giriş alanları ve
 * data-cevirme işaretli bölümler değiştirilmez (gönderilen değerler Türkçe kalır).
 */
const NITELIK = ['placeholder', 'aria-label', 'title'];
let sozluk: Record<string, string> = {};
let gozcu: MutationObserver | null = null;

const atla = (e: Element | null) => !e || Boolean(e.closest('select, option, textarea, [contenteditable], [data-cevirme]'));

function cevir(n: Node) {
  if (n.nodeType === Node.TEXT_NODE) {
    const v = n.nodeValue ?? ''; const k = v.trim(); const e = k && sozluk[k];
    if (e && e !== k && !atla(n.parentElement)) n.nodeValue = v.replace(k, e);
    return;
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const el = n as Element; if (atla(el)) return;
  for (const a of NITELIK) { const v = el.getAttribute(a)?.trim(); if (v && sozluk[v] && sozluk[v] !== v) el.setAttribute(a, sozluk[v]!); }
  for (const c of Array.from(el.childNodes)) cevir(c);
}

export function ceviriBaslat(s: Record<string, string>) {
  sozluk = s; document.documentElement.lang = 'en';
  if (!Object.keys(s).length) return;
  cevir(document.body);
  gozcu?.disconnect();
  gozcu = new MutationObserver((l) => { for (const m of l) { if (m.type === 'childList') m.addedNodes.forEach(cevir); else cevir(m.target); } });
  gozcu.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: NITELIK });
}

export function ceviriDurdur() { gozcu?.disconnect(); gozcu = null; sozluk = {}; document.documentElement.lang = 'tr'; }
