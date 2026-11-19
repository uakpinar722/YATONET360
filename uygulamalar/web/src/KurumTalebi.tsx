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
// YG-1560: Çözüm Ortağı başvurusu aynı formla alınır; teşekkür metni onaylı G-1 s2a seçeneğinden türetilmiştir.
const BASVURU = { tr: { b: 'Çözüm Ortağı Başvurusu', kurum: 'Firma Unvanı', tamam: 'Başvurunuz alınmıştır; değerlendirme sonucu size bildirilecek, onaylandığında hesabınız açılacaktır.' }, en: { b: 'Solution Partner Application', kurum: 'Company Name', tamam: 'Your application has been received; you will be notified of the result and your account will be opened upon approval.' } };
export function KurumTalebiFormu({ dil, geri, basvuru = false }: { dil: 'tr' | 'en'; geri: () => void; basvuru?: boolean }) {
  const t = basvuru ? { ...T[dil], ...BASVURU[dil] } : T[dil]; const [f, setF] = useState({ kurumTuru: basvuru ? 'Çözüm Ortağı Adayı' : TURLER[0]!, kurumAdi: '', adSoyad: '', eposta: '', telefon: '', mesaj: '' }); const [h, setH] = useState(''); const [ok, setOk] = useState(false);
  const gonder = (e: FormEvent) => { e.preventDefault(); setH(''); void istek('/iletisim/kurum-talebi', f).then(() => setOk(true)).catch((x) => setH((x as Error).message)); };
  const al = (k: keyof typeof f, l: string, tip = 'text') => <><label htmlFor={`kt-${k}`}>{l}</label><input id={`kt-${k}`} type={tip} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <div><h2>{t.b}</h2>{h && <div className="hata" role="alert">{h}</div>}
    {ok ? <div className="not orta" role="status">{t.tamam}</div> : <form onSubmit={gonder}>
      {!basvuru && <><label htmlFor="kt-tur">{t.tur}</label><select id="kt-tur" value={f.kurumTuru} onChange={(e) => setF({ ...f, kurumTuru: e.target.value })}>{TURLER.map((x) => <option key={x} value={x}>{dil === 'en' ? EN[x] : x}</option>)}</select></>}
      {al('kurumAdi', t.kurum)}{al('adSoyad', t.ad)}{al('eposta', t.ep, 'email')}{al('telefon', t.tel, 'tel')}{al('mesaj', t.mesaj)}
      <button className="btn">{t.gonder}</button></form>}
    <button type="button" className="lnk" onClick={geri}>{t.geri}</button></div>;
}

type Talep = { kimlik: string; talep_no: string; kurum_turu: string; kurum_adi: string; ad_soyad: string; e_posta: string; telefon: string | null; mesaj: string | null; durum: string; yonlenen: string | null; not_metni: string | null };
/** YG-1556: Firma Yönetimi Müdürü yönlendirir; yönlendirilen birim görüşüp davet eder veya kapatır. */
export function KurumTalepleri() {
  const [v, setV] = useState<{ yonlendirir: boolean; karar?: boolean; mpmTurleri?: string[]; sigortaSirketleri?: { tsb_kodu: string; tam_unvan: string }[]; roller: { kimlik: string; rol_adi: string }[]; talepler: Talep[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/kurum-talebi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Kurumsal İletişim Talepleri ({v.talepler.filter((x) => x.durum === 'Yeni').length} yeni)</summary>{m && <div className="not" role="status">{m}</div>}
    {v.talepler.map((x) => <div className="soru" key={x.kimlik}><span>{x.talep_no} · {x.kurum_turu} · {x.kurum_adi} · {x.ad_soyad} · {x.e_posta}{x.telefon ? ` · ${x.telefon}` : ''}{x.mesaj ? ` · ${x.mesaj}` : ''} · {x.durum}{x.yonlenen ? ` · ${x.yonlenen}` : ''}{x.not_metni ? ` · ${x.not_metni}` : ''}</span>
      {(x.durum === 'Yeni' || x.durum === 'Yönlendirildi') && <div className="tam"><label htmlFor={`kn-${x.kimlik}`}>Not</label><input id={`kn-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} />
        {v.yonlendirir && <><label htmlFor={`kr-${x.kimlik}`}>Birim</label><select id={`kr-${x.kimlik}`} value={g[`r${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`r${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{v.roller.map((r) => <option key={r.kimlik} value={r.kimlik}>{r.rol_adi}</option>)}</select><button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/yonlendir`, { rol: g[`r${x.kimlik}`], not: g[x.kimlik] }), 'Talep yönlendirildi.')}>Yönlendir</button></>}
        {v.mpmTurleri?.includes(x.kurum_turu) ? (v.karar && <>{/* YG-1701 (A53-S1) */}
          <label htmlFor={`kk-${x.kimlik}`}>Karar</label><select id={`kk-${x.kimlik}`} value={g[`k${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`k${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option><option>Hesap Açılsın</option><option>Hesap Açılmasın</option></select>
          {g[`k${x.kimlik}`] === 'Hesap Açılsın' && x.kurum_turu === 'Sigorta Şirketi' && <><label htmlFor={`kt-${x.kimlik}`}>Sigorta Şirketi</label><select id={`kt-${x.kimlik}`} value={g[`t${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`t${x.kimlik}`]: e.target.value })}><option value="">Seçiniz</option>{v.sigortaSirketleri?.map((s) => <option key={s.tsb_kodu} value={s.tsb_kodu}>{s.tam_unvan}</option>)}</select><label htmlFor={`kd-${x.kimlik}`}>Yetkilendirme Yazısı (tarih ve sayı)</label><input id={`kd-${x.kimlik}`} value={g[`d${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`d${x.kimlik}`]: e.target.value })} /></>}
          {g[`k${x.kimlik}`] === 'Hesap Açılsın' && x.kurum_turu === 'Kurumsal Müşteri' && <><label htmlFor={`kf-${x.kimlik}`}>Taraf No</label><input id={`kf-${x.kimlik}`} value={g[`f${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`f${x.kimlik}`]: e.target.value })} /><label htmlFor={`ks-${x.kimlik}`}>Ek-2 Onay Sınırı (EUR)</label><input id={`ks-${x.kimlik}`} inputMode="decimal" value={g[`s${x.kimlik}`] ?? ''} onChange={(e) => setG({ ...g, [`s${x.kimlik}`]: e.target.value })} /></>}
          <button className="btn2 kucuk" disabled={!g[`k${x.kimlik}`] || !g[x.kimlik]?.trim()} onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/karar`, { karar: g[`k${x.kimlik}`], gorusme: g[x.kimlik], tsbKodu: g[`t${x.kimlik}`], dayanak: g[`d${x.kimlik}`], tarafNo: g[`f${x.kimlik}`], ek2Siniri: g[`s${x.kimlik}`] ? Number(g[`s${x.kimlik}`]!.replace(/\./g, '').replace(',', '.')) : undefined }), g[`k${x.kimlik}`] === 'Hesap Açılsın' ? 'Karar kaydedildi; davet kurum yetkilisine gönderildi.' : 'Karar kaydedildi.')}>Kararı Kaydet</button></>)
          : <><button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/sonuc`, { durum: 'Davet Edildi', not: g[x.kimlik] }), 'Kaydedildi.')}>Davet Edildi</button><button className="btn2 kucuk" onClick={() => is(istek(`/kurum-talebi/${x.kimlik}/sonuc`, { durum: 'Kapatıldı', not: g[x.kimlik] }), 'Kaydedildi.')}>Kapat</button></>}</div>}</div>)}</details>;
}

type GT = { kimlik: string; talep_no: string; kanal: string; konu: string; ad_soyad: string; e_posta: string | null; telefon: string | null; mesaj: string; dosya_no: string | null; durum: string; yonlenen_rol: string | null };
/** YG-1554: Gelen Talepler; konuya göre yönlendirilir, "Diğer" Müşteri ve Paydaş İlişkileri Müdürlüğünce birime yönlendirilir. */
export function GelenTalepler() {
  const [v, setV] = useState<{ roller: string[]; yonlendirir?: boolean; hasarKonulari?: string[]; talepler: GT[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/gelen-talepler').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  return <details className="ozet"><summary>Gelen Talepler · {v.talepler.filter((x) => x.durum === 'Yönlendirme bekliyor').length} yönlendirme bekliyor</summary>{m && <div className="not" role="status">{m}</div>}
    {v.talepler.length === 0 && <div className="not">Gelen talep bulunmamaktadır.</div>}
    {v.talepler.map((x) => <div className="soru" key={x.kimlik}><span><b>{x.talep_no}</b> · {x.kanal} · {x.konu} · {x.durum}{x.yonlenen_rol ? ` · ${x.yonlenen_rol}` : ''}<br /><small>{x.ad_soyad} · {x.e_posta ?? ''}{x.telefon ? ` · ${x.telefon}` : ''}{x.dosya_no ? ` · Dosya: ${x.dosya_no}` : ''} · {x.mesaj}</small></span>
      {!v.yonlendirir && v.hasarKonulari?.includes(x.konu) && x.yonlenen_rol !== 'Operasyon Müdürü' && <div className="tam"><button className="btn2 kucuk" onClick={() => void istek(`/gelen-talep/${x.kimlik}/operasyona-aktar`, {}).then(() => { setM('Talep Operasyon Müdürüne aktarıldı.'); return yk(); }).catch((e) => setM(e.message))}>Operasyona Aktar</button></div>}
      {v.yonlendirir && <div className="tam"><label htmlFor={`gt-${x.kimlik}`}>Yönlendirilecek Birim</label><select id={`gt-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.roller.map((r) => <option key={r}>{r}</option>)}</select>
        <button className="btn2 kucuk" disabled={!g[x.kimlik]} onClick={() => void istek(`/gelen-talep/${x.kimlik}/yonlendir`, { rol: g[x.kimlik] }).then(() => { setM('Talep yönlendirildi.'); return yk(); }).catch((e) => setM(e.message))}>{g[x.kimlik] ? `${g[x.kimlik]}na Gönder` : 'Gönder'}</button></div>}</div>)}</details>;
}
