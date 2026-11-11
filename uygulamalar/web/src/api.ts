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
  const p = gonder<T>(yol, govde, anahtar).catch((e) => { if (e instanceof ApiHatasi) throw e; return new Promise<T>((c, r) => setTimeout(() => void gonder<T>(yol, govde, anahtar).then(c, r), 1000)); }).finally(() => ucustakiler.delete(iz));
  ucustakiler.set(iz, p); return p;
}
async function gonder<T>(yol: string, govde?: object, anahtar?: string): Promise<T> {
  bekleyen++; bildir();
  try {
    const y = await fetch('/api' + yol, govde
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1', ...(anahtar ? { 'X-Islem-Anahtari': anahtar } : {}) }, body: JSON.stringify(govde), credentials: 'same-origin' }
      : { credentials: 'same-origin' });
    const j = await y.json().catch(() => ({}));
    if (!y.ok) throw new ApiHatasi(y.status, j.hata ?? 'İşlem tamamlanamadı; yeniden deneyiniz.');
    return j as T;
  } finally { bekleyen--; bildir(); }
}

export interface Ben {
  kimlik: string; adSoyad: string; grup: string; izinler: string[]; dil: 'tr' | 'en'; rizaBicimi: 'ozel_gun' | 'pazarlama';
  eksik: ('kosullar' | 'aydinlatma' | 'izinler' | 'rehber' | 'egitim')[];
  roller: { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string }[];
}
export interface GirisYaniti { asama: 'kod'; yontem: 'uygulama' | 'sms'; kurulumGerekli: boolean; smsAcik: boolean }
