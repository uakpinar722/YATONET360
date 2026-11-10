import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

const TURLER = ['Sigorta Şirketi', 'Sigorta Brokeri', 'Sigorta Acentesi', 'Kurumsal Müşteri', 'Marina / Tersane / Çekek Sahası', 'Tedarikçi'];
const EN: Record<string, string> = { 'Sigorta Şirketi': 'Insurance Company', 'Sigorta Brokeri': 'Insurance Broker', 'Sigorta Acentesi': 'Insurance Agency', 'Kurumsal Müşteri': 'Corporate Client', 'Marina / Tersane / Çekek Sahası': 'Marina / Shipyard / Haul-out Yard', 'Tedarikçi': 'Supplier' };
// Teşekkür metni onaylı G-1 s3a seçeneğinden türetilmiştir (V-388).
const T = {
  tr: { b: 'Kurumsal İletişim Talebi', tur: 'Kurum Türü', kurum: 'Kurum Adı', ad: 'Ad Soyad', ep: 'E-Posta', tel: 'Telefon', mesaj: 'Mesajınız', gonder: 'Gönder', geri: '← Geri', tamam: 'Talebiniz alınmıştır; ekibimiz sizinle iletişime geçecek ve hesabınızı açacaktır.' },
  en: { b: 'Corporate Contact Request', tur: 'Organization Type', kurum: 'Organization Name', ad: 'Full Name', ep: 'E-mail', tel: 'Telephone', mesaj: 'Your Message', gonder: 'Send', geri: '← Back', tamam: 'Your request has been received; our team will contact you and open your account.' },
};

/** YG-1556: Hesap Oluştur → kurumsal iletişim talebi (herkese açık). */
export function KurumTalebiFormu({ dil, geri }: { dil: 'tr' | 'en'; geri: () => void }) {
  const t = T[dil]; const [f, setF] = useState({ kurumTuru: TURLER[0]!, kurumAdi: '', adSoyad: '', eposta: '', telefon: '', mesaj: '' }); const [h, setH] = useState(''); const [ok, setOk] = useState(false);
  const gonder = (e: FormEvent) => { e.preventDefault(); setH(''); void istek('/iletisim/kurum-talebi', f).then(() => setOk(true)).catch((x) => setH((x as Error).message)); };
  const al = (k: keyof typeof f, l: string, tip = 'text') => <><label htmlFor={`kt-${k}`}>{l}</label><input id={`kt-${k}`} type={tip} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <div><h2>{t.b}</h2>{h && <div className="hata" role="alert">{h}</div>}
    {ok ? <div className="not orta" role="status">{t.tamam}</div> : <form onSubmit={gonder}>
      <label htmlFor="kt-tur">{t.tur}</label><select id="kt-tur" value={f.kurumTuru} onChange={(e) => setF({ ...f, kurumTuru: e.target.value })}>{TURLER.map((x) => <option key={x} value={x}>{dil === 'en' ? EN[x] : x}</option>)}</select>
      {al('kurumAdi', t.kurum)}{al('adSoyad', t.ad)}{al('eposta', t.ep, 'email')}{al('telefon', t.tel, 'tel')}{al('mesaj', t.mesaj)}
      <button className="btn">{t.gonder}</button></form>}
    <button type="button" className="lnk" onClick={geri}>{t.geri}</button></div>;
}

type Talep = { kimlik: string; talep_no: string; kurum_turu: string; kurum_adi: string; ad_soyad: string; e_posta: string; telefon: string | null; mesaj: string | null; durum: string; yonlenen: string | null; not_metni: string | null };
/** YG-1556: Firma Yönetimi Müdürü yönlendirir; yönlendirilen birim görüşüp davet eder veya kapatır. */
export function KurumTalepleri() {
  const [v, setV] = useState<{ yonlendirir: boolean; roller: { kimlik: string; rol_adi: string }[]; talepler: Talep[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/kurum-talebi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Kurumsal İletişim Talepleri ({v.talepler.filter((x) => x.durum === 'Yeni').length} yeni)</summary>{m && <div className="not" role="status">{m}</div>}
    {v.talepler.map((x) => <div className="soru" key={x.kimlik}><span>{x.talep_no} · {x.kurum_turu} · {x.kurum_adi} · {x.ad_soyad} · {x.e_posta}{x.telefon ? ` · ${x.telefon}` : ''}{x.mesaj ? ` · ${x.mesaj}` : ''} · {x.durum}{x.yonlenen ? ` · ${x.yonlenen}` : ''}{x.not_metni ? ` · ${x.not_metni}` : ''}</span>
      {(x.durum === 'Yeni' || x.durum === 'Yönlendirildi') && <div className="tam"><label htmlFor={`kn-${x.kimlik}`}>Not</label><input id={`kn-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
        {v.yonlendirir && <><label htmlFor={`kr-${x.kimlik}`}>Birim</label><select id={`kr-${x.kimlik}`} value={g[`r${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`r${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{v.roller.map((r) => <option key={r.kimlik} value={r.kimlik}>{r.rol_adi}</option>)}</select><button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/yonlendir`, { rol: g[`r${x.kimlik}`], not: g[x.kimlik] }), 'Talep yönlendirildi.')}>Yönlendir</button></>}
        <button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/sonuc`, { durum: 'Davet Edildi', not: g[x.kimlik] }), 'Kaydedildi.')}>Davet Edildi</button><button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/sonuc`, { durum: 'Kapatıldı', not: g[x.kimlik] }), 'Kaydedildi.')}>Kapat</button></div>}</div>)}</details>;
}
