export class ApiHatasi extends Error {
  constructor(public kod: number, mesaj: string) { super(mesaj); }
}

export async function istek<T>(yol: string, govde?: object): Promise<T> {
  const y = await fetch('/api' + yol, govde
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Yatonet': '1' }, body: JSON.stringify(govde), credentials: 'same-origin' }
    : { credentials: 'same-origin' });
  const j = await y.json().catch(() => ({}));
  if (!y.ok) throw new ApiHatasi(y.status, j.hata ?? 'İşlem tamamlanamadı; yeniden deneyiniz.');
  return j as T;
}

export interface Ben {
  kimlik: string; adSoyad: string; grup: string; izinler: string[];
  roller: { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string }[];
}
export interface GirisYaniti { asama: 'kod'; yontem: 'uygulama' | 'sms'; kurulumGerekli: boolean; smsAcik: boolean }
