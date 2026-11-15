import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_DOSYASI = join(KOK, '.env.local');

/** YG-1121: gizli değerler kodda değil, git dışı ortam dosyasında durur. */
export function ortamOku(): Record<string, string> {
  const d: Record<string, string> = {};
  if (existsSync(ENV_DOSYASI)) {
    for (const s of readFileSync(ENV_DOSYASI, 'utf8').split(/\r?\n/)) {
      const i = s.indexOf('=');
      if (i > 0) d[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
  }
  return { ...d, ...(process.env as Record<string, string>) };
}
export const ENV_YOLU = ENV_DOSYASI;

/** Süre kuralları (katalog satırlarıyla). */
export const KURAL = {
  hareketsizlikDk: 30, // YG-1153
  ayricalikliHareketsizlikDk: 15, // YG-1153
  azamiOturumSaat: 12, // YG-1153
  kodAsamasiDk: 10, // YG-1712
  beklemeDenemeSayisi: 5, // YG-1155
  ilkBeklemeDk: 15, // YG-1155
  azamiBeklemeDk: 24 * 60, // YG-1155
  parolaAsgari: 12, // YG-1152
  smsKodGecerlilikDk: 5, // YG-1712
  smsYenidenGonderimSn: 60, // YG-1712
  parolaSifirlamaDk: 60, // YG-1713
  adresDenemeSiniri: 30, // YG-1157, YG-1713
  adresDenemePenceresiDk: 10, // YG-1157, YG-1713
};

/** YG-1712, YG-1713: SMS, kod aşaması, parola yenileme ve adres deneme değerleri sistem parametresinden yüklenir; parametre yoksa yukarıdaki varsayılan geçerlidir. */
const KURAL_PARAMETRE: Record<string, keyof typeof KURAL> = {
  kimlik_sms_kod_gecerlilik_dk: 'smsKodGecerlilikDk', kimlik_sms_yeniden_gonderim_sn: 'smsYenidenGonderimSn', kimlik_kod_asamasi_dk: 'kodAsamasiDk',
  kimlik_parola_sifirlama_dk: 'parolaSifirlamaDk', kimlik_adres_deneme_siniri: 'adresDenemeSiniri', kimlik_adres_deneme_penceresi_dk: 'adresDenemePenceresiDk',
};
export async function kuralYukle(db: import('pg').Pool | import('pg').PoolClient): Promise<void> {
  const { rows } = await db.query(`SELECT kod, deger FROM sistem_parametresi WHERE kod = ANY($1)`, [Object.keys(KURAL_PARAMETRE)]);
  for (const r of rows) { const n = Number(r.deger); if (Number.isFinite(n) && n > 0) KURAL[KURAL_PARAMETRE[r.kod]!] = n; }
}

export const COOKIE_ADI = 'yatonet_oturum';
