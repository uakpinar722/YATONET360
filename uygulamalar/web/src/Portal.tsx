import { useEffect, useState, type FormEvent } from 'react';
import { istek, type Ben } from './api';
import { BelgeSec } from './Kalite';

interface Kart { kimlik: string; dosyaNo: string; yat: string; durum: string; renk: string; ilerleme?: number; dosyaSorumlusu?: string | null }
interface OnayKart { kimlik: string; baslik: string; belge_adi: string; dosya_no: string | null }
interface Yetkili { rol: string; sahip_ad: string; belge_durumu: string; ust_limit_eur: string | null; bitis_tarihi: string | null; odeme_yetkisi: boolean }
interface Ana { yetkili: Yetkili | null; onaylar: (OnayKart & { ony_kod?: string })[]; dosyalar: Kart[]; talepler: Kart[] }
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
      {v?.yetkili && <div className="not">{v.yetkili.rol} · {v.yetkili.sahip_ad}</div>}
      {v?.onaylar.filter((o) => o.ony_kod === 'ONY-30').map((o) => <div className="hata" key={o.kimlik} role="alert"><b>⚠ Yata Erişim İzni</b>{o.dosya_no ? ` · ${o.dosya_no}` : ''}<div>Acil müdahale için ekibin yata erişmesine izin vermeniz istenmektedir.</div><button className="btn" onClick={() => setOnay(o.kimlik)}>İncele</button></div>)}
      {v?.yetkili && <Yetkilerim ben={ben} y={v.yetkili} yenile={() => void yukle()} />}
      {v && v.onaylar.some((o) => o.ony_kod !== 'ONY-30') && <>
        <div className="bolum">Onayınızı Bekleyenler</div>
        {v.onaylar.filter((o) => o.ony_kod !== 'ONY-30').map((o) => <div className="ozet" key={o.kimlik}><b>{o.belge_adi}</b>{o.dosya_no ? ` · ${o.dosya_no}` : ''}<button className="btn" onClick={() => void istek<{ belirtec: string }>(`/portal/onay/${o.kimlik}/ac`, {}).then((r) => setOnay(r.belirtec)).catch((e) => setHata(e.message))}>İncele ve Onayla</button></div>)}
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
      <YetkiliAtama />
      <div className="bolum">Acil Durum</div>
      <div className="uyari">Yat su alıyor, sürükleniyor, yangın sonrası durum varsa veya bağlama emniyeti tehlikedeyse hemen arayınız. Acil durumlarda lütfen önce 112&apos;yi arayınız.</div>
      <AcilDugmesi />
    </>
  );
}

/** YG-1658: konum 10 dakikada bir iletilir; izin yoksa yatın kayıtlı konumu; kullanıcı her an durdurabilir. */
function AcilDugmesi() {
  const TUR = ['Can Güvenliği', 'Su Alma veya Batma', 'Yangın', 'Sürüklenme veya Bağlama Tehlikesi', 'Kirlilik', 'Diğer'];
  const [f, setF] = useState({ tur: TUR[1]!, yatAdi: '', konum: '', aciklama: '' }); const [t, setT] = useState<string | null>(null); const [msg, setMsg] = useState(''); const [hata, setHata] = useState('');
  useEffect(() => {
    if (!t) return;
    const gonder = () => {
      const yolla = (g: object) => void istek<{ durdu: boolean }>(`/portal/acil/${t}/konum`, g).then((r) => { if (r.durdu) { setT(null); setMsg('Konum gönderimi durduruldu.'); } }).catch(() => {});
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => yolla({ enlem: p.coords.latitude, boylam: p.coords.longitude }), () => yolla({})); else yolla({});
    };
    gonder(); const z = setInterval(gonder, 600_000); return () => clearInterval(z);
  }, [t]);
  if (t) return <div className="ozet"><div>{msg}</div><div className="not">Konumunuzun iletilmesi için lütfen bu sayfayı açık tutunuz.</div><button className="btn2" onClick={() => void istek(`/portal/acil/${t}/konum-durdur`, {}).then(() => { setT(null); setMsg('Konum gönderimi durduruldu.'); })}>Konum Göndermeyi Durdur</button></div>;
  return (
    <div className="ozet">
      {hata && <div className="hata" role="alert">{hata}</div>}{msg && <div>{msg}</div>}
      <label htmlFor="pa-t">Acil Durum Türü</label><select id="pa-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{TUR.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="pa-y">Yat</label><input id="pa-y" value={f.yatAdi} onChange={(e) => setF({ ...f, yatAdi: e.target.value })} />
      <label htmlFor="pa-k">Konum</label><input id="pa-k" value={f.konum} onChange={(e) => setF({ ...f, konum: e.target.value })} />
      <label htmlFor="pa-a">Açıklama</label><input id="pa-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <div className="not">Acil Durum düğmesini kullandığınızda cihazınızın konumu Aydınlatma Metnimizde açıklandığı şekilde işlenir; konum izni vermezseniz yatın kayıtlı konumu iletilir.</div>
      <button className="btn hayir" disabled={!f.yatAdi.trim() || !f.konum.trim()} onClick={() => { setHata(''); void istek<{ talep: string; talepNo: string; uyari112: string }>('/portal/acil', f).then((r) => { setMsg(`${r.talepNo} · ${r.uyari112}`); setT(r.talep); }).catch((e) => setHata(e.message)); }}>Acil Durum</button>
    </div>
  );
}

/** YG-482: parça bazında seçim; sigortalıda önce sigorta talimatı. */
function SokulenParcalar({ id }: { id: string }) {
  const [l, setL] = useState<{ kimlik: string; parca_adi: string; secim: string | null; son_tarih: string }[]>([]); const [h, setH] = useState('');
  const yukle = () => istek<typeof l>(`/dosya/${id}/sokulen-parca`).then(setL).catch(() => {});
  useEffect(() => { void yukle(); }, [id]);
  if (!l.length) return null;
  return <><div className="bolum">Sökülen Parçalar</div><div className="ozet">{h && <div className="hata" role="alert">{h}</div>}{l.map((p) => <div key={p.kimlik}><label htmlFor={`sp-${p.kimlik}`}>{p.parca_adi} · Son: {p.son_tarih.split('-').reverse().join('.')}</label><select id={`sp-${p.kimlik}`} value={p.secim ?? ''} onChange={(e) => { setH(''); void istek(`/sokulen-parca/${p.kimlik}/secim`, { secim: e.target.value }).then(yukle).catch((x) => setH(x.message)); }}><option value="">Seçiniz</option>{['İade', 'Montaj', 'Süreli Bekletme', 'Hurda-Bertaraf'].map((x) => <option key={x}>{x}</option>)}</select></div>)}</div></>;
}

/** YG-458: portaldan garanti talebi. */
function GarantiTalebi({ id }: { id: string }) {
  const [b, setB] = useState(''); const [m, setM] = useState('');
  return <div className="ozet">{m && <div className="not" role="status">{m}</div>}<label htmlFor="gt-b">Sorunu Kısaca Yazınız</label><input id="gt-b" value={b} onChange={(e) => setB(e.target.value)} /><button className="btn2" disabled={!b.trim()} onClick={() => void istek(`/portal/dosya/${id}/garanti-talebi`, { belirti: b }).then(() => { setB(''); setM('Talebiniz Dosya Sorumlunuza iletildi.'); }).catch((x) => setM(x.message))}>Garanti Talebi Gönder</button></div>;
}

function DosyaOzeti({ id, geri }: { id: string; geri: () => void }) {
  const [bilgi, setBilgi] = useState('');
  const [d, setD] = useState<(Kart & { cayma?: boolean; belgeler: { kimlik: string; ad: string; surum_no: number }[]; fotograflar?: { kimlik: string; aciklama: string; onay_zamani: string }[]; faturalar: { kimlik: string; fatura_no: string; fatura_tarihi: string | null; toplam_eur: string; toplam_tl: string | null; durum: string }[]; teslim: { teslime_hazir_zamani: string | null; kalan_gun: number | null } | null; teklifler: { teklif_no: string; surum_no: number; teklif_turu: string; bildirilen_sure_gun?: number | null; tahmini_teslim_tarihi?: string | null; statu: string; karar: string | null; genel_toplam_eur: string; kalemler: { sira_no: number; aciklama: string; miktar: string; birim: string; tutar_eur: string }[] }[] }) | null>(null); const [hata, setHata] = useState('');
  useEffect(() => { void istek<NonNullable<typeof d>>(`/portal/dosya/${id}`).then(setD).catch((e) => setHata(e.message)); }, [id]);
  if (!d) return hata ? <div className="hata" role="alert">{hata}</div> : null;
  return (
    <>
      <button className="lnk" onClick={geri}>← Ana Sayfa</button>
      {d.cayma && !bilgi && <button className="btn2 kucuk" onClick={() => void istek<{ kimlik: string }>(`/portal/dosya/${id}/cayma`, {}).then(() => setBilgi('Cayma bildirimi Onayınızı Bekleyenler bölümüne eklendi; onayınız bekleniyor.')).catch((e) => setHata(e.message))}>Cayma Hakkımı Kullanmak İstiyorum</button>}
      {bilgi && <div className="not" role="status">{bilgi}</div>}
      <h1>{d.yat} · {d.dosyaNo}</h1>
      <div className="ozet"><div><Durum k={d} /></div>{d.dosyaSorumlusu && <div>Dosya Sorumlunuz: {d.dosyaSorumlusu}</div>}</div>
      {d.teklifler.length > 0 && <><div className="bolum">Teklifler</div><div className="ozet">{d.teklifler.map((t) => <div key={t.teklif_no + t.surum_no}><b className="koyu">{t.teklif_no} Rev.{t.surum_no}</b>{t.bildirilen_sure_gun ? ` · Tahmini Onarım Süresi / Tahmini Teslim Tarihi: ${t.bildirilen_sure_gun} iş günü${t.tahmini_teslim_tarihi ? ` / ${t.tahmini_teslim_tarihi.split('-').reverse().join('.')}` : ''}` : ''} · {t.teklif_turu} · {t.statu}{t.karar ? ` · ${t.karar}` : ''} · {t.genel_toplam_eur} EUR{t.kalemler.map((k) => <div key={k.sira_no} className="not">{k.aciklama} · {k.miktar} {k.birim} · {k.tutar_eur} EUR</div>)}</div>)}</div></>}
      {d.teslim?.teslime_hazir_zamani && <div className="uyari">Yatınız teslime hazırdır. Teslim için kalan gün: {d.teslim.kalan_gun}. Bu süreden sonraki barınma gideri tarafınıza aittir.</div>}
      {d.faturalar.length > 0 && <><div className="bolum">Faturalar</div><div className="ozet">{d.faturalar.map((f) => <div key={f.fatura_no}>{f.fatura_no} · {f.fatura_tarihi?.split('-').reverse().join('.')} · {f.toplam_eur} EUR{f.toplam_tl ? ` · ${f.toplam_tl} TL` : ''} · {f.durum} <FaturaItiraz id={f.kimlik} /></div>)}</div></>}
      <SokulenParcalar id={id} />
      {(d.fotograflar?.length ?? 0) > 0 && <><div className="bolum">İlerleme Fotoğrafları</div><div className="ozet">{d.fotograflar!.map((f) => <div key={f.kimlik}><a href={`/api/portal/fotograf/${f.kimlik}`}>{f.aciklama}</a> · {new Date(f.onay_zamani).toLocaleDateString('tr-TR')}</div>)}</div></>}
      <div className="bolum">Garanti Talebi</div>
      <GarantiTalebi id={id} />
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
  const [tkr, setTkr] = useState('Kabul'); const [cek, setCek] = useState('');
  const [t, setT] = useState<OnayEkran | null>(null); const [hata, setHata] = useState(''); const [not, setNot] = useState(''); const [kutu, setKutu] = useState<Record<string, boolean>>({}); const [kod, setKod] = useState(''); const [son, setSon] = useState<{ durum: string; onayKodu: string } | null>(null);
  const [m, setM] = useState(''); const [tk, setTk] = useState<string[]>([]); const [lehtar, setLehtar] = useState('');
  useEffect(() => { void istek<OnayEkran>(`/onay/${belirtec}`).then(setT).catch((e) => setHata(e.message)); }, [belirtec]);
  const kodIste = async (kanal: string) => { setHata(''); setNot(''); try { await istek(`/onay/${belirtec}/kod`, { kanal }); setNot(kanal === 'E-posta' ? 'Kod e-posta adresinize gönderilmiştir.' : `Kod ••${t?.telefonSonu ?? ''} ile biten telefonunuza gönderilmiştir.`); } catch (x) { setHata((x as Error).message); void istek<OnayEkran>(`/onay/${belirtec}`).then(setT).catch(() => {}); } };
  const karar = async () => { setHata(''); try { setSon(await istek<{ durum: string; onayKodu: string }>(`/onay/${belirtec}/karar`, { kod, kutular: kutu, form: t?.formTuru === 'Teslim Kararı' ? { teslimKarar: tkr, cekince: cek } : t?.formTuru ? { mulkiyet: m, takyidat: tk, lehtar } : undefined })); } catch (x) { setHata((x as Error).message); } };
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
      {t.formTuru === 'Teslim Kararı' && <>
        <label htmlFor="o-tk">Teslim Kararı</label><select id="o-tk" value={tkr} onChange={(e) => setTkr(e.target.value)}><option value="Kabul">Kabul</option><option value="Koşullu Kabul">Koşullu Kabul (çekinceli)</option></select>
        {tkr === 'Koşullu Kabul' && <><label htmlFor="o-c">Çekince</label><input id="o-c" value={cek} onChange={(e) => setCek(e.target.value)} /></>}
      </>}
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
/** YG-1566: metinler A2 taslağından. */
function Yetkilerim({ ben, y, yenile }: { ben: Ben; y: Yetkili; yenile: () => void }) {
  const [b, setB] = useState(''); const [h, setH] = useState('');
  return <>
    <div className="bolum">Yetkilerim</div>
    <div className="ozet">{y.sahip_ad} adına yapabileceğiniz işlemler aşağıda gösterilmiştir.
      {y.belge_durumu === 'Geçerli' ? <div>Yetki Belgesi Geçerli{y.ust_limit_eur ? ` · Üst Limit: ${y.ust_limit_eur} EUR` : ''}{y.bitis_tarihi ? ` · Bitiş: ${y.bitis_tarihi}` : ''}{!y.odeme_yetkisi && <div>Yetki belgeniz ödeme ve onay yetkisi içermediğinden onay işlemleri yat sahibine iletilecektir.</div>}<div>Yetki sınırınızı aşan veya yetki belgenizde yer almayan işlemler yat sahibinin onayına iletilir.</div></div>
        : y.belge_durumu === 'Kontrolde' ? <div>Yetki belgeniz kontrol edilmektedir.</div>
        : <><div><b>Yetki Belgesi Bekleniyor</b></div><div>Yetki belgeniz sisteme ulaşana kadar dosyaları, teknik raporu ve fiyat teklifini görüntüleyebilirsiniz; bu sürede onay işlemleri yat sahibine iletilecektir.</div><div>Vekâletname, yetki yazısı veya yat yönetim sözleşmesi (PDF ya da fotoğraf).</div>
          {h && <div className="hata" role="alert">{h}</div>}<BelgeSec ad="Yetki Belgesi" bagTuru="Yat Yetkilisi" bagKimligi={ben.kimlik} deger={b} sec={setB} /><button className="btn2" disabled={!b} onClick={() => void istek('/yetkilerim/belge', { belge: b }).then(yenile).catch((e) => setH(e.message))}>Yetki Belgesi Yükle</button></>}
    </div>
  </>;
}

export function YatSahibiKayit({ bitti, geri, yetkili }: { bitti: () => void; geri: () => void; yetkili?: boolean }) {
  const [yt, setYt] = useState({ rol: '', sahipAd: '', sahipTelefon: '+90', sahipEposta: '' });
  const [adim, setAdim] = useState<'tel' | 'kod'>('tel'); const [tel, setTel] = useState('+90'); const [kod, setKod] = useState(''); const [ad, setAd] = useState(''); const [ep, setEp] = useState(''); const [hata, setHata] = useState('');
  const kodAl = async (e: FormEvent) => { e.preventDefault(); setHata(''); try { await istek('/kayit/kod', { telefon: tel }); setAdim('kod'); } catch (x) { setHata((x as Error).message); } };
  const tamam = async (e: FormEvent) => { e.preventDefault(); setHata(''); try { await istek('/kayit/tamamla', { telefon: tel, kod, ad, eposta: ep || undefined, yetkili: yetkili ? { ...yt, sahipEposta: yt.sahipEposta || undefined } : undefined }); bitti(); } catch (x) { setHata((x as Error).message); } };
  return (
    <div>
      <h2>{yetkili ? 'Yat Sahibi Adına İşlem Yapıyorum' : 'Yat Sahibi Kaydı'}</h2>
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
          {yetkili && <>
            <label htmlFor="yy-r">Yat Sahibine Göre Rolünüz</label><select id="yy-r" value={yt.rol} onChange={(e) => setYt({ ...yt, rol: e.target.value })}><option value="">Seçiniz</option>{['Yatın Kaptanı', 'Yat Sahibinin Yetkili Temsilcisi', 'Yat Yönetim Şirketi / İşletmeci', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Yat Brokeri', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
            <div className="not">Adına işlem yaptığınız yat sahibinin bilgilerini giriniz. Yat sahibine bilgilendirme mesajı gönderilecektir.</div>
            <label htmlFor="yy-a">Yat Sahibinin Adı Soyadı / Unvanı</label><input id="yy-a" value={yt.sahipAd} onChange={(e) => setYt({ ...yt, sahipAd: e.target.value })} />
            <label htmlFor="yy-t">Yat Sahibinin Cep Telefonu</label><input id="yy-t" inputMode="tel" value={yt.sahipTelefon} onChange={(e) => setYt({ ...yt, sahipTelefon: e.target.value })} />
            <label htmlFor="yy-e">Yat Sahibinin E-Postası</label><input id="yy-e" type="email" value={yt.sahipEposta} onChange={(e) => setYt({ ...yt, sahipEposta: e.target.value })} />
            <div className="not">Yetki belgesi olmadan talep açabilir ve dosyayı izleyebilirsiniz. Teklif onayı gibi işlemler yalnız yetki belgesinde yazılı kapsam, tutar ve süre içinde yapılabilir.</div>
          </>}
          <button className="btn" disabled={kod.length !== 6 || !ad.trim() || (yetkili && (!yt.rol || !yt.sahipAd.trim()))}>Hesabımı Oluştur</button>
        </form>
      )}
      <button type="button" className="lnk" onClick={geri}>← Geri</button>
    </div>
  );
}

/** YG-887: kalem, tutar ve gerekçe; itiraz edilmeyen kısım ödenince teslim yapılır. */
function FaturaItiraz({ id }: { id: string }) {
  const [ac, setAc] = useState(false); const [f, setF] = useState({ kalem: '', tutar: '', gerekce: '' }); const [m, setM] = useState('');
  if (!ac) return <button className="lnk" onClick={() => setAc(true)}>İtiraz Et</button>;
  return <><label htmlFor={`fi-k-${id}`}>İtiraz Edilen Kalem</label><input id={`fi-k-${id}`} value={f.kalem} onChange={(e) => setF({ ...f, kalem: e.target.value })} /><label htmlFor={`fi-t-${id}`}>Tutar (EUR)</label><input id={`fi-t-${id}`} value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} /><label htmlFor={`fi-g-${id}`}>Gerekçe</label><input id={`fi-g-${id}`} value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} /><button className="btn2 kucuk" onClick={() => void istek(`/fatura/${id}/itiraz`, { kalem: f.kalem, gerekce: f.gerekce, tutar: Number(f.tutar.replace(/\./g, '').replace(',', '.')) }).then(() => setM('İtirazınız alındı; yanıt bekleniyor.')).catch((e) => setM(e.message))}>İtirazı Gönder</button>{m && <div className="not" role="status">{m}</div>}</>;
}

/** YG-1070, ONY-14: sizi yat sahibi gösteren yetkililer; atama SMS kodlu ekranda onaylanır. */
function YetkiliAtama() {
  const [l, setL] = useState<{ kullanici_ref: string; rol: string; ad_soyad: string; belge_durumu: string; ust_limit_eur: string | null; bitis_tarihi: string | null }[]>([]); const [ac, setAc] = useState(''); const [f, setF] = useState({ yatlar: '', limit: '', bitis: '', odeme: false, bilgi: false }); const [m, setM] = useState('');
  useEffect(() => { void istek<typeof l>('/portal/yetkililerim').then(setL).catch(() => setL([])); }, []);
  if (!l.length) return null;
  return <><div className="bolum">Yetkililerim</div>{m && <div className="not" role="status">{m}</div>}{l.map((y) => <div className="ozet" key={y.kullanici_ref}><div>{y.ad_soyad} · {y.rol} · {y.belge_durumu}{y.ust_limit_eur !== null ? ` · ${y.ust_limit_eur} EUR` : ''}{y.bitis_tarihi ? ` · Bitiş: ${y.bitis_tarihi.split('-').reverse().join('.')}` : ''}</div>{ac === y.kullanici_ref ? <><label htmlFor="ya-y">Kapsadığı Yatlar (Virgülle)</label><input id="ya-y" value={f.yatlar} onChange={(e) => setF({ ...f, yatlar: e.target.value })} /><label htmlFor="ya-l">Tek İşlem Üst Limiti (EUR){y.rol === 'Yatın Kaptanı' ? ' · Boşsa Sıfır' : ''}</label><input id="ya-l" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /><label htmlFor="ya-b">Bitiş Tarihi</label><input id="ya-b" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} /><label className="kutu"><input type="checkbox" checked={f.odeme} onChange={(e) => setF({ ...f, odeme: e.target.checked })} /><span>Ödeme Yetkisi (limit girilirse)</span></label><label className="kutu"><input type="checkbox" checked={f.bilgi} onChange={(e) => setF({ ...f, bilgi: e.target.checked })} /><span>Bilgi Paylaşım İzni</span></label><button className="btn2 kucuk" onClick={() => void istek(`/portal/yetkili/${y.kullanici_ref}/atama`, { yatlar: f.yatlar.split(',').map((s) => s.trim()).filter(Boolean), islemler: ['ONY-23', 'ONY-25', 'ONY-27'], limit: f.limit ? Number(f.limit.replace(/\./g, '').replace(',', '.')) : undefined, bitis: f.bitis, odeme: f.odeme, bilgi: f.bilgi }).then(() => { setAc(''); setM('Atama, onayınız için Onayınızı Bekleyenler bölümüne eklendi.'); }).catch((e) => setM(e.message))}>Atamayı Onaya Gönder</button></> : <button className="btn2 kucuk" onClick={() => setAc(y.kullanici_ref)}>Yetki Ata</button>}</div>)}</>;
}
