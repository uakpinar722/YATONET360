export class ApiHatasi extends Error {
  constructor(public kod: number, mesaj: string) { super(mesaj); }
}

let bekleyen = 0;
const dinleyiciler = new Set<(n: number) => void>();
const bildir = () => dinleyiciler.forEach((d) => d(bekleyen));
export function bekleyenDinle(d: (n: number) => void) { dinleyiciler.add(d); return () => { dinleyiciler.delete(d); }; }

export async function istek<T>(yol: string, govde?: object): Promise<T> {
  bekleyen++; bildir();
  try {
    const y = await fetch('/api' + yol, govde
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1' }, body: JSON.stringify(govde), credentials: 'same-origin' }
      : { credentials: 'same-origin' });
    const j = await y.json().catch(() => ({}));
    if (!y.ok) throw new ApiHatasi(y.status, j.hata ?? 'İşlem tamamlanamadı; yeniden deneyiniz.');
    return j as T;
  } finally { bekleyen--; bildir(); }
}

export interface Ben {
  kimlik: string; adSoyad: string; grup: string; izinler: string[]; dil: 'tr' | 'en'; rizaBicimi: 'ozel_gun' | 'pazarlama';
  eksik: ('kosullar' | 'aydinlatma' | 'izinler')[];
  roller: { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string }[];
}
export interface GirisYaniti { asama: 'kod'; yontem: 'uygulama' | 'sms'; kurulumGerekli: boolean; smsAcik: boolean }
