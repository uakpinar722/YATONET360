import { KatalogReferansi } from './KatalogReferansi';
import { YatKarada } from './YatKarada';
import { HassasGorsel } from './HassasGorsel';
import { KurtarmaSonucKontrol } from './KurtarmaSonuc';
import { OnDegerlendirme } from './OnDegerlendirme';
import { IlkKapsam } from './IlkKapsam';
import { KritikBulgular } from './KritikBulgu';
import { Randevular } from './Randevu';
import { IletisimBilgisi } from './IletisimBilgisi';
import { IcIlerleme } from './IcIlerleme';
import { DosyaPerformans } from './DosyaPerformans';
import { ZorlukKatsayisi } from './Zorluk';
import { useEffect, useState, type ReactNode } from 'react';
import { DosyaDestek } from './Destek';
import { YatGecmisi } from './YatGecmis';
import { KilometreTaslari } from './Kilometre';
import { KislikSorumlusu } from './Kislik';
import { ErtelenenKalemler } from './Ertelenen';
import { ResmiOnayIsaretleri } from './ResmiOnay';
import { YontemRaporu } from './YontemRaporu';
import { RiskRezervi } from './RiskRezervi';
import { TeslimSure } from './TeslimSure';
import { SigortaFark } from './SigortaFark';
import { OnerilenTesisler } from './BaglamaNoktasi';
import { istek } from './api';
import { BelgeSec } from './Kalite';

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yap = async (f: () => Promise<any>, tamam?: string) => { setHata(''); setNot(''); try { const r = await f(); if (r?.uyari) setNot(r.uyari); else if (tamam) setNot(tamam); await yenile(); return r; } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not && <div className="not" role="status">{not}</div>}</>;
  return { yap, Mesaj };
}

type Yap = (f: () => Promise<unknown>, m?: string) => Promise<void>;
const sayi = (x: string) => Number(x.replace(',', '.'));
const gun = (x: string | null) => (x ? x.slice(0, 10).split('-').reverse().join('.') : '—');
interface TeklifOz { odeme_farki_ayri?: boolean; kimlik: string; teklif_no: string; surum_no: number; statu: string; karar: string | null; teklif_muhatabi: string }

/** İP-4 ve İP-6 dosya işlemleri: hasar no, koşul, kesin teslim, protokol, yurt dışı, kurtarma, acil temas. */
export function DosyaEkIslemler({ id, teklifler, sigortali, ticari, ds, firmalar, firmaTeklifleri }: { firmaTeklifleri: { kimlik: string; teklif_no: string }[]; id: string; teklifler: TeklifOz[]; sigortali: boolean; ticari: boolean; ds: boolean; firmalar: { kurulus_ref: string; ticari_unvan: string }[] }) {
  const [kosul, setKosul] = useState<{ kimlik: string; eylem: string; son_tarih: string; gerceklesmezse: string; durum: string; sorumlu: string; kalan: number }[]>([]);
  const [deg, setDeg] = useState<{ degisiklik_no: string; tur: string; mevcut: string; onerilen: string; bedel_farki_eur: string; kumulatif_eur: string; ek_sure_gun: number; kanal: string; sigorta_onayi: string; durum: string }[]>([]);
  const [kur, setKur] = useState<{ kimlik: string; hizmet_turu: string; acil: boolean; ticari_unvan: string; yat_sahibi_onay_zamani: string | null; firma_onay_zamani: string | null; koordinator_onay_zamani: string | null; baslama_zamani: string | null }[]>([]);
  const [tem, setTem] = useState<{ tur: string; ozet: string; zaman: string }[]>([]);
  const [ekip, setEkip] = useState<{ kullanici: string; ad_soyad: string; rol: string }[]>([]);
  useEffect(() => { void istek<{ ekip: typeof ekip }>(`/dosya/${id}`).then((r) => setEkip(r.ekip)).catch(() => {}); }, [id]);
  const yukle = () => Promise.all([istek<typeof kosul>(`/dosya/${id}/kosullar`).then(setKosul), istek<typeof deg>(`/dosya/${id}/degisiklikler`).then(setDeg), istek<typeof kur>(`/dosya/${id}/kurtarma`).then(setKur), istek<typeof tem>(`/acil/${id}/temas`).then(setTem)]);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); }, [id]);
  const [hn, setHn] = useState(''); const [k, setK] = useState({ teklif: '', eylem: '', sorumlu: '', son: '', gerceklesmezse: '' }); const [kb, setKb] = useState(''); const [kg, setKg] = useState(''); const [kt, setKt] = useState({ tarih: '', bedel: '' });
  const [p, setP] = useState({ tur: 'Değişiklik', mevcut: '', onerilen: '', fark: '', toplam: '', sure: '', kanal: 'YATONET 360', sigorta: 'Gerekli Değil', starih: '' }); const [pb, setPb] = useState('');
  const [ku, setKu] = useState({ hizmet: 'Kurtarma', saglayici: '', acil: false }); const [dalis, setDalis] = useState({ limanIzni: '', dalisPlani: '', enerjiIzolasyonu: '' }); const [kod, setKod] = useState(''); const [te, setTe] = useState({ tur: '112 Arandı', ozet: '' }); const [sec, setSec] = useState('Devam');
  const ret = teklifler.filter((t) => t.teklif_muhatabi === 'Sigorta Şirketi' && t.karar === 'Ret');
  const kismi = teklifler.filter((t) => t.teklif_muhatabi === 'Sigorta Şirketi' && (['Kısmi Onay', 'Ret'].includes(t.karar ?? '') || t.odeme_farki_ayri));
  return (
    <Blok baslik="Dosya İşlemleri"><Mesaj />
      {sigortali && <><label htmlFor="de-hn">Hasar Dosya No</label><input id="de-hn" value={hn} onChange={(e) => setHn(e.target.value)} /><button className="btn2 kucuk" disabled={!hn.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/hasar-no`, { no: hn }), 'Hasar dosya numarası kaydedildi.')}>Hasar No Kaydet</button></>}
      {ticari && kismi.map((t) => <div className="soru" key={t.kimlik}><span>{t.teklif_no}: Sigortaca onaylanmayan kalemler</span><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/onaylanmayan-teklif`, {}), 'Yat sahibine ayrı teklif taslağı açıldı.')}>Yat Sahibine Teklif Aç</button></div>)}
      {ds && ret.map((t) => <div className="soru" key={t.kimlik}><span>{t.teklif_no}: Yat Sahibinin Seçimi</span><div className="tam"><label htmlFor={`de-rs-${t.kimlik}`}>Seçim</label><select id={`de-rs-${t.kimlik}`} value={sec} onChange={(e) => setSec(e.target.value)}><option>Devam</option><option>Kapanış</option><option>Devir</option></select><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/ret-secenegi`, { secim: sec }), 'Seçim kaydedildi.')}>Seçimi Kaydet</button></div></div>)}

      <TeklifIslemleri id={id} teklifler={teklifler} firma={firmaTeklifleri} ticari={ticari} yap={yap} />
      <div className="bolum">Koşullu Onay</div>
      {kosul.map((x) => <div className="soru" key={x.kimlik}><span className={x.durum === 'Açık' ? 'uyari' : ''}>{x.eylem} · {x.sorumlu} · Son: {gun(x.son_tarih)}{x.durum === 'Açık' ? ` · Kalan: ${x.kalan} gün` : ''} · Gerçekleşmezse: {x.gerceklesmezse} · {x.durum}</span>
        {x.durum === 'Açık' && <div className="tam"><BelgeSec ad={`Koşul Kanıtı ${x.kimlik.slice(0, 6)}`} bagTuru="Dosya" bagKimligi={id} deger={kb} sec={setKb} /><button className="btn2 kucuk" disabled={!kb} onClick={() => void yap(() => istek(`/teklif-kosulu/${x.kimlik}/kapat`, { belge: kb }), 'Koşul kapatıldı.')}>Koşulu Kapat</button><label htmlFor={`de-rk-${x.kimlik}`}>Risk Kabulü Gerekçesi</label><input id={`de-rk-${x.kimlik}`} value={kg} onChange={(e) => setKg(e.target.value)} /><button className="btn2 kucuk" disabled={!kg.trim()} onClick={() => void yap(() => istek(`/teklif-kosulu/${x.kimlik}/risk-kabulu`, { gerekce: kg }), 'Risk kabulü onaya gönderildi.')}>Risk Kabulü İste</button></div>}
      </div>)}
      {teklifler.length > 0 && <>
        <label htmlFor="de-kt">Teklif</label><select id="de-kt" value={k.teklif} onChange={(e) => setK({ ...k, teklif: e.target.value })}><option value="">Seçiniz</option>{teklifler.map((t) => <option key={t.kimlik} value={t.kimlik}>{t.teklif_no} Rev.{t.surum_no}</option>)}</select>
        <label htmlFor="de-ke">Tamamlanacak Eylem</label><input id="de-ke" value={k.eylem} onChange={(e) => setK({ ...k, eylem: e.target.value })} />
        <label htmlFor="de-ks">Sorumlu</label><select id="de-ks" value={k.sorumlu} onChange={(e) => setK({ ...k, sorumlu: e.target.value })}><option value="">Seçiniz</option>{ekip.map((x) => <option key={x.kullanici} value={x.kullanici}>{x.ad_soyad} · {x.rol}</option>)}</select>
        <label htmlFor="de-kd">Koşul Son Tarihi</label><input id="de-kd" type="date" value={k.son} onChange={(e) => setK({ ...k, son: e.target.value })} />
        <label htmlFor="de-kg">Gerçekleşmezse Sonuç</label><input id="de-kg" value={k.gerceklesmezse} onChange={(e) => setK({ ...k, gerceklesmezse: e.target.value })} />
        <button className="btn2 kucuk" disabled={!k.teklif || !k.sorumlu || !k.eylem.trim() || !k.son || !k.gerceklesmezse.trim()} onClick={() => void yap(() => istek(`/teklif/${k.teklif}/kosul`, k), 'Koşul kaydedildi.')}>Koşul Ekle</button>
      </>}

      <div className="bolum">Kesin Teslim Tarihi</div>
      <div className="iki-tarih"><div><label htmlFor="de-kst">Kesin Teslim</label><input id="de-kst" type="date" value={kt.tarih} onChange={(e) => setKt({ ...kt, tarih: e.target.value })} /></div><div><label htmlFor="de-ksb">Gecikme Bedeli (EUR)</label><input id="de-ksb" inputMode="decimal" value={kt.bedel} onChange={(e) => setKt({ ...kt, bedel: e.target.value })} /></div></div>
      <div className="dugmeler"><button className="btn2 kucuk" disabled={!kt.tarih || !kt.bedel} onClick={() => void yap(() => istek(`/dosya/${id}/kesin-teslim`, { tarih: kt.tarih, gecikmeBedeli: sayi(kt.bedel) }), 'Kesin teslim tarihi Genel Müdür Yardımcısı onayına gönderildi.')}>Onaya Gönder</button><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/dosya/${id}/yurt-disi`, {}), 'Yurt dışı işaretlendi; teklif Genel Müdür Yardımcısı onayına gider.')}>Yurt Dışı Yat</button></div>

      <div className="bolum">Değişiklik Protokolü</div>
      {deg.map((x) => <div key={x.degisiklik_no}>{x.degisiklik_no} · {x.tur} · Eski: {x.mevcut} · Yeni: {x.onerilen} · Fark: {x.bedel_farki_eur} EUR · Onaylı Kümülatif: {x.kumulatif_eur} EUR · {x.ek_sure_gun} gün · {x.kanal} · Sigorta: {x.sigorta_onayi} · {x.durum}</div>)}
      <label htmlFor="de-pt">Değişiklik Türü</label><select id="de-pt" value={p.tur} onChange={(e) => setP({ ...p, tur: e.target.value })}>{['Değişiklik', 'İlave İş', 'Süre Uzatımı'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-pm">Mevcut Durum</label><input id="de-pm" value={p.mevcut} onChange={(e) => setP({ ...p, mevcut: e.target.value })} />
      <label htmlFor="de-po">Önerilen Durum</label><input id="de-po" value={p.onerilen} onChange={(e) => setP({ ...p, onerilen: e.target.value })} />
      <div className="iki-tarih"><div><label htmlFor="de-pf">Bedel Farkı (EUR)</label><input id="de-pf" inputMode="decimal" value={p.fark} onChange={(e) => setP({ ...p, fark: e.target.value })} /></div><div><label htmlFor="de-pn">Yeni Toplam (EUR)</label><input id="de-pn" inputMode="decimal" value={p.toplam} onChange={(e) => setP({ ...p, toplam: e.target.value })} /></div></div>
      <label htmlFor="de-ps">Ek Süre (Gün)</label><input id="de-ps" inputMode="numeric" value={p.sure} onChange={(e) => setP({ ...p, sure: e.target.value })} />
      <label htmlFor="de-pk">Protokol Onay Kanalı</label><select id="de-pk" value={p.kanal} onChange={(e) => setP({ ...p, kanal: e.target.value })}>{['YATONET 360', 'E-imza', 'Islak İmza'].map((x) => <option key={x}>{x}</option>)}</select>
      {p.kanal !== 'YATONET 360' && <BelgeSec ad="İmzalı Protokol" bagTuru="Dosya" bagKimligi={id} deger={pb} sec={setPb} />}
      <label htmlFor="de-pg">Sigorta Şirketi Onayı</label><select id="de-pg" value={p.sigorta} onChange={(e) => setP({ ...p, sigorta: e.target.value })}><option>Gerekli Değil</option><option>Alındı</option></select>
      {p.sigorta === 'Alındı' && <><label htmlFor="de-pd">Sigorta Onay Tarihi</label><input id="de-pd" type="date" value={p.starih} onChange={(e) => setP({ ...p, starih: e.target.value })} /></>}
      <button className="btn2 kucuk" disabled={!p.mevcut.trim() || !p.onerilen.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/degisiklik`, { tur: p.tur, mevcut: p.mevcut, onerilen: p.onerilen, bedelFarki: p.fark ? sayi(p.fark) : 0, yeniToplam: p.toplam ? sayi(p.toplam) : undefined, ekSure: Number(p.sure) || 0, kanal: p.kanal, belge: pb || undefined, sigortaOnayi: p.sigorta, sigortaTarih: p.starih || undefined }), 'Protokol kaydedildi.')}>Protokol Aç</button>

      <div className="bolum">Kurtarma, Çekme ve Dalgıçlık</div>
      {kur.map((x) => <div className="soru" key={x.kimlik}><span>{x.hizmet_turu}{x.acil ? ' · Acil' : ''} · {x.ticari_unvan} · Yat Sahibi: {x.yat_sahibi_onay_zamani ? 'Onaylı' : 'Bekleniyor'} · Firma: {x.firma_onay_zamani ? 'Onaylı' : 'Bekleniyor'} · Koordinatör: {x.koordinator_onay_zamani ? 'Onaylı' : 'Bekleniyor'}{x.baslama_zamani ? ' · Başladı' : ''}</span>
        {!x.baslama_zamani && <div className="tam">
          {!x.koordinator_onay_zamani && <><label htmlFor={`de-ko-${x.kimlik}`}>Koordinatör Onay Kodu</label><input id={`de-ko-${x.kimlik}`} inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} /><button className="btn2 kucuk" disabled={!kod} onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/koordinator-onay`, { kod }), 'Koordinatör onayı kaydedildi.')}>Koordinatör Onayı</button></>}
          {['Dalgıçlık', 'Birden Fazla'].includes(x.hizmet_turu) && <><BelgeSec ad="Liman İzni" bagTuru="Dosya" bagKimligi={id} deger={dalis.limanIzni} sec={(v) => setDalis({ ...dalis, limanIzni: v })} /><BelgeSec ad="Dalış Planı" bagTuru="Dosya" bagKimligi={id} deger={dalis.dalisPlani} sec={(v) => setDalis({ ...dalis, dalisPlani: v })} /><BelgeSec ad="Enerji İzolasyonu" bagTuru="Dosya" bagKimligi={id} deger={dalis.enerjiIzolasyonu} sec={(v) => setDalis({ ...dalis, enerjiIzolasyonu: v })} /></>}
          <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/baslat`, dalis), 'Operasyon başladı.')}>Operasyonu Başlat</button>
          <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/kurtarma/${x.kimlik}/saglayici-gorunur`, {}), 'Sağlayıcı yat sahibine gösterilecek.')}>Açıklama Onayı Var</button>
        </div>}
      </div>)}
      <label htmlFor="de-kh">Hizmet Türü</label><select id="de-kh" value={ku.hizmet} onChange={(e) => setKu({ ...ku, hizmet: e.target.value })}>{['Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Birden Fazla'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-kf">Sağlayıcı</label><select id="de-kf" value={ku.saglayici} onChange={(e) => setKu({ ...ku, saglayici: e.target.value })}><option value="">Seçiniz</option>{firmalar.map((f) => <option key={f.kurulus_ref} value={f.kurulus_ref}>{f.ticari_unvan}</option>)}</select>
      <label className="kutu"><input type="checkbox" checked={ku.acil} onChange={(e) => setKu({ ...ku, acil: e.target.checked })} /><span>Acil</span></label>
      <button className="btn2 kucuk" disabled={!ku.saglayici} onClick={() => void yap(() => istek(`/dosya/${id}/kurtarma`, ku), 'Kurtarma operasyonu açıldı; yat sahibi onayı gönderildi.')}>Operasyon Aç</button>

      <TeslimIslemleri id={id} yap={yap} />
      <SahaIslemleri id={id} yap={yap} />

      <div className="bolum">Acil Temas Kaydı</div>
      {tem.map((x, n) => <div key={n}>{x.tur} · {x.ozet} · {new Date(x.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}</div>)}
      <label htmlFor="de-tt">Muhatap</label><select id="de-tt" value={te.tur} onChange={(e) => setTe({ ...te, tur: e.target.value })}>{['112 Arandı', 'Marina Teması', 'Operasyon Müdürü Arandı', 'Refakatli Giriş', 'Sahil Güvenlik', 'Liman Başkanlığı', 'İl Çevre Müdürlüğü'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="de-to">Temas Özeti</label><input id="de-to" value={te.ozet} onChange={(e) => setTe({ ...te, ozet: e.target.value })} />
      <button className="btn2 kucuk" disabled={!te.ozet.trim()} onClick={() => void yap(() => istek(`/acil/${id}/temas`, te), 'Temas kaydedildi.')}>Temas Kaydet</button>
    </Blok>
  );
}

/** YG-062 geri alma; YG-208 kurumsal e-posta onayı; YG-189 firma fiyatı düzeltme. */
function TeklifIslemleri({ id, teklifler, firma, ticari, yap }: { id: string; teklifler: TeklifOz[]; firma: { kimlik: string; teklif_no: string }[]; ticari: boolean; yap: Yap }) {
  const [g, setG] = useState<Record<string, string>>({}); const [ep, setEp] = useState(''); const [eb, setEb] = useState(''); const [ft, setFt] = useState(''); const [kl, setKl] = useState<{ kimlik: string; satir_kodu: string; aciklama: string; birim_fiyat_eur: string; eski_fiyat_eur: string | null; iade_gerekcesi: string | null }[]>([]); const [dz, setDz] = useState<Record<string, { gerekce: string; fiyat: string }>>({}); const [db, setDb] = useState('');
  const kurumsal = teklifler.filter((t) => t.teklif_muhatabi === 'Kurumsal Müşteri' && t.statu === 'Gönderildi');
  const sg = teklifler.filter((t) => t.teklif_muhatabi === 'Sigorta Şirketi' && t.karar);
  return (<>
    {sg.map((t) => <div className="soru" key={`og-${t.kimlik}`}><span>{t.teklif_no}: Süre Dolumuyla Kabul</span><div className="tam"><label htmlFor={`og-${t.kimlik}`}>Geri Alma Gerekçesi</label><input id={`og-${t.kimlik}`} value={g[t.kimlik] ?? ''} onChange={(e) => setG({ ...g, [t.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!g[t.kimlik]?.trim()} onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/otomatik-kabul-geri`, { gerekce: g[t.kimlik] }), 'Kabul geri alındı.')}>Geri Al</button></div></div>)}
    {kurumsal.map((t) => <div className="soru" key={`ke-${t.kimlik}`}><span>{t.teklif_no}: Kurumsal E-posta Onayı</span><div className="tam"><label htmlFor={`ke-${t.kimlik}`}>Gönderen Adres</label><input id={`ke-${t.kimlik}`} type="email" value={ep} onChange={(e) => setEp(e.target.value)} /><BelgeSec ad={`Kurumsal Onay ${t.teklif_no}`} bagTuru="Dosya" bagKimligi={id} deger={eb} sec={setEb} /><button className="btn2 kucuk" disabled={!ep.trim() || !eb} onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/kurumsal-eposta-onay`, { gonderen: ep, belge: eb }), 'Onay kaydedildi.')}>Onayı Kaydet</button></div></div>)}
    {ticari && firma.length > 0 && <>
      <label htmlFor="fk-t">Firma Fiyat Düzeltme</label><select id="fk-t" value={ft} onChange={(e) => { setFt(e.target.value); if (e.target.value) void istek<typeof kl>(`/firma-teklif/${e.target.value}/kalemler`).then(setKl); else setKl([]); }}><option value="">Seçiniz</option>{firma.map((f) => <option key={f.kimlik} value={f.kimlik}>{f.teklif_no}</option>)}</select>
      {kl.length > 0 && <BelgeSec ad={`Firma Teklif Belgesi ${ft.slice(0, 6)}`} bagTuru="Dosya" bagKimligi={id} deger={db} sec={setDb} />}
      {kl.map((k) => { const d = dz[k.kimlik] ?? { gerekce: '', fiyat: '' }; const set = (x: Partial<typeof d>) => setDz({ ...dz, [k.kimlik]: { ...d, ...x } }); return <div className="soru" key={k.kimlik}><span>{k.satir_kodu} · {k.aciklama} · {k.birim_fiyat_eur} EUR{k.eski_fiyat_eur ? ` · Eski: ${k.eski_fiyat_eur} EUR` : ''}{k.iade_gerekcesi ? ' · Firmaya İade Edildi' : ''}</span><div className="tam"><label htmlFor={`dz-g-${k.kimlik}`}>Düzeltme Gerekçesi</label><input id={`dz-g-${k.kimlik}`} value={d.gerekce} onChange={(e) => set({ gerekce: e.target.value })} /><label htmlFor={`dz-f-${k.kimlik}`}>Doğru Fiyat (EUR)</label><input id={`dz-f-${k.kimlik}`} inputMode="decimal" value={d.fiyat} onChange={(e) => set({ fiyat: e.target.value })} /><div className="dugmeler"><button className="btn2 kucuk" disabled={!d.gerekce.trim()} onClick={() => void yap(() => istek(`/firma-kalem/${k.kimlik}/iade`, { gerekce: d.gerekce }), 'Kalem firmaya iade edildi.')}>Firmaya İade Et</button><button className="btn2 kucuk" disabled={!d.gerekce.trim() || !d.fiyat || !db} onClick={() => void yap(() => istek(`/firma-kalem/${k.kimlik}/lgm-duzeltme`, { fiyat: sayi(d.fiyat), gerekce: d.gerekce, belge: db }), 'Düzeltme Muhasebe ve Finans Müdürü onayına gönderildi.')}>LGM Düzeltmesi</button></div></div></div>; })}
    </>}
  </>);
}

/** İP-5: yat sahibi onayları, teslime hazır, onaysız teslim, yat kabul, sökülen parça, kapanış hesabı. */
function TeslimIslemleri({ id, yap }: { id: string; yap: Yap }) {
  const [on, setOn] = useState({ ony: 'ONY-03', parca: '', tutar: '', zaman: '', kayitNo: '', teklifNo: '' }); const [tes, setTes] = useState({ aliciTuru: 'Yetkili Temsilci', alici: '' }); const [foto, setFoto] = useState(''); const [ka, setKa] = useState({ teslimAlan: 'LGM', envanter: '', anahtarlar: '', sayaclar: '', yakit: '' }); const [kaF, setKaF] = useState(''); const [pa, setPa] = useState(''); const [parca, setParca] = useState<{ kimlik: string; parca_adi: string; secim: string | null; son_tarih: string }[]>([]); const [hs, setHs] = useState<Record<string, number> | null>(null); const [pf, setPf] = useState({ belge: '', aciklama: '' });
  const yp = () => istek<typeof parca>(`/dosya/${id}/sokulen-parca`).then(setParca);
  useEffect(() => { void yp().catch(() => {}); }, [id]);
  const AD: Record<string, string> = { 'ONY-03': 'Sigorta Bilgilendirmesi', 'ONY-06': 'Ek İş Ret Beyanı', 'ONY-07': 'Muadil Parça', 'ONY-08': 'İadesi Mümkün Olmayan Parça', 'ONY-09': 'Deniz Denemesi', 'ONY-10': 'Garanti İşi Planı' };
  return (<>
    <div className="bolum">Yat Sahibi Onayı İste</div>
    <label htmlFor="ts-o">Onay Türü</label><select id="ts-o" value={on.ony} onChange={(e) => setOn({ ...on, ony: e.target.value })}>{Object.entries(AD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    {['ONY-07', 'ONY-08'].includes(on.ony) && <><label htmlFor="ts-p">Parça Adı</label><input id="ts-p" value={on.parca} onChange={(e) => setOn({ ...on, parca: e.target.value })} /></>}
    {on.ony === 'ONY-08' && <><label htmlFor="ts-t">Parça Bedeli (EUR)</label><input id="ts-t" inputMode="decimal" value={on.tutar} onChange={(e) => setOn({ ...on, tutar: e.target.value })} /></>}
    {on.ony === 'ONY-09' && <><label htmlFor="ts-z">Deneme Tarih ve Saati</label><input id="ts-z" type="datetime-local" value={on.zaman} onChange={(e) => setOn({ ...on, zaman: e.target.value })} /></>}
    {on.ony === 'ONY-10' && <><label htmlFor="ts-k">Garanti Kayıt No</label><input id="ts-k" value={on.kayitNo} onChange={(e) => setOn({ ...on, kayitNo: e.target.value })} /></>}
    {on.ony === 'ONY-06' && <><label htmlFor="ts-n">Teklif No</label><input id="ts-n" value={on.teklifNo} onChange={(e) => setOn({ ...on, teklifNo: e.target.value })} /></>}
    <div className="dugmeler"><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/dosya/${id}/onay-iste`, { ony: on.ony, parca: on.parca || undefined, tutar: on.tutar ? sayi(on.tutar) : undefined, zaman: on.zaman || undefined, kayitNo: on.kayitNo || undefined, teklifNo: on.teklifNo || undefined }), 'Onay ekranı yat sahibine gönderildi.')}>Onay İste</button><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/acil/${id}/ilk-tedbir-talebi`, {}), 'Acil İlk Tedbir talebi gönderildi.')}>Acil İlk Tedbir Talebi</button></div>

    <DisTalepler id={id} />
    <DosyaDestek dosya={id} />
    <YatGecmisi dosya={id} />
    <KilometreTaslari dosya={id} />
    <KislikSorumlusu dosya={id} />
    <ErtelenenKalemler dosya={id} />
    <ResmiOnayIsaretleri dosya={id} />
    <YontemRaporu dosya={id} />
    <RiskRezervi dosya={id} />
    <TeslimSure dosya={id} />
    <SigortaFark dosya={id} />
    <OnerilenTesisler dosya={id} />
    <ZorlukKatsayisi dosya={id} />
    <OnDegerlendirme dosya={id} />
    <KritikBulgular dosya={id} />
    <Randevular dosya={id} />
    <IletisimBilgisi dosya={id} />
    <IcIlerleme dosya={id} />
    <IlkKapsam dosya={id} />
    <KatalogReferansi dosya={id} />
    <YatKarada dosya={id} />
    <HassasGorsel dosya={id} />
    <KurtarmaSonucKontrol dosya={id} />
    <DosyaPerformans dosya={id} />
    <GonderimDurumu id={id} />
    <div className="bolum">İlerleme Fotoğrafını Portala Aç</div>
    <BelgeSec ad="İlerleme Fotoğrafı" bagTuru="Dosya" bagKimligi={id} deger={pf.belge} sec={(x) => setPf({ ...pf, belge: x })} />
    <label htmlFor="pf-a">Yat Sahibinin Göreceği Açıklama</label><input id="pf-a" value={pf.aciklama} onChange={(e) => setPf({ ...pf, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={!pf.belge || !pf.aciklama.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/ilerleme-fotografi`, pf), 'Fotoğraf yat sahibi portalına açıldı.').then(() => setPf({ belge: '', aciklama: '' }))}>Portala Aç</button>
    <div className="bolum">Teslim</div>
    <div className="dugmeler"><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/dosya/${id}/teslime-hazir`, {}), 'Hazır bildirimi gönderildi; 7 gün başladı.')}>Teslime Hazır Bildir</button><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/dosya/${id}/teslim-hatirlat`, {}), 'Tek hatırlatma gönderildi.')}>Tutanak Hatırlat</button><button className="btn2 kucuk" onClick={() => void yap(() => istek<Record<string, number>>(`/dosya/${id}/kapanis-hesabi`).then(setHs))}>Kapanış Hesabı</button></div>
    {hs && <div>Onaylı: {hs.onayliKdvHaric} · Faturalı: {hs.faturali} · Tahsil: {hs.tahsil} · Açık Alacak: {hs.acikAlacak} · Firma Hakedişi: {hs.firmaHakedis} · Ödenen: {hs.firmayaOdenen} · Firma Borcu: {hs.firmaBorcu} EUR</div>}
    <label htmlFor="ts-at">Teslim Alan Türü</label><select id="ts-at" value={tes.aliciTuru} onChange={(e) => setTes({ ...tes, aliciTuru: e.target.value })}>{['Yat Sahibi', 'Yetkili Temsilci', 'Marina veya Tersane'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ts-a">Teslim Alan</label><input id="ts-a" value={tes.alici} onChange={(e) => setTes({ ...tes, alici: e.target.value })} />
    <BelgeSec ad="Teslim Fotoğrafı" bagTuru="Dosya" bagKimligi={id} deger={foto} sec={setFoto} />
    <button className="btn2 kucuk" disabled={!tes.alici.trim() || !foto} onClick={() => void yap(() => istek(`/dosya/${id}/teslim-onaysiz`, { ...tes, belge: foto }), 'Teslim edildi, onay verilmedi olarak kaydedildi.')}>Onaysız Teslimi Kaydet</button>
    <button className="btn2 kucuk" disabled={!tes.alici.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/tam-ziya-teslim`, { teslimAlan: `${tes.aliciTuru}: ${tes.alici.trim()}` }), 'Tam ziya teslimi kaydedildi; kapanışı başlatabilirsiniz.')}>Tam Ziya Teslimini Kaydet</button>

    <div className="bolum">Yat Teslim Alma ve Envanter Tutanağı (Yat Onarım Sözleşmesi Ek-2)</div>
    <label htmlFor="ka-t">Teslim Alan Taraf</label><select id="ka-t" value={ka.teslimAlan} onChange={(e) => setKa({ ...ka, teslimAlan: e.target.value })}><option>LGM</option><option>Görevli Firma</option></select>
    <label htmlFor="ka-e">Envanter</label><input id="ka-e" value={ka.envanter} onChange={(e) => setKa({ ...ka, envanter: e.target.value })} />
    <label htmlFor="ka-a">Anahtarlar</label><input id="ka-a" value={ka.anahtarlar} onChange={(e) => setKa({ ...ka, anahtarlar: e.target.value })} />
    <label htmlFor="ka-s">Sayaçlar</label><input id="ka-s" value={ka.sayaclar} onChange={(e) => setKa({ ...ka, sayaclar: e.target.value })} />
    <label htmlFor="ka-y">Yakıt Seviyesi</label><input id="ka-y" value={ka.yakit} onChange={(e) => setKa({ ...ka, yakit: e.target.value })} />
    <BelgeSec ad="Yat Kabul Fotoğrafları" bagTuru="Dosya" bagKimligi={id} deger={kaF} sec={setKaF} />
    <button className="btn2 kucuk" disabled={!kaF} onClick={() => void yap(() => istek(`/dosya/${id}/yat-kabul`, { ...ka, belge: kaF }), 'Yat kabul tutanağı kaydedildi.')}>Tutanağı Kaydet</button>

    <div className="bolum">Sökülen Parçalar</div>
    {parca.map((p) => <div key={p.kimlik}><label htmlFor={`spl-${p.kimlik}`}>{p.parca_adi} · Son: {gun(p.son_tarih)}</label><select id={`spl-${p.kimlik}`} value={p.secim ?? ''} onChange={(e) => void yap(() => istek(`/sokulen-parca/${p.kimlik}/secim`, { secim: e.target.value }).then(yp))}><option value="">Seçiniz</option>{['İade', 'Montaj', 'Süreli Bekletme', 'Hurda-Bertaraf', 'Sigorta Eksperi İncelemesi İçin Bekletme'].map((x) => <option key={x}>{x}</option>)}</select></div>)}
    <label htmlFor="sp-a">Parça Adı</label><input id="sp-a" value={pa} onChange={(e) => setPa(e.target.value)} />
    <button className="btn2 kucuk" disabled={!pa.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/sokulen-parca`, { ad: pa }).then(() => { setPa(''); return yp(); }), 'Parça eklendi.')}>Parça Ekle</button>
  </>);
}

/** İP-7: geçici onarım, kaldırma ve taşıma, hiza, kaptan görevlendirme. */
function SahaIslemleri({ id, yap }: { id: string; yap: Yap }) {
  const [g, setG] = useState({ islem: '', uygulama: '', kullanim: '', son: '', suAlma: false }); const [l, setL] = useState<{ kimlik: string; islem: string; son_gecerlilik: string; uzatma_sayisi: number; durum: string }[]>([]); const [uz, setUz] = useState(''); const [t, setT] = useState({ tur: 'Kaldırma', ekipman: '', kapasite: '', agirlik: '', yeniHasar: false }); const [hz, setHz] = useState(''); const [kp, setKp] = useState<{ kimlik: string; ad_soyad: string; ticari_unvan: string; gecerli: boolean }[]>([]); const [ks, setKs] = useState(''); const [hg, setHg] = useState('');
  const yk = () => istek<typeof l>(`/dosya/${id}/gecici-onarim`).then(setL);
  useEffect(() => { void yk().catch(() => {}); void istek<typeof kp>('/kaptanlar').then(setKp).catch(() => {}); }, [id]);
  return (<>
    <div className="bolum">Geçici Onarım</div>
    {l.map((x) => <div className="soru" key={x.kimlik}><span>{x.islem} · Son: {gun(x.son_gecerlilik)} · Uzatma: {x.uzatma_sayisi}/2 · {x.durum}</span>{x.durum === 'Açık' && <div className="tam"><label htmlFor={`gu-${x.kimlik}`}>Yeni Son Tarih</label><input id={`gu-${x.kimlik}`} type="date" value={uz} onChange={(e) => setUz(e.target.value)} /><div className="dugmeler"><button className="btn2 kucuk" disabled={!uz} onClick={() => void yap(() => istek(`/gecici-onarim/${x.kimlik}/uzat`, { son: uz }).then(yk), 'Süre uzatıldı.')}>Uzat</button><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/gecici-onarim/${x.kimlik}/kapat`, {}).then(yk), 'Geçici onarım kapatıldı.')}>Kapat</button></div></div>}</div>)}
    <label htmlFor="go-i">Geçici İşlem</label><input id="go-i" value={g.islem} onChange={(e) => setG({ ...g, islem: e.target.value })} />
    <label htmlFor="go-k">İzin Verilen Kullanım</label><input id="go-k" value={g.kullanim} onChange={(e) => setG({ ...g, kullanim: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="go-u">Uygulama Tarihi</label><input id="go-u" type="date" value={g.uygulama} onChange={(e) => setG({ ...g, uygulama: e.target.value })} /></div><div><label htmlFor="go-s">Son Geçerlilik</label><input id="go-s" type="date" value={g.son} onChange={(e) => setG({ ...g, son: e.target.value })} /></div></div>
    <label className="kutu"><input type="checkbox" checked={g.suAlma} onChange={(e) => setG({ ...g, suAlma: e.target.checked })} /><span>Su Alma Riski</span></label>
    <button className="btn2 kucuk" disabled={!g.islem.trim() || !g.uygulama || !g.son || !g.kullanim.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/gecici-onarim`, g).then(yk), 'Geçici onarım kaydedildi.')}>Geçici Onarım Kaydet</button>

    <div className="bolum">Kaldırma ve Taşıma</div>
    <label htmlFor="kt-t">İşlem</label><select id="kt-t" value={t.tur} onChange={(e) => setT({ ...t, tur: e.target.value })}>{['Kaldırma', 'Taşıma', 'Tesis Değişikliği'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="kt-e">Ekipman</label><input id="kt-e" value={t.ekipman} onChange={(e) => setT({ ...t, ekipman: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="kt-k">Kapasite (ton)</label><input id="kt-k" inputMode="decimal" value={t.kapasite} onChange={(e) => setT({ ...t, kapasite: e.target.value })} /></div><div><label htmlFor="kt-a">Yat Ağırlığı (ton)</label><input id="kt-a" inputMode="decimal" value={t.agirlik} onChange={(e) => setT({ ...t, agirlik: e.target.value })} /></div></div>
    <label className="kutu"><input type="checkbox" checked={t.yeniHasar} onChange={(e) => setT({ ...t, yeniHasar: e.target.checked })} /><span>Yeni Hasar Oluştu</span></label>
    <button className="btn2 kucuk" disabled={!t.ekipman.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/kaldirma-tasima`, { tur: t.tur, ekipman: t.ekipman, kapasite: t.kapasite ? sayi(t.kapasite) : undefined, agirlik: t.agirlik ? sayi(t.agirlik) : undefined, yeniHasar: t.yeniHasar }), 'Kaydedildi.')}>Kaydı Gir</button>
    <label htmlFor="kt-h">Hukuk Onayı Gerekçesi</label><input id="kt-h" value={hg} onChange={(e) => setHg(e.target.value)} /><button className="btn2 kucuk" disabled={!hg.trim()} onClick={() => void yap(() => istek(`/dosya/${id}/tasima-onayi`, { gerekce: hg }), 'Hukuk ve Uyum Direktörü onayına gönderildi.')}>Taşıma Onayı İste</button>

    <div className="bolum">Deniz Denemesi ve Kaptan</div>
    <BelgeSec ad="Ana Makine Hiza Ölçümü" bagTuru="Dosya" bagKimligi={id} deger={hz} sec={setHz} /><button className="btn2 kucuk" disabled={!hz} onClick={() => void yap(() => istek(`/dosya/${id}/hiza-kontrolu`, { belge: hz }), 'Hiza kontrolü kaydedildi.')}>Hiza Kontrolünü Kaydet</button>
    <label htmlFor="kp-s">Kaptan</label><select id="kp-s" value={ks} onChange={(e) => setKs(e.target.value)}><option value="">Seçiniz</option>{kp.map((x) => <option key={x.kimlik} value={x.kimlik} disabled={!x.gecerli}>{x.ad_soyad} · {x.ticari_unvan}{x.gecerli ? '' : ' · Belge Süresi Dolmuş'}</option>)}</select>
    <button className="btn2 kucuk" disabled={!ks} onClick={() => void yap(() => istek(`/dosya/${id}/kaptan-gorevlendirme`, { kaptan: ks }), 'Kaptan görevlendirildi.')}>Kaptan Görevlendir</button>
  </>);
}

/** YG-456: Ticari İşler Direktörü mutabakat raporunu gönderir; ikili teyit sonrası itiraz süresi başlar. */
export function MutabakatRaporlari() {
  const [l, setL] = useState<{ kimlik: string; sigortaci_adi: string; donem: string; kesim_tarihi: string; itiraz_son: string | null; durum: string; satirlar: { kimlik: string; dosya_no: string; fatura_no: string; acik_bakiye: string; itiraz_edildi: boolean; mutabik: boolean }[] }[] | null>(null); const [not, setNot] = useState<Record<string, string>>({});
  const yukle = () => istek<NonNullable<typeof l>>('/mutabakat').then(setL).catch(() => setL(null));
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle(); }, []);
  if (!l) return null;
  return (
    <Blok baslik="Sigorta Mutabakat Raporları"><Mesaj />
      {l.length === 0 && <div className="not">Rapor bulunmamaktadır.</div>}
      {l.map((r) => <div className="soru" key={r.kimlik}><span><b className="koyu">{r.sigortaci_adi}</b> · {r.donem} · {r.durum}{r.itiraz_son ? ` · İtiraz Son: ${gun(r.itiraz_son)}` : ''}</span>
        <div className="tam">
          {r.satirlar.map((s) => <div key={s.kimlik}>{s.dosya_no} · {s.fatura_no} · Açık: {s.acik_bakiye} EUR{s.itiraz_edildi ? ' · İtiraz' : ''}{s.mutabik ? ' · Mutabık' : ''}{r.durum === 'Gönderildi' && !s.itiraz_edildi && <><label htmlFor={`mu-${s.kimlik}`}>İtiraz Notu</label><input id={`mu-${s.kimlik}`} value={not[s.kimlik] ?? ''} onChange={(e) => setNot({ ...not, [s.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!not[s.kimlik]?.trim()} onClick={() => void yap(() => istek(`/mutabakat-satiri/${s.kimlik}/itiraz`, { not: not[s.kimlik] }), 'İtiraz kaydedildi.')}>İtirazı Kaydet</button></>}</div>)}
          {r.durum === 'Hazır' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/mutabakat/${r.kimlik}/gonder`, {}), 'Rapor ikili teyide gönderildi.')}>Raporu Gönder</button>}
        </div>
      </div>)}
    </Blok>
  );
}

/** YG-210, YG-273: firma kurtarma onayı ve acil müsaitlik. */
export function FirmaAcilIslemleri({ yap }: { yap: Yap }) {
  const [it, setIt] = useState<{ garanti: { kimlik: string; kayit_no: string; firma_itiraz: string | null }[]; mahsup: { kimlik: string; tur: string; tutar_eur: string; aciklama: string; firma_itiraz: string | null }[] } | null>(null); const [ig, setIg] = useState<Record<string, string>>({});
  const yi = () => istek<NonNullable<typeof it>>('/firma-portal/itirazlar').then(setIt);
  useEffect(() => { void yi().catch(() => {}); }, []);
  const [l, setL] = useState<{ kimlik: string; hizmet_turu: string; acil: boolean; firma_onay_zamani: string | null; dosya_no: string }[]>([]); const [kod, setKod] = useState(''); const [m, setM] = useState({ musait: true, dk: '' });
  useEffect(() => { void istek<typeof l>('/firma-portal/kurtarma').then(setL).catch(() => {}); }, []);
  return (<>
    {l.filter((x) => !x.firma_onay_zamani).map((x) => <div className="ozet" key={x.kimlik}><div>{x.dosya_no} · {x.hizmet_turu}{x.acil ? ' · Acil' : ''} Sözleşmesi</div><label htmlFor={`fk-${x.kimlik}`}>Onay Kodu</label><input id={`fk-${x.kimlik}`} inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} /><button className="btn2" disabled={!kod} onClick={() => void yap(() => istek(`/firma-portal/kurtarma/${x.kimlik}/onay`, { kod }).then(() => istek<typeof l>('/firma-portal/kurtarma').then(setL)), 'Onayınız kaydedildi.')}>Sözleşmeyi Onayla</button></div>)}
    {it?.garanti.filter((x) => !x.firma_itiraz).map((x) => <div className="ozet" key={x.kimlik}><div>Garanti Kararı: {x.kayit_no} (2 iş günü içinde itiraz edebilirsiniz)</div><label htmlFor={`gi-${x.kimlik}`}>İtiraz Gerekçesi</label><input id={`gi-${x.kimlik}`} value={ig[x.kimlik] ?? ''} onChange={(e) => setIg({ ...ig, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!ig[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/firma-portal/garanti/${x.kimlik}/itiraz`, { gerekce: ig[x.kimlik] }).then(yi), 'İtirazınız alındı.')}>İtiraz Et</button></div>)}
    {it?.mahsup.filter((x) => !x.firma_itiraz).map((x) => <div className="ozet" key={x.kimlik}><div>Rücu ve Mahsup: {x.tur} · {x.tutar_eur} EUR · {x.aciklama} (5 iş günü içinde itiraz edebilirsiniz)</div><label htmlFor={`mi-${x.kimlik}`}>İtiraz Gerekçesi</label><input id={`mi-${x.kimlik}`} value={ig[x.kimlik] ?? ''} onChange={(e) => setIg({ ...ig, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!ig[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/firma-portal/mahsup/${x.kimlik}/itiraz`, { gerekce: ig[x.kimlik] }).then(yi), 'İtirazınız alındı.')}>İtiraz Et</button></div>)}
    <div className="ozet"><label className="kutu"><input type="checkbox" checked={m.musait} onChange={(e) => setM({ ...m, musait: e.target.checked })} /><span>Acil Göreve Müsaitim</span></label><label htmlFor="fk-dk">Yanıt Süresi (Dakika)</label><input id="fk-dk" inputMode="numeric" value={m.dk} onChange={(e) => setM({ ...m, dk: e.target.value })} /><button className="btn2" disabled={!m.dk} onClick={() => void yap(() => istek('/firma-portal/acil-musaitlik', { musait: m.musait, yanitDk: Number(m.dk) }), 'Müsaitlik kaydedildi.')}>Müsaitliği Kaydet</button></div>
  </>);
}

/** YG-1078: Direktör ve üstü; diğer kullanıcılara bölüm görünmez. */
export function YasalAyipRaporu() {
  const [v, setV] = useState<{ ayip: { kayit_no: string; dosya_no: string; statu: string; karar: string | null; tarih: string }[]; rucu: { dosya_no: string; ticari_unvan: string; tur: string; tutar_eur: string; kalan_eur: string; statu: string; tarih: string }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/rapor/yasal-ayip').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  return <><div className="bolum">Yasal Ayıp ve Rücu Kayıtları</div><div className="dugmeler"><a href="/api/rapor/yasal-ayip.csv">Dışa Aktar (CSV)</a></div><div className="ozet">{v.ayip.length === 0 && v.rucu.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{v.ayip.map((a) => <div key={a.kayit_no}>{a.dosya_no} · {a.kayit_no} · {a.statu}{a.karar ? ` · ${a.karar}` : ''} · {a.tarih}</div>)}{v.rucu.map((r, n) => <div key={n}>{r.dosya_no} · {r.ticari_unvan} · {r.tur} · {r.tutar_eur} EUR · Kalan: {r.kalan_eur} EUR · {r.statu}</div>)}</div></>;
}

/** YG-1299: Sağlayıcı ve Sözleşme Matrisi; yurt dışında KVKK m.9 dayanağı ve maskeleme kuralı zorunlu. */
export function SaglayiciMatrisi() {
  const bos = { baglanti: '', saglayici: '', veriYeri: 'Türkiye', ulke: '', erisim: '', ucret: '', seviye: '', yedek: '', kvkk: false, m9: '', maskeleme: '', kurulBildirim: '' };
  const [l, setL] = useState<{ kimlik: string; baglanti: string; saglayici: string; veri_yeri: string; ulke: string | null; kvkk_sozlesmesi: boolean; m9_dayanak: string | null; hizmet_seviyesi: string | null; yedek_saglayici: string | null }[] | null>(null); const [f, setF] = useState(bos); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/saglayici-matrisi').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const A = (k: keyof typeof bos, et: string) => <><label htmlFor={`sm-${k}`}>{et}</label><input id={`sm-${k}`} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <><div className="bolum">Sağlayıcı ve Sözleşme Matrisi</div>{m && <div className="not" role="status">{m}</div>}<div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.baglanti} · {x.saglayici} · {x.veri_yeri}{x.ulke ? ` (${x.ulke})` : ''} · KVKK sözleşmesi: {x.kvkk_sozlesmesi ? 'Var' : '⚠ Yok'}{x.m9_dayanak ? ` · m.9: ${x.m9_dayanak}` : ''}{x.yedek_saglayici ? ` · Yedek: ${x.yedek_saglayici}` : ''}</div>)}</div>
    <div className="ozet">{A('baglanti', 'Bağlantı (ör. SMS, WhatsApp, E-posta)')}{A('saglayici', 'Sağlayıcı')}<label htmlFor="sm-v">Veri Yeri</label><select id="sm-v" value={f.veriYeri} onChange={(e) => setF({ ...f, veriYeri: e.target.value })}><option>Türkiye</option><option>Yurt Dışı</option></select>{f.veriYeri === 'Yurt Dışı' && <>{A('ulke', 'Ülke')}{A('m9', 'KVKK m.9 Dayanağı')}{A('maskeleme', 'Maskeleme Kuralı')}{A('kurulBildirim', 'Kurula Bildirim Tarihi (YYYY-AA-GG)')}</>}{A('erisim', 'Erişim Yöntemi')}{A('ucret', 'Ücret')}{A('seviye', 'Hizmet Seviyesi')}{A('yedek', 'Yedek Sağlayıcı')}<label className="kutu"><input type="checkbox" checked={f.kvkk} onChange={(e) => setF({ ...f, kvkk: e.target.checked })} /><span>KVKK Veri İşleyen Sözleşmesi İmzalandı</span></label>
      <button className="btn2" onClick={() => void istek('/saglayici-matrisi', { ...f, kurulBildirim: f.kurulBildirim || undefined }).then(() => { setF(bos); setM('Kayıt eklendi.'); return yk(); }).catch((e) => setM(e.message))}>Matrise Ekle</button></div></>;
}

/** YG-826: mali parametreler; boş değer işlemi bir üst onaya gönderir. Her değişiklik gerekçeyle kayda geçer. */
export function MaliParametreler() {
  const [l, setL] = useState<{ kod: string; deger: string | null; aciklama: string }[] | null>(null); const [d, setD] = useState<Record<string, string>>({}); const [g, setG] = useState(''); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/parametreler').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  return <><div className="bolum">Mali Parametreler</div>{m && <div className="not" role="status">{m}</div>}<label htmlFor="mp-g">Değişiklik Gerekçesi</label><input id="mp-g" value={g} onChange={(e) => setG(e.target.value)} /><div className="ozet">{l.map((x) => <div key={x.kod}>{x.aciklama}: {x.deger ?? '⚠ Tanımsız (işlem bir üst onaya gider)'} <input aria-label={`${x.aciklama} yeni değer`} value={d[x.kod] ?? ''} onChange={(e) => setD({ ...d, [x.kod]: e.target.value })} /> <button className="btn2 kucuk" disabled={!g.trim() || d[x.kod] === undefined} onClick={() => void istek(`/parametre/${x.kod}`, { deger: d[x.kod] === '' ? null : Number(String(d[x.kod]).replace(',', '.')), gerekce: g }).then(() => { setM('Parametre güncellendi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>)}</div></>;
}

/** YG-1472: resmî tatil ve arife takvimi (yıllık parametre). Arife yarım iş günü sayılır. */
export function TatilTakvimi() {
  const [l, setL] = useState<{ tarih: string; ad: string; yarim_gun: boolean }[] | null>(null); const [f, setF] = useState({ tarih: '', ad: '', arife: false }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/takvim').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  return <><div className="bolum">Resmî Tatil ve Arife Takvimi</div>{m && <div className="not" role="status">{m}</div>}<div className="ozet">{l.length === 0 && <div className="not">⚠ Takvim boş: iş günü sayaçları yalnız Pazar gününü düşüyor.</div>}{l.map((x) => <div key={x.tarih}>{x.tarih.split('-').reverse().join('.')} · {x.ad}{x.yarim_gun ? ' (Arife, yarım gün)' : ''} <button className="btn2 kucuk" onClick={() => void istek('/takvim', { tarih: x.tarih, sil: true }).then(() => yk()).catch((e) => setM(e.message))}>Kaldır</button></div>)}</div>
    <label htmlFor="tt-t">Tarih</label><input id="tt-t" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /><label htmlFor="tt-a">Tatil Adı</label><input id="tt-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} /><label className="kutu"><input type="checkbox" checked={f.arife} onChange={(e) => setF({ ...f, arife: e.target.checked })} /><span>Arife (Yarım Gün)</span></label>
    <button className="btn2" onClick={() => void istek('/takvim', f).then(() => { setF({ tarih: '', ad: '', arife: false }); setM('Takvim güncellendi.'); return yk(); }).catch((e) => setM(e.message))}>Takvime Ekle</button></>;
}

/** CEO 06.11.2026: yıllık bütçe; birimler talep girer, CEO nihai onay toplantısında onaylar. */
export function ButceDonemi() {
  const [yil, setYil] = useState(new Date().getFullYear() + 1);
  const [v, setV] = useState<{ durum: string; talepler: { kimlik: string; birim: string; kategori: string; aciklama: string; tutar_eur: string; gerekce: string }[]; kategoriToplam: { ad: string; tutarEur: number }[]; birimlerim: string[]; kategoriler: string[]; onaylayabilir: boolean } | null>(null);
  const [f, setF] = useState({ birim: '', kategori: '', aciklama: '', tutar: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/butce/${yil}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [yil]);
  if (!v) return null;
  const para = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toplam = v.kategoriToplam.reduce((a, x) => a + x.tutarEur, 0);
  return <><div className="bolum">Bütçe Dönemi</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="bd-y">Bütçe Yılı</label><input id="bd-y" type="number" value={yil} onChange={(e) => setYil(Number(e.target.value))} />
    <div className="ozet"><div>Durum: {v.durum}</div>{v.kategoriToplam.map((x) => <div key={x.ad}>{x.ad}: {para(x.tutarEur)} EUR</div>)}<div><b>Toplam: {para(toplam)} EUR</b></div></div>
    <div className="ozet">{v.talepler.map((x) => <div key={x.kimlik}>{x.birim} · {x.kategori} · {x.aciklama} · {para(Number(x.tutar_eur))} EUR · {x.gerekce}</div>)}</div>
    {v.durum === 'Hazırlık' && v.birimlerim.length > 0 && <>
      {v.birimlerim.length > 1 && <><label htmlFor="bd-b">Birim</label><select id="bd-b" value={f.birim} onChange={(e) => setF({ ...f, birim: e.target.value })}><option value="">Seçiniz</option>{v.birimlerim.map((x) => <option key={x}>{x}</option>)}</select></>}
      <label htmlFor="bd-k">Kategori</label><select id="bd-k" value={f.kategori} onChange={(e) => setF({ ...f, kategori: e.target.value })}><option value="">Seçiniz</option>{v.kategoriler.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="bd-a">Kalem Açıklaması</label><input id="bd-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <label htmlFor="bd-t">Tutar (EUR)</label><input id="bd-t" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} />
      <label htmlFor="bd-g">Gerekçe</label><input id="bd-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
      <button className="btn2" onClick={() => void istek(`/butce/${yil}/talep`, { ...f, birim: f.birim || undefined, tutar: Number(f.tutar.replace(/\./g, '').replace(',', '.')) }).then(() => { setF({ ...f, aciklama: '', tutar: '', gerekce: '' }); setM('Talep eklendi.'); return yk(); }).catch((e) => setM(e.message))}>Talep Ekle</button></>}
    {v.durum === 'Hazırlık' && v.onaylayabilir && <button className="btn2" onClick={() => void istek(`/butce/${yil}/onay`, {}).then(() => { setM('Bütçe onaylandı.'); return yk(); }).catch((e) => setM(e.message))}>Bütçeyi Onayla</button>}</>;
}

/** YG-532: LGM poliçesi, imza sirküleri, broker ve acente yetki belgeleri; bitişe göre uyarı. */
/** YG-1145: tamamlanan, bekleyen ve başarısız gönderim parçaları ayrı görünür. */
function GonderimDurumu({ id }: { id: string }) {
  const [v, setV] = useState<{ ozet: { tamamlandi: number; bekliyor: number; basarisiz: number }; satirlar: { kanal: string; konu: string; hedef: string; parca: string; deneme: number }[] } | null>(null);
  return <><div className="bolum">Gönderim Durumu</div>
    <button className="btn2 kucuk" onClick={() => void istek<NonNullable<typeof v>>(`/dosya/${id}/gonderimler`).then(setV).catch(() => setV(null))}>Gönderimleri Göster</button>
    {v && <div className="ozet"><div>Tamamlandı: {v.ozet.tamamlandi} · Bekliyor: {v.ozet.bekliyor} · Başarısız: {v.ozet.basarisiz}</div>{v.satirlar.map((x, n) => <div key={n}>{x.parca} · {x.kanal} · {x.konu} · {x.hedef}{x.deneme > 1 ? ` · ${x.deneme} deneme` : ''}</div>)}</div>}</>;
}

/** YG-1272: dışarıdan gelen banka, fiyat, kapsam veya teslim değişikliği; kayıtlı numaradan teyit edilmeden uygulanmaz. */
function DisTalepler({ id }: { id: string }) {
  const [l, setL] = useState<{ kimlik: string; tur: string; gelis_kanali: string; gonderen: string; ozet: string; durum: string; guvenlik_uyarisi: string | null }[]>([]); const [f, setF] = useState({ tur: 'Kapsam', kanal: 'E-posta', gonderen: '', ozet: '' }); const [ty, setTy] = useState({ telefon: '', not: '' }); const [m, setM] = useState('');
  const yk = () => istek<typeof l>(`/dosya/${id}/dis-talepler`).then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, [id]);
  const teyit = (k: string, sonuc: string) => void istek(`/dis-talep/${k}/teyit`, { ...ty, sonuc }).then(() => { setM('Teyit kaydedildi.'); setTy({ telefon: '', not: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Dışarıdan Gelen Değişiklik Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.tur} · {x.gelis_kanali} · {x.gonderen} · {x.ozet} · {x.durum}{x.guvenlik_uyarisi ? ` · ${x.guvenlik_uyarisi}` : ''}
      {x.durum === 'Teyit Bekliyor' && <><button className="btn2 kucuk" disabled={!ty.telefon.trim() || !ty.not.trim()} onClick={() => teyit(x.kimlik, 'Teyit Edildi')}>Teyit Edildi</button><button className="btn2 kucuk" disabled={!ty.telefon.trim() || !ty.not.trim()} onClick={() => teyit(x.kimlik, 'Teyit Edilmedi')}>Teyit Edilmedi</button></>}</div>)}</div>
    {l.some((x) => x.durum === 'Teyit Bekliyor') && <><label htmlFor="dt-tel">Aranan Kayıtlı Numara</label><input id="dt-tel" value={ty.telefon} onChange={(e) => setTy({ ...ty, telefon: e.target.value })} /><label htmlFor="dt-not">Görüşme Notu</label><input id="dt-not" value={ty.not} onChange={(e) => setTy({ ...ty, not: e.target.value })} /></>}
    <label htmlFor="dt-t">Talep Türü</label><select id="dt-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Banka', 'Fiyat', 'Kapsam', 'Teslim'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="dt-k">Geldiği Kanal</label><select id="dt-k" value={f.kanal} onChange={(e) => setF({ ...f, kanal: e.target.value })}>{['E-posta', 'WhatsApp', 'Telefon', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="dt-g">Gönderen (adres veya numara)</label><input id="dt-g" value={f.gonderen} onChange={(e) => setF({ ...f, gonderen: e.target.value })} />
    <label htmlFor="dt-o">Talep Özeti</label><input id="dt-o" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.gonderen.trim() || !f.ozet.trim()} onClick={() => void istek<{ uyari: string | null }>(`/dosya/${id}/dis-talep`, f).then((r) => { setM(r.uyari ?? 'Talep kaydedildi; kayıtlı numaradan teyit bekleniyor.'); setF({ ...f, gonderen: '', ozet: '' }); return yk(); }).catch((e) => setM(e.message))}>Talebi Kaydet</button></>;
}

/** YG-1081, YG-859: kartela maliyeti yalnız Ticari İşler Direktörü ve CEO; taslak sürümde girilir, CEO onayıyla yürürlüğe girer. */
export function KartelaMaliyet() {
  const [v, setV] = useState<{ surum: string; taslak: boolean; kalemler: { kod: string; islem: string; birim: string; maliyet_eur: string; maliyet_tarihi: string | null; kaynak_norm: string | null }[] } | null>(null); const [q, setQ] = useState(''); const [f, setF] = useState({ kod: '', maliyet: '', tarih: '', kaynak: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/kartela/maliyet?q=${encodeURIComponent(q)}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [q]);
  if (!v) return null;
  const is = (u: string, g: object, ok: string) => void istek(u, g).then(() => { setM(ok); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kartela Maliyetleri · {v.surum}{v.taslak ? ' (Taslak)' : ' (Yürürlükte)'}</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="km-q">Kalem Ara</label><input id="km-q" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="ozet">{v.kalemler.map((x) => <div key={x.kod}>{x.kod} · {x.islem} · {x.birim} · {Number(x.maliyet_eur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR · {x.maliyet_tarihi ? x.maliyet_tarihi.split('-').reverse().join('.') : 'Tarih yok'} · {x.kaynak_norm ?? 'Kaynak yok'}</div>)}</div>
    {!v.taslak && <button className="btn2" onClick={() => is('/kartela/taslak', {}, 'Taslak sürüm açıldı.')}>Taslak Sürüm Aç</button>}
    {v.taslak && <>
      <label htmlFor="km-k">Kalem Kodu</label><input id="km-k" value={f.kod} onChange={(e) => setF({ ...f, kod: e.target.value })} />
      <label htmlFor="km-m">Maliyet (EUR)</label><input id="km-m" inputMode="decimal" value={f.maliyet} onChange={(e) => setF({ ...f, maliyet: e.target.value })} />
      <label htmlFor="km-t">Maliyet Tarihi</label><input id="km-t" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} />
      <label htmlFor="km-n">Kaynak Norm</label><input id="km-n" value={f.kaynak} onChange={(e) => setF({ ...f, kaynak: e.target.value })} />
      <div className="dugmeler"><button className="btn2" onClick={() => is('/kartela/taslak/maliyet', { ...f, maliyet: Number(f.maliyet.replace(/\./g, '').replace(',', '.')) }, 'Maliyet kaydedildi.')}>Maliyeti Kaydet</button><button className="btn2" onClick={() => is('/kartela/taslak/onaya-gonder', {}, 'Sürüm CEO onayına gönderildi.')}>Yürürlüğe Almak İçin Onaya Gönder</button></div></>}</>;
}

/** YG-1660: Firma Kapsama Raporu (BT ve Firma Yönetimi Direktörü) ve aday raporu (GMY). Yetkisiz rolde görünmez. */
export function FirmaKapsamaRaporu() {
  const [aday, setAday] = useState(false); const [l, setL] = useState<{ ana_brans: string; kapsama: string; bolge: string; firma: number }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>(`/rapor/firma-kapsama${aday ? '?aday=1' : ''}`).then(setL).catch(() => setL(null)); }, [aday]);
  if (!l) return null;
  return <><div className="bolum">{aday ? 'Aday Firma Kapsama Raporu' : 'Firma Kapsama Raporu'}</div>
    <label className="kutu"><input type="checkbox" checked={aday} onChange={(e) => setAday(e.target.checked)} /><span>Aday firmalar</span></label>
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={`${x.ana_brans}-${x.kapsama}-${x.bolge}`}>{x.ana_brans} · {x.kapsama} · {x.bolge} · {x.firma === 0 ? 'Boş' : `${x.firma} firma`}</div>)}</div></>;
}

/** YG-1660: yurt dışı yerel firma talebi; Operasyon Müdürü açar, iki onay birbirini beklemez. */
export function YurtDisiFirmaTalebi() {
  const [l, setL] = useState<{ kimlik: string; ulke: string; sehir: string; ana_brans: string; fym_karari: string | null; hud_karari: string | null; durum: string }[] | null>(null); const [f, setF] = useState({ ulke: '', sehir: '', brans: '', firma: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/firma/yurt-disi-talep').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  return <><div className="bolum">Yurt Dışı Yerel Firma Talepleri</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.ulke} / {x.sehir} · {x.ana_brans} · Firma Yönetimi: {x.fym_karari ?? 'Bekliyor'} · Hukuk: {x.hud_karari ?? 'Bekliyor'} · {x.durum}</div>)}</div>
    <label htmlFor="yd-u">Ülke</label><input id="yd-u" value={f.ulke} onChange={(e) => setF({ ...f, ulke: e.target.value })} />
    <label htmlFor="yd-s">Şehir</label><input id="yd-s" value={f.sehir} onChange={(e) => setF({ ...f, sehir: e.target.value })} />
    <label htmlFor="yd-b">Branş</label><input id="yd-b" value={f.brans} onChange={(e) => setF({ ...f, brans: e.target.value })} />
    <label htmlFor="yd-f">Önerilen Firma (varsa)</label><input id="yd-f" value={f.firma} onChange={(e) => setF({ ...f, firma: e.target.value })} />
    <label htmlFor="yd-g">Gerekçe</label><input id="yd-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2" onClick={() => void istek('/firma/yurt-disi-talep', { ...f, firma: f.firma || undefined }).then(() => { setF({ ulke: '', sehir: '', brans: '', firma: '', gerekce: '' }); setM('Talep onaya gönderildi.'); return yk(); }).catch((e) => setM(e.message))}>Talep Aç</button></>;
}

export function KurumBelgeleri() {
  const T = ['LGM Sigorta Poliçesi', 'İmza Sirküleri', 'Broker Yetki Belgesi', 'Acente Yetki Belgesi'];
  const [l, setL] = useState<{ kimlik: string; tur: string; ad: string; karsi_taraf: string | null; bitis: string; durum: string }[] | null>(null); const [f, setF] = useState({ tur: '', ad: '', karsiTaraf: '', bitis: '', yenilenen: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/kurum-belgesi').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  return <><div className="bolum">Kurumsal Belgeler</div>{m && <div className="not" role="status">{m}</div>}<div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.tur} · {x.ad}{x.karsi_taraf ? ` · ${x.karsi_taraf}` : ''} · Bitiş: {x.bitis.split('-').reverse().join('.')} · {x.durum}</div>)}</div>
    <label htmlFor="kb-t">Belge Türü</label><select id="kb-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}><option value="">Seçiniz</option>{T.map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="kb-a">Belge Adı / No</label><input id="kb-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
    <label htmlFor="kb-k">Karşı Taraf (Sigorta Şirketi, Broker, Acente)</label><input id="kb-k" value={f.karsiTaraf} onChange={(e) => setF({ ...f, karsiTaraf: e.target.value })} />
    <label htmlFor="kb-b">Bitiş</label><input id="kb-b" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} />
    <label htmlFor="kb-y">Yenilenen Belge (varsa)</label><select id="kb-y" value={f.yenilenen} onChange={(e) => setF({ ...f, yenilenen: e.target.value })}><option value="">Yok</option>{l.filter((x) => x.durum === 'Geçerli').map((x) => <option key={x.kimlik} value={x.kimlik}>{x.tur} · {x.ad}</option>)}</select>
    <button className="btn2" onClick={() => void istek('/kurum-belgesi', { ...f, yenilenen: f.yenilenen || undefined }).then(() => { setF({ tur: '', ad: '', karsiTaraf: '', bitis: '', yenilenen: '' }); setM('Belge kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Belge Kaydet</button></>;
}

/** YG-1281, YG-1283: BT kesintisi ve kurumsal kriz olayları; sürümlü etki, yanıt, geçici çözüm, kapanış. */
export function OlayKayitlari() {
  type O = { kimlik: string; olay_turu: string; ozet: string; durum: string; surum: number; olusturma_zamani: string; yanit_zamani: string | null; gecici_cozum_zamani: string | null; ihlal_bagli: boolean; acan: string; aciklama_yetkilisi: string | null };
  const [l, setL] = useState<O[] | null>(null); const [f, setF] = useState<Record<string, { hizmet: string; kullanici: string; surec: string; veri: string; kisiselVeri: boolean; kapanis: string }>>({}); const [m, setM] = useState('');
  const yk = () => istek<O[]>('/olaylar').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const z = (x: string | null) => (x ? new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const al = (id: string) => f[id] ?? { hizmet: '', kullanici: '', surec: '', veri: '', kisiselVeri: false, kapanis: '' };
  const yaz = (id: string, k: string, v: string | boolean) => setF({ ...f, [id]: { ...al(id), [k]: v } });
  const is = (yol: string, g: object, t: string) => void istek(yol, g).then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Kesinti ve Olay Kayıtları</div>{m && <div className="not" role="status">{m}</div>}{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}
    {l.map((x) => { const v = al(x.kimlik); return <div className="ozet" key={x.kimlik}>
      <div><b>{x.olay_turu}</b> · {x.ozet} · {x.durum} · Sürüm {x.surum}{x.ihlal_bagli ? ' · Veri ihlali kaydı bağlı' : ''}</div>
      <div>Başlangıç: {z(x.olusturma_zamani)} · Yanıt: {z(x.yanit_zamani)} · Geçici Çözüm: {z(x.gecici_cozum_zamani)} · Açıklama Yetkilisi: {x.aciklama_yetkilisi ?? '—'}</div>
      {x.durum === 'Açık' && <>
        <label htmlFor={`ol-h-${x.kimlik}`}>Etkilenen Hizmet</label><input id={`ol-h-${x.kimlik}`} value={v.hizmet} onChange={(e) => yaz(x.kimlik, 'hizmet', e.target.value)} />
        <label htmlFor={`ol-k-${x.kimlik}`}>Etkilenen Kullanıcılar</label><input id={`ol-k-${x.kimlik}`} value={v.kullanici} onChange={(e) => yaz(x.kimlik, 'kullanici', e.target.value)} />
        <label htmlFor={`ol-s-${x.kimlik}`}>Etkilenen Süreç</label><input id={`ol-s-${x.kimlik}`} value={v.surec} onChange={(e) => yaz(x.kimlik, 'surec', e.target.value)} />
        <label htmlFor={`ol-v-${x.kimlik}`}>Etkilenen Veri</label><input id={`ol-v-${x.kimlik}`} value={v.veri} onChange={(e) => yaz(x.kimlik, 'veri', e.target.value)} />
        <label className="kutu"><input type="checkbox" checked={v.kisiselVeri} onChange={(e) => yaz(x.kimlik, 'kisiselVeri', e.target.checked)} /><span>Kişisel Veri Etkilendi (veri ihlali kaydı açılır)</span></label>
        <div className="dugmeler"><button className="btn2 kucuk" onClick={() => is(`/olay/${x.kimlik}/guncelle`, { hizmet: v.hizmet, kullanici: v.kullanici, surec: v.surec, veri: v.veri, kisiselVeri: v.kisiselVeri }, 'Olay güncellendi.')}>Etkiyi Güncelle</button>
          {!x.yanit_zamani && <button className="btn2 kucuk" onClick={() => is(`/olay/${x.kimlik}/yanit`, {}, 'Yanıt kaydedildi.')}>Yanıt Verildi</button>}
          {!x.gecici_cozum_zamani && <button className="btn2 kucuk" onClick={() => is(`/olay/${x.kimlik}/gecici-cozum`, {}, 'Geçici çözüm kaydedildi.')}>Geçici Çözüm Uygulandı</button>}</div>
        <label htmlFor={`ol-z-${x.kimlik}`}>Kapanış Özeti (Kök Neden ve Önlem)</label><input id={`ol-z-${x.kimlik}`} value={v.kapanis} onChange={(e) => yaz(x.kimlik, 'kapanis', e.target.value)} />
        <button className="btn2 kucuk" disabled={!v.kapanis.trim()} onClick={() => is(`/olay/${x.kimlik}/kapat`, { ozet: v.kapanis }, 'Olay kapatıldı.')}>Olayı Kapat</button></>}
    </div>; })}</>;
}
