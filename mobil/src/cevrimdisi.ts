// YG-494: çevrimdışı kuyruk. Platforma bağlı değildir; depo şifreli SQLite ile uygulanır (depo.ts), sınama bellekte yapılır.
export type KayitDurumu = 'Bekliyor' | 'Çakışma' | 'Reddedildi' | 'Uygulandı';
export interface KuyrukKaydi { kimlik: string; yol: string; govde: unknown; temelZaman?: string; durum: KayitDurumu; hata?: string; olusturma: string; uygulanma?: string }
export interface KuyrukDeposu { hepsi(): Promise<KuyrukKaydi[]>; yaz(k: KuyrukKaydi): Promise<void>; sil(kimlik: string): Promise<void> }
export type EsitlemeSonucu = { kimlik: string; durum: 'Uygulandı' | 'Çakışma' | 'Reddedildi'; hata?: string };
export type Gonderici = (kayitlar: { kimlik: string; yol: string; govde: unknown; temelZaman?: string }[]) => Promise<EsitlemeSonucu[]>;

const PARCA = 50;
/** YG-495: eşitlenen kayıt cihazda 48 saat saklanır. */
const SAKLAMA_MS = 48 * 3_600_000;

export class CevrimdisiKuyruk {
  constructor(private depo: KuyrukDeposu, private gonder: Gonderici, private kimlikUret: () => string, private simdi: () => Date = () => new Date()) {}

  async ekle(yol: string, govde: unknown, temelZaman?: string): Promise<string> {
    const kimlik = this.kimlikUret();
    await this.depo.yaz({ kimlik, yol, govde, temelZaman, durum: 'Bekliyor', olusturma: this.simdi().toISOString() });
    return kimlik;
  }

  async bekleyenSayisi(): Promise<number> { return (await this.depo.hepsi()).filter((k) => k.durum === 'Bekliyor').length; }
  /** Kullanıcıya gösterilir; çakışan kayıt sessizce silinmez ve üzerine yazılmaz. */
  async sorunlular(): Promise<KuyrukKaydi[]> { return (await this.depo.hepsi()).filter((k) => k.durum === 'Çakışma' || k.durum === 'Reddedildi'); }
  /** YG-495: 48 saati dolan eşitlenmiş kayıtlar cihazdan kaldırılır. */
  async temizle(): Promise<number> { const sinir = this.simdi().getTime() - SAKLAMA_MS; let n = 0; for (const k of await this.depo.hepsi()) if (k.durum === 'Uygulandı' && k.uygulanma && new Date(k.uygulanma).getTime() < sinir) { await this.depo.sil(k.kimlik); n++; } return n; }
  /** YG-495: sunucu yedekten geri yüklendiyse son 48 saatte eşitlenen kayıtlar aynı kimlikle yeniden kuyruğa alınır. */
  async geriYuklemeSonrasiYenidenGonder(): Promise<number> { let n = 0; for (const k of await this.depo.hepsi()) if (k.durum === 'Uygulandı') { await this.depo.yaz({ ...k, durum: 'Bekliyor', uygulanma: undefined }); n++; } return n; }
  async vazgec(kimlik: string): Promise<void> { await this.depo.sil(kimlik); }

  /** Bağlantı kesilirse kayıtlar kuyrukta kalır; aynı kimlikle yeniden gönderim sunucuda yinelenmez. */
  async esitle(): Promise<{ gonderilen: number; bagliDegil: boolean }> {
    await this.temizle();
    const l = (await this.depo.hepsi()).filter((k) => k.durum === 'Bekliyor').sort((a, b) => a.olusturma.localeCompare(b.olusturma));
    let gonderilen = 0;
    for (let i = 0; i < l.length; i += PARCA) {
      const parca = l.slice(i, i + PARCA); let sonuc: EsitlemeSonucu[];
      try { sonuc = await this.gonder(parca.map(({ kimlik, yol, govde, temelZaman }) => ({ kimlik, yol, govde, temelZaman }))); } catch { return { gonderilen, bagliDegil: true }; }
      for (const s of sonuc) {
        const k = parca.find((x) => x.kimlik === s.kimlik); if (!k) continue;
        if (s.durum === 'Uygulandı') await this.depo.yaz({ ...k, durum: 'Uygulandı', hata: undefined, uygulanma: this.simdi().toISOString() });
        else await this.depo.yaz({ ...k, durum: s.durum, hata: s.hata });
        gonderilen++;
      }
    }
    return { gonderilen, bagliDegil: false };
  }
}
