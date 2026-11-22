import { useEffect, useState } from 'react';
import { istek } from './api';

type Ek = { planlar: { kimlik: string; yil: number; surecler: string[]; aciklama: string | null; durum: string }[]; planHazirlar: boolean; raporlar: boolean; bulgular: { kimlik: string; denetim_no: string; sinif: string; tanim: string; durum: string; takip_sonucu: string | null; takip_notu: string | null }[]; ozet: { sinif: string; acik: number; kapandi: number }[] };
/** YG-1676, YG-1680: yıllık plan ve bulgu takibi. */
export function DenetimPlani() {
  const [v, setV] = useState<Ek | null>(null); const [f, setF] = useState({ yil: String(new Date().getFullYear() + 1), surecler: '', aciklama: '' }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Ek>('/ic-denetim/ek').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>İç Denetim Planı ve Bulgu Takibi</summary>{m && <div className="not" role="status">{m}</div>}
    {v.planlar.map((p) => <div className="soru" key={p.kimlik}><span>{p.yil} · {p.durum} · {p.surecler.join(', ')}</span></div>)}
    {v.planHazirlar && <><label htmlFor="dp-y">Yıl</label><input id="dp-y" inputMode="numeric" value={f.yil} onChange={(e) => setF({ ...f, yil: e.target.value })} /><label htmlFor="dp-s">Denetlenecek Süreçler (virgülle)</label><input id="dp-s" value={f.surecler} onChange={(e) => setF({ ...f, surecler: e.target.value })} /><label htmlFor="dp-a">Açıklama</label><input id="dp-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim/plan', { yil: Number(f.yil), surecler: f.surecler.split(','), aciklama: f.aciklama }), 'Plan CEO onayına gönderildi.')}>Planı CEO Onayına Sun</button></>}
    {v.ozet.length > 0 && <div className="not">{v.ozet.map((x) => `${x.sinif}: ${x.acik} açık / ${x.kapandi} kapalı`).join(' · ')}</div>}
    {v.raporlar && <button className="btn2 kucuk" onClick={() => is(istek('/ic-denetim/bulgu-raporu', {}), 'Kapanış durumu CEO\'ya raporlandı.')}>Kapanış Durumunu CEO'ya Raporla</button>}
    {v.bulgular.map((x) => <div className="soru" key={x.kimlik}><span>{x.denetim_no} · {x.sinif} · {x.tanim} · {x.durum}{x.takip_sonucu ? ` · Takip: ${x.takip_sonucu}` : ''}</span>{x.durum === 'Açık' && <div className="tam"><label htmlFor={`bt-${x.kimlik}`}>Takip Notu</label><input id={`bt-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/bulgu/${x.kimlik}/takip`, { sonuc: 'Etkin', not: g[x.kimlik] }), 'Bulgu kapandı.')}>Etkin</button><button className="btn2 kucuk" onClick={() => is(istek(`/ic-denetim/bulgu/${x.kimlik}/takip`, { sonuc: 'Etkin Değil', not: g[x.kimlik] }), 'Takip kaydedildi.')}>Etkin Değil</button></div>}</div>)}</details>;
}

type Rg = { taramalar: { kimlik: string; donem: string; sonuc: string | null; aciklama: string | null; mum_listesi: string[] }[]; kurallar: { mum_no: string; mevzuat: string | null; yukumluluk: string }[] };
/** YG-807: haftalık Resmî Gazete taraması; değişiklik uyum kuralına işlenir. */
export function ResmiGazete() {
  const [v, setV] = useState<Rg | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [sec, setSec] = useState<string[]>([]); const [m, setM] = useState('');
  const yk = () => istek<Rg>('/resmi-gazete').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const kaydet = (id: string, sonuc: string) => void istek(`/resmi-gazete/${id}`, { sonuc, aciklama: g[id], mumlar: sonuc === 'Değişiklik Var' ? sec : [] }).then(() => { setM('Tarama kaydedildi.'); setSec([]); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Resmî Gazete Taraması</summary>{m && <div className="not" role="status">{m}</div>}
    {v.taramalar.map((t) => <div className="soru" key={t.kimlik}><span>{t.donem} · {t.sonuc ?? 'Bekliyor'}{t.mum_listesi.length ? ` · ${t.mum_listesi.join(', ')}` : ''}{t.aciklama ? ` · ${t.aciklama}` : ''}</span>{!t.sonuc && <div className="tam"><label htmlFor={`rg-a-${t.kimlik}`}>Değişiklik</label><input id={`rg-a-${t.kimlik}`} value={g[t.kimlik] ?? ''} onChange={(e) => setG({ ...g, [t.kimlik]: e.target.value })} />
      <label htmlFor={`rg-m-${t.kimlik}`}>İlgili Uyum Kuralları</label><select id={`rg-m-${t.kimlik}`} multiple value={sec} onChange={(e) => setSec([...e.target.selectedOptions].map((o) => o.value))}>{v.kurallar.map((k) => <option key={k.mum_no} value={k.mum_no}>{k.mum_no} · {k.yukumluluk.slice(0, 60)}</option>)}</select>
      <button className="btn2 kucuk" onClick={() => kaydet(t.kimlik, 'Değişiklik Yok')}>Değişiklik Yok</button><button className="btn2 kucuk" onClick={() => kaydet(t.kimlik, 'Değişiklik Var')}>Değişikliği İşle</button></div>}</div>)}</details>;
}

type Sm = { kimlik: string; kayit_no: string; kaynak: string; platform: string; ozet: string; olumsuz: boolean; sonuc: string | null; gecikti: boolean; dosya_no?: string | null; sikayet_no?: string | null; yanit_varyant?: string | null; yanit_zamani?: string | null; yanitlar?: boolean };
/** YG-731, YG-1466: yalnız sözcü onaylı FR-KLT-017 şablonuyla yanıtlar ve "Yanıtlandı" işaretler; metin platforma elle yapıştırılır. */
function SozcuYanit({ id, dosyali, bitti }: { id: string; dosyali: boolean; bitti: (t: string) => void }) {
  const [v, setV] = useState(''); const [dil, setDil] = useState('tr'); const [metin, setMetin] = useState(''); const [h, setH] = useState('');
  const getir = (vv: string, dd: string) => { setV(vv); setDil(dd); setMetin(''); setH(''); if (vv) void istek<{ metin: string }>(`/sosyal-medya/${id}/yanit-metni?varyant=${encodeURIComponent(vv)}&dil=${dd}`).then((r) => setMetin(r.metin)).catch((e) => setH(e.message)); };
  return <div className="tam"><label htmlFor={`sy-v-${id}`}>Yanıt Şablonu</label><select id={`sy-v-${id}`} value={v} onChange={(e) => getir(e.target.value, dil)}><option value="">Seçiniz</option><option>Genel</option>{dosyali && <option>Dosyalı</option>}<option>Olumlu</option></select>
    <label htmlFor={`sy-d-${id}`}>Dil</label><select id={`sy-d-${id}`} value={dil} onChange={(e) => getir(v, e.target.value)}><option value="tr">Türkçe</option><option value="en">İngilizce</option></select>
    {h && <div className="hata" role="alert">{h}</div>}{metin && <div className="not">{metin}</div>}
    <button className="btn2 kucuk" disabled={!metin} onClick={() => void istek(`/sosyal-medya/${id}/yanitlandi`, { varyant: v, dil }).then(() => bitti('Yanıtlandı olarak işaretlendi.')).catch((e) => setH(e.message))}>Yanıtlandı Olarak İşaretle</button></div>;
}

/** YG-586: personel bildirir; Müşteri ve Paydaş İlişkileri Müdürü 2 saat içinde değerlendirir. Personel paylaşıma yanıt vermez. */
export function SosyalMedya() {
  const [l, setL] = useState<Sm[] | null>(null); const [f, setF] = useState({ platform: '', baglanti: '', ozet: '' }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<Sm[]>('/sosyal-medya').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Sosyal Medya Bildirimi</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Paylaşıma yanıt vermeyiniz; yalnız bildiriniz.</div>
    <label htmlFor="sm-p">Platform</label><input required id="sm-p" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /><label htmlFor="sm-b">Paylaşım Bağlantısı</label><input required id="sm-b" value={f.baglanti} onChange={(e) => setF({ ...f, baglanti: e.target.value })} /><label htmlFor="sm-o">Not (isteğe bağlı)</label><input required id="sm-o" value={f.ozet} onChange={(e) => setF({ ...f, ozet: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.platform.trim() || (!f.ozet.trim() && !f.baglanti.trim())} onClick={() => is(istek('/sosyal-medya', { ...f, tarama: l !== null }), 'Bildiriminiz Müşteri ve Paydaş İlişkileri Müdürlüğüne iletildi.')}>Paylaşımı Bildir</button>
    {l?.map((x) => <div className={x.gecikti || (x.olumsuz && !x.sonuc) ? 'soru hata' : 'soru'} key={x.kimlik}><span>{x.kayit_no} · {x.kaynak} · {x.platform} · {x.ozet}{x.sonuc ? ` · ${x.sonuc}` : x.gecikti ? ' · 2 Saat Aşıldı' : ''}{x.dosya_no ? ` · Dosya: ${x.dosya_no}` : ''}{x.yanit_zamani ? ` · Yanıtlandı (${x.yanit_varyant})` : ''}{x.sikayet_no ? ` · Şikâyet ${x.sikayet_no}` : ''}</span>{x.dosya_no && !x.sikayet_no && l !== null && <button className="btn2 kucuk" onClick={() => is(istek(`/sosyal-medya/${x.kimlik}/sikayet`, {}), 'Şikâyet kaydı açıldı.')}>Şikâyet Kaydı Aç</button>}{!x.dosya_no && <div className="tam"><label htmlFor={`sm-dn-${x.kimlik}`}>Dosya No</label><input id={`sm-dn-${x.kimlik}`} value={g[`dn${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`dn${x.kimlik}`]: e.target.value })} /><button className="btn2 kucuk" disabled={!g[`dn${x.kimlik}`]?.trim()} onClick={() => is(istek(`/sosyal-medya/${x.kimlik}/dosya`, { dosyaNo: g[`dn${x.kimlik}`] }), 'Paylaşım dosyayla eşleştirildi; Dosya Sorumlusu bilgilendirildi.')}>Dosyayla Eşleştir</button></div>}{x.yanitlar && !x.yanit_zamani && <SozcuYanit id={x.kimlik} dosyali={Boolean(x.dosya_no)} bitti={(t) => is(Promise.resolve(), t)} />}{!x.sonuc && <div className="tam"><label htmlFor={`sm-d-${x.kimlik}`}>Değerlendirme</label><input id={`sm-d-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />{['İşlem Gerekmez', 'Sözcüye İletildi', 'Hukuka İletildi', 'Kapatıldı'].map((s) => <button key={s} className="btn2 kucuk" onClick={() => is(istek(`/sosyal-medya/${x.kimlik}/degerlendir`, { degerlendirme: g[x.kimlik], sonuc: s }), 'Değerlendirme kaydedildi.')}>{s}</button>)}</div>}</div>)}</details>;
}

type HM = { kod: string; dil: string; surum: string; baslik: string; durum: string; govde: string };
/** YG-1697 (A51-S8): Sabit Hukuki Metinler; metin değişikliği ve İngilizce sürüm "Onaya Gönder" ile CEO'ya; onaylı sürüm yürürlüğe girer. */
export function HukukiMetinler() {
  const [v, setV] = useState<{ hazirlar: boolean; metinler: HM[] } | null>(null); const [ac, setAc] = useState(''); const [f, setF] = useState<{ tr: string; en: string; gerekce: string }>({ tr: '', en: '', gerekce: '' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/hukuki-metinler').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const kodlar = [...new Set(v.metinler.map((x) => x.kod))];
  const yurur = (kod: string, dil: string) => v.metinler.find((x) => x.kod === kod && x.dil === dil && x.durum === 'Yürürlükte');
  return <details><summary>Sabit Hukuki Metinler</summary>{m && <div className="not" role="status">{m}</div>}
    {v.metinler.map((x) => <div className="soru" key={`${x.kod}-${x.dil}-${x.surum}`}><span>{x.kod} · {x.dil.toUpperCase()} · {x.surum} · {x.durum}</span></div>)}
    {v.hazirlar && <><label htmlFor="hm-k">Metin</label><select id="hm-k" value={ac} onChange={(e) => { const k = e.target.value; setAc(k); setF({ tr: yurur(k, 'tr')?.govde ?? '', en: yurur(k, 'en')?.govde ?? '', gerekce: '' }); }}><option value="">Seçiniz</option>{kodlar.map((k) => <option key={k}>{k}</option>)}</select>
      {ac && <>{yurur(ac, 'tr') && <><label htmlFor="hm-tr">Türkçe Metin</label><textarea id="hm-tr" rows={8} value={f.tr} onChange={(e) => setF({ ...f, tr: e.target.value })} /></>}
        {yurur(ac, 'en') && <><label htmlFor="hm-en">İngilizce Metin</label><textarea id="hm-en" rows={8} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} /></>}
        <label htmlFor="hm-g">Değişiklik Gerekçesi</label><input required id="hm-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
        <button className="btn2 kucuk" disabled={!f.gerekce.trim()} onClick={() => void istek<{ surum: string }>(`/hukuki-metin/${encodeURIComponent(ac)}`, f).then((r) => { setM(`${ac} ${r.surum} CEO onayına gönderildi.`); setAc(''); return yk(); }).catch((e) => setM(e.message))}>Onaya Gönder</button></>}</>}</details>;
}
