/**
 * YG-1370, V-1122: birleşik seçim alanı. Bütün ekranlarda serbest metin kutusu, bu kişinin o alana daha önce girdiği değerleri
 * seçilebilir liste olarak sunar; seçenek yoksa elle yazılır. Liste yalnız bu tarayıcıda tutulur (kişisel kolaylık).
 * Gizli ve kişisel veri alanları (parola, kod, kimlik no, IBAN, e-posta, telefon, tutar) ve kendi listesi olan alanlar kapsam dışıdır.
 */
const ON = 'yatonet_oneri:';
const EN_COK = 12;
const HARIC = /parola|sifre|şifre|kod|otp|tckn|kimlik|iban|vergi|tel|eposta|e-posta|mail|tutar|fiyat|bedel|miktar/i;

const uygunMu = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && (el.type === 'text' || el.type === '') && Boolean(el.id) && !el.getAttribute('list') && el.dataset.oneri !== 'yok'
  && el.autocomplete !== 'off' && !['numeric', 'decimal', 'tel', 'email'].includes(el.inputMode) && !HARIC.test(el.id) && !HARIC.test(el.labels?.[0]?.textContent ?? '');

const oku = (id: string): string[] => { try { const v = JSON.parse(localStorage.getItem(ON + id) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const yaz = (id: string, l: string[]) => { try { localStorage.setItem(ON + id, JSON.stringify(l)); } catch { /* depolama kapalı */ } };

function listeBagla(el: HTMLInputElement) {
  const l = oku(el.id); if (!l.length) return;
  const dl = `oneri-${el.id}`; let d = document.getElementById(dl) as HTMLDataListElement | null;
  if (!d) { d = document.createElement('datalist'); d.id = dl; document.body.appendChild(d); }
  d.replaceChildren(...l.map((x) => { const o = document.createElement('option'); o.value = x; return o; }));
  el.setAttribute('list', dl); el.dataset.oneriBagli = '1';
}

export function oneriBaslat() {
  document.addEventListener('focusin', (e) => { const el = e.target; if (uygunMu(el) || (el instanceof HTMLInputElement && el.dataset.oneriBagli)) listeBagla(el as HTMLInputElement); });
  document.addEventListener('change', (e) => {
    const el = e.target; if (!(el instanceof HTMLInputElement)) return; if (!el.dataset.oneriBagli && !uygunMu(el)) return;
    const v = el.value.trim(); if (v.length < 2 || v.length > 120) return;
    yaz(el.id, [v, ...oku(el.id).filter((x) => x !== v)].slice(0, EN_COK));
  });
}
