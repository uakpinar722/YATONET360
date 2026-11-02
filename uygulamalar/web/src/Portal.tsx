import { useEffect, useState, type FormEvent } from 'react';
import { istek, type Ben } from './api';

interface Kart { kimlik: string; dosyaNo: string; yat: string; durum: string; renk: string; ilerleme?: number; dosyaSorumlusu?: string | null }
interface OnayKart { kimlik: string; baslik: string; belge_adi: string; dosya_no: string | null }
interface Ana { onaylar: OnayKart[]; dosyalar: Kart[]; talepler: Kart[] }
interface OnayEkran { baslik: string; metin: string; dugme: string; kutular: { ad: string; zorunlu?: boolean }[]; formTuru: string | null; durum: string; epostaKodu: boolean; telefonSonu: string | null; dosyaNo: string | null; onyKod: string }

const Durum = ({ k }: { k: Kart }) => <span className={`m-durum m-${k.renk === 'kırmızı' ? 'k' : k.renk === 'sarı' ? 's' : k.renk === 'gri' ? 'g' : 'y'}`}>{k.durum}</span>;
const MULKIYET = ['Malik', 'Finansal kiralama (leasing)', 'Kredi / ipotekli', 'Miras (elbirliği)', 'Paylı'];
const TAKYIDAT = ['Yok', 'Rehin / ipotek', 'Haciz', 'İhtiyati tedbir / ihtiyati haciz', 'Diğer kısıt'];

/** YG-1565: A1 Yat Sahibi Ana Ekranı: Onayınızı Bekleyenler, Dosyalarım, Hızlı İşlemler, Acil Durum. */
export function YatSahibiAna({ ben }: { ben: Ben }) {
  const [v, setV] = useState<Ana | null>(null); const [hata, setHata] = useState(''); const [form, setForm] = useState(false); const [acik, setAcik] = useState<string | null>(null); const [onay, setOnay] = useState<string | null>(null);
  const yukle = () => istek<Ana>('/portal/ana').then(setV).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, []);
  if (onay) return <OnayEkrani belirtec={onay} gomulu geri={() => { setOnay(null); void yukle(); }} />;
  if (form) return <HasarBildirimi bitti={() => { setForm(false); void yukle(); }} />;
  if (acik) return <DosyaOzeti id={acik} geri={() => setAcik(null)} />;
  return (
    <>
      <h1>Hoş Geldiniz, {ben.adSoyad}</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {v && v.onaylar.length > 0 && <>
        <div className="bolum">Onayınızı Bekleyenler</div>
        {v.onaylar.map((o) => <div className="ozet" key={o.kimlik}><b>{o.belge_adi}</b>{o.dosya_no ? ` · ${o.dosya_no}` : ''}<button className="btn" onClick={() => void istek<{ belirtec: string }>(`/portal/onay/${o.kimlik}/ac`, {}).then((r) => setOnay(r.belirtec)).catch((e) => setHata(e.message))}>İncele ve Onayla</button></div>)}
      </>}
      <div className="bolum">Dosyalarım</div>
      {v && v.dosyalar.length + v.talepler.length === 0 && <div className="ozet bos">Dosyanız bulunmamaktadır.</div>}
      {v?.talepler.map((k) => <div className="ozet" key={k.kimlik}><b>{k.yat}</b> · {k.dosyaNo}<div><Durum k={k} /></div></div>)}
      {v?.dosyalar.map((k) => (
        <div className="ozet" key={k.kimlik}>
          <b>{k.yat}</b> · {k.dosyaNo}
          <div><Durum k={k} /></div>
          <div className="ilerleme" role="progressbar" aria-valuenow={k.ilerleme} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${k.ilerleme}%` }} /></div>
          <button className="btn2 kucuk" onClick={() => setAcik(k.kimlik)}>Ayrıntı</button>
        </div>
      ))}
      <div className="bolum">Hızlı İşlemler</div>
      <div className="dugmeler"><button className="btn2" onClick={() => setForm(true)}>Hasar Bildir</button></div>
      <div className="bolum">Acil Durum</div>
      <div className="uyari">Yat su alıyor, sürükleniyor, yangın sonrası durum varsa veya bağlama emniyeti tehlikedeyse hemen arayınız. Acil durumlarda lütfen önce 112&apos;yi arayınız.</div>
    </>
  );
}

function DosyaOzeti({ id, geri }: { id: string; geri: () => void }) {
  const [d, setD] = useState<(Kart & { belgeler: { kimlik: string; ad: string; surum_no: number }[] }) | null>(null); const [hata, setHata] = useState('');
  useEffect(() => { void istek<NonNullable<typeof d>>(`/portal/dosya/${id}`).then(setD).catch((e) => setHata(e.message)); }, [id]);
  if (!d) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  return (
    <>
      <button className="lnk" onClick={geri}>← Ana Sayfa</button>
      <h1>{d.yat} · {d.dosyaNo}</h1>
      <div className="ozet"><div><Durum k={d} /></div>{d.dosyaSorumlusu && <div>Dosya Sorumlunuz: {d.dosyaSorumlusu}</div>}</div>
      <div className="bolum">Belgelerim</div>
      <div className="ozet">{d.belgeler.length === 0 ? 'Belge bulunmamaktadır.' : d.belgeler.map((b) => <div key={b.kimlik}><a href={`/api/belge/${b.kimlik}/surum/${b.surum_no}/indir`}>{b.ad}</a></div>)}</div>
    </>
  );
}

/** YG-011, YG-1562: kısa form; bu form acil durumlar için değildir. Fotoğraf isteğe bağlı, en fazla 5. */
function HasarBildirimi({ bitti }: { bitti: () => void }) {
  const [yat, setYat] = useState(''); const [yer, setYer] = useState(''); const [ozet, setOzet] = useState(''); const [sigorta, setSigorta] = useState('Bilinmiyor'); const [sg, setSg] = useState(''); const [hn, setHn] = useState(''); const [fotolar, setFotolar] = useState<File[]>([]);
  const [hata, setHata] = useState(''); const [no, setNo] = useState('');
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    try {
      const r = await istek<{ kimlik: string; talepNo: string }>('/portal/ihbar', { yatAdi: yat, konum: yer, ozet, sigorta, sigortaci: sg, hasarNo: hn });
      for (const f of fotolar) {
        const q = new URLSearchParams({ ad: f.name, tur: 'Hasar Fotoğrafı', bagTuru: 'Talep', bagKimligi: r.kimlik, kaynak: 'Sistem', dosya: f.name });
        const y = await fetch(`/api/belge/yukle?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Yatonet': '1' }, body: f, credentials: 'same-origin' });
        if (!y.ok) throw new Error(`Bildiriminiz kaydedildi (${r.talepNo}); "${f.name}" eklenemedi.`);
      }
      setNo(r.talepNo);
    } catch (x) { setHata((x as Error).message); }
  };
  if (no) return (
    <div className="ozet">
      <h1>Bildiriminiz Alındı</h1>
      <div>Kaydınız oluşturulmuştur.</div><div><b>Talep No: {no}</b></div>
      <div>Dosya Sorumlumuz sizinle iletişime geçecektir. Durum değişikliklerini bu uygulamadan ve bildirimlerle takip edebilirsiniz.</div>
      <button className="btn" onClick={bitti}>Ana Ekrana Git</button>
    </div>
  );
  return (
    <form className="ozet" onSubmit={(e) => void gonder(e)}>
      <h1>Hasar Bildirimi</h1>
      <div className="uyari">Bu form acil durumlar için değildir. Acil durumda 7/24 Destek Hattını arayınız.</div>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <label htmlFor="h-y">Yatın Adı</label><input id="h-y" value={yat} onChange={(e) => setYat(e.target.value)} />
      <label htmlFor="h-b">Yatın Bulunduğu Yer</label><input id="h-b" value={yer} onChange={(e) => setYer(e.target.value)} />
      <label htmlFor="h-o">Olay Özeti</label><textarea id="h-o" rows={4} value={ozet} onChange={(e) => setOzet(e.target.value)} />
      <label htmlFor="h-f">Fotoğraf Ekle ({fotolar.length}/5) (İsteğe Bağlı)</label><input id="h-f" type="file" accept="image/*" multiple onChange={(e) => { const l = [...(e.target.files ?? [])]; if (l.length > 5) { setHata('En fazla 5 fotoğraf ekleyebilirsiniz.'); return; } setFotolar(l); }} />
      <label htmlFor="h-s">Sigorta Durumu</label><select id="h-s" value={sigorta} onChange={(e) => setSigorta(e.target.value)}>{["Türkiye'de Sigortalı", 'Yurt Dışında Sigortalı', 'Sigortasız', 'Bilinmiyor'].map((x) => <option key={x}>{x}</option>)}</select>
      {sigorta === "Türkiye'de Sigortalı" && <><label htmlFor="h-sg">Sigorta Şirketi</label><input id="h-sg" value={sg} onChange={(e) => setSg(e.target.value)} /><label htmlFor="h-hn">Hasar Dosya Numarası</label><input id="h-hn" value={hn} onChange={(e) => setHn(e.target.value)} /></>}
      <button className="btn" disabled={!yat.trim() || !yer.trim() || !ozet.trim()}>Bildirimi Gönder</button>
      <button type="button" className="lnk" onClick={bitti}>Vazgeç</button>
    </form>
  );
}

/** YG-1433, YG-1448, YG-1507: bağlantı açılınca metin, varsa kutular, tek düğme ve kod. Uygulama kurmak gerekmez. */
export function OnayEkrani({ belirtec, gomulu, geri }: { belirtec: string; gomulu?: boolean; geri?: () => void }) {
  const [t, setT] = useState<OnayEkran | null>(null); const [hata, setHata] = useState(''); const [not, setNot] = useState(''); const [kutu, setKutu] = useState<Record<string, boolean>>({}); const [kod, setKod] = useState(''); const [son, setSon] = useState<{ durum: string; onayKodu: string } | null>(null);
  const [m, setM] = useState(''); const [tk, setTk] = useState<string[]>([]); const [lehtar, setLehtar] = useState('');
  useEffect(() => { void istek<OnayEkran>(`/onay/${belirtec}`).then(setT).catch((e) => setHata(e.message)); }, [belirtec]);
  const kodIste = async (kanal: string) => { setHata(''); setNot(''); try { await istek(`/onay/${belirtec}/kod`, { kanal }); setNot(kanal === 'E-posta' ? 'Kod e-posta adresinize gönderilmiştir.' : `Kod ••${t?.telefonSonu ?? ''} ile biten telefonunuza gönderilmiştir.`); } catch (x) { setHata((x as Error).message); } };
  const karar = async () => { setHata(''); try { setSon(await istek<{ durum: string; onayKodu: string }>(`/onay/${belirtec}/karar`, { kod, kutular: kutu, form: t?.formTuru ? { mulkiyet: m, takyidat: tk, lehtar } : undefined })); } catch (x) { setHata((x as Error).message); } };
  const tumKutu = (t?.kutular ?? []).every((k) => !k.zorunlu || kutu[k.ad]);
  const icerik = !t ? (hata ? <div className="hata" role="alert">{hata}</div> : null) : son ? (
    <div className="ozet"><h2>Onayınız Alınmıştır</h2><div>Onay Kodu: <b>{son.onayKodu}</b></div><div>Değerli onayınız için teşekkür ederiz.</div>{geri && <button className="btn" onClick={geri}>Ana Sayfaya Dön</button>}</div>
  ) : t.durum !== 'Bekliyor' ? (
    <div className="ozet"><h2>{t.baslik}</h2><div className="uyari">Bu onay artık açık değildir ({t.durum}).</div>{geri && <button className="btn" onClick={geri}>Ana Sayfaya Dön</button>}</div>
  ) : (
    <div className="ozet">
      <h2>{t.baslik}</h2>
      {t.dosyaNo && <div className="not">Dosya No: {t.dosyaNo}</div>}
      {t.metin.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
      {t.formTuru === 'Mülkiyet Beyanı' && <>
        <label htmlFor="o-m">Mülkiyet Türü</label><select id="o-m" value={m} onChange={(e) => setM(e.target.value)}><option value="">Seçiniz</option>{MULKIYET.map((x) => <option key={x}>{x}</option>)}</select>
        <label>Takyidat</label>{TAKYIDAT.map((x) => <label className="kutu" key={x}><input type="checkbox" checked={tk.includes(x)} onChange={(e) => setTk((o) => (e.target.checked ? [...o, x] : o.filter((y) => y !== x)))} /><span>{x}</span></label>)}
        {m !== 'Malik' && m !== '' && <><label htmlFor="o-l">Lehtar</label><input id="o-l" value={lehtar} onChange={(e) => setLehtar(e.target.value)} /></>}
      </>}
      {t.kutular.map((k) => <label className="kutu" key={k.ad}><input type="checkbox" checked={Boolean(kutu[k.ad])} onChange={(e) => setKutu((o) => ({ ...o, [k.ad]: e.target.checked }))} /><span>{k.ad}</span></label>)}
      {not && <div className="not" role="status">{not}</div>}
      {hata && <div className="hata" role="alert">{hata}</div>}
      <button type="button" className="btn2" onClick={() => void kodIste('SMS')}>SMS Kodu Gönder</button>
      {t.epostaKodu && <button type="button" className="lnk" onClick={() => void kodIste('E-posta')}>Kodu E-postayla Gönder</button>}
      <label htmlFor="o-k">Doğrulama Kodu</label><input id="o-k" inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} />
      <button className="btn" disabled={!tumKutu || kod.length !== 6} onClick={() => void karar()}>{t.dugme}</button>
      {geri && <button type="button" className="lnk" onClick={geri}>Vazgeç</button>}
    </div>
  );
  if (gomulu) return icerik;
  return <div className="ilk"><div className="ilk-kart"><div className="ilk-bas"><img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" /></div><div className="ilk-ic">{icerik}</div><div className="ilk-dip"><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></div></div></div>;
}

/** Y1: Yat Sahibi Kaydı: telefon, kod, bilgiler. Koşul, aydınlatma ve izin adımları kayıt sonrası ilk giriş akışında gelir. */
export function YatSahibiKayit({ bitti, geri }: { bitti: () => void; geri: () => void }) {
  const [adim, setAdim] = useState<'tel' | 'kod'>('tel'); const [tel, setTel] = useState('+90'); const [kod, setKod] = useState(''); const [ad, setAd] = useState(''); const [ep, setEp] = useState(''); const [hata, setHata] = useState('');
  const kodAl = async (e: FormEvent) => { e.preventDefault(); setHata(''); try { await istek('/kayit/kod', { telefon: tel }); setAdim('kod'); } catch (x) { setHata((x as Error).message); } };
  const tamam = async (e: FormEvent) => { e.preventDefault(); setHata(''); try { await istek('/kayit/tamamla', { telefon: tel, kod, ad, eposta: ep || undefined }); bitti(); } catch (x) { setHata((x as Error).message); } };
  return (
    <div>
      <h2>Yat Sahibi Kaydı</h2>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {adim === 'tel' ? (
        <form onSubmit={(e) => void kodAl(e)}>
          <div className="not">Doğrulama kodu almak için cep telefonu numaranızı giriniz.</div>
          <label htmlFor="y-t">Telefon</label><input id="y-t" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} />
          <button className="btn">SMS Kodu Gönder</button>
        </form>
      ) : (
        <form onSubmit={(e) => void tamam(e)}>
          <label htmlFor="y-k">Doğrulama Kodu</label><input id="y-k" inputMode="numeric" value={kod} onChange={(e) => setKod(e.target.value)} />
          <label htmlFor="y-a">Ad Soyad</label><input id="y-a" value={ad} onChange={(e) => setAd(e.target.value)} />
          <label htmlFor="y-e">E-Posta</label><input id="y-e" type="email" value={ep} onChange={(e) => setEp(e.target.value)} />
          <div className="not">Teklif ve belgeleriniz PDF olarak bu adrese de gönderilecektir.</div>
          <button className="btn" disabled={kod.length !== 6 || !ad.trim()}>Hesabımı Oluştur</button>
        </form>
      )}
      <button type="button" className="lnk" onClick={geri}>← Geri</button>
    </div>
  );
}
