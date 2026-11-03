import { useEffect, useState, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { BelgeSec } from './Kalite';
import { IbanTeyit, NobetCizelge } from './Sicil';

const eur = (x: string | number | null | undefined) => (x === null || x === undefined ? '—' : `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);
const saat = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yap = async (f: () => Promise<any>, tamam?: string) => { setHata(''); setNot(''); try { const r = await f(); if (r?.uyari) setNot(r.uyari); else if (tamam) setNot(tamam); await yenile(); return r; } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not && <div className="not" role="status">{not}</div>}</>;
  return { yap, Mesaj };
}

const NITELIK = ['Onarım', 'Yenileme (Değişim)', 'Bakım', 'Keşif ve Test', 'Geçici / Acil Önlem', 'Yat Sahibi Talebi'];
const BEDEL = ['Malzeme', 'İşçilik', 'Nakliye', 'Masraf', 'Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Ulaşım', 'Konaklama', 'Harcırah', 'Gümrük ve İzin Giderleri'];
interface Satir { kod: string; aciklama: string; nitelik: string; bedel: string; miktar: string; birim: string }
interface Kayitlar {
  cetveller: { kimlik: string; surum: number; durum: string; satir: number }[];
  teklifler: { kimlik: string; teklif_no: string; surum_no: number; teklif_turu: string; statu: string; karar: string | null; ara_toplam_eur: string; genel_toplam_eur: string; gecerlilik_bitis_tarihi: string | null; teklif_muhatabi: string }[];
  firma: { kimlik: string; teklif_no: string; durum: string; toplam_eur: string; gecerlilik: string }[];
  isEmirleri: { kimlik: string; is_emri_no: string; is_emri_turu: string; statu: string; firma_yaniti: string | null; firma: string; ana_is_emri_ref: string | null }[];
}
interface Mali { odemeTalepleri: { kimlik: string; tur: string; tutar_eur: string; son_tarih: string; durum: string }[]; faturalar: { kimlik: string; proforma_no: string; durum: string; fatura_no: string | null; toplam_eur: string; toplam_tl: string | null; vade: string | null; tahsil_edilen_eur: string }[]; hakedisler: { kimlik: string; hakedis_no: string; bu_donem_brut: string; kesinti: string; net: string; statu: string }[]; teslimEngeli: string | null }

/** YG-386: firmanın girdiği ilerlemeyi Teknik Uzman veya Saha Sorumlusu doğrular; kabul bundan sonra verilir. */
function IlerlemeDogrula({ isEmri }: { isEmri: string }) {
  const [l, setL] = useState<{ kimlik: string; aciklama: string; miktar: string; dogrulandi: boolean }[]>([]); const [h, setH] = useState('');
  const yukle = () => istek<typeof l>(`/is-emri/${isEmri}/ilerlemeler`).then(setL).catch((e) => setH((e as Error).message));
  useEffect(() => { void yukle(); }, [isEmri]);
  return <>{h && <div className="hata" role="alert">{h}</div>}{l.filter((x) => !x.dogrulandi).map((x) => <button key={x.kimlik} className="btn2 kucuk" onClick={() => void istek(`/is-emri/${isEmri}/ilerleme/${x.kimlik}/dogrula`, {}).then(yukle).catch((e) => setH((e as Error).message))}>{x.aciklama} · {x.miktar} Doğrula</button>)}</>;
}

/** YG-195, YG-230, YG-301, YG-302, YG-884: dosya içinde kapsam, teklif, iş emri ve mali akış. */
export function TicariBolumu({ id, rollerim, roller, asama }: { id: string; rollerim: string[]; roller: string[]; asama: string | null }) {
  const [v, setV] = useState<Kayitlar | null>(null); const [m, setM] = useState<Mali | null>(null); const [firmalar, setFirmalar] = useState<{ kimlik: string; ticari_unvan: string; engel: string | null }[]>([]);
  const yukle = () => Promise.all([istek<Kayitlar>(`/dosya/${id}/teklifler`).then(setV), istek<Mali>(`/dosya/${id}/mali`).then(setM)]);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); void istek<typeof firmalar>('/firma/uygunluk').then(setFirmalar).catch(() => setFirmalar([])); }, [id]);
  const [satir, setSatir] = useState<Satir>({ kod: '', aciklama: '', nitelik: NITELIK[0]!, bedel: BEDEL[1]!, miktar: '1', birim: 'saat' }); const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [ie, setIe] = useState({ tur: 'KN', firma: '', yer: '', kapsam: '', bedel: '', teklif: '', ana: '' }); const [ft, setFt] = useState('');
  const [kanal, setKanal] = useState('YATONET 360'); const [yetkili, setYetkili] = useState(''); const [sonTarih, setSonTarih] = useState(''); const [fNo, setFNo] = useState(''); const [fTarih, setFTarih] = useState(''); const [fKur, setFKur] = useState(''); const [fKurT, setFKurT] = useState(''); const [thTutar, setThTutar] = useState(''); const [thTarih, setThTarih] = useState('');
  if (!v) return null;
  const ticari = roller.includes('Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)');
  const tu = rollerim.includes('Teknik Uzman') || rollerim.includes('Sorumlu Teknik Uzman (Koordinatör)');
  const iskrtYazar = rollerim.includes('Operasyon Yöneticisi') || rollerim.includes('Teknik Yönetici');
  return (
    <>
      <Mesaj />
      <Blok baslik="Kapsam ve Metraj Cetveli">
        {v.cetveller.map((c) => <div key={c.kimlik}>Rev.{c.surum} · {c.satir} satır · {c.durum}</div>)}
        {tu && <>
          {satirlar.map((x, n) => <div key={n}>{x.aciklama} · {x.miktar} {x.birim} · {x.nitelik} · {x.bedel}{x.kod ? ` · ${x.kod}` : ''}</div>)}
          <label htmlFor="c-a">Açıklama</label><input id="c-a" value={satir.aciklama} onChange={(e) => setSatir({ ...satir, aciklama: e.target.value })} />
          <label htmlFor="c-k">Kartela Kodu (Varsa)</label><input id="c-k" value={satir.kod} onChange={(e) => setSatir({ ...satir, kod: e.target.value })} />
          <div className="iki-tarih"><div><label htmlFor="c-n">İşin Niteliği</label><select id="c-n" value={satir.nitelik} onChange={(e) => setSatir({ ...satir, nitelik: e.target.value })}>{NITELIK.map((x) => <option key={x}>{x}</option>)}</select></div><div><label htmlFor="c-b">Bedel Türü</label><select id="c-b" value={satir.bedel} onChange={(e) => setSatir({ ...satir, bedel: e.target.value })}>{BEDEL.map((x) => <option key={x}>{x}</option>)}</select></div></div>
          <div className="iki-tarih"><div><label htmlFor="c-m">Miktar</label><input id="c-m" inputMode="decimal" value={satir.miktar} onChange={(e) => setSatir({ ...satir, miktar: e.target.value })} /></div><div><label htmlFor="c-r">Birim</label><input id="c-r" value={satir.birim} onChange={(e) => setSatir({ ...satir, birim: e.target.value })} /></div></div>
          <button className="btn2" disabled={!satir.aciklama.trim()} onClick={() => { setSatirlar([...satirlar, satir]); setSatir({ ...satir, aciklama: '', kod: '' }); }}>Satır Ekle</button>
          <button className="btn2" disabled={!satirlar.length} onClick={() => void yap(() => istek(`/dosya/${id}/cetvel`, { satirlar: satirlar.map((x) => ({ aciklama: x.aciklama, kartela: x.kod || undefined, nitelik: x.nitelik, bedel: x.bedel, miktar: Number(x.miktar.replace(',', '.')), birim: x.birim })) }), 'Teknik Yöneticinin onayına gönderildi.').then(() => setSatirlar([]))}>Cetveli Onaya Gönder</button>
        </>}
      </Blok>
      <Blok baslik="Fiyat Teklifleri">
        {v.teklifler.length === 0 && <div className="not">Teklif bulunmamaktadır.</div>}
        {v.teklifler.map((t) => (
          <div key={t.kimlik} className="soru">
            <span>{t.teklif_no} Rev.{t.surum_no} · {t.teklif_muhatabi} · {t.statu}{t.karar ? ` · ${t.karar}` : ''} · {eur(t.genel_toplam_eur)}{t.gecerlilik_bitis_tarihi ? ` · Geçerlilik: ${t.gecerlilik_bitis_tarihi.split('-').reverse().join('.')}` : ''}</span>
            <div className="dugmeler">
              {ticari && t.statu === 'Taslak' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/onaya-gonder`, {}), 'Onaya gönderildi.')}>Onaya Gönder</button>}
              {t.statu === 'Onaylı' && <button className="btn2 kucuk" onClick={() => void yap(() => istek<{ durum: string }>(`/teklif/${t.kimlik}/gonder`, {}).then((r) => { window.dispatchEvent(new Event('sigorta-gonderim')); return { uyari: r.durum === 'Teyit Bekliyor' ? 'Sigortaya gönderim için iki teyit gereklidir; aşağıdaki bölümden teyit ediniz.' : 'Gönderildi.' }; }))}>Gönder</button>}
              {t.statu === 'Karar' && ticari && <>
                <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/proforma`, {}), 'Proforma onaya gönderildi.')}>Proforma Hazırla</button>
                <button className="btn2 kucuk" disabled={!sonTarih} onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/odeme-talebi`, { tur: 'Avans', sonTarih }), 'Ödeme talebi onaya gönderildi.')}>Avans Talebi</button>
              </>}
            </div>
            {t.statu === 'Gönderildi' && t.teklif_muhatabi === 'Sigorta Şirketi' && <div>
              <label htmlFor={`k-${t.kimlik}`}>Onay Kanalı</label><select id={`k-${t.kimlik}`} value={kanal} onChange={(e) => setKanal(e.target.value)}>{['YATONET 360', 'KEP', 'E-imza', 'Sözleşmede Tanımlı Kurumsal E-posta'].map((x) => <option key={x}>{x}</option>)}</select>
              <label htmlFor={`y-${t.kimlik}`}>Onaylayan Yetkili</label><input id={`y-${t.kimlik}`} value={yetkili} onChange={(e) => setYetkili(e.target.value)} />
              <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/teklif/${t.kimlik}/sigorta-karar`, { karar: 'Tam Onay', kanal, yetkili }), 'Sigorta kararı kaydedildi.')}>Tam Onay Kaydet</button>
            </div>}
          </div>
        ))}
        {ticari && <>
          <label htmlFor="t-f">Firma Fiyat Teklifi</label><select id="t-f" value={ft} onChange={(e) => setFt(e.target.value)}><option value="">Seçiniz</option>{v.firma.map((f) => <option key={f.kimlik} value={f.kimlik}>{f.teklif_no} · {eur(f.toplam_eur)} · {f.durum}</option>)}</select>
          <button className="btn2" disabled={!ft} onClick={() => void yap(() => istek(`/dosya/${id}/teklif`, { firmaTeklifi: ft }), 'Teklif hazırlandı.')}>Fiyat Teklifi Hazırla</button>
          <label htmlFor="t-s">Ödeme Son Tarihi</label><input id="t-s" type="date" value={sonTarih} onChange={(e) => setSonTarih(e.target.value)} />
        </>}
      </Blok>
      <Blok baslik="İş Emirleri">
        {v.isEmirleri.length === 0 && <div className="not">İş emri bulunmamaktadır.</div>}
        {v.isEmirleri.map((e) => (
          <div key={e.kimlik} className="soru">
            <span>{e.ana_is_emri_ref ? '↳ ' : ''}{e.is_emri_no} · {e.firma} · {e.statu}{e.firma_yaniti ? ` · ${e.firma_yaniti}` : ''}</span>
            <div className="dugmeler">
              {e.statu === 'Başlangıç Kontrolünde' && tu && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-emri/${e.kimlik}/baslangic`, { sonuc: 'Başlanabilir' }))}>Başlanabilir</button>}
              {['Aktif', 'Tamamlandı'].includes(e.statu) && tu && <IlerlemeDogrula isEmri={e.kimlik} />}
              {e.statu === 'Tamamlandı' && tu && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-emri/${e.kimlik}/teknik-kabul`, { sonuc: 'Kabul' }), 'Teknik kabul kaydedildi.')}>Teknik Kabul</button>}
              {e.statu === 'Tamamlandı' && rollerim.includes('Dosya Sorumlusu') && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-emri/${e.kimlik}/kapat`, {}))}>Kapat</button>}
            </div>
          </div>
        ))}
        {iskrtYazar && <>
          <label htmlFor="e-t">Tür</label><select id="e-t" value={ie.tur} onChange={(x) => setIe({ ...ie, tur: x.target.value })}>{[['KN', 'Keşif'], ['ON', 'Onarım'], ['EK', 'Ek İş'], ['GR', 'Garanti ve Düzeltme'], ['PH', 'Planlı Hizmet']].map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
          <label htmlFor="e-f">Firma</label><select id="e-f" value={ie.firma} onChange={(x) => setIe({ ...ie, firma: x.target.value })}><option value="">Seçiniz</option>{firmalar.map((f) => <option key={f.kimlik} value={f.kimlik} disabled={Boolean(f.engel)}>{f.ticari_unvan}{f.engel ? ` · ${f.engel}` : ''}</option>)}</select>
          <label htmlFor="e-y">Uygulama Yeri</label><input id="e-y" value={ie.yer} onChange={(x) => setIe({ ...ie, yer: x.target.value })} />
          <label htmlFor="e-k">Kapsam</label><input id="e-k" value={ie.kapsam} onChange={(x) => setIe({ ...ie, kapsam: x.target.value })} />
          {ie.tur !== 'KN' && <><label htmlFor="e-b">Firma Bedeli (EUR)</label><input id="e-b" inputMode="decimal" value={ie.bedel} onChange={(x) => setIe({ ...ie, bedel: x.target.value })} /></>}
          {(ie.tur === 'ON' || ie.tur === 'EK' || ie.tur === 'PH') && <><label htmlFor="e-tk">Onaylı Teklif</label><select id="e-tk" value={ie.teklif} onChange={(x) => setIe({ ...ie, teklif: x.target.value })}><option value="">Seçiniz</option>{v.teklifler.filter((t) => t.statu === 'Karar').map((t) => <option key={t.kimlik} value={t.kimlik}>{t.teklif_no}</option>)}</select></>}
          {(ie.tur === 'EK' || ie.tur === 'GR') && <><label htmlFor="e-an">Ana İş Emri</label><select id="e-an" value={ie.ana} onChange={(x) => setIe({ ...ie, ana: x.target.value })}><option value="">Seçiniz</option>{v.isEmirleri.map((e) => <option key={e.kimlik} value={e.kimlik}>{e.is_emri_no}</option>)}</select></>}
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/is-emri`, { tur: ie.tur, firma: ie.firma, yer: ie.yer, kapsam: ie.kapsam, bedel: ie.bedel ? Number(ie.bedel.replace(',', '.')) : undefined, teklif: ie.teklif || undefined, ana: ie.ana || undefined }), 'İş emri oluşturuldu.')}>İş Emri Oluştur</button>
        </>}
      </Blok>
      {m && <Blok baslik="Ödeme ve Fatura">
        {m.teslimEngeli && <div className="uyari">Teslim Engeli: {m.teslimEngeli}</div>}
        {m.odemeTalepleri.map((o) => <div key={o.kimlik}>{o.tur} · {eur(o.tutar_eur)} · {o.durum}</div>)}
        {m.faturalar.map((f) => (
          <div key={f.kimlik} className="soru">
            <span>{f.proforma_no} · {f.durum} · {eur(f.toplam_eur)}{f.fatura_no ? ` · Fatura: ${f.fatura_no}` : ''}{f.vade ? ` · Vade: ${f.vade.split('-').reverse().join('.')}` : ''}</span>
            {ticari && <div className="dugmeler">
              {f.durum === 'Proforma' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/fatura/${f.kimlik}/muhasebeye`, {}))}>Muhasebeye İlet</button>}
              {f.durum === 'Muhasebeye İletildi' && <button className="btn2 kucuk" disabled={!fNo || !fTarih || !fKur || !fKurT} onClick={() => void yap(() => istek(`/fatura/${f.kimlik}/bilgi`, { no: fNo, tarih: fTarih, kur: Number(fKur.replace(',', '.')), kurTarihi: fKurT }))}>Fatura Bilgisini Kaydet</button>}
              {['Faturalandı', 'Kısmi Tahsil'].includes(f.durum) && <button className="btn2 kucuk" disabled={!thTutar || !thTarih} onClick={() => void yap(() => istek('/tahsilat', { fatura: f.kimlik, tutar: Number(thTutar.replace(',', '.')), tarih: thTarih, kanal: 'Havale' }))}>Havale Tahsilatı</button>}
            </div>}
          </div>
        ))}
        {ticari && m.faturalar.length > 0 && <>
          <div className="iki-tarih"><div><label htmlFor="f-n">Fatura No (Muhasebeden)</label><input id="f-n" value={fNo} onChange={(e) => setFNo(e.target.value)} /></div><div><label htmlFor="f-t">Fatura Tarihi</label><input id="f-t" type="date" value={fTarih} onChange={(e) => setFTarih(e.target.value)} /></div></div>
          <div className="iki-tarih"><div><label htmlFor="f-k">TCMB Satış Kuru</label><input id="f-k" inputMode="decimal" value={fKur} onChange={(e) => setFKur(e.target.value)} /></div><div><label htmlFor="f-kt">Kur Tarihi</label><input id="f-kt" type="date" value={fKurT} onChange={(e) => setFKurT(e.target.value)} /></div></div>
          <div className="iki-tarih"><div><label htmlFor="h-t">Tahsilat (EUR)</label><input id="h-t" inputMode="decimal" value={thTutar} onChange={(e) => setThTutar(e.target.value)} /></div><div><label htmlFor="h-d">Tahsilat Tarihi</label><input id="h-d" type="date" value={thTarih} onChange={(e) => setThTarih(e.target.value)} /></div></div>
        </>}
        {m.hakedisler.map((h) => <div key={h.kimlik} className="soru"><span>{h.hakedis_no} · Brüt {eur(h.bu_donem_brut)} · Kesinti {eur(h.kesinti)} · Net {eur(h.net)} · {h.statu}</span><div className="dugmeler">{h.statu === 'Doğrulama Bekliyor' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/hakedis/${h.kimlik}/dogrula`, {}))}>Doğrula</button>}{h.statu === 'Doğrulandı' && ticari && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/hakedis/${h.kimlik}/odeme-talimati`, {}), 'Talimat onaya gönderildi.')}>Ödeme Talimatı</button>}</div></div>)}
        {asama === 'Teslim' && rollerim.includes('Dosya Sorumlusu') && <button className="btn2" disabled={Boolean(m.teslimEngeli)} onClick={() => void yap(() => istek(`/dosya/${id}/teslim`, {}), 'Teslim onayı yat sahibine gönderildi.')}>Teslimi Başlat</button>}
      </Blok>}
    </>
  );
}

interface IsEmri { kimlik: string; dosya: string; isEmriNo: string; tur: string; statu: string; dosyaNo: string; oncelik: string; yat: string; yatTuru: string | null; yer: string; kapsam: string; bedel: string | null; yanitSon: string | null; yanit: string | null }
interface FirmaAyrinti extends IsEmri { kalemler: { aciklama: string; miktar: string; birim: string; gerceklesen_miktar: string }[] }
interface AcilCagri { kimlik: string; cagri_no: string; son_zaman: string; konum: string; yat_tipi: string | null; olay_turu: string; tehlike: string }

/** YG-371, YG-372, YG-373: izni firma tesisten alır ve belgesini yükler; LGM düzenlemez. Sıcak iş ve kapalı alanda gaz ölçümü istenir. */
function CalismaIzni({ isEmri, yap }: { isEmri: string; yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [f, setF] = useState({ tur: 'Sıcak İş', tesis: '', no: '', veren: '', baslangic: '', bitis: '', belge: '', oksijen: '', yanici: '' });
  const gaz = /sıcak|kapalı/i.test(f.tur);
  return <Blok baslik="Çalışma İzni Belgesi">
    <label htmlFor="ci-t">İzin Türü</label><select id="ci-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Sıcak İş', 'Kapalı Alan', 'Yüksekte Çalışma', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ci-s">Tesis</label><input id="ci-s" value={f.tesis} onChange={(e) => setF({ ...f, tesis: e.target.value })} />
    <label htmlFor="ci-n">İzin No</label><input id="ci-n" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })} />
    <label htmlFor="ci-v">İzni Veren</label><input id="ci-v" value={f.veren} onChange={(e) => setF({ ...f, veren: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="ci-b">Başlangıç</label><input id="ci-b" type="datetime-local" value={f.baslangic} onChange={(e) => setF({ ...f, baslangic: e.target.value })} /></div><div><label htmlFor="ci-e">Bitiş (En Çok 12 Saat)</label><input id="ci-e" type="datetime-local" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} /></div></div>
    {gaz && <div className="iki-tarih"><div><label htmlFor="ci-o">Oksijen (%)</label><input id="ci-o" inputMode="decimal" value={f.oksijen} onChange={(e) => setF({ ...f, oksijen: e.target.value })} /></div><div><label htmlFor="ci-y">Yanıcı Gaz (%)</label><input id="ci-y" inputMode="decimal" value={f.yanici} onChange={(e) => setF({ ...f, yanici: e.target.value })} /></div></div>}
    <BelgeSec ad="İzin Belgesi" bagTuru="İş Emri" bagKimligi={isEmri} deger={f.belge} sec={(k) => setF({ ...f, belge: k })} />
    <button className="btn2" disabled={!f.belge} onClick={() => void yap(() => istek(`/firma-portal/is-emri/${isEmri}/calisma-izni`, { ...f, baslangic: f.baslangic && new Date(f.baslangic).toISOString(), bitis: f.bitis && new Date(f.bitis).toISOString(), oksijen: gaz ? Number(f.oksijen.replace(',', '.')) : undefined, yanici: gaz ? Number(f.yanici.replace(',', '.')) : undefined }), 'İzin belgesi kaydedildi.')}>İzin Belgesini Kaydet</button>
  </Blok>;
}

/** YG-430: firma yalnız kendi birim fiyatını girer; müşteri fiyatı görünmez. */
function FirmaFiyat({ dosya, yap }: { dosya: string; yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [l, setL] = useState<{ kimlik: string; aciklama: string; miktar: string; birim: string }[]>([]); const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => { void yap(() => istek<typeof l>(`/firma-portal/dosya/${dosya}/kapsam`).then(setL)); }, [dosya]);
  if (!l.length) return null;
  return <Blok baslik="Firma Fiyat Teklifi">{l.map((s) => <div key={s.kimlik}><label htmlFor={`fy-${s.kimlik}`}>{s.aciklama} · {s.miktar} {s.birim} · Birim Fiyat (EUR)</label><input id={`fy-${s.kimlik}`} inputMode="decimal" value={f[s.kimlik] ?? ''} onChange={(e) => setF({ ...f, [s.kimlik]: e.target.value })} /></div>)}<button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/dosya/${dosya}/fiyat`, { kalemler: l.map((s) => ({ satir: s.kimlik, fiyat: Number((f[s.kimlik] ?? '').replace(',', '.')) })) }), 'Fiyat teklifiniz gönderildi.')}>Fiyat Teklifini Gönder</button></Blok>;
}

/** YG-292, YG-388: firma yalnız kendi uygunsuzluğunu görür ve yanıtlar. */
function FirmaUygunsuzluk({ yap }: { yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [l, setL] = useState<{ kimlik: string; uygunsuzluk_no: string; sinif: string; gercek_durum: string; statu: string; firma_yaniti: string | null }[]>([]); const [y, setY] = useState<Record<string, string>>({});
  const yukle = () => istek<typeof l>('/firma-portal/uygunsuzluklar').then(setL);
  useEffect(() => { void yukle().catch(() => {}); }, []);
  const acik = l.filter((u) => u.statu !== 'Kapalı' && u.statu !== 'Geçersiz');
  if (!acik.length) return null;
  return <Blok baslik="Uygunsuzluklar">{acik.map((u) => <div className="soru" key={u.kimlik}><span>{u.uygunsuzluk_no} · {u.sinif} · {u.gercek_durum}</span><label htmlFor={`fu-${u.kimlik}`}>Yanıtınız</label><input id={`fu-${u.kimlik}`} value={y[u.kimlik] ?? u.firma_yaniti ?? ''} onChange={(e) => setY({ ...y, [u.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/firma-portal/uygunsuzluk/${u.kimlik}/yanit`, { yanit: y[u.kimlik] }).then(yukle), 'Yanıtınız kaydedildi.')}>Yanıtla</button></div>)}</Blok>;
}

/** YG-1574 A7 Çözüm Ortağı: İşleminizi Bekleyenler, acil çağrı, iş emirleri, kabul kodla, ilerleme ve hakediş. Müşteri bilgisi ve müşteri fiyatı yoktur (YG-294). */
export function FirmaAna({ ben }: { ben: Ben }) {
  const [l, setL] = useState<IsEmri[] | null>(null); const [ac, setAc] = useState<AcilCagri[]>([]); const [acik, setAcik] = useState<FirmaAyrinti | null>(null); const [kod, setKod] = useState(''); const [not_, setNot_] = useState(''); const [tahmini, setTahmini] = useState(''); const [brut, setBrut] = useState(''); const [fat, setFat] = useState(''); const [kalem, setKalem] = useState(''); const [miktar, setMiktar] = useState(''); const [belge, setBelge] = useState('');
  const yukle = async () => { const r = await istek<{ isEmirleri: IsEmri[] }>('/firma-portal/ana'); setL(r.isEmirleri); setAc(await istek<AcilCagri[]>('/firma-portal/acil-cagrilar')); if (acik) setAcik(await istek<FirmaAyrinti>(`/firma-portal/is-emri/${acik.kimlik}`)); };
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => setL([])); }, []);
  if (!l) return null;
  if (acik) return (
    <>
      <button className="lnk" onClick={() => setAcik(null)}>← İş Emirleri</button>
      <h1>{acik.isEmriNo}</h1><Mesaj />
      <div className="ozet"><div>{acik.yat} · {acik.yatTuru ?? '—'} · {acik.yer}</div><div>{acik.kapsam}</div><div>Bedel: {eur(acik.bedel)} · {acik.statu}</div>{acik.yanitSon && acik.statu === 'Kabul Bekliyor' && <div>Yanıt Son: {saat(acik.yanitSon)}</div>}</div>
      {acik.kalemler.length > 0 && <Blok baslik="Kapsam">{acik.kalemler.map((k) => <div key={k.aciklama}>{k.aciklama} · {k.gerceklesen_miktar}/{k.miktar} {k.birim}</div>)}</Blok>}
      {acik.statu === 'Kabul Bekliyor' && <Blok baslik="Yanıt">
        <label htmlFor="f-k">Onay Kodu</label><input id="f-k" inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} />
        <button className="btn" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/yanit`, { yanit: 'Kabul', kod }))}>Kabul Ediyorum</button>
        <label htmlFor="f-g">Çekince veya Ret Gerekçesi</label><input id="f-g" value={not_} onChange={(e) => setNot_(e.target.value)} />
        <div className="dugmeler"><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/yanit`, { yanit: 'Çekince', aciklama: not_ }))}>Çekince Bildir</button><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/yanit`, { yanit: 'Ret', aciklama: not_ }))}>Reddet</button></div>
      </Blok>}
      {acik.statu === 'Aktif' && <Blok baslik="İlerleme">
        <label htmlFor="f-ka">Kalem</label><select id="f-ka" value={kalem} onChange={(e) => setKalem(e.target.value)}><option value="">Seçiniz</option>{acik.kalemler.map((k) => <option key={k.aciklama}>{k.aciklama}</option>)}</select>
        <label htmlFor="f-m">Miktar</label><input id="f-m" inputMode="decimal" value={miktar} onChange={(e) => setMiktar(e.target.value)} />
        <BelgeSec ad="Kanıt Belgesi" bagTuru="İş Emri" bagKimligi={acik.kimlik} deger={belge} sec={setBelge} />
        <button className="btn2" disabled={!belge} onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/ilerleme`, { kalem, miktar: Number(miktar.replace(',', '.')), belge }), 'İlerleme kaydedildi.').then(() => setBelge(''))}>İlerleme Kaydet</button>
        {acik.tur === 'AC' && <><label htmlFor="f-th">Tahmini Tutar (EUR)</label><input id="f-th" inputMode="decimal" value={tahmini} onChange={(e) => setTahmini(e.target.value)} /><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/acil-tutar`, { tahmini: Number(tahmini.replace(',', '.')) }))}>Tutarı Güncelle</button></>}
        <div className="dugmeler"><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/tamamlandi`, {}))}>İş Tamamlandı</button><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/durdur`, { neden: not_ }))}>İşi Durdur ve Bildir</button></div>
      </Blok>}
      {acik.tur === 'KN' && !['Kabul Bekliyor', 'Çekinceli'].includes(acik.statu) && <FirmaFiyat dosya={acik.dosya} yap={yap} />}
      {acik.statu === 'Aktif' && <CalismaIzni isEmri={acik.kimlik} yap={yap} />}
      {['Aktif', 'Tamamlandı'].includes(acik.statu) && acik.tur !== 'KN' && <Blok baslik="Hakediş">
        <BelgeSec ad="Hakediş Kanıtı" bagTuru="İş Emri" bagKimligi={acik.kimlik} deger={belge} sec={setBelge} />
        <div className="iki-tarih"><div><label htmlFor="f-br">Brüt (EUR)</label><input id="f-br" inputMode="decimal" value={brut} onChange={(e) => setBrut(e.target.value)} /></div><div><label htmlFor="f-fn">Fatura No</label><input id="f-fn" value={fat} onChange={(e) => setFat(e.target.value)} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${acik.kimlik}/hakedis`, { brut: Number(brut.replace(',', '.')), faturaNo: fat, belge }), 'Hakediş doğrulamaya gönderildi.')}>Hakediş Gönder</button>
      </Blok>}
    </>
  );
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1><Mesaj />
      <div className="bolum">İşleminizi Bekleyenler</div>
      {ac.length === 0 && <div className="ozet bos">Acil çağrı bulunmamaktadır.</div>}
      {ac.map((c) => <div className="ood" role="alert" key={c.kimlik}><b>Acil Görev Çağrısı · {c.cagri_no}</b><div>{c.olay_turu} · {c.konum} · {c.yat_tipi ?? '—'}</div><div>{c.tehlike}</div><div>Yanıt Son: {saat(c.son_zaman)}</div>
        <label htmlFor={`c-${c.kimlik}`}>Tahmini Tutar (EUR)</label><input id={`c-${c.kimlik}`} inputMode="decimal" value={tahmini} onChange={(e) => setTahmini(e.target.value)} />
        <div className="dugmeler"><button className="btn" onClick={() => void yap(() => istek(`/firma-portal/acil-cagri/${c.kimlik}/yanit`, { yanit: 'Kabul', tahmini: Number(tahmini.replace(',', '.') || 0) }))}>Kabul Ediyorum, Yola Çıkıyorum</button><button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/acil-cagri/${c.kimlik}/yanit`, { yanit: 'Müsait Değil' }))}>Müsait Değilim</button></div></div>)}
      <FirmaUygunsuzluk yap={yap} />
      <div className="bolum">İş Emirlerim</div>
      {l.length === 0 && <div className="ozet bos">İş emri bulunmamaktadır.</div>}
      {l.length > 0 && <div className="tablo"><table className="kartli"><thead><tr><th>İş Emri</th><th>Yat</th><th>Durum</th><th /></tr></thead><tbody>{l.map((e) => <tr key={e.kimlik}><td data-ad="İş Emri">{e.isEmriNo}</td><td data-ad="Yat">{e.yat}</td><td data-ad="Durum">{e.statu}</td><td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => void istek<FirmaAyrinti>(`/firma-portal/is-emri/${e.kimlik}`).then(setAcik)}>Aç</button></td></tr>)}</tbody></table></div>}
    </>
  );
}

interface SigortaDosya { kimlik: string; dosyaNo: string; hasarNo: string | null; yat: string; durum: string; renk: string }
interface SigortaTeklif { kimlik: string; teklif_no: string; surum_no: number; teklif_turu: string; genel_toplam_eur: string; sigorta_karar_son: string | null; dosya_no: string }
interface TeklifAyrinti extends SigortaTeklif { ara_toplam_eur: string; kdv_tutari_eur: string; kalemler: { sira_no: number; aciklama: string; isin_niteligi: string; tutar_eur: string }[] }

/** YG-1568, YG-1571 A4 Sigorta Şirketi: teklif kalemleri seçimli onaylanır; ret düğmesi yoktur; firma adı görünmez. */
export function SigortaAna({ ben }: { ben: Ben }) {
  const [v, setV] = useState<{ dosyalar: SigortaDosya[]; bekleyen: SigortaTeklif[] } | null>(null); const [t, setT] = useState<TeklifAyrinti | null>(null); const [sec, setSec] = useState<number[]>([]);
  const yukle = () => istek<NonNullable<typeof v>>('/sigorta/ana').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => setV({ dosyalar: [], bekleyen: [] })); }, []);
  if (!v) return null;
  if (t) {
    const top = t.kalemler.filter((k) => sec.includes(k.sira_no)).reduce((a, k) => a + Number(k.tutar_eur), 0);
    return (
      <>
        <button className="lnk" onClick={() => setT(null)}>← Ana Sayfa</button>
        <h1>{t.teklif_no} Rev.{t.surum_no}</h1><Mesaj />
        <label className="kutu"><input type="checkbox" checked={sec.length === t.kalemler.length} onChange={(e) => setSec(e.target.checked ? t.kalemler.map((k) => k.sira_no) : [])} /><span>Tümünü Seç</span></label>
        {t.kalemler.map((k) => <label className="kutu" key={k.sira_no}><input type="checkbox" checked={sec.includes(k.sira_no)} onChange={(e) => setSec(e.target.checked ? [...sec, k.sira_no] : sec.filter((x) => x !== k.sira_no))} /><span>{k.aciklama} · {k.isin_niteligi} · {eur(k.tutar_eur)}</span></label>)}
        <div className="not">Seçilen Toplam (KDV Hariç): {eur(top)}</div>
        <button className="btn" disabled={!sec.length} onClick={() => void yap(() => istek(`/sigorta/teklif/${t.kimlik}/karar`, { siralar: sec, surum: t.surum_no }), 'Kararınız kaydedildi.').then(() => setT(null))}>Seçilen Kalemleri Onayla</button>
      </>
    );
  }
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1><Mesaj />
      <div className="bolum">İşleminizi Bekleyenler</div>
      {v.bekleyen.length === 0 && <div className="ozet bos">Bekleyen işlem bulunmamaktadır.</div>}
      {v.bekleyen.map((b) => <div className="ozet" key={b.kimlik}><b>{b.teklif_turu} · {b.dosya_no}</b><div>{eur(b.genel_toplam_eur)}{b.sigorta_karar_son ? ` · Son: ${saat(b.sigorta_karar_son)}` : ''}</div><button className="btn" onClick={() => void istek<TeklifAyrinti>(`/sigorta/teklif/${b.kimlik}`).then((x) => { setT(x); setSec([]); })}>İncele</button></div>)}
      <div className="bolum">Dosyalar</div>
      {v.dosyalar.length === 0 && <div className="ozet bos">Dosya bulunmamaktadır.</div>}
      {v.dosyalar.length > 0 && <div className="tablo"><table className="kartli"><thead><tr><th>Hasar Dosya No</th><th>LGM Dosya No</th><th>Yat</th><th>Durum</th></tr></thead><tbody>{v.dosyalar.map((d) => <tr key={d.kimlik}><td data-ad="Hasar Dosya No">{d.hasarNo ?? '—'}</td><td data-ad="LGM Dosya No">{d.dosyaNo}</td><td data-ad="Yat">{d.yat}</td><td data-ad="Durum">{d.durum}</td></tr>)}</tbody></table></div>}
    </>
  );
}

const ACIL_TURLER = ['Can Güvenliği', 'Su Alma veya Batma', 'Yangın', 'Sürüklenme veya Bağlama Tehlikesi', 'Kirlilik', 'Diğer'];

/** YG-263, YG-264, YG-244: Acil Çağrı Aç, nöbetçi görünümü, 112 hatırlatması, nöbet devri. */
export function NobetAcil({ dosyaAc, izinli, cizelge }: { dosyaAc: (id: string) => void; izinli: boolean; cizelge: boolean }) {
  const [n, setN] = useState<{ mesaiIcinde: boolean; dosyaSorumlusu: string | null; teknikUzman: string | null; yonetici: string | null } | null>(null);
  const { yap, Mesaj } = useYap(() => istek<NonNullable<typeof n>>('/nobet/simdi').then(setN));
  useEffect(() => { void istek<NonNullable<typeof n>>('/nobet/simdi').then(setN).catch(() => {}); }, []);
  const [f, setF] = useState({ telefon: '', yatAdi: '', konum: '', olay: '', olayTuru: ACIL_TURLER[1]!, musteriTuru: 'Bireysel Müşteri', sigortaci: '' }); const [h112, setH112] = useState(false);
  return (
    <>
      <h1>Nöbet ve Acil</h1><Mesaj />
      {cizelge && <NobetCizelge />}
      {n && <div className="ozet"><div>{n.mesaiIcinde ? 'Mesai İçi' : 'Mesai Dışı'}</div><div>Nöbetçi Dosya Sorumlusu: {n.dosyaSorumlusu ?? '—'}</div><div>Nöbetçi Teknik Uzman: {n.teknikUzman ?? '—'}</div><div>Yönetici Nöbetçisi: {n.yonetici ?? '—'}</div></div>}
      {izinli && <><div className="bolum">Acil Çağrı Aç</div>
        <div className="ozet">
          <div className="uyari">Can tehlikesi yoksa da kaptana 112&apos;yi hatırlatınız. Kaptan yoksa 112&apos;yi nöbetçi arar.</div>
          <label className="kutu"><input type="checkbox" checked={h112} onChange={(e) => setH112(e.target.checked)} /><span>112 Hatırlatıldı</span></label>
          <label htmlFor="ac-t">Arayan Numara</label><input id="ac-t" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} />
          <label htmlFor="ac-y">Yat</label><input id="ac-y" value={f.yatAdi} onChange={(e) => setF({ ...f, yatAdi: e.target.value })} />
          <label htmlFor="ac-k">Konum</label><input id="ac-k" value={f.konum} onChange={(e) => setF({ ...f, konum: e.target.value })} />
          <label htmlFor="ac-u">Olay Türü</label><select id="ac-u" value={f.olayTuru} onChange={(e) => setF({ ...f, olayTuru: e.target.value })}>{ACIL_TURLER.map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="ac-o">Olay Özeti</label><input id="ac-o" value={f.olay} onChange={(e) => setF({ ...f, olay: e.target.value })} />
          <label htmlFor="ac-m">Müşteri Türü</label><select id="ac-m" value={f.musteriTuru} onChange={(e) => setF({ ...f, musteriTuru: e.target.value })}>{['Bireysel Müşteri', 'Kurumsal Müşteri', 'Sigorta Şirketi'].map((x) => <option key={x}>{x}</option>)}</select>
          {f.musteriTuru === 'Sigorta Şirketi' && <><label htmlFor="ac-s">Sigorta Şirketi</label><input id="ac-s" value={f.sigortaci} onChange={(e) => setF({ ...f, sigortaci: e.target.value })} /></>}
          <button className="btn" onClick={() => void yap(() => istek<{ kimlik: string }>('/acil/cagri', { ...f, hatirlatma112: h112 }).then((r) => dosyaAc(r.kimlik)))}>Acil Çağrı Aç</button>
        </div></>}
    </>
  );
}

/** YG-948, YG-920: İdari İşlemlerim: izin ve masraf. Metin sağlık veya tanı bilgisi içermez (YG-952). */
export function IdariIslemler() {
  const { yap, Mesaj } = useYap(() => undefined);
  const [iz, setIz] = useState({ tur: 'Yıllık', baslangic: '', bitis: '' }); const [m, setM] = useState({ tur: 'Yemek', tarih: '', tutarTl: '', kur: '', miktar: '1', belgeOzeti: '' });
  return (
    <>
      <h1>İdari İşlemlerim</h1><Mesaj />
      <IbanTeyit />
      <Blok baslik="İzin Talebi">
        <label htmlFor="iz-t">İzin Türü</label><select id="iz-t" value={iz.tur} onChange={(e) => setIz({ ...iz, tur: e.target.value })}>{['Yıllık', 'Mazeret', 'Ücretsiz', 'Rapor'].map((x) => <option key={x}>{x}</option>)}</select>
        <div className="iki-tarih"><div><label htmlFor="iz-b">Başlangıç</label><input id="iz-b" type="date" value={iz.baslangic} onChange={(e) => setIz({ ...iz, baslangic: e.target.value })} /></div><div><label htmlFor="iz-s">Bitiş</label><input id="iz-s" type="date" value={iz.bitis} onChange={(e) => setIz({ ...iz, bitis: e.target.value })} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek<{ gun: number }>('/izin', iz).then((r) => ({ uyari: `İzin talebiniz gönderildi: ${r.gun} gün.` })))}>İzin Talep Et</button>
      </Blok>
      <Blok baslik="Masraf Fişi">
        <label htmlFor="ms-t">Masraf Türü</label><select id="ms-t" value={m.tur} onChange={(e) => setM({ ...m, tur: e.target.value })}>{['Yemek', 'Konaklama', 'Km', 'Ulaşım', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
        <div className="iki-tarih"><div><label htmlFor="ms-d">Fiş Tarihi</label><input id="ms-d" type="date" value={m.tarih} onChange={(e) => setM({ ...m, tarih: e.target.value })} /></div><div><label htmlFor="ms-n">Belge No</label><input id="ms-n" value={m.belgeOzeti} onChange={(e) => setM({ ...m, belgeOzeti: e.target.value })} /></div></div>
        <div className="iki-tarih"><div><label htmlFor="ms-a">Tutar (TL)</label><input id="ms-a" inputMode="decimal" value={m.tutarTl} onChange={(e) => setM({ ...m, tutarTl: e.target.value })} /></div><div><label htmlFor="ms-k">TCMB Kuru</label><input id="ms-k" inputMode="decimal" value={m.kur} onChange={(e) => setM({ ...m, kur: e.target.value })} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek<{ odenecek: number; kesilen: number }>('/masraf', { ...m, tutarTl: Number(m.tutarTl.replace(',', '.')), kur: Number(m.kur.replace(',', '.')), miktar: Number(m.miktar) }).then((r) => ({ uyari: `Ödenecek: ${eur(r.odenecek)}${r.kesilen > 0 ? ` · Limit Aşımı: ${eur(r.kesilen)}` : ''}` })))}>Masraf Gönder</button>
      </Blok>
    </>
  );
}
