import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { sonSurum } from './adimlar.js';
import { birKez } from './bildirim.js';
import type { Baglam } from './kimlik.js';
import { metinGetir } from './metin.js';

type Db = Pool | PoolClient;
const ACIK_METINLER = ['KVKK-01'];
let webAdresi = '';

/**
 * YG-1477 (K-241): vefat işaretli dosyada temsilci atandıktan sonra yat tarafına giden ilk mesaja KVKK-01 aydınlatma bağlantısı onaylı M6 cümlesiyle eklenir; yeni onay istenmez.
 * Dosya başına bir kez; diğer mesajlar değişmez.
 */
export async function mirasciAydinlatmaEki(db: Db, dosyaNo: string, dil: 'tr' | 'en'): Promise<string> {
  const d = (await db.query(`SELECT vefat_temsilci FROM dosya WHERE dosya_no = $1`, [dosyaNo])).rows[0];
  if (!d?.vefat_temsilci || !webAdresi || !(await birKez(db, 'kvkk01_mirasci', dosyaNo))) return '';
  return `\n\n${await metinGetir(db, 'M6', dil, { bağlantı: `${webAdresi}/#aydinlatma=KVKK-01`, link: `${webAdresi}/#aydinlatma=KVKK-01` })}`;
}

/** Giriş gerektirmeden açılan aydınlatma metni (yalnız tanımlı kodlar, yürürlükteki sürüm). */
export function aydinlatmaAcikYollari(s: FastifyInstance, b: Baglam) {
  webAdresi = b.webAdresi;
  s.get('/acik/aydinlatma/:kod', async (i, y) => {
    const { kod } = i.params as { kod: string }; const dil = ((i.query ?? {}) as { dil?: string }).dil === 'en' ? 'en' : 'tr';
    if (!ACIK_METINLER.includes(kod)) return y.code(404).send({ hata: 'Metin bulunamadı.' });
    const surum = await sonSurum(b.db, kod);
    return (await b.db.query(`SELECT kod, dil, surum, baslik, govde FROM hukuki_metin WHERE kod = $1 AND surum = $2 ORDER BY (dil = $3) DESC LIMIT 1`, [kod, surum, dil])).rows[0];
  });
}
