import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { TicariBolumu } from './Ticari';
import { KaliteBolumu, RaporBolumu, SigortaEposta, SigortaGonderimBolumu, TedarikBolumu, YatDegeriBolumu } from './Kalite';
import { TeklifTalebiBolumu, TesisIslemleri } from './Portallar';

interface Secenek { kanallar: string[]; turler: string[]; yetki: string[]; sorular: string[]; tekneTuru: string[]; govde: string[]; klas: string[]; sifat: string[]; oncelikler: string[] }
interface IhbarSatir { kimlik: string; talep_no: string; statu: string; oncelik: string; ihtiyac_tanimi: string; yat_mevcut_konumu: string; bildirim_alinma_zamani: string; ilk_yanit_zamani: string | null; talep_sahibi_adi: string; yat_adi: string; ilk_yanit_son: string | null }
interface DosyaSatir { kimlik: string; dosya_no: string; statu: string; asama: string | null; oncelik: string; konum: string; yat_adi: string; dosya_sorumlusu: string | null; beklemede: string | null; sonraki_son: string | null }
interface Sure { tur: string; baslangic: string; bitis: string; kaydirma_notu: string | null; tamamlanma: string | null; renk: 'yeşil' | 'sarı' | 'kırmızı' | null }
interface Ekip { kimlik: string; rol: string; ad_soyad: string; kullanici: string }
interface Bekleme { kimlik: string; neden: string; hedef_tarih: string; sayac_durur: boolean; uzatma_sayisi: number; olusturma_zamani: string; kaldirilma_zamani: string | null; sorumlu: string }
interface Konu { kimlik: string; konu_no: string; baslik: string; statu: string; hedef_tarih: string; sahip: string; gecikmis: boolean }
interface Belge { kimlik: string; ad: string; belge_turu: string; surumler: { no: number; durum: string }[] }
interface DosyaAyrinti extends DosyaSatir {
  musteri_turu: string; dosya_niteligi: string; kisa_teknik_tanim: string; zorluk_katsayisi: string; bireysel6502: boolean; rollerim: string[]; izinler: string[]; dosya_sorumlusu_ref: string | null; hasar_ilerleyebilir: boolean; vefat_isareti: boolean;
  yat: { yat_adi: string; tur: string | null; marka: string | null; model: string | null; tam_boy_m: string | null; govde_malzemesi: string | null; tahrik_turu: string | null; bayrak: string | null; gecici_kayit: boolean; katalog_teyit: string | null };
  talep: { talep_sahibi_adi: string; talep_sahibi_turu: string; ihbar_yetki_durumu: string; yat_mevcut_durumu: string };
  taraflar: { kimlik: string; taraf_rolu: string; kisi_adi_soyadi: string; telefon: string | null; eposta: string | null }[];
  sigorta: { sigortaci_adi: string | null; sigorta_hasar_dosya_no: string | null; police_no: string | null; eposta: string | null; onay_yetkilisi_eposta: string | null } | null;
  ekip: Ekip[]; sureler: Sure[]; bekleme: Bekleme[]; konular: Konu[]; yapilacaklar: { is: string; sorumlu: string; engel?: boolean }[];
  gecmis: { yeni_statu: string; yeni_asama: string | null; gerekce: string; olusturma_zamani: string; yapan: string | null; sonraki_sorumlu_rol: string | null }[];
}
const saat = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
const gun = (s: string) => s.split('-').reverse().join('.');
const ASAMALAR = ['Keşif', 'Teklif', 'Onay', 'Uygulama', 'Kontrol', 'Teslim'];
const EKIP_ROLLERI = ['Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi', 'Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Saha Sorumlusu', 'Kalite Kontrolör', 'Tedarik Sorumlusu'];
const BEKLEME = ['Bilgi', 'Uzman Görüşü', 'Eksper', 'Sigorta Onayı', 'Müşteri Kararı', 'Parça', 'Hava', 'Erişim', 'Ödeme', 'Sigorta Kararı', 'Muvafakat'];

/** YG-034, YG-035: renk risk düzeyine göre. YG-1579: Kritik kırmızı, Yüksek sarı, Normal ve Planlı gri. */
export const Oncelik = ({ o }: { o: string }) => <span className={`oncelik o-${o === 'Kritik' ? 'k' : o === 'Yüksek' ? 'y' : 'g'}`}>{o}</span>;
const Sayac = ({ s }: { s: Sure }) => s.tamamlanma ? <>Tamamlandı · {saat(s.tamamlanma)}</> : <span className={`sure s-${s.renk === 'kırmızı' ? 'k' : s.renk === 'sarı' ? 's' : 'y'}`}>Son: {saat(s.bitis)}{s.kaydirma_notu ? ` · ${s.kaydirma_notu}` : ''}</span>;
const Blok = ({ baslik, children }: { baslik: string; children: ReactNode }) => <><div className="bolum">{baslik}</div><div className="ozet">{children}</div></>;

export function Dosyalar({ ben, acikDosya, acildi }: { ben: Ben; acikDosya: string | null; acildi: () => void }) {
  const ihbarci = ben.izinler.includes('ihbar.kaydet'); const tumu = ben.izinler.includes('dosya.tum');
  const [ihbarlar, setIhbarlar] = useState<IhbarSatir[]>([]); const [dosyalar, setDosyalar] = useState<DosyaSatir[]>([]);
  const [kapsam, setKapsam] = useState(tumu ? 'tum' : 'benim'); const [form, setForm] = useState(false); const [ihbarId, setIhbarId] = useState<string | null>(null); const [dosyaId, setDosyaId] = useState<string | null>(acikDosya); const [hata, setHata] = useState('');
  const yukle = () => {
    void istek<DosyaSatir[]>(`/dosya?kapsam=${kapsam}`).then(setDosyalar).catch((e) => setHata(e.message));
    if (ihbarci) void istek<IhbarSatir[]>('/ihbar').then(setIhbarlar).catch((e) => setHata(e.message));
  };
  useEffect(yukle, [kapsam]);
  useEffect(() => { if (acikDosya) { setDosyaId(acikDosya); setIhbarId(null); acildi(); } }, [acikDosya]);
  if (dosyaId) return <DosyaEkrani id={dosyaId} roller={ben.roller.map((r) => r.rol_adi)} geri={() => { setDosyaId(null); yukle(); }} />;
  if (ihbarId) return <IhbarEkrani id={ihbarId} geri={(d) => { setIhbarId(null); yukle(); if (d) setDosyaId(d); }} />;
  if (form) return <IhbarFormu bitti={(id) => { setForm(false); yukle(); if (id) setIhbarId(id); }} />;
  return (
    <>
      <h1>Dosyalar</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {ihbarci && <button className="btn" onClick={() => setForm(true)}>Yeni İhbar</button>}
      {ihbarci && <>
        <div className="bolum">Açılış Bekleyen İhbarlar</div>
        {ihbarlar.length === 0 ? <div className="ozet bos">Bekleyen ihbar bulunmamaktadır.</div> : (
          <div className="tablo"><table className="kartli"><thead><tr><th>Numara</th><th>Yat</th><th>Öncelik</th><th>Durum</th><th>İlk Yanıt</th><th /></tr></thead>
            <tbody>{ihbarlar.map((t) => <tr key={t.kimlik}><td data-ad="Numara">{t.talep_no}</td><td data-ad="Yat">{t.yat_adi}</td><td data-ad="Öncelik"><Oncelik o={t.oncelik} /></td><td data-ad="Durum">{t.statu}</td><td data-ad="İlk Yanıt">{t.ilk_yanit_zamani ? saat(t.ilk_yanit_zamani) : t.ilk_yanit_son ? `Son: ${saat(t.ilk_yanit_son)}` : '—'}</td><td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => setIhbarId(t.kimlik)}>Aç</button></td></tr>)}</tbody>
          </table></div>
        )}
      </>}
      <div className="bolum">{kapsam === 'tum' ? 'Tüm Dosyalar' : 'Dosyalarım'}</div>
      {tumu && <div className="dugmeler"><button className={kapsam === 'tum' ? 'btn2 kucuk secili' : 'btn2 kucuk'} onClick={() => setKapsam('tum')}>Tümü</button><button className={kapsam === 'benim' ? 'btn2 kucuk secili' : 'btn2 kucuk'} onClick={() => setKapsam('benim')}>Dosyalarım</button></div>}
      {dosyalar.length === 0 ? <div className="ozet bos">Dosya bulunmamaktadır.</div> : (
        <div className="tablo"><table className="kartli"><thead><tr><th>Dosya No</th><th>Yat</th><th>Öncelik</th><th>Durum</th><th>Dosya Sorumlusu</th><th /></tr></thead>
          <tbody>{dosyalar.map((d) => <tr key={d.kimlik}><td data-ad="Dosya No">{d.dosya_no}</td><td data-ad="Yat">{d.yat_adi}</td><td data-ad="Öncelik"><Oncelik o={d.oncelik} /></td><td data-ad="Durum">{d.statu}{d.asama ? ` · ${d.asama}` : ''}{d.beklemede ? ` · Beklemede: ${d.beklemede}` : ''}</td><td data-ad="Dosya Sorumlusu">{d.dosya_sorumlusu ?? '—'}</td><td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => setDosyaId(d.kimlik)}>Aç</button></td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

/** YG-1467: on soruluk sıra; koşullu sorular kendiliğinden açılır. YG-034: Hayır yeşil, Bilinmiyor sarı, Evet kırmızı. */
function IhbarFormu({ bitti }: { bitti: (id?: string) => void }) {
  const [s, setS] = useState<Secenek | null>(null); const [hata, setHata] = useState('');
  const [kanal, setKanal] = useState('Telefon'); const [ad, setAd] = useState(''); const [tur, setTur] = useState(''); const [turAcik, setTurAcik] = useState(''); const [tel, setTel] = useState(''); const [ep, setEp] = useState('');
  const [konum, setKonum] = useState(''); const [durum, setDurum] = useState(''); const [ozet, setOzet] = useState(''); const [acil, setAcil] = useState(false); const [dil, setDil] = useState('Türkçe');
  const [cevap, setCevap] = useState<Record<string, string>>({}); const [oneri, setOneri] = useState('Normal'); const [oncelik, setOncelik] = useState('');
  const [yTur, setYTur] = useState(''); const [yAd, setYAd] = useState(''); const [marka, setMarka] = useState(''); const [markalar, setMarkalar] = useState<{ marka: string }[]>([]); const [modeller, setModeller] = useState<{ kimlik: string; model: string; boy_m: number | null; govde_malzemesi: string | null }[]>([]);
  const [modelId, setModelId] = useState(''); const [diger, setDiger] = useState(false); const [dMarka, setDMarka] = useState(''); const [dModel, setDModel] = useState(''); const [boy, setBoy] = useState(''); const [govde, setGovde] = useState('Bilinmiyor'); const [bayrak, setBayrak] = useState('Türkiye'); const [kullanim, setKullanim] = useState('Özel'); const [klas, setKlas] = useState('Bilinmiyor'); const [yil, setYil] = useState(''); const [garanti, setGaranti] = useState('');
  const [sahipAd, setSahipAd] = useState(''); const [sahipTel, setSahipTel] = useState(''); const [sahipEp, setSahipEp] = useState(''); const [sigortaci, setSigortaci] = useState(''); const [hasarNo, setHasarNo] = useState('');
  useEffect(() => { void istek<Secenek>('/ihbar/secenek').then((x) => { setS(x); setTur(x.turler[0] ?? ''); setYTur(x.tekneTuru[0] ?? ''); }).catch((e) => setHata(e.message)); }, []);
  useEffect(() => { void istek<{ onerilen: string }>('/ihbar/oncelik-oner', { cevaplar: cevap, acil }).then((r) => { setOneri(r.onerilen); setOncelik(''); }).catch(() => {}); }, [cevap, acil]);
  useEffect(() => { if (marka.length < 1 || diger) { setMarkalar([]); return; } void istek<{ marka: string }[]>(`/yat/marka?q=${encodeURIComponent(marka)}`).then((l) => { setMarkalar(l); const es = l.find((m) => m.marka.toLocaleLowerCase('tr') === marka.toLocaleLowerCase('tr')); if (es) modelAl(es.marka); else { setModeller([]); setModelId(''); } }).catch(() => {}); }, [marka, diger]);
  const modelAl = (m: string) => { setModelId(''); void istek<typeof modeller>(`/yat/model?marka=${encodeURIComponent(m)}`).then(setModeller).catch(() => {}); };
  const secili = modeller.find((m) => m.kimlik === modelId);
  const buYil = new Date().getFullYear();
  const garantiAcik = !yil || buYil - Number(yil) <= 5;
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    try {
      const r = await istek<{ kimlik: string; talepNo: string }>('/ihbar', {
        kanal, sahibiAdi: ad, sahibiTuru: tur, sahibiTuruAciklama: turAcik, telefon: tel, eposta: ep || undefined, konum, yatDurumu: durum, ihtiyac: ozet, acil, cevaplar: cevap, oncelik: oncelik || undefined, dil, sigortaci: sigortaci || undefined, hasarNo: hasarNo || undefined,
        yatSahibi: sahipAd ? { ad: sahipAd, telefon: sahipTel || undefined, eposta: sahipEp || undefined } : undefined,
        yat: { adi: yAd, tur: yTur, markaModelId: modelId || undefined, markaDiger: diger ? dMarka : undefined, modelDiger: diger ? dModel : undefined, boy: boy ? Number(boy.replace(',', '.')) : undefined, govde, bayrak, kullanim, klas, uretimYili: yil ? Number(yil) : undefined },
      });
      bitti(r.kimlik);
    } catch (x) { setHata((x as Error).message); window.scrollTo(0, 0); }
  };
  if (!s) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  return (
    <form className="ozet" onSubmit={(e) => void gonder(e)}>
      <h1>Yeni İhbar</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div className="bolum">İhbar Eden</div>
      <label htmlFor="i-kanal">Bildirim Kanalı</label><select id="i-kanal" value={kanal} onChange={(e) => setKanal(e.target.value)}>{s.kanallar.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="i-ad">Adı Soyadı</label><input id="i-ad" value={ad} onChange={(e) => setAd(e.target.value)} />
      <label htmlFor="i-tur">İhbar Edenin Rolü</label><select id="i-tur" value={tur} onChange={(e) => setTur(e.target.value)}>{s.turler.map((x) => <option key={x}>{x}</option>)}</select>
      {tur === 'Diğer' && <><label htmlFor="i-tura">Kim Olduğu</label><input id="i-tura" value={turAcik} onChange={(e) => setTurAcik(e.target.value)} /></>}
      <div className="iki-tarih"><div><label htmlFor="i-tel">Telefon</label><input id="i-tel" value={tel} onChange={(e) => setTel(e.target.value)} /></div><div><label htmlFor="i-ep">E-posta</label><input id="i-ep" type="email" value={ep} onChange={(e) => setEp(e.target.value)} /></div></div>
      <label htmlFor="i-dil">Yazışma Dili</label><select id="i-dil" value={dil} onChange={(e) => setDil(e.target.value)}><option>Türkçe</option><option>İngilizce</option></select>
      <div className="bolum">Yat</div>
      <label htmlFor="i-ytur">1. Tekne Türü</label><select id="i-ytur" value={yTur} onChange={(e) => setYTur(e.target.value)}>{s.tekneTuru.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="i-yad">2. Yat Adı</label><input id="i-yad" value={yAd} onChange={(e) => setYAd(e.target.value)} />
      <label htmlFor="i-marka">3. Marka</label>
      {!diger && <>
        <input id="i-marka" list="i-markalar" value={marka} onChange={(e) => setMarka(e.target.value)} autoComplete="off" />
        <datalist id="i-markalar">{markalar.map((m) => <option key={m.marka} value={m.marka} />)}</datalist>
        {modeller.length > 0 && <><label htmlFor="i-model">Model</label><select id="i-model" value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">Seçiniz</option>{modeller.map((m) => <option key={m.kimlik} value={m.kimlik}>{m.model}</option>)}</select></>}
      </>}
      <label className="kutu"><input type="checkbox" checked={diger} onChange={(e) => { setDiger(e.target.checked); setModelId(''); }} /><span>Listede Yok (Diğer)</span></label>
      {diger && <div className="iki-tarih"><div><label htmlFor="i-dm">Marka</label><input id="i-dm" value={dMarka} onChange={(e) => setDMarka(e.target.value)} /></div><div><label htmlFor="i-dmo">Model</label><input id="i-dmo" value={dModel} onChange={(e) => setDModel(e.target.value)} /></div></div>}
      {secili?.boy_m ? <div className="not">Boy: {secili.boy_m} m (Katalogdan – Teyit Bekliyor)</div> : <><label htmlFor="i-boy">4. Yaklaşık Boy (m)</label><input id="i-boy" inputMode="decimal" value={boy} onChange={(e) => setBoy(e.target.value)} /></>}
      {secili?.govde_malzemesi ? <div className="not">Gövde: {secili.govde_malzemesi} (Katalogdan – Teyit Bekliyor)</div> : <><label htmlFor="i-govde">5. Gövde Malzemesi</label><select id="i-govde" value={govde} onChange={(e) => setGovde(e.target.value)}>{s.govde.map((x) => <option key={x}>{x}</option>)}</select></>}
      <label htmlFor="i-bayrak">6. Bayrak</label><input id="i-bayrak" value={bayrak} onChange={(e) => setBayrak(e.target.value)} />
      <label htmlFor="i-kull">7. Kullanım</label><select id="i-kull" value={kullanim} onChange={(e) => setKullanim(e.target.value)}><option>Özel</option><option>Ticari</option></select>
      <label htmlFor="i-klas">8. Klas</label><select id="i-klas" value={klas} onChange={(e) => setKlas(e.target.value)}>{s.klas.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="i-yil">9. İmal Yılı (Bilinmiyorsa Boş)</label><input id="i-yil" inputMode="numeric" value={yil} onChange={(e) => setYil(e.target.value)} />
      {garantiAcik && <><label htmlFor="i-gar">10. Garanti</label><select id="i-gar" value={garanti} onChange={(e) => setGaranti(e.target.value)}><option value="">Bilinmiyor</option><option>Evet</option><option>Hayır</option></select></>}
      <div className="bolum">Yat Sahibi (Biliniyorsa)</div>
      <label htmlFor="i-sa">Adı Soyadı veya Unvanı</label><input id="i-sa" value={sahipAd} onChange={(e) => setSahipAd(e.target.value)} />
      <div className="iki-tarih"><div><label htmlFor="i-st">Telefon</label><input id="i-st" value={sahipTel} onChange={(e) => setSahipTel(e.target.value)} /></div><div><label htmlFor="i-se">E-posta</label><input id="i-se" type="email" value={sahipEp} onChange={(e) => setSahipEp(e.target.value)} /></div></div>
      <div className="bolum">Olay</div>
      <label htmlFor="i-konum">Adres (Yatın Mevcut Konumu)</label><input id="i-konum" value={konum} onChange={(e) => setKonum(e.target.value)} />
      <label htmlFor="i-durum">Yatın Mevcut Durumu</label><input id="i-durum" value={durum} onChange={(e) => setDurum(e.target.value)} />
      <label htmlFor="i-ozet">Olay Özeti</label><textarea id="i-ozet" rows={3} value={ozet} onChange={(e) => setOzet(e.target.value)} />
      <div className="iki-tarih"><div><label htmlFor="i-sg">Sigorta Şirketi</label><input id="i-sg" value={sigortaci} onChange={(e) => setSigortaci(e.target.value)} /></div><div><label htmlFor="i-hn">Sigorta Hasar Dosya No</label><input id="i-hn" value={hasarNo} onChange={(e) => setHasarNo(e.target.value)} /></div></div>
      <div className="bolum">Öncelik Soruları</div>
      {s.sorular.map((q) => (
        <div key={q} className="soru"><span>{q}</span><div className="dugmeler">{['Hayır', 'Bilinmiyor', 'Evet'].map((c) => <button key={c} type="button" className={`cevap ${cevap[q] === c ? `c-${c === 'Evet' ? 'k' : c === 'Bilinmiyor' ? 's' : 'y'}` : ''}`} aria-pressed={cevap[q] === c} onClick={() => setCevap((o) => ({ ...o, [q]: c }))}>{c}</button>)}</div></div>
      ))}
      <label className="kutu"><input type="checkbox" checked={acil} onChange={(e) => setAcil(e.target.checked)} /><span>Acil Durum</span></label>
      <div className="not">Sistemin Önerdiği Öncelik: <Oncelik o={oneri} /></div>
      <label htmlFor="i-onc">Öncelik</label>
      <select id="i-onc" value={oncelik || oneri} onChange={(e) => setOncelik(e.target.value)}>{s.oncelikler.filter((o) => s.oncelikler.indexOf(o) <= s.oncelikler.indexOf(oneri)).map((o) => <option key={o}>{o}</option>)}</select>
      <button className="btn">İhbarı Kaydet</button>
      <button type="button" className="lnk" onClick={() => bitti()}>Vazgeç</button>
    </form>
  );
}

function IhbarEkrani({ id, geri }: { id: string; geri: (dosya?: string) => void }) {
  const [t, setT] = useState<any>(null); const [hata, setHata] = useState(''); const [dayanak, setDayanak] = useState(''); const [gerekce, setGerekce] = useState('');
  const [karar, setKarar] = useState('Kabul'); const [ozet, setOzet] = useState(''); const [musteri, setMusteri] = useState('Bireysel Müşteri'); const [kosul, setKosul] = useState(''); const [tarih, setTarih] = useState(''); const [acilGecici, setAcilGecici] = useState(false); const [eksik, setEksik] = useState('');
  const yukle = () => istek<any>(`/ihbar/${id}`).then(setT).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, [id]);
  const yap = async (f: () => Promise<any>) => { setHata(''); try { await f(); await yukle(); } catch (x) { setHata((x as Error).message); } };
  if (!t) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const acilis = async () => {
    setHata('');
    try {
      const r = await istek<{ kimlik?: string }>(`/ihbar/${id}/acilis`, { karar, ozet, musteriTuru: musteri, kosullar: kosul, yenidenTarih: tarih, gerekce, acilGecici, eksikGerekce: eksik, tamamlamaTarih: tarih });
      geri(r.kimlik);
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <>
      <button className="lnk" onClick={() => geri()}>← Dosyalar</button>
      <h1>{t.talep_no} · {t.yat_adi}</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div className="ozet">
        <div><Oncelik o={t.oncelik} /> · {t.statu} · Sistemin Önerdiği: {t.onerilen_oncelik}</div>
        <div>İhbar Eden: {t.talep_sahibi_adi} ({t.talep_sahibi_turu}) · {t.bildirim_kanali}</div>
        <div>Yetki Durumu: {t.ihbar_yetki_durumu}</div>
        <div>Konum: {t.yat_mevcut_konumu} · Durum: {t.yat_mevcut_durumu}</div>
        <div>Olay Özeti: {t.ihtiyac_tanimi}</div>
        <div>Marka/Model: {t.marka ?? '—'} {t.model ?? ''} · Boy: {t.tam_boy_m ?? '—'} m · Gövde: {t.govde_malzemesi ?? '—'}</div>
        {t.ilk_yanit_son && !t.ilk_yanit_zamani && <div>İlk Yanıt Son: {saat(t.ilk_yanit_son)} <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/ihbar/${id}/ilk-yanit`, {}))}>İlk Yanıt Verildi</button></div>}
      </div>
      <Blok baslik="1. Mükerrerlik Kontrolü">
        {t.mukerrerlik_sonucu ? <div>Sonuç: {t.mukerrerlik_sonucu}</div> : <>
          {t.adaylar.length === 0 && <div className="not">Olası mükerrer dosya bulunamadı.</div>}
          {t.adaylar.map((a: any) => <div key={a.kimlik} className="uyari"><b>{a.dosya_no}</b> · {a.yat_adi} · {a.neden} · {a.statu} <button type="button" className="btn2 kucuk" onClick={() => void yap(() => istek(`/ihbar/${id}/mukerrerlik`, { sonuc: 'Mevcut dosyaya bağlandı', dosya: a.kimlik })).then(() => geri())}>Bu Dosyaya Bağla</button></div>)}
          <button className="btn2" onClick={() => void yap(() => istek(`/ihbar/${id}/mukerrerlik`, { sonuc: 'Mükerrer değil' }))}>Mükerrer Değil</button>
          {t.adaylar.length > 0 && <><label htmlFor="m-g">Ayrı Olay Gerekçesi</label><input id="m-g" value={gerekce} onChange={(e) => setGerekce(e.target.value)} /><button className="btn2" onClick={() => void yap(() => istek(`/ihbar/${id}/mukerrerlik`, { sonuc: 'Ayrı olay (gerekçeli)', gerekce }))}>Ayrı Olay</button></>}
        </>}
      </Blok>
      {t.ihbar_yetki_durumu !== 'Doğrulandı' && <Blok baslik="2. Yetki Doğrulaması">
        <label htmlFor="y-d">Doğrulamanın Dayanağı</label><input id="y-d" value={dayanak} onChange={(e) => setDayanak(e.target.value)} />
        <button className="btn2" onClick={() => void yap(() => istek(`/ihbar/${id}/yetki`, { durum: 'Doğrulandı', dayanak }))}>Yetkiyi Doğrula</button>
      </Blok>}
      <Blok baslik="3. Açılış Kararı">
        <label htmlFor="a-k">Karar</label><select id="a-k" value={karar} onChange={(e) => setKarar(e.target.value)}>{['Kabul', 'Koşullu Açılış', 'Bekletme', 'Yönlendirme', 'Ret'].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="a-o">Açılış Özeti</label><textarea id="a-o" rows={2} value={ozet} onChange={(e) => setOzet(e.target.value)} />
        {(karar === 'Kabul' || karar === 'Koşullu Açılış') && <><label htmlFor="a-m">Müşteri Türü</label><select id="a-m" value={musteri} onChange={(e) => setMusteri(e.target.value)}>{['Bireysel Müşteri', 'Kurumsal Müşteri', 'Sigorta Şirketi'].map((x) => <option key={x}>{x}</option>)}</select></>}
        {karar === 'Koşullu Açılış' && <><label htmlFor="a-ko">İzinli ve Yasak İşler</label><textarea id="a-ko" rows={2} value={kosul} onChange={(e) => setKosul(e.target.value)} /></>}
        {(karar === 'Yönlendirme' || karar === 'Ret') && <><label htmlFor="a-g">Gerekçe</label><textarea id="a-g" rows={2} value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></>}
        {t.oncelik === 'Kritik' && karar === 'Kabul' && <label className="kutu"><input type="checkbox" checked={acilGecici} onChange={(e) => setAcilGecici(e.target.checked)} /><span>Acil Geçici Açılış</span></label>}
        {acilGecici && <><label htmlFor="a-e">Eksik Alan Gerekçesi</label><input id="a-e" value={eksik} onChange={(e) => setEksik(e.target.value)} /></>}
        {(karar === 'Bekletme' || acilGecici) && <><label htmlFor="a-t">{acilGecici ? 'Tamamlama Tarihi' : 'Yeniden Değerlendirme Tarihi'}</label><input id="a-t" type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></>}
        <button className="btn" onClick={() => void acilis()}>Kararı Kaydet</button>
      </Blok>
    </>
  );
}

function DosyaEkrani({ id, geri, roller }: { id: string; geri: () => void; roller: string[] }) {
  const [d, setD] = useState<DosyaAyrinti | null>(null); const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const [rol, setRol] = useState(''); const [adaylar, setAdaylar] = useState<{ kimlik: string; ad_soyad: string; oran: number | null }[]>([]); const [kisi, setKisi] = useState(''); const [devir, setDevir] = useState('');
  const [belgeler, setBelgeler] = useState<Belge[]>([]); const [bNeden, setBNeden] = useState(BEKLEME[0]!); const [bSorumlu, setBSorumlu] = useState(''); const [bTarih, setBTarih] = useState(''); const [bKanit, setBKanit] = useState('');
  const [oYeni, setOYeni] = useState(''); const [oGerekce, setOGerekce] = useState(''); const [aGerekce, setAGerekce] = useState('');
  const [kBaslik, setKBaslik] = useState(''); const [kSahip, setKSahip] = useState(''); const [kTarih, setKTarih] = useState(''); const [boy, setBoy] = useState(''); const [govde, setGovde] = useState(''); const [tahrik, setTahrik] = useState(''); const [kaynak, setKaynak] = useState('Ruhsat');
  const yukle = () => Promise.all([istek<DosyaAyrinti>(`/dosya/${id}`).then(setD), istek<Belge[]>(`/belge?bagTuru=Dosya&bagKimligi=${id}`).then(setBelgeler).catch(() => setBelgeler([]))]).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, [id]);
  useEffect(() => { if (!rol) { setAdaylar([]); return; } void istek<typeof adaylar>(`/dosya/${id}/ekip-oneri?rol=${encodeURIComponent(rol)}`).then(setAdaylar).catch((e) => setHata(e.message)); }, [rol, id]);
  const yap = async (f: () => Promise<any>) => { setHata(''); setNot(''); try { const r = await f(); if (r?.uyari) setNot(r.uyari); await yukle(); } catch (x) { setHata((x as Error).message); window.scrollTo(0, 0); } };
  const yukleBelge = async (f: File) => {
    const q = new URLSearchParams({ ad: f.name, tur: 'Dosya Belgesi', bagTuru: 'Dosya', bagKimligi: id, kaynak: 'Elden', dosya: f.name });
    const r = await fetch(`/api/belge/yukle?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Yatonet': '1' }, body: f, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.hata ?? 'Yükleme tamamlanamadı.');
    setBKanit(j.belge);
  };
  if (!d) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const ds = d.rollerim.includes('Dosya Sorumlusu');
  const sonraki = d.asama ? ASAMALAR[ASAMALAR.indexOf(d.asama) + 1] : undefined;
  const acikBekleme = d.bekleme.filter((b) => !b.kaldirilma_zamani);
  const izinliRoller = EKIP_ROLLERI.filter((r) => (['Dosya Sorumlusu', 'Yedek Sorumlu', 'Operasyon Yöneticisi'].includes(r) && d.izinler.includes('dosya.ata.operasyon')) || (['Teknik Uzman', 'Sorumlu Teknik Uzman (Koordinatör)', 'Teknik Yönetici', 'Saha Sorumlusu'].includes(r) && d.izinler.includes('dosya.ata.teknik')) || (r === 'Kalite Kontrolör' && d.izinler.includes('dosya.ata.kalite')) || (r === 'Tedarik Sorumlusu' && d.izinler.includes('dosya.ata.tedarik')));
  return (
    <>
      <button className="lnk" onClick={geri}>← Dosyalar</button>
      <h1>{d.dosya_no} · {d.yat.yat_adi}</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="uyari" role="status">{not}</div>}
      <div className="ozet">
        <div><Oncelik o={d.oncelik} /> · {d.statu}{d.asama ? ` · ${d.asama}` : ''}{d.hasar_ilerleyebilir ? ' · Hasar İlerleyebilir' : ''}</div>
        {acikBekleme.map((b) => <div key={b.kimlik} className="uyari">Beklemede: {b.neden} · Hedef: {gun(b.hedef_tarih)} · {b.sorumlu}{b.sayac_durur ? ' · Süre Durdu' : ''} <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/beklemede/${b.kimlik}/kaldir`, {}))}>Kaldır</button></div>)}
        <div>{d.musteri_turu} · {d.dosya_niteligi}{d.bireysel6502 ? ' · 6502 Kapsamında' : ''}</div>
        <div>{d.kisa_teknik_tanim}</div>
        <div>Konum: {d.konum}</div>
        {d.sigorta && <div>Sigorta: {d.sigorta.sigortaci_adi ?? '—'} · Hasar Dosya No: {d.sigorta.sigorta_hasar_dosya_no ?? '—'}</div>}
        {d.sigorta && <SigortaEposta id={id} eposta={d.sigorta.eposta} ek3={d.sigorta.onay_yetkilisi_eposta} yenile={yukle} />}
      </div>
      {d.yapilacaklar.length > 0 && <Blok baslik="Yapılacaklar">{d.yapilacaklar.map((y) => <div key={y.is} className={y.engel ? 'uyari' : ''}>{y.is} · {y.sorumlu}</div>)}</Blok>}
      {d.sureler.length > 0 && <Blok baslik="Süreler">{d.sureler.map((s) => <div key={s.tur}>{s.tur}: <Sayac s={s} /></div>)}</Blok>}
      <Blok baslik="Yat">
        <div>{d.yat.tur ?? '—'} · {d.yat.marka ?? '—'} {d.yat.model ?? ''} · {d.yat.tam_boy_m ?? '—'} m · {d.yat.govde_malzemesi ?? '—'} · Tahrik: {d.yat.tahrik_turu ?? '—'} · Bayrak: {d.yat.bayrak ?? '—'}</div>
        {d.yat.katalog_teyit && <div className="not">{d.yat.katalog_teyit}</div>}
        {d.yat.gecici_kayit && <div className="not">Geçici Yat Kaydı</div>}
        <div className="iki-tarih"><div><label htmlFor="y-b">Boy (m)</label><input id="y-b" inputMode="decimal" value={boy} onChange={(e) => setBoy(e.target.value)} /></div><div><label htmlFor="y-g">Gövde</label><select id="y-g" value={govde} onChange={(e) => setGovde(e.target.value)}><option value="">Seçiniz</option>{['Fiber', 'Ahşap', 'Çelik', 'Alüminyum'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
        <div className="iki-tarih"><div><label htmlFor="y-t">Tahrik</label><input id="y-t" value={tahrik} onChange={(e) => setTahrik(e.target.value)} /></div><div><label htmlFor="y-k">Kaynak</label><select id="y-k" value={kaynak} onChange={(e) => setKaynak(e.target.value)}>{['Ruhsat', 'Telefon (kaptan / yat sahibi)', 'Teknik Uzman keşfi'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/yat-bilgisi`, { boy: boy ? Number(boy.replace(',', '.')) : undefined, govde: govde || undefined, tahrik: tahrik || undefined, kaynak }))}>Yat Bilgisini Kaydet</button>
      </Blok>
      <Blok baslik="Dosya Ekibi">
        {d.ekip.length === 0 && <div className="not">Henüz atama yapılmadı.</div>}
        {d.ekip.map((e) => <div key={e.kimlik}>{e.rol}: {e.ad_soyad}</div>)}
        {izinliRoller.length > 0 && <>
          <label htmlFor="e-r">Atanacak Rol</label><select id="e-r" value={rol} onChange={(e) => { setRol(e.target.value); setKisi(''); }}><option value="">Seçiniz</option>{izinliRoller.map((r) => <option key={r}>{r}</option>)}</select>
          {rol && <><label htmlFor="e-k">Kişi</label><select id="e-k" value={kisi} onChange={(e) => setKisi(e.target.value)}><option value="">Seçiniz</option>{adaylar.map((a) => <option key={a.kimlik} value={a.kimlik} disabled={a.oran !== null && a.oran >= 100}>{a.ad_soyad}{a.oran !== null ? ` · Kapasite %${a.oran}` : ''}</option>)}</select></>}
          {rol && d.ekip.some((e) => e.rol === rol) && <><label htmlFor="e-d">Devir Notu</label><input id="e-d" value={devir} onChange={(e) => setDevir(e.target.value)} /></>}
          <button className="btn2" disabled={!rol || !kisi} onClick={() => void yap(() => istek(`/dosya/${id}/ekip`, { kullanici: kisi, rol, devirNotu: devir })).then(() => { setRol(''); setKisi(''); setDevir(''); })}>Ata</button>
        </>}
      </Blok>
      {d.statu === 'Aktif' && sonraki && <Blok baslik="Aşama">
        <label htmlFor="a-g">Açıklama</label><input id="a-g" value={aGerekce} onChange={(e) => setAGerekce(e.target.value)} />
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/asama`, { asama: sonraki, gerekce: aGerekce }))}>{sonraki} Aşamasına Geç</button>
      </Blok>}
      {ds && <Blok baslik="Öncelik">
        {d.oncelik === 'Kritik' && <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/risk-kontrol`, {}))}>Risk Kontrol Altına Alındı</button>}
        <label htmlFor="o-y">Yeni Öncelik</label><select id="o-y" value={oYeni} onChange={(e) => setOYeni(e.target.value)}><option value="">Seçiniz</option>{['Kritik', 'Yüksek', 'Normal', 'Planlı'].filter((x) => x !== d.oncelik).map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="o-g">Gerekçe</label><input id="o-g" value={oGerekce} onChange={(e) => setOGerekce(e.target.value)} />
        <button className="btn2" disabled={!oYeni} onClick={() => void yap(() => istek(`/dosya/${id}/oncelik`, { oncelik: oYeni, gerekce: oGerekce }))}>Önceliği Değiştir</button>
      </Blok>}
      <Blok baslik="Belgeler">
        {belgeler.length === 0 && <div className="not">Belge bulunmamaktadır.</div>}
        {belgeler.map((b) => <div key={b.kimlik}>{b.ad} · {b.belge_turu} · {b.surumler[0]?.durum} · <a href={`/api/belge/${b.kimlik}/surum/${b.surumler[0]?.no}/indir`}>İndir</a></div>)}
        <label htmlFor="b-y">Belge Yükle</label><input id="b-y" type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void yap(() => yukleBelge(f)); }} />
      </Blok>
      {d.statu !== 'Kapalı' && <Blok baslik="Beklemede İşareti">
        <label htmlFor="k-n">Neden</label><select id="k-n" value={bNeden} onChange={(e) => setBNeden(e.target.value)}>{BEKLEME.map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor="k-s">Sorumlu</label><select id="k-s" value={bSorumlu} onChange={(e) => setBSorumlu(e.target.value)}><option value="">Seçiniz</option>{[...new Map(d.ekip.map((e) => [e.kullanici, e])).values()].map((e) => <option key={e.kullanici} value={e.kullanici}>{e.ad_soyad}</option>)}</select>
        <label htmlFor="k-t">Hedef Tarih</label><input id="k-t" type="date" value={bTarih} onChange={(e) => setBTarih(e.target.value)} />
        <label htmlFor="k-k">Kanıt Belgesi</label><select id="k-k" value={bKanit} onChange={(e) => setBKanit(e.target.value)}><option value="">Seçiniz</option>{belgeler.map((b) => <option key={b.kimlik} value={b.kimlik}>{b.ad}</option>)}</select>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/beklemede`, { neden: bNeden, sorumlu: bSorumlu, hedefTarih: bTarih, kanitBelge: bKanit }))}>İşareti Aç</button>
      </Blok>}
      <Blok baslik="Açık Konular">
        {d.konular.length === 0 && <div className="not">Açık konu bulunmamaktadır.</div>}
        {d.konular.map((k) => <div key={k.kimlik}>{k.konu_no} · {k.baslik} · {k.sahip} · {k.statu} · {gun(k.hedef_tarih)}{k.gecikmis ? ' · Gecikmiş' : ''}</div>)}
        <label htmlFor="n-b">Yeni Konu</label><input id="n-b" value={kBaslik} onChange={(e) => setKBaslik(e.target.value)} />
        <div className="iki-tarih"><div><label htmlFor="n-s">Sahibi</label><select id="n-s" value={kSahip} onChange={(e) => setKSahip(e.target.value)}><option value="">Seçiniz</option>{[...new Map(d.ekip.map((e) => [e.kullanici, e])).values()].map((e) => <option key={e.kullanici} value={e.kullanici}>{e.ad_soyad}</option>)}</select></div><div><label htmlFor="n-t">Hedef Tarih</label><input id="n-t" type="date" value={kTarih} onChange={(e) => setKTarih(e.target.value)} /></div></div>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/konu`, { baslik: kBaslik, sahip: kSahip, hedefTarih: kTarih })).then(() => setKBaslik(''))}>Konu Aç</button>
      </Blok>
      <SahaBolumu id={id} d={d} belgeler={belgeler} yenile={() => void yukle()} />
      <YatDegeriBolumu id={id} />
      <SigortaGonderimBolumu id={id} />
      <RaporBolumu id={id} rollerim={d.rollerim} />
      <TicariBolumu id={id} rollerim={d.rollerim} roller={roller} asama={d.asama} />
      <KaliteBolumu id={id} roller={roller} />
      <TesisIslemleri id={id} ds={d.rollerim.includes('Dosya Sorumlusu')} />
      <TeklifTalebiBolumu id={id} roller={roller} />
      <TedarikBolumu id={id} roller={roller} />
      <Blok baslik="Taraflar">{d.taraflar.map((t) => <div key={t.kimlik}>{t.taraf_rolu}: {t.kisi_adi_soyadi} · {t.telefon ?? '—'} · {t.eposta ?? '—'}</div>)}</Blok>
      <Blok baslik="Durum Geçmişi">{d.gecmis.map((g, i) => <div key={i}>{saat(g.olusturma_zamani)} · {g.yeni_statu}{g.yeni_asama ? ` · ${g.yeni_asama}` : ''} · {g.gerekce}{g.yapan ? ` · ${g.yapan}` : ''}{g.sonraki_sorumlu_rol ? ` · Sıradaki: ${g.sonraki_sorumlu_rol}` : ''}</div>)}</Blok>
    </>
  );
}

interface Saha {
  kesifler: { kimlik: string; amac_kapsam: string; durum: string; planlanan_baslangic: string; cikis_durumu: string | null }[];
  bulgular: { kimlik: string; bulgu_no: string; konum_referansi: string; bolge_kodu: string | null; aciklama: string; hasar_onem_derecesi: string; bulgu_etiketi: string; yonlendirme: string }[];
  gorseller: { gorsel_no: string | null; asama: string; cekim_kalemi: string; bolge_kodu: string | null; cekilemedi_nedeni: string | null }[];
  olcumler: { olcum_no: string; olcum_noktasi: string; olculen_buyukluk: string; ozet_deger: string; birim: string; gecerlilik: string; sinir_disi: boolean }[];
  kontrolListeleri: { kimlik: string; kayit_no: string; statu: string }[];
  fotoEksik: string[];
  garantiKayitlari: { kimlik: string; kayit_no: string; statu: string; oncelik: string; yanit_son: string | null; karar: string | null; sikayet_sonucu: string | null }[];
}
const KALEMLER = ['Genel – Baş', 'Genel – Kıç', 'Genel – Sancak', 'Genel – İskele', 'Genel – Güverte', 'Bölge – Geniş Plan', 'Bölge – Yakın Plan (Ölçekli)', 'Kimlik – Yat Adı', 'Kimlik – Sicil', 'Kimlik – HIN'];
const CEKILEMEDI = ['Denize bakıyor / bağlı taraf', 'Yat suda, su altı görülemiyor', 'Erişim yok', 'Güvenlik riski', 'Diğer'];
const KAPANMA = ['Tamamlandı', 'Sigortaca Onaylanmayan', 'Müşteri Vazgeçti', 'Müşteri Vazgeçti – Yanıt Alınamadı', 'Hükmi Tam Ziya', 'Tam Ziya', 'Birleştirildi', 'Hatalı Açılış', 'Devredildi'];

/** YG-175, YG-1425: garanti kapsam kararı; iyi niyet tutarına göre GMY veya CEO onayına gider. */
function GarantiKarar({ id, yap }: { id: string; yap: (f: () => Promise<any>, tamam?: string) => Promise<void> }) {
  const [karar, setKarar] = useState('Garanti'); const [gerekce, setGerekce] = useState(''); const [tutar, setTutar] = useState('');
  return (
    <div>
      <label htmlFor={`gk-${id}`}>Kapsam Kararı</label><select id={`gk-${id}`} value={karar} onChange={(e) => setKarar(e.target.value)}>{['Garanti', 'Üretici Garantisi', 'İyi Niyet', 'Ücretli İş', 'Kapsam Dışı'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor={`gg-${id}`}>Karar Gerekçesi</label><input id={`gg-${id}`} value={gerekce} onChange={(e) => setGerekce(e.target.value)} />
      <label htmlFor={`gt-${id}`}>{karar === 'İyi Niyet' ? 'İyi Niyet Tutarı (EUR)' : 'Düzeltme Maliyeti (EUR)'}</label><input id={`gt-${id}`} type="number" min="0" step="0.01" value={tutar} onChange={(e) => setTutar(e.target.value)} />
      <button className="btn2 kucuk" disabled={!gerekce.trim() || (karar === 'İyi Niyet' && !tutar)} onClick={() => void yap(() => istek(`/garanti-sikayet/${id}/karar`, { karar, gerekce, maliyet: tutar ? Number(tutar) : undefined }), karar === 'İyi Niyet' ? 'İyi niyet kararı onaya gönderildi.' : 'Karar kaydedildi.')}>Kararı Kaydet</button>
    </div>
  );
}

/** YG-056, YG-127, YG-1452: keşif, bulgu, yönlendirmeli fotoğraf; YG-075, YG-148: kapanış ve tutanak; YG-1425: garanti ve şikâyet. */
function SahaBolumu({ id, d, belgeler, yenile }: { id: string; d: DosyaAyrinti; belgeler: Belge[]; yenile: () => void }) {
  const [v, setV] = useState<Saha | null>(null); const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const [amac, setAmac] = useState(''); const [kBas, setKBas] = useState(''); const [kBit, setKBit] = useState(''); const [inc, setInc] = useState(''); const [cikis, setCikis] = useState('Hazır'); const [sup, setSup] = useState('Hayır'); const [sayim, setSayim] = useState(false); const [eris, setEris] = useState(''); const [erisT, setErisT] = useState('');
  const [bKonum, setBKonum] = useState(''); const [bBolge, setBBolge] = useState(''); const [bAcik, setBAcik] = useState(''); const [bOnem, setBOnem] = useState('Orta'); const [bHedef, setBHedef] = useState('');
  const [gKalem, setGKalem] = useState(KALEMLER[0]!); const [gBelge, setGBelge] = useState(''); const [gBolge, setGBolge] = useState(''); const [gOlcek, setGOlcek] = useState(''); const [gNeden, setGNeden] = useState('');
  const [iTur, setITur] = useState('Askı'); const [iNeden, setINeden] = useState(''); const [iGer, setIGer] = useState(''); const [iYapilan, setIYapilan] = useState(''); const [iAcik, setIAcik] = useState(''); const [iTeslim, setITeslim] = useState(''); const [iDev, setIDev] = useState('');
  const [kNeden, setKNeden] = useState(''); const [beyan, setBeyan] = useState(false);
  const [gsTur, setGsTur] = useState('Garanti bildirimi'); const [gsAcik, setGsAcik] = useState('');
  const yukle = () => istek<Saha>(`/dosya/${id}/saha`).then(setV).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, [id]);
  const yap = async (f: () => Promise<any>, tamam?: string) => { setHata(''); setNot(''); try { await f(); if (tamam) setNot(tamam); await yukle(); yenile(); } catch (x) { setHata((x as Error).message); } };
  if (!v) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  const acikKesif = v.kesifler.find((k) => k.durum === 'Planlandı');
  return (
    <>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="not" role="status">{not}</div>}
      <Blok baslik="Keşif">
        {v.kesifler.map((k) => <div key={k.kimlik}>{saat(k.planlanan_baslangic)} · {k.amac_kapsam} · {k.durum}{k.cikis_durumu ? ` · ${k.cikis_durumu}` : ''}</div>)}
        {d.statu === 'Aktif' && d.asama === 'Keşif' && !acikKesif && <>
          <label htmlFor="ks-a">Keşfin Amacı ve Kapsamı</label><input id="ks-a" value={amac} onChange={(e) => setAmac(e.target.value)} />
          <div className="iki-tarih"><div><label htmlFor="ks-b">Başlangıç</label><input id="ks-b" type="datetime-local" value={kBas} onChange={(e) => setKBas(e.target.value)} /></div><div><label htmlFor="ks-s">Bitiş</label><input id="ks-s" type="datetime-local" value={kBit} onChange={(e) => setKBit(e.target.value)} /></div></div>
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/kesif`, { amac, baslangic: new Date(kBas).toISOString(), bitis: new Date(kBit).toISOString() }))}>Keşif Görevi Aç</button>
        </>}
        {acikKesif && <>
          {v.fotoEksik.length > 0 && <div className="uyari">Eksik Fotoğraf: {v.fotoEksik.join(', ')}</div>}
          <label htmlFor="ks-i">İncelenen Alanlar</label><input id="ks-i" value={inc} onChange={(e) => setInc(e.target.value)} />
          <label htmlFor="ks-e">Erişilemeyen Alanlar</label><input id="ks-e" value={eris} onChange={(e) => setEris(e.target.value)} />
          {eris && <><label htmlFor="ks-et">Açık Konu Hedef Tarihi</label><input id="ks-et" type="date" value={erisT} onChange={(e) => setErisT(e.target.value)} /></>}
          <label htmlFor="ks-c">Çıkış Durumu</label><select id="ks-c" value={cikis} onChange={(e) => setCikis(e.target.value)}>{['Hazır', 'Koşullu', 'Açık'].map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="ks-t">Asbest veya Eski TBT Boyası Şüphesi Var mı?</label><select id="ks-t" value={sup} onChange={(e) => setSup(e.target.value)}>{['Hayır', 'Bilinmiyor', 'Evet'].map((x) => <option key={x}>{x}</option>)}</select>
          <label className="kutu"><input type="checkbox" checked={sayim} onChange={(e) => setSayim(e.target.checked)} /><span>Kanıt Sayımı Yapıldı</span></label>
          <button className="btn2" onClick={() => void yap(() => istek(`/kesif/${acikKesif.kimlik}/tamamla`, { tarih: new Date().toISOString(), incelenen: inc, erisilemeyen: eris || undefined, hedefTarih: erisT || undefined, cikis, supheli: sup, kanitSayimi: sayim }))}>Keşfi Tamamla</button>
        </>}
      </Blok>
      <Blok baslik="Bulgular">
        {v.bulgular.map((b) => <div key={b.kimlik}>{b.bulgu_no} · {b.hasar_onem_derecesi}{b.bolge_kodu ? ` · ${b.bolge_kodu}` : ''} · {b.konum_referansi} · {b.aciklama}</div>)}
        <label htmlFor="bg-k">Konum Referansı</label><input id="bg-k" value={bKonum} onChange={(e) => setBKonum(e.target.value)} placeholder="Baştan 8 m, sancak" />
        <div className="iki-tarih"><div><label htmlFor="bg-b">Bölge Kodu</label><input id="bg-b" value={bBolge} onChange={(e) => setBBolge(e.target.value)} placeholder="S1" /></div><div><label htmlFor="bg-o">Önem</label><select id="bg-o" value={bOnem} onChange={(e) => setBOnem(e.target.value)}>{['Kritik', 'Yüksek', 'Orta', 'Düşük', 'Gözlem'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
        <label htmlFor="bg-a">Açıklama</label><input id="bg-a" value={bAcik} onChange={(e) => setBAcik(e.target.value)} />
        <label htmlFor="bg-h">Hedef Tarih</label><input id="bg-h" type="date" value={bHedef} onChange={(e) => setBHedef(e.target.value)} />
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/bulgu`, { konum: bKonum, bolge: bBolge || undefined, aciklama: bAcik, etiket: 'Hasar', bilgiTuru: 'İlk Gözlem', onem: bOnem, yonlendirme: 'Onarım', sorumlu: d.ekip.find((e) => e.rol.includes('Teknik Uzman'))?.kullanici, hedefTarih: bHedef }))}>Bulgu Ekle</button>
      </Blok>
      <Blok baslik="Yönlendirmeli Fotoğraf">
        {KALEMLER.map((k) => { const y = v.gorseller.find((g) => g.cekim_kalemi === k); return <div key={k}>{y ? '✔' : '○'} {k}{y?.gorsel_no ? ` · ${y.gorsel_no}` : ''}{y?.cekilemedi_nedeni ? ` · ${y.cekilemedi_nedeni}` : ''}</div>; })}
        <label htmlFor="gr-k">Kalem</label><select id="gr-k" value={gKalem} onChange={(e) => setGKalem(e.target.value)}>{KALEMLER.map((k) => <option key={k}>{k}</option>)}</select>
        {gKalem.startsWith('Bölge') && <><label htmlFor="gr-b">Bölge Kodu</label><input id="gr-b" value={gBolge} onChange={(e) => setGBolge(e.target.value)} /></>}
        {gKalem.includes('Yakın') && <><label htmlFor="gr-o">Ölçek Referansı</label><input id="gr-o" value={gOlcek} onChange={(e) => setGOlcek(e.target.value)} /></>}
        <label htmlFor="gr-f">Yüklenmiş Fotoğraf</label><select id="gr-f" value={gBelge} onChange={(e) => setGBelge(e.target.value)}><option value="">Seçiniz</option>{belgeler.map((b) => <option key={b.kimlik} value={b.kimlik}>{b.ad}</option>)}</select>
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/gorsel`, { asama: 'Keşif', kalem: gKalem, belge: gBelge, bolge: gBolge || undefined, olcek: gOlcek || undefined }))}>Fotoğrafı Kaydet</button>
        {!gKalem.startsWith('Bölge') && <><label htmlFor="gr-n">Çekilemedi Nedeni</label><select id="gr-n" value={gNeden} onChange={(e) => setGNeden(e.target.value)}><option value="">Seçiniz</option>{CEKILEMEDI.map((x) => <option key={x}>{x}</option>)}</select><button className="btn2" disabled={!gNeden} onClick={() => void yap(() => istek(`/dosya/${id}/gorsel`, { asama: 'Keşif', kalem: gKalem, cekilemedi: gNeden }))}>Çekilemedi</button></>}
      </Blok>
      {d.statu !== 'Kapalı' && d.rollerim.includes('Dosya Sorumlusu') && <>
        <Blok baslik="Kapanış Kontrolü">
          <label htmlFor="kp-n">Kapanma Nedeni (Kapalı için)</label><select id="kp-n" value={kNeden} onChange={(e) => setKNeden(e.target.value)}><option value="">Seçiniz</option>{KAPANMA.map((x) => <option key={x}>{x}</option>)}</select>
          <label className="kutu"><input type="checkbox" checked={beyan} onChange={(e) => setBeyan(e.target.checked)} /><span>Bu dosyayla ilgili aktarılmamış yazışma yok</span></label>
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/kapanis`, { cikis: d.statu === 'Teknik Kapalı' ? 'Kapalı' : 'Teknik Kapalı', neden: kNeden || undefined, yetkiKapsam: true, uygulama: true, testKabul: true, acikKonu: true, garanti: true, arsiv: true, yazismaBeyani: beyan }), 'Operasyon Müdürünün onayına gönderildi.')}>{d.statu === 'Teknik Kapalı' ? 'Kapanışı Onaya Gönder' : 'Teknik Kapanışı Onaya Gönder'}</button>
        </Blok>
        <Blok baslik="Askı, İptal, Fesih, Devir">
          <label htmlFor="is-t">İşlem</label><select id="is-t" value={iTur} onChange={(e) => setITur(e.target.value)}>{['Askı', 'İptal', 'Fesih', 'Devir'].map((x) => <option key={x}>{x}</option>)}</select>
          {iTur !== 'Askı' && <><label htmlFor="is-n">Kapanma Nedeni</label><select id="is-n" value={iNeden} onChange={(e) => setINeden(e.target.value)}><option value="">Seçiniz</option>{KAPANMA.map((x) => <option key={x}>{x}</option>)}</select></>}
          {iTur === 'Devir' && <><label htmlFor="is-d">Devralan Taraf</label><input id="is-d" value={iDev} onChange={(e) => setIDev(e.target.value)} /></>}
          <label htmlFor="is-g">Gerekçe</label><input id="is-g" value={iGer} onChange={(e) => setIGer(e.target.value)} />
          <label htmlFor="is-y">Yapılan İşler</label><input id="is-y" value={iYapilan} onChange={(e) => setIYapilan(e.target.value)} />
          <label htmlFor="is-a">Açık İşler</label><input id="is-a" value={iAcik} onChange={(e) => setIAcik(e.target.value)} />
          <label htmlFor="is-e">Teslim Edilenler</label><input id="is-e" value={iTeslim} onChange={(e) => setITeslim(e.target.value)} />
          <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/islem`, { tur: iTur, neden: iNeden || undefined, devralan: iDev || undefined, gerekce: iGer, talepEden: 'Dosya Sorumlusu', yatDurumu: d.talep.yat_mevcut_durumu, yapilan: iYapilan, acik: iAcik, teslim: iTeslim }), 'Operasyon Müdürünün onayına gönderildi.')}>Tutanağı Onaya Gönder</button>
        </Blok>
      </>}
      <Blok baslik="Garanti ve Şikâyet">
        {v.garantiKayitlari.map((g) => <div key={g.kimlik}>{g.kayit_no} · {g.statu} · <Oncelik o={g.oncelik} />{g.yanit_son ? ` · Yanıt Son: ${saat(g.yanit_son)}` : ''}{g.karar ? ` · ${g.karar}` : ''}{g.sikayet_sonucu ? ` · ${g.sikayet_sonucu}` : ''}{!g.karar && g.statu !== 'Kapalı' && <GarantiKarar id={g.kimlik} yap={yap} />}</div>)}
        <label htmlFor="gs-t">Kayıt Türü</label><select id="gs-t" value={gsTur} onChange={(e) => setGsTur(e.target.value)}><option>Garanti bildirimi</option><option>Şikâyet</option></select>
        <label htmlFor="gs-a">{gsTur === 'Şikâyet' ? 'Şikâyet Konusu' : 'Belirti'}</label><input id="gs-a" value={gsAcik} onChange={(e) => setGsAcik(e.target.value)} />
        <button className="btn2" onClick={() => void yap(() => istek(`/dosya/${id}/garanti-sikayet`, { turler: [gsTur], kanal: 'Telefon', oncelik: 'Normal', belirti: gsTur === 'Şikâyet' ? undefined : gsAcik, konu: gsTur === 'Şikâyet' ? gsAcik : undefined }))}>Kaydı Aç</button>
      </Blok>
    </>
  );
}

/** Üst arama: eski numara ana dosyaya yönlendirir (YG-024). */
export function AramaSonucu({ q, ac }: { q: string; ac: (id: string) => void }) {
  const [r, setR] = useState<{ kimlik: string; dosya_no: string; yat_adi: string; statu: string; oncelik: string; ana_kimlik: string | null; ana_no: string | null }[] | null>(null); const [hata, setHata] = useState('');
  useEffect(() => { setR(null); void istek<{ dosyalar: NonNullable<typeof r> }>(`/ara?q=${encodeURIComponent(q)}`).then((x) => setR(x.dosyalar)).catch((e) => setHata(e.message)); }, [q]);
  return (
    <>
      <h1>Arama: {q}</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {r && r.length === 0 && <div className="ozet bos">Sonuç bulunamadı.</div>}
      {r && r.length > 0 && <div className="tablo"><table className="kartli"><thead><tr><th>Dosya No</th><th>Yat</th><th>Durum</th><th /></tr></thead><tbody>{r.map((d) => <tr key={d.kimlik}><td data-ad="Dosya No">{d.dosya_no}{d.ana_no ? ` → ${d.ana_no}` : ''}</td><td data-ad="Yat">{d.yat_adi}</td><td data-ad="Durum"><Oncelik o={d.oncelik} /> {d.statu}</td><td data-ad="İşlem"><button className="btn2 kucuk" onClick={() => ac(d.ana_kimlik ?? d.kimlik)}>Aç</button></td></tr>)}</tbody></table></div>}
    </>
  );
}
