export class ApiHatasi extends Error {
  constructor(public kod: number, mesaj: string) { super(mesaj); }
}

let bekleyen = 0;
const dinleyiciler = new Set<(n: number) => void>();
const bildir = () => dinleyiciler.forEach((d) => d(bekleyen));
export function bekleyenDinle(d: (n: number) => void) { dinleyiciler.add(d); return () => { dinleyiciler.delete(d); }; }

/** YG-1310: kayıt isteği işlem anahtarı taşır; ağ hatasında aynı anahtarla bir kez yeniden denenir ve sunucu ilk yanıtı döner. Aynı anda gelen özdeş istek (çift tıklama) tek istek olarak gider. */
const ucustakiler = new Map<string, Promise<unknown>>();
export function istek<T>(yol: string, govde?: object): Promise<T> {
  if (!govde) return gonder<T>(yol);
  const iz = yol + ' ' + JSON.stringify(govde);
  const var0 = ucustakiler.get(iz); if (var0) return var0 as Promise<T>;
  const anahtar = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const p = gonder<T>(yol, govde, anahtar).catch((e) => { if (e instanceof ApiHatasi) throw e; return new Promise<T>((c, r) => setTimeout(() => void gonder<T>(yol, govde, anahtar).then(c, (e2) => r(e2 instanceof ApiHatasi ? e2 : kuyrugaAl(yol, govde, anahtar))), 1000)); }).finally(() => ucustakiler.delete(iz));
  ucustakiler.set(iz, p); return p;
}
async function gonder<T>(yol: string, govde?: object, anahtar?: string): Promise<T> {
  bekleyen++; bildir();
  try {
    const y = await fetch('/api' + yol, govde
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1', ...(anahtar ? { 'X-Islem-Anahtari': anahtar } : {}) }, body: JSON.stringify(govde), credentials: 'same-origin' }
      : { credentials: 'same-origin' });
    const j = await y.json().catch(() => ({}));
    // YG-1402: sunucu hatasında destek için kısa ilişki kodu gösterilir (teknik ayrıntı gösterilmez; olay sunucu günlüğünde kodla kayıtlıdır).
    if (!y.ok && y.status === 409 && j.cakisma) window.dispatchEvent(new CustomEvent('kayit-cakismasi', { detail: j.hata })); // YG-1382
    if (!y.ok && j.islem && j.hedef) window.dispatchEvent(new CustomEvent('takilan-adim', { detail: { hata: j.hata, islem: j.islem, hedef: j.hedef } })); // YG-1386
    if (!y.ok) throw new ApiHatasi(y.status, `${j.hata ?? 'İşlem tamamlanamadı; yeniden deneyiniz.'}${y.status >= 500 && j.iliski ? ` Destek kodu: ${String(j.iliski).slice(-8)}` : ''}`);
    return j as T;
  } finally { bekleyen--; bildir(); }
}

export interface Ben {
  kimlik: string; adSoyad: string; grup: string; izinler: string[]; dil: 'tr' | 'en'; rizaBicimi: 'ozel_gun' | 'pazarlama';
  eksik: ('kosullar' | 'aydinlatma' | 'izinler' | 'rehber' | 'egitim')[];
  roller: { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string }[];
}
export interface GirisYaniti { asama: 'kod'; yontem: 'uygulama' | 'sms'; kurulumGerekli: boolean; smsAcik: boolean }

/**
 * TZ-1 (CEO 26.11.2026, YG-063): sunucuya ulaşılamadığında kayıt isteği bu tarayıcıda kuyruğa alınır ve kullanıcıya bildirilir;
 * sistem açılınca kuyruk aynı işlem anahtarıyla (YG-1310, sunucu ilk yanıtı döner) sırayla gönderilir. Reddedilen kayıt hata listesine düşer.
 */
const KUYRUK = 'yatonet_kuyruk'; const KUYRUK_HATA = 'yatonet_kuyruk_hata';
type Bekleyen = { yol: string; govde: object; anahtar: string; zaman: string };
const oku = (k: string): Bekleyen[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') as Bekleyen[]; } catch { return []; } };
const yaz = (k: string, l: unknown[]) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch { /* depolama kapalıysa kuyruk tutulamaz */ } };
function kuyrugaAl(yol: string, govde: object, anahtar: string): ApiHatasi {
  yaz(KUYRUK, [...oku(KUYRUK), { yol, govde, anahtar, zaman: new Date().toISOString() }]);
  window.dispatchEvent(new CustomEvent('kuyruk-degisti', { detail: oku(KUYRUK).length }));
  return new ApiHatasi(0, 'Kaydınız alındı, sistem açılınca işlenecek.');
}
export const kuyrukSayisi = () => oku(KUYRUK).length;
let isleniyor = false;
export async function kuyruguIsle(): Promise<void> {
  if (isleniyor || !oku(KUYRUK).length) return; isleniyor = true;
  try {
    for (const x of oku(KUYRUK)) {
      try { await gonder(x.yol, x.govde, x.anahtar); }
      catch (e) { if (!(e instanceof ApiHatasi)) break; yaz(KUYRUK_HATA, [...oku(KUYRUK_HATA), { ...x, hata: e.message }]); }
      yaz(KUYRUK, oku(KUYRUK).filter((y) => y.anahtar !== x.anahtar));
    }
  } finally { isleniyor = false; window.dispatchEvent(new CustomEvent('kuyruk-degisti', { detail: oku(KUYRUK).length })); }
}
if (typeof window !== 'undefined') { window.addEventListener('online', () => void kuyruguIsle()); setInterval(() => void kuyruguIsle(), 30_000); }
