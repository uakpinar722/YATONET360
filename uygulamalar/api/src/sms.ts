import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { KOK } from './ayarlar.js';

/** SMS ve e-posta sağlayıcıları seçilene kadar deneme kutusu kullanılır (iki operatör kararı K-143). Üretimde kutu çalışmaz. */
export interface SmsGonderici { gonder(telefon: string, metin: string): Promise<void> }
export interface EpostaGonderici { gonder(adres: string, metin: string): Promise<void> }

export class DenemeKutusu implements SmsGonderici, EpostaGonderici {
  gidenler: { telefon: string; metin: string }[] = [];
  constructor(private dosya: string | null = join(KOK, '.araclar', 'sms_kutusu.txt')) {}
  async gonder(telefon: string, metin: string) {
    if (process.env.YATONET_ORTAM === 'uretim') throw new Error('Deneme kutusu üretimde kullanılamaz');
    this.gidenler.push({ telefon, metin });
    if (this.dosya) appendFileSync(this.dosya, `${new Date().toISOString()} ${telefon} ${metin}\n`);
  }
}
export const denemeEpostaKutusu = () => new DenemeKutusu(join(KOK, '.araclar', 'eposta_kutusu.txt'));
