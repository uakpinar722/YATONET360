import { hash, verify } from '@node-rs/argon2';
import { createRequire } from 'node:module';
import { KURAL } from './ayarlar.js';

const yukle = createRequire(import.meta.url);
const yaygin: { has(p: string): boolean } = (() => {
  const m = yukle('fxa-common-password-list');
  return m.test ? { has: (p: string) => m.test(p) } : new Set<string>(m);
})();

/** YG-1152: geri çözülemez saklama. */
export const parolaOzetle = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const parolaDogrula = (ozet: string, p: string) => verify(ozet, p).catch(() => false);

let kor: Promise<string> | undefined;
/** Bilinmeyen hesapta da aynı süre harcanır; yanıt süresinden hesap varlığı anlaşılmaz. */
export async function sahteDogrula(p: string) {
  kor ??= parolaOzetle('yatonet-kor-deger-yalnizca-sure-icin');
  await parolaDogrula(await kor, p);
}

/** YG-1152: en az 12 karakter, sızdırılmış/yaygın listede olmayan. Hata metni döndürür, uygunsa null. */
export function parolaKuraliHatasi(p: string): string | null {
  if (typeof p !== 'string' || [...p].length < KURAL.parolaAsgari) return 'Parola en az 12 karakter olmalıdır.';
  if (yaygin.has(p.toLowerCase())) return 'Bu parola sızdırılmış parola listelerinde yer almaktadır; başka bir parola belirleyiniz.';
  return null;
}
