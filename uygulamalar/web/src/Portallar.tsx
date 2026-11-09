import { ProsesLgm } from './Proses';
import { useEffect, useState, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { BelgeSec } from './Kalite';

const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;
const eur = (x: string | number | null) => (x === null ? '—' : `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`);
const tarih = (s: string | null) => (s ? s.split('-').reverse().join('.') : '—');
const sayi = (x: string) => Number(x.replace(/\./g, '').replace(',', '.'));
function useYap(yenile: () => unknown) {
  const [hata, setHata] = useState(''); const [not_, setNot] = useState('');
  const yap = async (f: () => Promise<unknown>, t?: string) => { setHata(''); setNot(''); try { await f(); if (t) setNot(t); await yenile(); } catch (x) { setHata((x as Error).message); } };
  const Mesaj = () => <>{hata && <div className="hata" role="alert">{hata}</div>}{not_ && <div className="not" role="status">{not_}</div>}</>;
  return { yap, Mesaj };
}

interface TesisV {
  kurulus: string;
  bekleyen: { kimlik: string; tur: string; hedef_tarih: string; aciklama: string | null; yat_adi: string; tam_boy_m: string | null; yat_turu: string | null }[];
  takvim: { kimlik: string; tur: string; hedef_tarih: string; tesis_izin_no: string | null; yat_adi: string }[];
  yatlar: { dosya: string; yat_adi: string; teslim: string | null; serbest_birakma_kodu: string | null }[];
  kayitlar: { kimlik: string; tur: string; baslik: string }[];
  faturalar: { kimlik: string; fatura_no: string; tarih: string; kalem: string; gun: number | null; tutar_eur: string; durum: string }[];
}

/** YG-1575, YG-1576 A8 Tesis: firma unvanı, müşteri fiyatı, firma maliyeti ve teknik dosya yoktur; dil naziktir. */
export function TesisAna({ ben }: { ben: Ben }) {
  const [v, setV] = useState<TesisV | null>(null); const [iz, setIz] = useState<Record<string, string>>({}); const [g, setG] = useState<Record<string, string>>({});
  const [k, setK] = useState({ tur: 'Tesis Kuralı', baslik: '', belge: '' }); const [f, setF] = useState({ talep: '', no: '', tarih: '', kalem: 'Çekek', gun: '', tutar: '', belge: '' });
  const yukle = () => istek<TesisV>('/tesis-portal/ana').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return <Mesaj />;
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1><Mesaj />
      {v.yatlar.filter((y) => !y.teslim).map((y) => <div className="ood" role="status" key={y.dosya}>⚠ {y.yat_adi} yatının teslimi veya taşınması için LGM teslim onayını beklemenizi rica ederiz.<div className="dugmeler"><button className="btn2 kucuk" onClick={() => void yap(() => istek(`/tesis-portal/dosya/${y.dosya}/teslim-talebi`, {}), 'Teslim talebiniz iletildi.')}>Teslim Talebi</button></div></div>)}
      {v.yatlar.filter((y) => y.teslim).map((y) => <div className="not" key={y.dosya}>{y.yat_adi}: Teslim onayı verilmiştir. Onay Kodu: {y.serbest_birakma_kodu}</div>)}
      <Blok baslik="Yanıt Bekleyenler">
        {v.bekleyen.length === 0 && <div className="not">Bekleyen talep bulunmamaktadır.</div>}
        {v.bekleyen.map((t) => (
          <div className="soru" key={t.kimlik}>
            <span><b className="koyu">{t.tur}</b> · {t.yat_adi} · {t.yat_turu ?? '—'}{t.tam_boy_m ? ` · ${Number(t.tam_boy_m).toLocaleString('tr-TR')} m` : ''} · {tarih(t.hedef_tarih)}</span>
            {t.aciklama && <div>{t.aciklama}</div>}
            <label htmlFor={`ti-${t.kimlik}`}>Tesis İzin Numarası</label><input id={`ti-${t.kimlik}`} value={iz[t.kimlik] ?? ''} onChange={(e) => setIz({ ...iz, [t.kimlik]: e.target.value })} />
            <button className="btn evet" onClick={() => void yap(() => istek(`/tesis-portal/talep/${t.kimlik}/yanit`, { izin: true, izinNo: iz[t.kimlik] }), 'Yanıtınız iletildi.')}>İzin Ver</button>
            <label htmlFor={`tg-${t.kimlik}`}>Gerekçe</label><input id={`tg-${t.kimlik}`} value={g[t.kimlik] ?? ''} onChange={(e) => setG({ ...g, [t.kimlik]: e.target.value })} />
            <button className="btn hayir" onClick={() => void yap(() => istek(`/tesis-portal/talep/${t.kimlik}/yanit`, { izin: false, gerekce: g[t.kimlik] }), 'Yanıtınız iletildi.')}>İzin Verme</button>
          </div>
        ))}
      </Blok>
      <Blok baslik="İş Takvimi">
        {v.takvim.length === 0 && <div className="not">Takvimde iş bulunmamaktadır.</div>}
        {v.takvim.map((t) => <div key={t.kimlik}>{tarih(t.hedef_tarih)} · {t.yat_adi} · {t.tur} · Onaylı{t.tesis_izin_no ? ` · İzin No: ${t.tesis_izin_no}` : ''}</div>)}
      </Blok>
      <Blok baslik="Faturalar">
        {v.faturalar.map((x) => <div key={x.kimlik}>{x.fatura_no} · {tarih(x.tarih)} · {x.kalem}{x.gun ? ` · ${x.gun} Gün` : ''} · {eur(x.tutar_eur)} · {x.durum}</div>)}
        <label htmlFor="tf-t">İş</label><select id="tf-t" value={f.talep} onChange={(e) => setF({ ...f, talep: e.target.value })}><option value="">Seçiniz</option>{v.takvim.map((t) => <option key={t.kimlik} value={t.kimlik}>{t.yat_adi} · {t.tur}</option>)}</select>
        <div className="iki-tarih"><div><label htmlFor="tf-n">Fatura No</label><input id="tf-n" value={f.no} onChange={(e) => setF({ ...f, no: e.target.value })} /></div><div><label htmlFor="tf-d">Fatura Tarihi</label><input id="tf-d" type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></div></div>
        <label htmlFor="tf-k">Kalem</label><select id="tf-k" value={f.kalem} onChange={(e) => setF({ ...f, kalem: e.target.value })}>{['Çekek', 'Barınma', 'Bekleme ve Muhafaza', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
        {f.kalem === 'Bekleme ve Muhafaza' && <><label htmlFor="tf-g">Gün</label><input id="tf-g" inputMode="numeric" value={f.gun} onChange={(e) => setF({ ...f, gun: e.target.value })} /></>}
        <label htmlFor="tf-u">Tutar (EUR)</label><input id="tf-u" inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} />
        <BelgeSec ad="Fatura Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={f.belge} sec={(x) => setF({ ...f, belge: x })} />
        <button className="btn2" disabled={!f.belge} onClick={() => void yap(() => istek('/tesis-portal/fatura', { ...f, tutar: sayi(f.tutar), gun: f.gun ? Number(f.gun) : undefined }), 'Faturanız kaydedildi.')}>Fatura Gönder</button>
      </Blok>
      <Blok baslik="Tesis Kuralları ve Tarife">
        {v.kayitlar.map((x) => <div key={x.kimlik}>{x.tur} · {x.baslik}</div>)}
        <label htmlFor="tk-t">Tür</label><select id="tk-t" value={k.tur} onChange={(e) => setK({ ...k, tur: e.target.value })}>{['Tesis Kuralı', 'Tarife'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="tk-b">Başlık</label><input id="tk-b" value={k.baslik} onChange={(e) => setK({ ...k, baslik: e.target.value })} />
        <BelgeSec ad="Kural veya Tarife Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={k.belge} sec={(x) => setK({ ...k, belge: x })} />
        <button className="btn2" disabled={!k.belge} onClick={() => void yap(() => istek('/tesis-portal/kayit', k), 'Belgeniz kaydedildi.')}>Yükle</button>
      </Blok>
    </>
  );
}

interface TedarikciV {
  kurulus: string;
  talepler: { kimlik: string; talep_no: string; son_zaman: string; durum: string; kalemler: { kimlik: string; urun_tanimi: string; uretici_parca_no: string | null; miktar: string; birim: string; birim_fiyat_eur: string | null; teslim_suresi_gun: number | null }[] }[];
  siparisler: { kimlik: string; siparis_no: string; statu: string; kdv_haric_eur: string; teslim_tarihi: string; teslim_yeri: string; tedarikci_kabul: string | null; tedarikci_teslim_tarihi: string | null; sevk_var: boolean; kalemler: { urun_tanimi: string; uretici_parca_no: string; miktar: string; birim: string; birim_bedel_eur: string }[] }[];
  faturalar: { kimlik: string; fatura_no: string; tarih: string; tutar_eur: string; siparis_no: string; eslestirme: string | null; vade: string; odeme_durumu: string }[];
}

/** YG-1577, YG-298 A9 Tedarikçi: yalnız kendi teklif ve siparişleri; müşteri kimliği yoktur. */
interface KurumHesapV { kurum: { kimlik: string; sicil_no: string; ticari_unvan: string; kayit_rolu: string; kurumsal_eposta: string | null; kurumsal_telefon: string | null; il: string | null; ilce: string | null }; kullanicilar: { kimlik: string; ad_soyad: string; e_posta: string; cep_telefonu: string | null; hesap_durumu: string; ben: boolean }[]; talepler: { kimlik: string; ad_soyad: string; eposta: string; durum: string }[]; bankalar: { kimlik: string; iban: string; durum: string }[]; bilgiTalepleri: { kimlik: string; alan: string; yeni_deger: string; durum: string }[]; itiraz: { durum: string } | null; itirazEdilebilir: boolean }
interface Cari { satirlar: { hakedis_no: string; is_emri_no: string; bu_donem_brut: string; kesinti: string; net: string; statu: string; firma_fatura_no: string | null; planlanan_tarih: string | null; talimat: string | null; tahsilat_tarihi: string | null }[]; acikNet: number }
/** YG-1574: gün başına kayıt; zorunlu alanlar dolmadan Günü Kapat çalışmaz. */
export function GunlukKayit({ isEmri, yap }: { isEmri: string; yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [f, setF] = useState({ faaliyet: '', olcumler: '', engel: '', sonrakiPlan: '', sorumlu: '' }); const [fot, setFot] = useState<string[]>([]);
  const kaydet = (kapat: boolean) => void yap(() => istek(`/firma-portal/is-emri/${isEmri}/gunluk`, { ...f, fotograflar: fot, kapat }), kapat ? 'Gün kapatıldı.' : 'Kayıt saklandı.');
  return (
    <Blok baslik="Günlük Kayıt">
      <label htmlFor={`gl-f-${isEmri}`}>Yapılan Faaliyet</label><input id={`gl-f-${isEmri}`} value={f.faaliyet} onChange={(e) => setF({ ...f, faaliyet: e.target.value })} />
      <BelgeSec ad="Fotoğraf" bagTuru="İş Emri" bagKimligi={isEmri} deger={fot[fot.length - 1] ?? ''} sec={(x) => setFot([...fot, x])} />
      <label htmlFor={`gl-o-${isEmri}`}>Ölçümler</label><input id={`gl-o-${isEmri}`} value={f.olcumler} onChange={(e) => setF({ ...f, olcumler: e.target.value })} />
      <label htmlFor={`gl-e-${isEmri}`}>Engel</label><input id={`gl-e-${isEmri}`} value={f.engel} onChange={(e) => setF({ ...f, engel: e.target.value })} />
      <label htmlFor={`gl-p-${isEmri}`}>Bir Sonraki Çalışma Günü Planı</label><input id={`gl-p-${isEmri}`} value={f.sonrakiPlan} onChange={(e) => setF({ ...f, sonrakiPlan: e.target.value })} />
      <label htmlFor={`gl-s-${isEmri}`}>Sorumlu</label><input id={`gl-s-${isEmri}`} value={f.sorumlu} onChange={(e) => setF({ ...f, sorumlu: e.target.value })} />
      <div className="not">Günü kapatabilmeniz için zorunlu alanları tamamlamanızı rica ederiz.</div>
      <div className="dugmeler"><button className="btn2" onClick={() => kaydet(false)}>Kaydı Sakla</button><button className="btn evet" onClick={() => kaydet(true)}>Günü Kapat</button></div>
    </Blok>
  );
}

/** A7 Çözüm Ortağı alt menüsü: açık kayıtlar ve aktif iş emirleri. */
export function GunlukSayfasi() {
  const [v, setV] = useState<{ acik: { kimlik: string; tarih: string; is_emri_no: string }[]; aktif: { kimlik: string; is_emri_no: string; bugun: string | null }[] } | null>(null); const [sec, setSec] = useState('');
  const yukle = () => istek<NonNullable<typeof v>>('/firma-portal/gunluk').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  return (
    <>
      <h1>Günlük Kayıt</h1><Mesaj />
      {v && <>
        {v.acik.length > 0 && <Blok baslik="Kapatılmamış Günlük Kayıtlar">{v.acik.map((x) => <div key={x.kimlik} className="uyari">⚠ {x.is_emri_no} · {tarih(x.tarih)}</div>)}</Blok>}
        <Blok baslik="Aktif İş Emirleri">
          {v.aktif.length === 0 && <div className="not">Aktif iş emri bulunmamaktadır.</div>}
          {v.aktif.map((x) => <div className="soru" key={x.kimlik}><span>{x.is_emri_no} · Bugün: {x.bugun ?? 'Kayıt yok'}</span><button className="btn2 kucuk" onClick={() => setSec(x.kimlik)}>Kayıt Gir</button></div>)}
        </Blok>
        {sec && <GunlukKayit key={sec} isEmri={sec} yap={yap} />}
      </>}
    </>
  );
}

/** YG-1430, YG-404, YG-417: firma tedariki parça ve teslim talebi; kabulü LGM verir. */
export function ParcaVeTeslim({ isEmri, yap }: { isEmri: string; yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [l, setL] = useState<{ kimlik: string; urun_tanimi: string; parca_no: string; lot_no: string; kabul_karari: string | null }[]>([]); const [p, setP] = useState({ urun: '', parcaNo: '', miktar: '', birim: 'adet', lot: '' }); const [b, setB] = useState(''); const [ts, setTs] = useState<boolean | null>(null); const [tpl, setTpl] = useState<{ tarih: string; kisa_form: boolean; katilimcilar: string; konusulanlar: string } | null>(null);
  const yukle = () => Promise.all([istek<typeof l>(`/firma-portal/is-emri/${isEmri}/parca`).then(setL), istek<{ teslimOnayi: boolean }>(`/firma-portal/is-emri/${isEmri}/teslim-durumu`).then((x) => setTs(x.teslimOnayi)), istek<typeof tpl>(`/firma-portal/is-emri/${isEmri}/baslangic-toplantisi`).then(setTpl)]);
  useEffect(() => { void yukle().catch(() => undefined); }, [isEmri]);
  return (
    <>
      <Blok baslik="Parça Girişi">
        {l.map((x) => <div key={x.kimlik}>{x.urun_tanimi} · {x.parca_no} · Lot: {x.lot_no} · {x.kabul_karari ?? 'Kontrol Bekliyor'}</div>)}
        <label htmlFor={`pg-u-${isEmri}`}>Ürün</label><input id={`pg-u-${isEmri}`} value={p.urun} onChange={(e) => setP({ ...p, urun: e.target.value })} />
        <label htmlFor={`pg-n-${isEmri}`}>Parça No</label><input id={`pg-n-${isEmri}`} value={p.parcaNo} onChange={(e) => setP({ ...p, parcaNo: e.target.value })} />
        <div className="iki-tarih"><div><label htmlFor={`pg-m-${isEmri}`}>Parça Miktarı</label><input id={`pg-m-${isEmri}`} inputMode="decimal" value={p.miktar} onChange={(e) => setP({ ...p, miktar: e.target.value })} /></div><div><label htmlFor={`pg-b-${isEmri}`}>Birim</label><input id={`pg-b-${isEmri}`} value={p.birim} onChange={(e) => setP({ ...p, birim: e.target.value })} /></div></div>
        <label htmlFor={`pg-l-${isEmri}`}>Lot No</label><input id={`pg-l-${isEmri}`} value={p.lot} onChange={(e) => setP({ ...p, lot: e.target.value })} />
        <BelgeSec ad="İrsaliye veya Sertifika" bagTuru="İş Emri" bagKimligi={isEmri} deger={b} sec={setB} />
        <button className="btn2" disabled={!b} onClick={() => void yap(() => istek(`/firma-portal/is-emri/${isEmri}/parca`, { ...p, miktar: Number(p.miktar.replace(',', '.')), belge: b }).then(() => { setB(''); setP({ urun: '', parcaNo: '', miktar: '', birim: 'adet', lot: '' }); return yukle(); }), 'Parça girişi kontrole gönderildi.')}>Parça Girişini Kaydet</button>
      </Blok>
      {tpl && <Blok baslik="Başlangıç Toplantısı"><div>{tarih(tpl.tarih)}{tpl.kisa_form ? ' · Kısa Form' : ''} · {tpl.katilimcilar}</div><div>{tpl.konusulanlar}</div></Blok>}
      <Blok baslik="Teslim">
        <div className={ts ? 'not' : 'uyari'}>{ts ? 'Teslim Onayı Verildi.' : '⚠ LGM teslim onayını beklemenizi rica ederiz; yat, anahtar ve evrak bu onaydan önce teslim edilmez.'}</div>
        <button className="btn2" onClick={() => void yap(() => istek(`/firma-portal/is-emri/${isEmri}/teslim-talebi`, {}), 'Teslim talebiniz iletildi.')}>Teslim Talebi</button>
      </Blok>
    </>
  );
}

interface SahaV { teshisiBelirsiz: boolean; statu: string; toplanti: { tarih: string; kisa_form: boolean; katilimcilar: string } | null; gunlukler: { kimlik: string; tarih: string; faaliyet: string | null; engel: string | null; durum: string }[]; parcalar: { kimlik: string; urun_tanimi: string; parca_no: string; lot_no: string; kabul_karari: string | null }[]; sapmalar: { kimlik: string; tur: string; aciklama: string; karar: string; durum: string; hedef_tarih: string | null }[]; bulgular: { kimlik: string; sinif: string; aciklama: string }[]; testler?: { kimlik: string; test_no: string; test_grubu: string; sonuc: string | null }[]; dosyaBulgulari?: { kimlik: string; bulgu_no: string; aciklama: string }[]; }
/** YG-379, YG-786, Ek I §7.5: LGM saha kayıtları; karneye kayıtlardan yansır. */
export function SahaKayitlari({ isEmri }: { isEmri: string }) {
  const [v, setV] = useState<SahaV | null>(null); const [s, setS] = useState({ tur: 'Yöntem', aciklama: '', karar: 'Düzeltme', firmaKaynakli: true, isgIhlali: false, onaysizEkIs: false, ekTest: '', zarfGenisledi: false, bulgu: '' }); const [d, setD] = useState({ sinif: 'Minör', aciklama: '', hedef: '' }); const [be, setBe] = useState(''); const [ac, setAc] = useState(false); const [hedef, setHedef] = useState(''); const [kk, setKk] = useState<Record<string, string>>({}); const [gv, setGv] = useState(''); const [tp, setTp] = useState({ tarih: '', katilimcilar: '', konusulanlar: '', kisaForm: false });
  const yukle = () => istek<SahaV>(`/is-emri/${isEmri}/saha-kayitlari`).then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { if (ac) void yap(yukle); }, [ac]);
  if (!ac) return <button className="btn2 kucuk" onClick={() => setAc(true)}>Saha Kayıtları</button>;
  return (
    <div className="tam"><Mesaj />
      {v && <>
        {v.gunlukler.map((x) => <div key={x.kimlik}>{tarih(x.tarih)} · {x.faaliyet ?? '—'}{x.engel ? ` · Engel: ${x.engel}` : ''} · {x.durum}</div>)}
        {v.parcalar.map((x) => <div className="soru" key={x.kimlik}><span>{x.urun_tanimi} · {x.parca_no} · Lot: {x.lot_no} · {x.kabul_karari ?? 'Kontrol Bekliyor'}</span>{!x.kabul_karari && ['Kabul', 'Koşullu Kabul', 'Karantina', 'Ret'].map((k) => <button key={k} className="btn2 kucuk" onClick={() => void yap(() => istek(`/parca-girisi/${x.kimlik}/karar`, { karar: k }))}>{k}</button>)}</div>)}
        {v.statu === 'Durduruldu' && <div className="uyari">⚠ İş durduruldu. <label htmlFor={`rb-${isEmri}`}>Güvenli Koşul Doğrulaması</label><input id={`rb-${isEmri}`} value={gv} onChange={(e) => setGv(e.target.value)} /><button className="btn2 kucuk" disabled={!gv.trim()} onClick={() => void yap(() => istek(`/is-emri/${isEmri}/yeniden-baslat`, { gerekce: gv }), 'İş yeniden başlatıldı.')}>Yeniden Başlat</button></div>}
        {v.toplanti ? <div>Başlangıç Toplantısı: {tarih(v.toplanti.tarih)}{v.toplanti.kisa_form ? ' · Kısa Form' : ''} · {v.toplanti.katilimcilar}</div> : <>
          <label htmlFor={`tp-t-${isEmri}`}>Başlangıç Toplantısı Tarihi</label><input id={`tp-t-${isEmri}`} type="date" value={tp.tarih} onChange={(e) => setTp({ ...tp, tarih: e.target.value })} />
          <label htmlFor={`tp-k-${isEmri}`}>Toplantı Katılımcıları</label><input id={`tp-k-${isEmri}`} value={tp.katilimcilar} onChange={(e) => setTp({ ...tp, katilimcilar: e.target.value })} />
          <label htmlFor={`tp-o-${isEmri}`}>Konuşulanlar</label><input id={`tp-o-${isEmri}`} value={tp.konusulanlar} onChange={(e) => setTp({ ...tp, konusulanlar: e.target.value })} />
          <label><input type="checkbox" checked={tp.kisaForm} onChange={(e) => setTp({ ...tp, kisaForm: e.target.checked })} /> Kısa Form (Basit İş)</label>
          <button className="btn2 kucuk" disabled={!tp.tarih || !tp.katilimcilar.trim() || !tp.konusulanlar.trim()} onClick={() => void yap(() => istek(`/is-emri/${isEmri}/baslangic-toplantisi`, tp), 'Başlangıç toplantısı kaydedildi.')}>Toplantıyı Kaydet</button>
        </>}
        {v.sapmalar.map((x) => <div className="soru" key={x.kimlik}><span>Sapma: {x.tur} · {x.karar} · {x.aciklama} · {x.durum}{x.hedef_tarih ? ` · Hedef: ${tarih(x.hedef_tarih)}` : ''}</span>{x.durum === 'Açık' && <div className="tam"><BelgeSec ad={`Kapanış Kanıtı ${x.tur}`} bagTuru="İş Emri" bagKimligi={isEmri} deger={kk[x.kimlik] ?? ''} sec={(b) => setKk({ ...kk, [x.kimlik]: b })} /><button className="btn2 kucuk" disabled={!kk[x.kimlik]} onClick={() => void yap(() => istek(`/sapma/${x.kimlik}/kapat`, { belge: kk[x.kimlik] }))}>Sapmayı Kapat</button></div>}</div>)}
        {v.bulgular.map((x) => <div key={x.kimlik}>Denetim: {x.sinif} · {x.aciklama}</div>)}
        <ProsesLgm isEmri={isEmri} />
        <label><input type="checkbox" checked={v.teshisiBelirsiz} onChange={(e) => void yap(() => istek(`/is-emri/${isEmri}/teshisi-belirsiz`, { deger: e.target.checked }))} /> Teşhisi Belirsiz İş</label>
        <label htmlFor={`sp-t-${isEmri}`}>Sapma Türü</label><select id={`sp-t-${isEmri}`} value={s.tur} onChange={(e) => setS({ ...s, tur: e.target.value })}>{['Kapsam', 'Yöntem', 'Süre', 'Maliyet', 'Kalite', 'Güvenlik', 'Belge'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor={`sp-a-${isEmri}`}>Sapma Açıklaması</label><input id={`sp-a-${isEmri}`} value={s.aciklama} onChange={(e) => setS({ ...s, aciklama: e.target.value })} />
        <label htmlFor={`sp-k-${isEmri}`}>Sapma Kararı</label><select id={`sp-k-${isEmri}`} value={s.karar} onChange={(e) => setS({ ...s, karar: e.target.value })}>{['İşi Durdur', 'Sınırlı Devam', 'Düzeltme', 'Değişiklik Talebi'].map((x) => <option key={x}>{x}</option>)}</select>
        <label><input type="checkbox" checked={s.firmaKaynakli} onChange={(e) => setS({ ...s, firmaKaynakli: e.target.checked })} /> Firma Kaynaklı</label>
        <label><input type="checkbox" checked={s.isgIhlali} onChange={(e) => setS({ ...s, isgIhlali: e.target.checked })} /> İSG İhlali</label>
        <label><input type="checkbox" checked={s.onaysizEkIs} onChange={(e) => setS({ ...s, onaysizEkIs: e.target.checked })} /> Onaysız Ek İş</label>
        {s.tur === 'Kapsam' && <><label><input type="checkbox" checked={s.zarfGenisledi} onChange={(e) => setS({ ...s, zarfGenisledi: e.target.checked })} /> Onarım Zarfı Genişledi</label>{s.zarfGenisledi && <><label htmlFor={`sp-g-${isEmri}`}>Gizli Hasar Bulgusu</label><select id={`sp-g-${isEmri}`} value={s.bulgu} onChange={(e) => setS({ ...s, bulgu: e.target.value })}><option value="">Seçiniz</option>{(v.dosyaBulgulari ?? []).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.bulgu_no} · {x.aciklama}</option>)}</select></>}</>}
        {Boolean(v.testler?.length) && <><label htmlFor={`sp-e-${isEmri}`}>Ek Test (gerekiyorsa)</label><select id={`sp-e-${isEmri}`} value={s.ekTest} onChange={(e) => setS({ ...s, ekTest: e.target.value })}><option value="">Gerekmiyor</option>{v.testler!.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.test_no} · {x.test_grubu} · {x.sonuc ?? 'Sonuç bekleniyor'}</option>)}</select></>}
        {(s.karar === 'Düzeltme' || s.karar === 'Sınırlı Devam') && <><label htmlFor={`sp-h-${isEmri}`}>Düzeltme Hedef Tarihi</label><input id={`sp-h-${isEmri}`} type="date" value={hedef} onChange={(e) => setHedef(e.target.value)} /></>}
        <button className="btn2 kucuk" disabled={!s.aciklama.trim()} onClick={() => void yap(() => istek(`/is-emri/${isEmri}/sapma`, { ...s, ekTest: s.ekTest || undefined, zarfGenisledi: s.zarfGenisledi || undefined, bulgu: s.zarfGenisledi ? s.bulgu : undefined, hedef: hedef || undefined }).then(() => { setS({ ...s, aciklama: '', ekTest: '', zarfGenisledi: false, bulgu: '' }); setHedef(''); }))}>Sapmayı Kaydet</button>
        <label htmlFor={`db-s-${isEmri}`}>Denetim Bulgusu Sınıfı</label><select id={`db-s-${isEmri}`} value={d.sinif} onChange={(e) => setD({ ...d, sinif: e.target.value })}><option>Minör</option><option>Majör</option></select>
        <label htmlFor={`db-a-${isEmri}`}>Bulgu Açıklaması</label><input id={`db-a-${isEmri}`} value={d.aciklama} onChange={(e) => setD({ ...d, aciklama: e.target.value })} />
        <BelgeSec ad="Denetim Kanıtı" bagTuru="İş Emri" bagKimligi={isEmri} deger={be} sec={setBe} />
        <button className="btn2 kucuk" disabled={!d.aciklama.trim() || !be} onClick={() => void yap(() => istek(`/is-emri/${isEmri}/denetim-bulgusu`, { ...d, belge: be }).then(() => { setBe(''); setD({ ...d, aciklama: '' }); }))}>Bulguyu Kaydet</button>
      </>}
    </div>
  );
}

interface KurumsalV { kurum: string; kurumId?: string; ek2Siniri: string; yetkili: boolean; rol: string; kullanicilar: { kimlik: string; ad_soyad: string; e_posta: string; hesap_durumu: string; rol: string; onay_siniri: string | null; yetkili: boolean; ben: boolean }[] }
/** YG-1563: kurumsal müşteri kendi kullanıcısını ekler; onay adımı yok; onay sınırı Ek-2 sınırını aşmaz. */
/** YG-304, YG-339: firma personeli; ayrılan personelin ekip kartları ve hesabı kapanır. */
export function FirmaPersoneli() {
  const [l, setL] = useState<{ kimlik: string; ad_soyad: string; gorev: string; isg_egitim_bitis: string | null; yetki_belgesi: string | null; yetki_belgesi_bitis: string | null; aktif: boolean }[]>([]); const [f, setF] = useState({ ad: '', gorev: '', telefon: '', isgBitis: '', belge: '', belgeBitis: '' }); const [m, setM] = useState('');
  const yk = () => istek<typeof l>('/firma-portal/personel').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  const tr = (x: string | null) => x ? x.split('-').reverse().join('.') : '-';
  return <><div className="bolum">Personelimiz</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.ad_soyad} · {x.gorev} · İSG eğitimi: {tr(x.isg_egitim_bitis)}{x.yetki_belgesi ? ` · ${x.yetki_belgesi}: ${tr(x.yetki_belgesi_bitis)}` : ''}{x.aktif ? <button className="btn2 kucuk" onClick={() => void istek(`/firma-portal/personel/${x.kimlik}/ayrildi`, {}).then(() => { setM('Ayrılış kaydedildi; ekip kartları kapandı.'); return yk(); }).catch((e) => setM(e.message))}>Ayrıldı</button> : ' · Ayrıldı'}</div>)}</div>
    <label htmlFor="fp-a">Ad Soyad</label><input id="fp-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
    <label htmlFor="fp-g">Görevi</label><input id="fp-g" value={f.gorev} onChange={(e) => setF({ ...f, gorev: e.target.value })} />
    <label htmlFor="fp-t">Telefon</label><input id="fp-t" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} />
    <label htmlFor="fp-i">İSG Eğitimi Geçerlilik Bitişi</label><input id="fp-i" type="date" value={f.isgBitis} onChange={(e) => setF({ ...f, isgBitis: e.target.value })} />
    <label htmlFor="fp-b">Yetki Belgesi / Sertifika</label><input id="fp-b" value={f.belge} onChange={(e) => setF({ ...f, belge: e.target.value })} />
    <label htmlFor="fp-bb">Belge Geçerlilik Bitişi</label><input id="fp-bb" type="date" value={f.belgeBitis} onChange={(e) => setF({ ...f, belgeBitis: e.target.value })} />
    <button className="btn2" onClick={() => void istek('/firma-portal/personel', { ...f, isgBitis: f.isgBitis || undefined, belgeBitis: f.belgeBitis || undefined }).then(() => { setF({ ad: '', gorev: '', telefon: '', isgBitis: '', belge: '', belgeBitis: '' }); setM('Personel kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Personel Ekle</button></>;
}

/** YG-424: Görevli Ekip Kartı; firma unvanı yazılmaz, QR doğrulamaya gider. */
export function EkipKarti({ isEmri, yap }: { isEmri: string; yap: (f: () => Promise<any>, t?: string) => Promise<any> }) {
  const [l, setL] = useState<{ kimlik: string; ad_soyad: string; gorev: string; aktif: boolean }[]>([]); const [s, setS] = useState<string[]>([]); const [k, setK] = useState<{ personel: string; kod: string; qr: string }[]>([]);
  useEffect(() => { void istek<typeof l>('/firma-portal/personel').then((x) => setL(x.filter((y) => y.aktif))).catch(() => setL([])); }, []);
  return <><div className="bolum">Görevli Ekip Kartı</div>
    {l.map((x) => <label className="kutu" key={x.kimlik}><input type="checkbox" checked={s.includes(x.kimlik)} onChange={(e) => setS(e.target.checked ? [...s, x.kimlik] : s.filter((y) => y !== x.kimlik))} /><span>{x.ad_soyad} · {x.gorev}</span></label>)}
    <button className="btn2" disabled={!s.length} onClick={() => void yap(() => istek<{ kartlar: typeof k }>(`/firma-portal/is-emri/${isEmri}/ekip-karti`, { personel: s }).then((r) => setK(r.kartlar)), 'Ekip kartları hazırlandı.')}>Ekip Kartı Oluştur</button>
    {k.map((x) => { const p = l.find((y) => y.kimlik === x.personel); return <div className="ozet" key={x.kod}><div>LİMİT GLOBAL MARINE adına görevli</div><div>{p?.ad_soyad} · {p?.gorev}</div><img src={x.qr} alt={`Doğrulama kodu ${x.kod}`} width={180} height={180} /><div>{x.kod}</div></div>; })}</>;
}

/** YG-424: QR ile açılan herkese açık ekip kartı doğrulaması. */
export function EkipKartiDogrula({ kod }: { kod: string }) {
  const [v, setV] = useState<{ ifade: string; ad: string; gorev: string; gecerlilik: string; dosyaNo: string; gecerli: boolean } | null | false>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>(`/ekip-karti/${encodeURIComponent(kod)}`).then(setV).catch(() => setV(false)); }, [kod]);
  if (v === null) return null;
  return <main className="kart"><h1>Görevli Ekip Kartı Doğrulama</h1>{v === false ? <div className="not" role="alert">Kart bulunamadı.</div> : <div className="ozet"><div>{v.ifade}</div><div>{v.ad} · {v.gorev}</div><div>Dosya No: {v.dosyaNo}</div><div>Geçerlilik: {v.gecerlilik.split('-').reverse().join('.')}</div><div role="status">{v.gecerli ? 'Kart geçerlidir.' : 'Kart geçerli değildir.'}</div></div>}</main>;
}

export function Kullanicilarim() {
  const [v, setV] = useState<KurumsalV | null>(null); const [f, setF] = useState({ ad: '', eposta: '', telefon: '', rol: 'İzleyici', sinir: '' }); const [ge, setGe] = useState<Record<string, string>>({});
  const yukle = () => istek<KurumsalV>('/kurumsal/kullanicilar').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  return (
    <>
      <h1>Kullanıcılarım</h1><Mesaj />
      {v && <>
        <div className="ozet"><div>{v.kurum} · Ek-2 Onay Sınırı: {eur(v.ek2Siniri)} · Rolünüz: {v.rol}</div>{v.yetkili && v.kurumId && <div><a href={`/api/kurumsal-kurum/${v.kurumId}/ek2.pdf`} target="_blank" rel="noreferrer">Ek-2 PDF</a> · <a href={`/api/kurumsal-kurum/${v.kurumId}/ek2.pdf?dil=en`} target="_blank" rel="noreferrer">Annex 2 PDF</a></div>}</div>
        <Blok baslik="Kullanıcılar">
          {v.kullanicilar.map((u) => <div className="soru" key={u.kimlik}><span>{u.ad_soyad} · {u.e_posta} · {u.rol}{u.onay_siniri ? ` · Sınır: ${eur(u.onay_siniri)}` : ''}{u.yetkili ? ' · Kurum Yetkilisi' : ''} · {u.hesap_durumu}</span>
            {v.yetkili && !u.ben && u.hesap_durumu !== 'Kapalı' && <div className="tam"><label htmlFor={`ku-${u.kimlik}`}>Kapatma Nedeni</label><input id={`ku-${u.kimlik}`} value={ge[u.kimlik] ?? ''} onChange={(e) => setGe({ ...ge, [u.kimlik]: e.target.value })} /><button className="btn hayir" disabled={!ge[u.kimlik]?.trim()} onClick={() => void yap(() => istek(`/kurumsal/kullanici/${u.kimlik}/kapat`, { gerekce: ge[u.kimlik] }))}>Hesabı Kapat</button></div>}
          </div>)}
        </Blok>
        {v.yetkili && <Blok baslik="Kullanıcı Ekle">
          <label htmlFor="kk-a">Ad Soyad</label><input id="kk-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
          <label htmlFor="kk-e">E-posta</label><input id="kk-e" type="email" value={f.eposta} onChange={(e) => setF({ ...f, eposta: e.target.value })} />
          <label htmlFor="kk-t">Telefon</label><input id="kk-t" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} />
          <label htmlFor="kk-r">Rol</label><select id="kk-r" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>{['İzleyici', 'Talep Açan', 'Onaylayan'].map((x) => <option key={x}>{x}</option>)}</select>
          {f.rol === 'Onaylayan' && <><label htmlFor="kk-s">Onay Sınırı (EUR)</label><input id="kk-s" inputMode="decimal" value={f.sinir} onChange={(e) => setF({ ...f, sinir: e.target.value })} /></>}
          <button className="btn2" disabled={!f.ad.trim() || !f.eposta.trim()} onClick={() => void yap(() => istek('/kurumsal/kullanici', { ad: f.ad, eposta: f.eposta, telefon: f.telefon, rol: f.rol, sinir: f.sinir ? Number(f.sinir.replace(',', '.')) : undefined }).then(() => { setF({ ad: '', eposta: '', telefon: '', rol: 'İzleyici', sinir: '' }); return { uyari: 'Kullanıcı eklendi, davet gönderildi.' }; }))}>Kullanıcı Ekle</button>
        </Blok>}
      </>}
    </>
  );
}

interface KarneOlay { kimlik: string; is_emri_no: string; oncelik: string; kalite_puani: string | null; sure_puani: string | null; maliyet_puani: string | null; iletisim_puani: string | null; uyum_puani: string | null; dosya_puani: string; itiraz: string | null }
interface KarneV { donem: { donem_puani: string | null; yetersiz_veri: boolean; kapanan_dosya_sayisi: number; uygunsuzluk_kesintisi: string; kalite: string | null; sure: string | null; maliyet: string | null; iletisim: string | null; uyum: string | null } | null; olaylar: KarneOlay[] }
const puan = (x: string | null | undefined) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }));
/** YG-351, YG-422: firma kendi dönem puanını ve boyut dökümünü görür, risk derecesini görmez; puana itiraz edebilir, geçmiş silinmez. */
function FirmaKarne({ yap }: { yap: (f: () => Promise<any>) => Promise<void> }) {
  const [v, setV] = useState<KarneV | null>(null); const [itz, setItz] = useState<Record<string, string>>({});
  const yukle = () => istek<KarneV>('/firma-portal/karne').then(setV);
  useEffect(() => { void yukle().catch(() => setV({ donem: null, olaylar: [] })); }, []);
  if (!v) return null;
  const d = v.donem;
  return (
    <Blok baslik="Performans Karnesi">
      {!d && <div className="not">Henüz kapanan iş emri bulunmamaktadır.</div>}
      {d && <div className="ozet"><div>Dönem Puanı (son 12 ay): {d.yetersiz_veri ? 'Yetersiz veri' : puan(d.donem_puani)} · Kapanan Dosya: {d.kapanan_dosya_sayisi}{Number(d.uygunsuzluk_kesintisi) > 0 ? ` · Uygunsuzluk Kesintisi: ${puan(d.uygunsuzluk_kesintisi)}` : ''}</div><div>Kalite: {puan(d.kalite)} · Uyum/Güvenlik: {puan(d.uyum)} · Süre: {puan(d.sure)} · Maliyet: {puan(d.maliyet)} · İletişim: {puan(d.iletisim)}</div></div>}
      {v.olaylar.map((x) => (
        <div className="soru" key={x.kimlik}>
          <span><b className="koyu">{x.is_emri_no}</b> · {x.oncelik} · Puan: {puan(x.dosya_puani)} · Kalite {puan(x.kalite_puani)} · Uyum {puan(x.uyum_puani)} · Süre {puan(x.sure_puani)} · Maliyet {puan(x.maliyet_puani)} · İletişim {puan(x.iletisim_puani)}{x.itiraz ? ` · İtiraz: ${x.itiraz}` : ''}</span>
          {x.itiraz !== 'İncelemede' && <div className="tam"><label htmlFor={`kr-${x.kimlik}`}>İtiraz Konusu</label><input id={`kr-${x.kimlik}`} value={itz[x.kimlik] ?? ''} onChange={(e) => setItz({ ...itz, [x.kimlik]: e.target.value })} /><button className="btn hayir" disabled={!itz[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/firma-portal/karne/${x.kimlik}/itiraz`, { konu: itz[x.kimlik] }).then(() => { setItz({ ...itz, [x.kimlik]: '' }); return yukle().then(() => ({ uyari: 'İtirazınız Firma Yönetimi Müdürüne iletildi.' })); }))}>İtiraz Et</button></div>}
        </div>
      ))}
    </Blok>
  );
}

const ALANLAR: Record<string, string> = { kurumsal_eposta: 'Kurumsal E-posta', kurumsal_telefon: 'Kurumsal Telefon', il: 'İl', ilce: 'İlçe' };
/** YG-425, YG-1004: firma bilgileri ve kullanıcılar; yeni kullanıcı LGM teyidiyle açılır, ayrılan kişinin hesabı hemen kapanır. YG-298: tedarikçide fatura ve ödeme durumu. */
export function KurumHesap({ baslik }: { baslik: string }) {
  const [v, setV] = useState<KurumHesapV | null>(null); const [f, setF] = useState({ ad: '', eposta: '', telefon: '' }); const [ge, setGe] = useState<Record<string, string>>({}); const [fat, setFat] = useState<TedarikciV['faturalar']>([]); const [cari, setCari] = useState<Cari | null>(null); const [iban, setIban] = useState(''); const [bi, setBi] = useState({ alan: 'kurumsal_eposta', yeni: '' }); const [itz, setItz] = useState('');
  const yukle = async () => { const h = await istek<KurumHesapV>('/kurum/hesap'); setV(h); if (h.kurum.kayit_rolu === 'Tedarikçi') setFat((await istek<TedarikciV>('/tedarikci-portal/ana')).faturalar); if (h.kurum.kayit_rolu === 'Çözüm Ortağı') setCari(await istek<Cari>('/firma-portal/cari')); };
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return <Mesaj />;
  const k = v.kurum;
  return (
    <>
      <h1>{baslik}</h1><Mesaj />
      <Blok baslik="Kurum Bilgileri">
        <div className="ozet"><div>{k.ticari_unvan} · {k.kayit_rolu} · Sicil No: {k.sicil_no}</div><div>E-posta: {k.kurumsal_eposta ?? '—'} · Telefon: {k.kurumsal_telefon ?? '—'} · {[k.il, k.ilce].filter(Boolean).join(' / ') || '—'}</div></div>
        {v.bilgiTalepleri.map((x) => <div key={x.kimlik}>{ALANLAR[x.alan]}: {x.yeni_deger} · {x.durum}</div>)}
        <label htmlFor="bi-a">Değiştirilecek Bilgi</label><select id="bi-a" value={bi.alan} onChange={(e) => setBi({ ...bi, alan: e.target.value })}>{Object.entries(ALANLAR).map(([a, ad]) => <option key={a} value={a}>{ad}</option>)}</select>
        <label htmlFor="bi-y">Yeni Değer</label><input id="bi-y" value={bi.yeni} onChange={(e) => setBi({ ...bi, yeni: e.target.value })} />
        <button className="btn2" disabled={!bi.yeni.trim()} onClick={() => void yap(() => istek('/kurum/bilgi-degisikligi', bi).then(() => { setBi({ ...bi, yeni: '' }); return { uyari: 'Talebiniz LGM teyidine gönderildi.' }; }))}>Değişiklik Talep Et</button>
      </Blok>
      <Blok baslik="Banka Hesabı">
        {v.bankalar.length === 0 && <div className="not">Kayıtlı banka hesabı bulunmamaktadır.</div>}
        {v.bankalar.map((x) => <div key={x.kimlik}>{x.iban} · {x.durum === 'Karantina' ? 'Teyit Bekleniyor' : x.durum}</div>)}
        <label htmlFor="ib-n">Yeni IBAN</label><input id="ib-n" value={iban} onChange={(e) => setIban(e.target.value)} />
        <div className="not">Yeni hesap, sicilde kayıtlı numaranızdan geri aranarak teyit edilince geçerli olur.</div>
        <button className="btn2" disabled={!iban.trim()} onClick={() => void yap(() => istek('/kurum/banka', { iban }).then(() => { setIban(''); return { uyari: 'IBAN teyide gönderildi.' }; }))}>IBAN Bildir</button>
      </Blok>
      {cari && <Blok baslik="Cari Ekstre">
        <div>Açık Net Tutar: {eur(cari.acikNet)}</div>
        {cari.satirlar.length === 0 && <div className="not">Hakediş bulunmamaktadır.</div>}
        {cari.satirlar.map((x) => <div key={x.hakedis_no}>{x.hakedis_no} · {x.is_emri_no} · Brüt: {eur(x.bu_donem_brut)} · Kesinti: {eur(x.kesinti)} · Net: {eur(x.net)} · {x.statu}{x.firma_fatura_no ? ` · Fatura: ${x.firma_fatura_no}` : ''}{x.tahsilat_tarihi ? ` · Tahsilat: ${tarih(x.tahsilat_tarihi)}` : ''}{x.planlanan_tarih ? ` · Ödeme Günü: ${tarih(x.planlanan_tarih)}` : ''}</div>)}
      </Blok>}
      {k.kayit_rolu === 'Çözüm Ortağı' && <FirmaKarne yap={yap} />}
      {k.kayit_rolu === 'Çözüm Ortağı' && <FirmaPersoneli />}
      {(v.itirazEdilebilir || v.itiraz) && <Blok baslik="Kabul Kararı İtirazı">
        {v.itiraz && <div>İtiraz Durumu: {v.itiraz.durum}</div>}
        {v.itirazEdilebilir && <><label htmlFor="it-g">İtiraz Gerekçesi</label><input id="it-g" value={itz} onChange={(e) => setItz(e.target.value)} /><button className="btn2" disabled={!itz.trim()} onClick={() => void yap(() => istek('/kurum/kabul-itiraz', { gerekce: itz }))}>İtiraz Et</button></>}
      </Blok>}
      {k.kayit_rolu === 'Tedarikçi' && <Blok baslik="Faturalar ve Ödeme Durumu">
        {fat.length === 0 && <div className="not">Fatura bulunmamaktadır.</div>}
        {fat.map((x) => <div key={x.kimlik}>{x.fatura_no} · {x.siparis_no} · {eur(x.tutar_eur)} · {x.odeme_durumu} · Vade: {tarih(x.vade)}</div>)}
      </Blok>}
      <Blok baslik="Kullanıcılar">
        {v.kullanicilar.map((u) => (
          <div className="soru" key={u.kimlik}>
            <span>{u.ad_soyad} · {u.e_posta} · {u.hesap_durumu}</span>
            {!u.ben && u.hesap_durumu !== 'Kapalı' && <div className="tam">
              <label htmlFor={`kk-${u.kimlik}`}>Kapatma Nedeni</label><input id={`kk-${u.kimlik}`} value={ge[u.kimlik] ?? ''} onChange={(e) => setGe({ ...ge, [u.kimlik]: e.target.value })} />
              <button className="btn hayir" disabled={!ge[u.kimlik]?.trim()} onClick={() => void yap(() => istek(`/kurum/kullanici/${u.kimlik}/kapat`, { gerekce: ge[u.kimlik] }))}>Hesabı Kapat</button>
            </div>}
          </div>
        ))}
        {v.talepler.map((u) => <div key={u.kimlik}>{u.ad_soyad} · {u.eposta} · {u.durum}</div>)}
        <label htmlFor="ky-a">Ad Soyad</label><input id="ky-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
        <label htmlFor="ky-e">E-posta</label><input id="ky-e" type="email" value={f.eposta} onChange={(e) => setF({ ...f, eposta: e.target.value })} />
        <label htmlFor="ky-t">Telefon</label><input id="ky-t" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} />
        <button className="btn2" disabled={!f.ad.trim() || !f.eposta.trim()} onClick={() => void yap(() => istek('/kurum/kullanici', f).then(() => { setF({ ad: '', eposta: '', telefon: '' }); return { uyari: 'Talebiniz LGM teyidine gönderildi.' }; }))}>Kullanıcı Ekle</button>
      </Blok>
    </>
  );
}

export function TedarikciAna({ ben, bolum = 'ana' }: { ben: Ben; bolum?: 'ana' | 'siparis' | 'teklif' }) {
  const [v, setV] = useState<TedarikciV | null>(null); const [fy, setFy] = useState<Record<string, { fiyat: string; sure: string }>>({});
  const [ka, setKa] = useState<Record<string, { kod: string; teslim: string; gerekce: string }>>({});
  const [se, setSe] = useState<Record<string, { tarih: string; irsaliye: string; tasiyici: string; lot: string; belge: string }>>({});
  const [fa, setFa] = useState<Record<string, { no: string; tarih: string; tutar: string; belge: string }>>({});
  const yukle = () => istek<TedarikciV>('/tedarikci-portal/ana').then(setV);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yap(yukle); }, []);
  if (!v) return <Mesaj />;
  const bekT = v.talepler.filter((t) => t.durum === 'Yanıt Bekliyor');
  // YG-1577: Ana Sayfa yalnız yanıt bekleyenleri gösterir; Siparişler ve Teklifler ayrı menüdedir.
  const gorunenS = bolum === 'ana' ? v.siparisler.filter((s) => s.statu === 'Verildi' && !s.tedarikci_kabul) : v.siparisler;
  return (
    <>
      <h1>{bolum === 'siparis' ? 'Siparişler' : bolum === 'teklif' ? 'Teklifler' : `Hoş Geldiniz, ${ben.adSoyad}`}</h1><Mesaj />
      {bolum !== 'siparis' && <Blok baslik="Teklif Talepleri">
        {bekT.length === 0 && <div className="not">Bekleyen teklif talebi bulunmamaktadır.</div>}
        {bekT.map((t) => (
          <div className="soru" key={t.kimlik}>
            <span><b className="koyu">{t.talep_no}</b> · Son: {new Date(t.son_zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}</span>
            {t.kalemler.map((k) => { const a = fy[k.kimlik] ?? { fiyat: '', sure: '' }; return <div key={k.kimlik}><div>{k.urun_tanimi}{k.uretici_parca_no ? ` · ${k.uretici_parca_no}` : ''} · {k.miktar} {k.birim}</div><div className="iki-tarih"><div><label htmlFor={`tf-${k.kimlik}`}>Birim Fiyat (EUR)</label><input id={`tf-${k.kimlik}`} inputMode="decimal" value={a.fiyat} onChange={(e) => setFy({ ...fy, [k.kimlik]: { ...a, fiyat: e.target.value } })} /></div><div><label htmlFor={`ts-${k.kimlik}`}>Teslim Süresi (Gün)</label><input id={`ts-${k.kimlik}`} inputMode="numeric" value={a.sure} onChange={(e) => setFy({ ...fy, [k.kimlik]: { ...a, sure: e.target.value } })} /></div></div></div>; })}
            <button className="btn2" onClick={() => void yap(() => istek(`/tedarikci-portal/talep/${t.kimlik}/yanit`, { kalemler: t.kalemler.map((k) => ({ kimlik: k.kimlik, fiyat: sayi(fy[k.kimlik]?.fiyat ?? ''), sure: Number(fy[k.kimlik]?.sure ?? '') })) }), 'Teklifiniz iletildi; geçerlilik 30 gündür.')}>Teklifi Gönder</button>
          </div>
        ))}
      </Blok>}
      {bolum !== 'teklif' && <Blok baslik={bolum === 'ana' ? 'Kabul Bekleyen Siparişler' : 'Siparişler'}>
        {gorunenS.length === 0 && <div className="not">{bolum === 'ana' ? 'Kabul bekleyen sipariş bulunmamaktadır.' : 'Sipariş bulunmamaktadır.'}</div>}
        {gorunenS.map((s) => {
          const a = ka[s.kimlik] ?? { kod: '', teslim: '', gerekce: '' }; const b = se[s.kimlik] ?? { tarih: '', irsaliye: '', tasiyici: '', lot: '', belge: '' }; const c = fa[s.kimlik] ?? { no: '', tarih: '', tutar: '', belge: '' };
          return (
            <div className="soru" key={s.kimlik}>
              <span><b className="koyu">{s.siparis_no}</b> · {s.statu} · {eur(s.kdv_haric_eur)} (KDV Hariç) · Teslim Yeri: {s.teslim_yeri}</span>
              {s.kalemler.map((k) => <div key={k.uretici_parca_no + k.urun_tanimi}>{k.urun_tanimi} · {k.uretici_parca_no} · {k.miktar} {k.birim} · {eur(k.birim_bedel_eur)}</div>)}
              {s.statu === 'Verildi' && !s.tedarikci_kabul && <>
                <div className="iki-tarih"><div><label htmlFor={`sk-t-${s.kimlik}`}>Teslim Tarihi</label><input id={`sk-t-${s.kimlik}`} type="date" value={a.teslim} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, teslim: e.target.value } })} /></div><div><label htmlFor={`sk-k-${s.kimlik}`}>Onay Kodu</label><input id={`sk-k-${s.kimlik}`} inputMode="numeric" value={a.kod} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, kod: e.target.value } })} /></div></div>
                <button className="btn evet" onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/yanit`, { kabul: true, kod: a.kod, teslim: a.teslim }), 'Siparişi kabul ettiniz.')}>Siparişi Kabul Ediyorum</button>
                <label htmlFor={`sk-g-${s.kimlik}`}>Gerekçe</label><input id={`sk-g-${s.kimlik}`} value={a.gerekce} onChange={(e) => setKa({ ...ka, [s.kimlik]: { ...a, gerekce: e.target.value } })} />
                <button className="btn hayir" onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/yanit`, { kabul: false, gerekce: a.gerekce }), 'Yanıtınız iletildi.')}>Kabul Etmiyorum</button>
              </>}
              {s.tedarikci_kabul === 'Kabul' && <div>Söz Verilen Teslim: {tarih(s.tedarikci_teslim_tarihi)}{s.sevk_var ? ' · Sevk Edildi' : ''}</div>}
              {s.tedarikci_kabul === 'Kabul' && !s.sevk_var && <>
                <div className="iki-tarih"><div><label htmlFor={`sv-t-${s.kimlik}`}>Sevk Tarihi</label><input id={`sv-t-${s.kimlik}`} type="date" value={b.tarih} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, tarih: e.target.value } })} /></div><div><label htmlFor={`sv-i-${s.kimlik}`}>İrsaliye No</label><input id={`sv-i-${s.kimlik}`} value={b.irsaliye} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, irsaliye: e.target.value } })} /></div></div>
                <div className="iki-tarih"><div><label htmlFor={`sv-s-${s.kimlik}`}>Taşıyıcı</label><input id={`sv-s-${s.kimlik}`} value={b.tasiyici} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, tasiyici: e.target.value } })} /></div><div><label htmlFor={`sv-l-${s.kimlik}`}>Lot No</label><input id={`sv-l-${s.kimlik}`} value={b.lot} onChange={(e) => setSe({ ...se, [s.kimlik]: { ...b, lot: e.target.value } })} /></div></div>
                <BelgeSec ad="İrsaliye ve Sertifika" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={b.belge} sec={(x) => setSe({ ...se, [s.kimlik]: { ...b, belge: x } })} />
                <button className="btn2" disabled={!b.belge} onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/sevk`, b), 'Sevk bildiriminiz iletildi.')}>Sevk Bildir</button>
              </>}
              {s.tedarikci_kabul === 'Kabul' && <>
                <div className="iki-tarih"><div><label htmlFor={`sf-n-${s.kimlik}`}>Fatura No</label><input id={`sf-n-${s.kimlik}`} value={c.no} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, no: e.target.value } })} /></div><div><label htmlFor={`sf-t-${s.kimlik}`}>Fatura Tarihi</label><input id={`sf-t-${s.kimlik}`} type="date" value={c.tarih} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, tarih: e.target.value } })} /></div></div>
                <label htmlFor={`sf-u-${s.kimlik}`}>KDV Hariç Tutar (EUR)</label><input id={`sf-u-${s.kimlik}`} inputMode="decimal" value={c.tutar} onChange={(e) => setFa({ ...fa, [s.kimlik]: { ...c, tutar: e.target.value } })} />
                <BelgeSec ad="Fatura Belgesi" bagTuru="Kuruluş" bagKimligi={v.kurulus} deger={c.belge} sec={(x) => setFa({ ...fa, [s.kimlik]: { ...c, belge: x } })} />
                <button className="btn2" disabled={!c.belge} onClick={() => void yap(() => istek(`/tedarikci-portal/siparis/${s.kimlik}/fatura`, { no: c.no, tarih: c.tarih, tutar: sayi(c.tutar), belge: c.belge }), 'Faturanız kaydedildi.')}>Fatura Gönder</button>
              </>}
            </div>
          );
        })}
      </Blok>}
    </>
  );
}

interface TesisTalep { kimlik: string; tur: string; hedef_tarih: string; durum: string; tesis_izin_no: string | null; red_gerekcesi: string | null; ticari_unvan: string }

/** YG-1447: dosya içinde Tesis İşlemleri listesi; açmak Dosya Sorumlusunun işidir. */
export function TesisIslemleri({ id, ds }: { id: string; ds: boolean }) {
  const [l, setL] = useState<TesisTalep[]>([]); const [t, setT] = useState<{ kimlik: string; ticari_unvan: string }[]>([]); const [f, setF] = useState({ tesis: '', tur: 'Saha Girişi', hedef: '', aciklama: '' });
  const yukle = () => istek<TesisTalep[]>(`/dosya/${id}/tesis-talepleri`).then(setL);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); if (ds) void istek<typeof t>('/tesis-listesi').then(setT).catch(() => {}); }, [id]);
  if (!ds && !l.length) return null;
  return (
    <Blok baslik="Tesis İşlemleri">
      <Mesaj />
      {l.map((x) => <div key={x.kimlik}>{x.ticari_unvan} · {x.tur} · {tarih(x.hedef_tarih)} · {x.durum}{x.tesis_izin_no ? ` · İzin No: ${x.tesis_izin_no}` : ''}{x.red_gerekcesi ? ` · ${x.red_gerekcesi}` : ''}</div>)}
      {ds && <>
        <label htmlFor="tis-t">Tesis</label><select id="tis-t" value={f.tesis} onChange={(e) => setF({ ...f, tesis: e.target.value })}><option value="">Seçiniz</option>{t.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
        <label htmlFor="tis-u">İşlem</label><select id="tis-u" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Saha Girişi', 'Çalışma İzni', 'Çekek Randevusu', 'Kalış Uzatma'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="tis-h">Hedef Tarih</label><input id="tis-h" type="date" value={f.hedef} onChange={(e) => setF({ ...f, hedef: e.target.value })} />
        <label htmlFor="tis-a">Açıklama</label><input id="tis-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/tesis-talebi`, f), 'Talep tesise iletildi.')}>Tesise Talep Gönder</button>
      </>}
    </Blok>
  );
}

interface TeklifTalebi { kimlik: string; talep_no: string; durum: string; gecerlilik: string | null; ticari_unvan: string; kalemler: { urun_tanimi: string; miktar: string; birim: string; birim_fiyat_eur: string | null; teslim_suresi_gun: number | null }[] }

/** YG-298: tedarikçiden teklif talebi; Tedarik Sorumlusu açar. */
export function TeklifTalebiBolumu({ id, roller }: { id: string; roller: string[] }) {
  const [l, setL] = useState<TeklifTalebi[]>([]); const [ted, setTed] = useState<{ kimlik: string; ticari_unvan: string; engel: string | null }[]>([]); const [f, setF] = useState({ tedarikci: '', sonZaman: '', tanim: '', parcaNo: '', miktar: '1', birim: 'adet', satir: '' }); const [satirlar, setSatirlar] = useState<{ kimlik: string; satir_kodu: string; aciklama: string }[]>([]);
  const ts = roller.includes('Tedarik Sorumlusu');
  const yukle = () => istek<TeklifTalebi[]>(`/dosya/${id}/teklif-talepleri`).then(setL);
  const { yap, Mesaj } = useYap(yukle);
  useEffect(() => { void yukle().catch(() => {}); if (ts) { void istek<typeof ted>('/firma/uygunluk?rol=Tedarikçi').then(setTed).catch(() => {}); void istek<typeof satirlar>(`/dosya/${id}/tedarik-satirlari`).then(setSatirlar).catch(() => {}); } }, [id]);
  if (!ts && !l.length) return null;
  return (
    <Blok baslik="Tedarikçi Teklif Talepleri">
      <Mesaj />
      {l.map((t) => <div className="soru" key={t.kimlik}><span>{t.talep_no} · {t.ticari_unvan} · {t.durum}{t.gecerlilik ? ` · Geçerlilik: ${tarih(t.gecerlilik)}` : ''}</span>{t.kalemler.map((k, n) => <div key={n}>{k.urun_tanimi} · {k.miktar} {k.birim}{k.birim_fiyat_eur !== null ? ` · ${eur(k.birim_fiyat_eur)} · ${k.teslim_suresi_gun} Gün` : ''}</div>)}</div>)}
      {ts && <>
        <label htmlFor="tt-t">Tedarikçi</label><select id="tt-t" value={f.tedarikci} onChange={(e) => setF({ ...f, tedarikci: e.target.value })}><option value="">Seçiniz</option>{ted.filter((x) => !x.engel).map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
        <label htmlFor="tt-s">Yanıt Son Zamanı</label><input id="tt-s" type="datetime-local" value={f.sonZaman} onChange={(e) => setF({ ...f, sonZaman: e.target.value })} />
        <label htmlFor="tt-k">Kapsam Satırı (fiyat teklife geçer)</label><select id="tt-k" value={f.satir} onChange={(e) => setF({ ...f, satir: e.target.value })}><option value="">Bağlama</option>{satirlar.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.satir_kodu} · {x.aciklama}</option>)}</select>
        <label htmlFor="tt-u">Ürün</label><input id="tt-u" value={f.tanim} onChange={(e) => setF({ ...f, tanim: e.target.value })} />
        <label htmlFor="tt-p">Üretici Parça No</label><input id="tt-p" value={f.parcaNo} onChange={(e) => setF({ ...f, parcaNo: e.target.value })} />
        <div className="iki-tarih"><div><label htmlFor="tt-m">Miktar</label><input id="tt-m" inputMode="decimal" value={f.miktar} onChange={(e) => setF({ ...f, miktar: e.target.value })} /></div><div><label htmlFor="tt-b">Birim</label><input id="tt-b" value={f.birim} onChange={(e) => setF({ ...f, birim: e.target.value })} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/teklif-talebi`, { tedarikci: f.tedarikci, sonZaman: f.sonZaman && new Date(f.sonZaman).toISOString(), kalemler: [{ tanim: f.tanim, parcaNo: f.parcaNo, miktar: sayi(f.miktar), birim: f.birim, satir: f.satir || undefined }] }), 'Teklif talebi gönderildi.')}>Teklif Talebi Gönder</button>
      </>}
    </Blok>
  );
}
