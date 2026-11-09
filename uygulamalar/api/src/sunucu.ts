import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { belgeYollari } from './belge.js';
import { erisimYollari } from './erisim.js';
import { hesabimYollari } from './hesabim.js';
import { vekaletYollari } from './vekalet.js';
import { hesapKurtarmaYollari } from './hesap_kurtarma.js';
import { dosyaYollari } from './dosya.js';
import { ihbarYollari } from './ihbar.js';
import { iletisimYollari } from './iletisim.js';
import { yatYollari } from './yat.js';
import { ilkGirisYollari } from './ilk_giris.js';
import { isYollari } from './is_motoru.js';
import { kimlikYollari, type Baglam } from './kimlik.js';
import { onayYollari } from './onay.js';
import { portalYollari } from './portal.js';
import { acilYollari } from './acil.js';
import { firmaYollari } from './firma.js';
import { ticariYollari } from './ticari.js';
import { kaliteYollari } from './kalite.js';
import { tedarikYollari } from './tedarik.js';
import { yatDegeriYollari } from './yat_degeri.js';
import { sigortaGonderimYollari } from './sigorta_gonderim.js';
import { tesisTedarikciYollari } from './portallar.js';
import { raporYollari } from './rapor.js';
import { sigortaYollari } from './sigorta.js';
import { sigortaEk2Yollari } from './sigorta_ek2.js';
import { kurumHesapYollari } from './kurum_hesap.js';
import { karneYollari } from './karne.js';
import { sahaKayitYollari } from './saha_kayit.js';
import { kurumsalYollari } from './kurumsal.js';
import { odemeYollari } from './odeme.js';
import { vergiYollari } from './vergi.js';
import { alacakYollari } from './alacak.js';
import { acilEkYollari } from './acil_ek.js';
import { onayEkYollari } from './onay_ek.js';
import { teslimEkYollari } from './teslim_ek.js';
import { firmaEkYollari } from './firma_ek.js';
import { ikYollari } from './ik.js';
import { mobilYollari } from './mobil.js';
import { kvkkYollari } from './kvkk.js';
import { yetkiEkYollari } from './yetki_ek.js';
import { guvenlikYollari } from './guvenlik.js';
import { yedekYollari } from './yedek.js';
import { istekBaglami } from './denetim.js';
import { alanYollari } from './alan.js';
import { uyumYollari } from './uyum.js';
import { kalanYollari } from './kalan.js';
import { teyitYollari } from './teyit.js';
import { firmaTesisYollari } from './firma_tesis.js';
import { destekYollari } from './destek.js';
import { yatGecmisYollari } from './yat_gecmis.js';
import { kilometreYollari } from './kilometre.js';
import { kislikYollari } from './kislik.js';
import { ertelenenYollari } from './ertelenen.js';
import { tutanakEkYollari } from './tutanak_ek.js';
import { resmiOnayYollari } from './resmi_onay.js';
import { ticariAtamaYollari } from './ticari_atama.js';
import { kesifTalebiYollari } from './kesif_talebi.js';
import { prosesYollari } from './proses.js';
import { yontemRaporuYollari } from './yontem_raporu.js';
import { riskRezerviYollari } from './risk_rezervi.js';
import { teslimSureYollari } from './teslim_sure.js';
import { topluOdemeYollari } from './toplu_odeme.js';
import { sigortaFarkYollari } from './sigorta_fark.js';
import { baglamaNoktasiYollari } from './baglama_noktasi.js';
import { anaVeriYollari } from './ana_veri.js';
import { menfaatMasrafYollari } from './menfaat_masraf.js';
import { idariTalepYollari } from './idari_talep.js';
import { personelEkYollari } from './personel_ek.js';
import { firmaPoliceYollari } from './firma_police.js';
import { personelKarneYollari } from './personel_karne.js';
import { zorlukYollari } from './zorluk.js';
import { memnuniyetYollari } from './memnuniyet.js';
import { kapanisEkYollari } from './kapanis_ek.js';
import { butceYollari } from './butce.js';
import { kritikAnahtari } from './depo.js';
import { sahaYollari } from './saha.js';
import { teklifYollari } from './teklif.js';
import { toplantiYollari } from './toplanti.js';
import { yetkiYollari } from './yetki.js';

export async function sunucuKur(b: Baglam) {
  // YG-1146: her istek ilişki kimliğiyle izlenir. YG-1147: istek gövdesi günlüğe yazılmaz.
  const s = Fastify({ logger: process.env.VITEST ? false : { level: 'info', serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0] }) } }, genReqId: () => randomUUID(), bodyLimit: 64 * 1024 });
  await s.register(cookie);
  kritikAnahtari(b.anahtar); // DEP-1a
  s.addHook('onRequest', (_i, _y, done) => { istekBaglami.run({}, done); }); // YG-1183
  s.addHook('onSend', async (i, y) => { y.header('X-Iliski-Kimligi', i.id); });
  // Çerez SameSite=Strict; ek olarak durum değiştiren istek bu üst bilgiyi taşımalıdır.
  s.addHook('onRequest', async (i, y) => {
    if (i.method !== 'GET' && i.method !== 'HEAD' && i.headers['x-yatonet'] !== '1') return y.code(403).send({ hata: 'Geçersiz istek.' });
  });
  s.setErrorHandler((e: Error, i, y) => {
    i.log.error({ hata: e.message, iliski: i.id });
    if (process.env.HATA_GOSTER) console.error('HATA', e.message);
    const kod = (e as { statusCode?: number }).statusCode;
    // Modüllerin iş kuralı hatası kullanıcıya kendi cümlesiyle gider; çerçeve ve sunucu hatası genel metinle (YG-1147).
    const isKurali = kod && kod < 500 && !(e as { code?: string }).code;
    y.code(kod && kod < 500 ? kod : 500).send({ hata: isKurali ? e.message : 'İşlem tamamlanamadı; yeniden deneyiniz.', iliski: i.id });
  });
  s.get('/saglik', async () => ({ durum: 'çalışıyor' }));
  await s.register(async (a) => { sigortaEk2Yollari(a, b); kurumHesapYollari(a, b); karneYollari(a, b); sahaKayitYollari(a, b); kurumsalYollari(a, b); odemeYollari(a, b); vergiYollari(a, b); alacakYollari(a, b); acilEkYollari(a, b); onayEkYollari(a, b); teslimEkYollari(a, b); firmaEkYollari(a, b); ikYollari(a, b); mobilYollari(a, b); kvkkYollari(a, b); yetkiEkYollari(a, b); guvenlikYollari(a, b); yedekYollari(a, b); alanYollari(a, b); uyumYollari(a, b); kalanYollari(a, b); butceYollari(a, b); teyitYollari(a, b); firmaTesisYollari(a, b); destekYollari(a, b); yatGecmisYollari(a, b); kilometreYollari(a, b); kislikYollari(a, b); ertelenenYollari(a, b); tutanakEkYollari(a, b); resmiOnayYollari(a, b); ticariAtamaYollari(a, b); kesifTalebiYollari(a, b); prosesYollari(a, b); yontemRaporuYollari(a, b); riskRezerviYollari(a, b); teslimSureYollari(a, b); topluOdemeYollari(a, b); sigortaFarkYollari(a, b); baglamaNoktasiYollari(a, b); anaVeriYollari(a, b); menfaatMasrafYollari(a, b); idariTalepYollari(a, b); firmaPoliceYollari(a, b); personelKarneYollari(a, b); zorlukYollari(a, b); memnuniyetYollari(a, b); kapanisEkYollari(a, b); personelEkYollari(a, b); kimlikYollari(a, b); ilkGirisYollari(a, b); hesabimYollari(a, b); yetkiYollari(a, b); isYollari(a, b); erisimYollari(a, b); hesapKurtarmaYollari(a, b); vekaletYollari(a, b); iletisimYollari(a, b); belgeYollari(a, b); toplantiYollari(a, b); yatYollari(a, b); ihbarYollari(a, b); dosyaYollari(a, b); onayYollari(a, b); portalYollari(a, b); sahaYollari(a, b); teklifYollari(a, b); firmaYollari(a, b); acilYollari(a, b); sigortaYollari(a, b); ticariYollari(a, b); kaliteYollari(a, b); tedarikYollari(a, b); yatDegeriYollari(a, b); sigortaGonderimYollari(a, b); tesisTedarikciYollari(a, b); raporYollari(a, b); }, { prefix: '/api' });
  return s;
}
