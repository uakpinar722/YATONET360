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
  parolaSifirlamaDk: 60, // parametre; katalogda tanımsız
  adresDenemeSiniri: 30, // YG-1157; eşik parametre, katalogda tanımsız
  adresDenemePenceresiDk: 10, // YG-1157; parametre
} as const;

export const COOKIE_ADI = 'yatonet_oturum';
