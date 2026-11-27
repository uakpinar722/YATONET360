import { OnayaGonder } from './Dugme';
import { useEffect, useState } from 'react';
import { tarih } from './bicim';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type Yap = (f: () => Promise<any>) => Promise<void>;
const saat = (dk: number) => `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
const tl = (x: number | string) => `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
type Pers = { kimlik: string; ad_soyad: string; ise_giris_tarihi: string | null; personel_durumu: string | null; brut_aylik_tl: string | null; ek3_yil: number | null; ek3_serbest_zaman: boolean | null };

/** Personelin kendi puantaj, disiplin, ayrılış ve yurt dışı işlemleri. */
export function PersonelIslemlerim({ yap }: { yap: Yap }) {
  const [p, setP] = useState({ tarih: '', gunTuru: 'Çalışma', giris: '', cikis: '', nobetFiili: '' }); const [d, setD] = useState<{ kimlik: string; konu: string; kademe: string; savunma_son: string | null; savunma: string | null; karar: string | null; itiraz: string | null }[]>([]); const [m, setM] = useState<Record<string, string>>({}); const [a, setA] = useState<{ kimlik: string; benim: boolean; son_is_gunu: string; cihaz_beyan_zamani: string | null; gizlilik_okundu_zamani: string | null }[]>([]); const [cb, setCb] = useState(''); const [yd, setYd] = useState({ ulke: '', baslangic: '', bitis: '' });
  const yk = () => { void istek<typeof d>('/disiplin/benim').then(setD).catch(() => {}); void istek<typeof a>('/ayrilis').then((l) => setA(l.filter((x) => x.benim))).catch(() => {}); };
  useEffect(yk, []);
  return (<>
    <div className="bolum">Puantaj</div>
    <div className="iki-tarih"><div><label htmlFor="pu-t">Tarih</label><input required id="pu-t" type="date" value={p.tarih} onChange={(e) => setP({ ...p, tarih: e.target.value })} /></div><div><label htmlFor="pu-g">Gün Türü</label><select id="pu-g" value={p.gunTuru} onChange={(e) => setP({ ...p, gunTuru: e.target.value })}>{['Çalışma', 'Hafta tatili', 'Resmî tatil'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
    <div className="iki-tarih"><div><label htmlFor="pu-i">Giriş</label><input id="pu-i" type="time" value={p.giris} onChange={(e) => setP({ ...p, giris: e.target.value })} /></div><div><label htmlFor="pu-c">Çıkış</label><input id="pu-c" type="time" value={p.cikis} onChange={(e) => setP({ ...p, cikis: e.target.value })} /></div></div>
    <label htmlFor="pu-n">Nöbette Fiilî Çalışma (dakika)</label><input id="pu-n" inputMode="numeric" value={p.nobetFiili} onChange={(e) => setP({ ...p, nobetFiili: e.target.value })} />
    <button className="btn2" disabled={!p.tarih} onClick={() => void yap(() => istek<{ netDakika: number; fazlaDakika: number }>('/puantaj', { tarih: p.tarih, gunTuru: p.gunTuru, giris: p.giris || undefined, cikis: p.cikis || undefined, nobetFiili: Number(p.nobetFiili) || 0 }).then((r) => ({ uyari: `Kaydedildi: ${saat(r.netDakika)}${r.fazlaDakika ? `, fazla çalışma ${saat(r.fazlaDakika)}` : ''}.` })))}>Puantaj Kaydet</button>

    {d.length > 0 && <div className="bolum">Disiplin Kayıtlarım</div>}
    {d.map((x) => <div className="ozet" key={x.kimlik}><div>{x.kademe} · {x.konu}{x.karar ? ` · Karar: ${x.karar}` : ''}</div>
      {!x.karar && !x.savunma && x.savunma_son && <><label htmlFor={`sv-${x.kimlik}`}>Savunmanız (son tarih: {x.savunma_son})</label><textarea required id={`sv-${x.kimlik}`} value={m[x.kimlik] ?? ''} onChange={(e) => setM({ ...m, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!m[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/savunma`, { metin: m[x.kimlik] }).then(() => { yk(); return { uyari: 'Savunmanız alındı.' }; }))}>Savunmayı Gönder</button></>}
      {x.karar && !x.itiraz && x.kademe !== 'Sözlü Uyarı' && <><label htmlFor={`it-${x.kimlik}`}>İtiraz (5 iş günü)</label><input required id={`it-${x.kimlik}`} value={m[x.kimlik] ?? ''} onChange={(e) => setM({ ...m, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!m[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/itiraz`, { metin: m[x.kimlik] }).then(() => { yk(); return { uyari: 'İtirazınız alındı.' }; }))}>İtiraz Et</button></>}
    </div>)}

    {a.map((x) => <div className="ozet" key={x.kimlik}><div>Ayrılış · Son İş Günü: {x.son_is_gunu}</div>
      {!x.gizlilik_okundu_zamani && <button className="btn2" onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/beyan`, { gizlilik: true }).then(() => { yk(); return { uyari: 'Okundu onayınız kaydedildi.' }; }))}>Gizlilik Yükümlülüğünü Okudum</button>}
      {!x.cihaz_beyan_zamani && <><label htmlFor="cb-b">Cihaz İadesi Beyanı</label><input required id="cb-b" value={cb} onChange={(e) => setCb(e.target.value)} /><button className="btn2" disabled={!cb.trim()} onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/beyan`, { cihaz: cb }).then(() => { yk(); return { uyari: 'Beyanınız kaydedildi.' }; }))}>Beyan Et</button></>}
    </div>)}

    <div className="bolum">Yurt Dışı Görevlendirme</div>
    <label htmlFor="yd-u">Ülke</label><input required id="yd-u" value={yd.ulke} onChange={(e) => setYd({ ...yd, ulke: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="yd-b">Başlangıç</label><input required id="yd-b" type="date" value={yd.baslangic} onChange={(e) => setYd({ ...yd, baslangic: e.target.value })} /></div><div><label htmlFor="yd-s">Bitiş</label><input required id="yd-s" type="date" value={yd.bitis} onChange={(e) => setYd({ ...yd, bitis: e.target.value })} /></div></div>
    <OnayaGonder rol="Birim Amiriniz" className="btn2" disabled={!yd.ulke.trim() || !yd.baslangic || !yd.bitis} onClick={() => void yap(() => istek('/yurtdisi-gorev', yd).then(() => ({ uyari: 'Görevlendirme onaya gönderildi.' })))}>Onaya Gönder</OnayaGonder>
  </>);
}

/** İnsan Kaynakları: personel kartı, eğitim, puantaj özeti, disiplin, ayrılış, iş kazası. */
/** YG-1615: bakiye kontrolü bekleyen izinler; karar Bugün sayfasındaki İzin Talebi kartından verilir. */
function IzinKontrol() {
  const [l, setL] = useState<{ kimlik: string; ad_soyad: string; izin_turu: string; baslangic: string; bitis: string; gun: number; kalan_gun: number; kalan_bakiye: number | null }[] | null>(null);
  useEffect(() => { void istek<NonNullable<typeof l>>('/ik/izin-kontrol').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  const tr = (d: string) => d.slice(0, 10).split('-').reverse().join('.');
  return <><div className="bolum">Bakiye Kontrolü Bekleyen İzinler</div>
    {l.length === 0 ? <div className="ozet bos">Bakiye kontrolü bekleyen izin talebi bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik} className="ozet kart-sol"><div className="ust2"><b>{x.ad_soyad} · {x.izin_turu} · {x.gun} Gün</b><em className={`rozet ${x.kalan_gun <= 2 ? 'kirmizi' : x.kalan_gun <= 7 ? 'sari' : 'gri'}`}>{x.kalan_gun < 0 ? 'Başladı' : `Başlangıca ${x.kalan_gun} Gün`}</em></div>
      <div className="not">{tr(x.baslangic)} – {tr(x.bitis)}{x.kalan_bakiye !== null ? ` · Kalan Bakiye: ${x.kalan_bakiye} gün${x.kalan_bakiye >= x.gun ? ' · İzin Bakiyesi Yeterli' : ' · Bakiye Yetersiz'}` : ''}</div></div>)}</>;
}

/** YG-1615: Personel ve Akademi; sertifika geçerlilikleri, zorunlu ders tamamlama, özel gün rıza durumu. */
function PersonelAkademi() {
  const [v, setV] = useState<{ sertifika: { ad_soyad: string; tur: string; ad: string; bitis: string; dolmus: boolean }[]; personel: { ad_soyad: string; personel_durumu: string; zorunlu: number; tamamlanan: number; dogum_rizasi: boolean; ise_giris_rizasi: boolean; evlilik_rizasi: boolean }[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/ik/personel-akademi').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const e = (b: boolean) => (b ? 'Var' : 'Yok');
  return <details><summary>Personel ve Akademi ({v.sertifika.length} sertifika uyarısı)</summary>
    <div className="bolum">Sertifika Takibi (Dolmuş veya 60 Gün İçinde Dolacak)</div>
    {v.sertifika.length === 0 ? <div className="ozet bos">Süresi dolan veya dolmak üzere olan sertifika bulunmamaktadır.</div> : v.sertifika.map((x, n) => <div key={n} className={x.dolmus ? 'hata' : 'uyari'}>{x.ad_soyad} · {x.tur} · {x.ad} · {x.dolmus ? 'Süresi doldu' : 'Süresi doluyor'} ({tarih(x.bitis)})</div>)}
    <div className="bolum">Akademi ve Özel Gün Rızaları</div>
    {v.personel.map((x, n) => <div key={n} className="soru"><span>{x.ad_soyad} · {x.personel_durumu} · Zorunlu eğitim {x.tamamlanan}/{x.zorunlu} · Doğum günü rızası {e(x.dogum_rizasi)} · İşe giriş yıl dönümü rızası {e(x.ise_giris_rizasi)} · Evlilik yıl dönümü rızası {e(x.evlilik_rizasi)}</span></div>)}
  </details>;
}

/** YG-1616: yıllık eğitim planı; gerçekleşme hedef rollerdeki personelin tamamlama oranıdır. */
function EgitimPlani() {
  type P = { kimlik: string; egitim_adi: string; hedef_roller: string[]; planlanan_ay: number; ders: string | null; hedef: number; tamamlayan: number; oran: number | null };
  const [yil, setYil] = useState(new Date().getFullYear()); const [v, setV] = useState<{ planlar: P[]; dersler: { kimlik: string; ad: string }[]; duzenler: boolean } | null>(null);
  const [f, setF] = useState({ ders: '', ad: '', roller: '', ay: '1', aciklama: '' }); const [m, setM] = useState('');
  const yk = (y = yil) => istek<NonNullable<typeof v>>(`/ik/egitim-plani?yil=${y}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const ekle = () => void istek('/ik/egitim-plani', { yil, ders: f.ders || undefined, ad: f.ad || undefined, roller: f.roller.split(',').map((x) => x.trim()).filter(Boolean), ay: Number(f.ay), aciklama: f.aciklama || undefined }).then(() => { setM('Plan satırı kaydedildi.'); setF({ ders: '', ad: '', roller: '', ay: '1', aciklama: '' }); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Yıllık Eğitim Planı · {yil}</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="ep-y">Plan Yılı</label><input id="ep-y" inputMode="numeric" value={yil} onChange={(e) => { const y = Number(e.target.value) || yil; setYil(y); if (String(y).length === 4) void yk(y); }} />
    {v.planlar.length === 0 ? <div className="ozet bos">Bu yıl için plan satırı bulunmamaktadır.</div> : v.planlar.map((x) => <div key={x.kimlik} className="soru"><span>{AY[x.planlanan_ay - 1]} · {x.egitim_adi}{x.ders ? ' (Akademi)' : ''} · {x.hedef_roller.length ? x.hedef_roller.join(', ') : 'Tüm LGM personeli'} · Gerçekleşme: {x.oran === null ? 'Hedef personel yok' : `%${String(x.oran).replace('.', ',')} (${x.tamamlayan}/${x.hedef})`}</span></div>)}
    {v.duzenler && <div className="ozet">
      <label htmlFor="ep-d">Akademi Dersi</label><select id="ep-d" value={f.ders} onChange={(e) => setF({ ...f, ders: e.target.value })}><option value="">Ders bağı yok</option>{v.dersler.map((d) => <option key={d.kimlik} value={d.kimlik}>{d.ad}</option>)}</select>
      <label htmlFor="ep-a">Eğitim Adı</label><input id="ep-a" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} />
      <label htmlFor="ep-r">Hedef Roller (virgülle; boşsa tüm personel)</label><input id="ep-r" value={f.roller} onChange={(e) => setF({ ...f, roller: e.target.value })} />
      <label htmlFor="ep-m">Planlanan Ay</label><select id="ep-m" value={f.ay} onChange={(e) => setF({ ...f, ay: e.target.value })}>{AY.map((a, n) => <option key={a} value={n + 1}>{a}</option>)}</select>
      <label htmlFor="ep-c">Açıklama</label><input id="ep-c" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <button className="btn2" disabled={!f.ders && !f.ad.trim()} onClick={ekle}>Plana Ekle</button>
    </div>}
  </details>;
}

/** YG-1616: personel yan hakları (tutar tutulmaz). */
function YanHaklar({ l }: { l: Pers[] }) {
  const [v, setV] = useState<{ kimlik: string; ad_soyad: string; tur: string; aciklama: string | null; baslangic: string; bitis: string | null }[] | null>(null);
  const [f, setF] = useState({ personel: '', tur: '', aciklama: '', baslangic: '', bitis: '' }); const [bt, setBt] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/ik/yan-hak').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>Yan Haklar ({v.filter((x) => !x.bitis).length} süren)</summary>{m && <div className="not" role="status">{m}</div>}
    {v.map((x) => <div key={x.kimlik} className="soru"><span>{x.ad_soyad} · {x.tur}{x.aciklama ? ` · ${x.aciklama}` : ''} · {tarih(x.baslangic)}{x.bitis ? ` – ${tarih(x.bitis)}` : ' · Sürüyor'}</span>
      {!x.bitis && <div className="tam"><label htmlFor={`yh-b-${x.kimlik}`}>Bitiş</label><input id={`yh-b-${x.kimlik}`} type="date" value={bt[x.kimlik] ?? ''} onChange={(e) => setBt({ ...bt, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!bt[x.kimlik]} onClick={() => is(istek(`/ik/yan-hak/${x.kimlik}/sonlandir`, { bitis: bt[x.kimlik] }), 'Yan hak sonlandırıldı.')}>Sonlandır</button></div>}</div>)}
    <div className="ozet">
      <label htmlFor="yh-p">Personel</label><select id="yh-p" value={f.personel} onChange={(e) => setF({ ...f, personel: e.target.value })}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
      <label htmlFor="yh-t">Yan Hak Türü</label><input id="yh-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })} />
      <label htmlFor="yh-a">Açıklama</label><input id="yh-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      <div className="iki-tarih"><div><label htmlFor="yh-s">Başlangıç</label><input id="yh-s" type="date" value={f.baslangic} onChange={(e) => setF({ ...f, baslangic: e.target.value })} /></div><div><label htmlFor="yh-e">Bitiş</label><input id="yh-e" type="date" value={f.bitis} onChange={(e) => setF({ ...f, bitis: e.target.value })} /></div></div>
      <button className="btn2" disabled={!f.personel || !f.tur.trim() || !f.baslangic} onClick={() => is(istek('/ik/yan-hak', { ...f, aciklama: f.aciklama || undefined, bitis: f.bitis || undefined }), 'Yan hak kaydedildi.')}>Yan Hakkı Kaydet</button>
    </div>
  </details>;
}

export function IkYonetimi({ yap }: { yap: Yap }) {
  const [yt, setYt] = useState<{ ik: boolean; isg: boolean; tid: boolean } | null>(null); const [l, setL] = useState<Pers[]>([]); const [k, setK] = useState({ kisi: '', iseGiris: '', brut: '', ek3Yil: '', ek3Serbest: false, vize: '', pasaport: '', dogum: '' }); const [eg, setEg] = useState({ personel: '', tur: 'İSG', ad: '', saat: '', tesis: '', tamamlanma: '', gecerlilik: '' }); const [ay, setAy] = useState(''); const [oz, setOz] = useState<{ kimlik: string; ad_soyad: string; net: number; fazla: number; izin: number; devamsizlik: number; serbestDakika: number; fazlaUcretTl: number }[]>([]); const [ds, setDs] = useState({ personel: '', olayTarihi: '', konu: '', kademe: 'Yazılı Uyarı', savunmaSon: '' }); const [dl, setDl] = useState<{ kimlik: string; ad_soyad: string; konu: string; kademe: string; savunma: string | null; karar: string | null; savunma_son: string | null }[]>([]); const [kr, setKr] = useState<Record<string, string>>({}); const [ay2, setAy2] = useState({ personel: '', tur: 'İşveren Feshi', bildirim: '', son: '', dilekce: '' }); const [al, setAl] = useState<{ kimlik: string; personel_ref: string; ad_soyad: string; tur: string; son_is_gunu: string; odeme_durumu: string; durum: string }[]>([]); const [dt, setDt] = useState<Record<string, { net?: { kidem: { damga: number; net: number } | null; ihbar: { damga: number; netDamgaSonrasi: number } } | null; devir: { kimlik: string; tur: string; aciklama: string; durum: string }[]; engel: string | null; ihbar?: { hafta: number; tutar: number; odeyen: string | null }; kidem?: number | null; uyari?: string | null }>>({}); const [dv, setDv] = useState<Record<string, string>>({}); const [par, setPar] = useState(''); const [kz, setKz] = useState<{ olay_ref: string; isveren: string; ticari_unvan: string | null; son_zaman: string; bilgi_gonderme_zamani: string | null; ozet: string }[]>([]); const [sg, setSg] = useState(''); const [dg, setDg] = useState('');
  const yk = (r: { ik: boolean; isg: boolean }) => {
    if (r.ik) { void istek<Pers[]>('/ik/personel').then(setL).catch(() => {}); void istek<typeof dl>('/disiplin').then(setDl).catch(() => {}); void istek<typeof al>('/ayrilis').then(setAl).catch(() => {}); }
    if (r.ik || r.isg) void istek<typeof kz>('/is-kazasi').then(setKz).catch(() => {});
  };
  useEffect(() => { void istek<NonNullable<typeof yt>>('/ik/yetki').then((r) => { setYt(r); yk(r); }).catch(() => {}); }, []);
  if (!yt || (!yt.ik && !yt.isg && !yt.tid)) return null;
  const secici = (id: string, v: string, f: (x: string) => void) => <select id={id} value={v} onChange={(e) => f(e.target.value)}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>;
  const ayrilisAc = (id: string) => void istek<(typeof dt)[string]>(`/ayrilis/${id}`).then((r) => setDt({ ...dt, [id]: r }));
  return (<>
    {yt.tid && <><div className="bolum">Günlük Harcırah</div><label htmlFor="hr-t">Günlük Tutar (EUR)</label><input required id="hr-t" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} /><button className="btn2" disabled={!par} onClick={() => void yap(() => istek('/ik/parametre', { kod: 'harcirah_gunluk_eur', deger: Number(par.replace(',', '.')) }).then(() => ({ uyari: 'Tutar kaydedildi.' })))}>Kaydet</button></>}
    {yt.ik && <>
      <IzinKontrol />
      <PersonelAkademi />
      <EgitimPlani />
      <YanHaklar l={l} />
      <div className="bolum">Personel Kartı</div>
      <label htmlFor="pk-k">Personel</label>{secici('pk-k', k.kisi, (x) => { const s = l.find((y) => y.kimlik === x); setK({ kisi: x, iseGiris: s?.ise_giris_tarihi ?? '', brut: s?.brut_aylik_tl ?? '', ek3Yil: s?.ek3_yil ? String(s.ek3_yil) : '', ek3Serbest: Boolean(s?.ek3_serbest_zaman), vize: '', pasaport: '', dogum: '' }); })}
      <div className="iki-tarih"><div><label htmlFor="pk-g">İşe Giriş</label><input required id="pk-g" type="date" value={k.iseGiris} onChange={(e) => setK({ ...k, iseGiris: e.target.value })} /></div><div><label htmlFor="pk-b">Brüt Aylık (TL)</label><input id="pk-b" inputMode="decimal" value={k.brut} onChange={(e) => setK({ ...k, brut: e.target.value })} /></div></div>
      <label htmlFor="pk-e">Ek-3 Onay Yılı</label><input id="pk-e" inputMode="numeric" value={k.ek3Yil} onChange={(e) => setK({ ...k, ek3Yil: e.target.value })} />
      <label className="kutu"><input type="checkbox" checked={k.ek3Serbest} onChange={(e) => setK({ ...k, ek3Serbest: e.target.checked })} /><span>Fazla Çalışma Karşılığı Serbest Zaman</span></label>
      <div className="iki-tarih"><div><label htmlFor="pk-vz">Vize Bitişi</label><input id="pk-vz" type="date" value={k.vize} onChange={(e) => setK({ ...k, vize: e.target.value })} /></div><div><label htmlFor="pk-ps">Pasaport Bitişi</label><input id="pk-ps" type="date" value={k.pasaport} onChange={(e) => setK({ ...k, pasaport: e.target.value })} /></div></div>
      <label htmlFor="pk-dt">Doğum Tarihi (yıllık izin yaş kuralı için)</label><input id="pk-dt" type="date" value={k.dogum} onChange={(e) => setK({ ...k, dogum: e.target.value })} />
      <button className="btn2" disabled={!k.kisi || !k.iseGiris} onClick={() => void yap(() => istek(`/ik/personel/${k.kisi}`, { iseGiris: k.iseGiris, dogumTarihi: k.dogum || undefined, vizeBitis: k.vize || undefined, pasaportBitis: k.pasaport || undefined, brut: k.brut ? Number(k.brut.replace(',', '.')) : undefined, ek3Yil: Number(k.ek3Yil) || undefined, ek3Serbest: k.ek3Serbest }).then(() => { yk(yt); return { uyari: 'Personel kartı kaydedildi.' }; }))}>Kartı Kaydet</button>
      <label htmlFor="kt-d">Damga Vergisi Oranı (binde, İnsan Kaynakları Müdürü)</label><input required id="kt-d" inputMode="decimal" value={dg} onChange={(e) => setDg(e.target.value)} /><button className="btn2" disabled={!dg} onClick={() => void yap(() => istek('/ik/parametre', { kod: 'damga_vergisi_binde', deger: Number(dg.replace(',', '.')) }).then(() => ({ uyari: 'Oran kaydedildi.' })))}>Oranı Kaydet</button>
      <label htmlFor="kt-t">Kıdem Tavanı (TL, İnsan Kaynakları Müdürü)</label><input required id="kt-t" inputMode="decimal" value={sg} onChange={(e) => setSg(e.target.value)} /><button className="btn2" disabled={!sg} onClick={() => void yap(() => istek('/ik/parametre', { kod: 'kidem_tavani_tl', deger: Number(sg.replace(',', '.')) }).then(() => ({ uyari: 'Tavan kaydedildi.' })))}>Tavanı Kaydet</button>

      <div className="bolum">Puantaj Özeti</div>
      <label htmlFor="po-a">Ay (YYYY-AA)</label><input required id="po-a" value={ay} onChange={(e) => setAy(e.target.value)} />
      <div className="dugmeler"><button className="btn2" disabled={!ay} onClick={() => void yap(() => istek<typeof oz>(`/puantaj/ozet?ay=${ay}`).then(setOz))}>Getir</button><button className="btn2" disabled={!ay} onClick={() => void yap(() => istek<{ adet: number }>('/puantaj/bordro', { ay }).then((r) => ({ uyari: `${r.adet} kayıt bordroya aktarıldı.` })))}>Bordroya Aktar</button></div>
      {oz.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {saat(x.net)} · Fazla: {saat(x.fazla)} · İzin: {x.izin} · Devamsızlık: {x.devamsizlik}{x.serbestDakika ? ` · Serbest Zaman: ${saat(x.serbestDakika)}` : ''}{x.fazlaUcretTl ? ` · Fazla Ücret: ${tl(x.fazlaUcretTl)}` : ''}</span></div>)}
    </>}
    <div className="bolum">Eğitim Kaydı</div>
    {!yt.ik && <input required aria-label="Personel Kimliği" value={eg.personel} onChange={(e) => setEg({ ...eg, personel: e.target.value })} />}
    {yt.ik && <><label htmlFor="eg-p">Personel</label>{secici('eg-p', eg.personel, (x) => setEg({ ...eg, personel: x }))}</>}
    <label htmlFor="eg-t">Tür</label><select id="eg-t" value={eg.tur} onChange={(e) => setEg({ ...eg, tur: e.target.value })}>{['İSG', 'Tesis Oryantasyonu', 'Mesleki Belge', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="eg-a">Ad</label><input required id="eg-a" value={eg.ad} onChange={(e) => setEg({ ...eg, ad: e.target.value })} />
    {eg.tur === 'İSG' && <><label htmlFor="eg-s">Süre (saat)</label><input id="eg-s" inputMode="numeric" value={eg.saat} onChange={(e) => setEg({ ...eg, saat: e.target.value })} /></>}
    {eg.tur === 'Tesis Oryantasyonu' && <><label htmlFor="eg-z">Tesis</label><input id="eg-z" value={eg.tesis} onChange={(e) => setEg({ ...eg, tesis: e.target.value })} /></>}
    <div className="iki-tarih"><div><label htmlFor="eg-b">Tamamlanma</label><input required id="eg-b" type="date" value={eg.tamamlanma} onChange={(e) => setEg({ ...eg, tamamlanma: e.target.value })} /></div>{eg.tur !== 'İSG' && <div><label htmlFor="eg-g">Geçerlilik Sonu</label><input id="eg-g" type="date" value={eg.gecerlilik} onChange={(e) => setEg({ ...eg, gecerlilik: e.target.value })} /></div>}</div>
    <button className="btn2" disabled={!eg.personel || !eg.ad.trim() || !eg.tamamlanma} onClick={() => void yap(() => istek('/ik/egitim', { ...eg, saat: eg.saat ? Number(eg.saat) : undefined, gecerlilik: eg.gecerlilik || undefined }).then(() => ({ uyari: 'Eğitim kaydedildi.' })))}>Eğitimi Kaydet</button>

    {yt.ik && <>
      <div className="bolum">Disiplin</div>
      <label htmlFor="ds-p">Personel</label>{secici('ds-p', ds.personel, (x) => setDs({ ...ds, personel: x }))}
      <label htmlFor="ds-k">Kademe</label><select id="ds-k" value={ds.kademe} onChange={(e) => setDs({ ...ds, kademe: e.target.value })}>{['Sözlü Uyarı', 'Yazılı Uyarı', 'Ücret Kesme', 'Fesih'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ds-z">Konu</label><input required id="ds-z" value={ds.konu} onChange={(e) => setDs({ ...ds, konu: e.target.value })} />
      <div className="iki-tarih"><div><label htmlFor="ds-o">Olay Tarihi</label><input required id="ds-o" type="date" value={ds.olayTarihi} onChange={(e) => setDs({ ...ds, olayTarihi: e.target.value })} /></div>{ds.kademe !== 'Sözlü Uyarı' && <div><label htmlFor="ds-s">Savunma Son Tarihi</label><input id="ds-s" type="date" value={ds.savunmaSon} onChange={(e) => setDs({ ...ds, savunmaSon: e.target.value })} /></div>}</div>
      <button className="btn2" disabled={!ds.personel || !ds.konu.trim() || !ds.olayTarihi} onClick={() => void yap(() => istek('/disiplin', { ...ds, savunmaSon: ds.savunmaSon || undefined }).then(() => { yk(yt); return { uyari: 'Disiplin kaydı açıldı.' }; }))}>Kaydı Aç</button>
      {dl.filter((x) => !x.karar).map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.kademe} · {x.konu} · {x.savunma ? 'Savunma Alındı' : `Savunma Bekleniyor (${x.savunma_son ?? ''})`}</span><div className="tam"><label htmlFor={`dk-${x.kimlik}`}>Karar</label><input required id={`dk-${x.kimlik}`} value={kr[x.kimlik] ?? ''} onChange={(e) => setKr({ ...kr, [x.kimlik]: e.target.value })} />{x.kademe === 'Ücret Kesme' && <><label htmlFor={`dg-${x.kimlik}`}>Kesinti (gündelik)</label><input id={`dg-${x.kimlik}`} inputMode="decimal" value={kr[`${x.kimlik}g`] ?? ''} onChange={(e) => setKr({ ...kr, [`${x.kimlik}g`]: e.target.value })} /></>}<button className="btn2 kucuk" disabled={!kr[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/karar`, { karar: kr[x.kimlik], gundelik: kr[`${x.kimlik}g`] ? Number(kr[`${x.kimlik}g`]!.replace(',', '.')) : undefined }).then(() => { yk(yt); return { uyari: 'Karar kaydedildi.' }; }))}>Kararı Kaydet</button></div></div>)}

      <div className="bolum">Ayrılış</div>
      <label htmlFor="ay-p">Personel</label>{secici('ay-p', ay2.personel, (x) => setAy2({ ...ay2, personel: x }))}
      <label htmlFor="ay-t">Ayrılış Türü</label><select id="ay-t" value={ay2.tur} onChange={(e) => setAy2({ ...ay2, tur: e.target.value })}>{['İşveren Feshi', 'İstifa', 'Haklı Fesih (25/II)', 'Emeklilik', 'Askerlik', 'Evlilik', 'Ölüm', 'Mutabakat'].map((x) => <option key={x}>{x}</option>)}</select>
      <div className="iki-tarih"><div><label htmlFor="ay-b">Bildirim Tarihi</label><input required id="ay-b" type="date" value={ay2.bildirim} onChange={(e) => setAy2({ ...ay2, bildirim: e.target.value })} /></div><div><label htmlFor="ay-s">Son İş Günü</label><input required id="ay-s" type="date" value={ay2.son} onChange={(e) => setAy2({ ...ay2, son: e.target.value })} /></div></div>
      {ay2.tur === 'İstifa' && ay2.personel && <BelgeSec ad="İmzalı İstifa Dilekçesi" bagTuru="Personel" bagKimligi={ay2.personel} deger={ay2.dilekce} sec={(x: string) => setAy2({ ...ay2, dilekce: x })} />}
      <button className="btn2" disabled={!ay2.personel || !ay2.bildirim || !ay2.son} onClick={() => void yap(() => istek('/ayrilis', { personel: ay2.personel, tur: ay2.tur, bildirim: ay2.bildirim, son: ay2.son, dilekce: ay2.dilekce || undefined }).then(() => { yk(yt); return { uyari: 'Ayrılış başlatıldı, devir listesi çıkarıldı.' }; }))}>Ayrılışı Başlat</button>
      {al.filter((x) => x.durum === 'Kapandı').map((x) => <div className="soru" key={`cb-${x.kimlik}`}><span>{x.ad_soyad} · Ayrıldı · {x.son_is_gunu}</span><a className="btn2 kucuk" href={`/api/personel/${x.personel_ref}/calisma-belgesi.pdf`} target="_blank" rel="noreferrer">Çalışma Belgesi</a></div>)}
      {al.filter((x) => x.durum === 'Açık').map((x) => { const v = dt[x.kimlik]; return <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.tur} · Son İş Günü: {x.son_is_gunu} · {x.odeme_durumu}</span><div className="tam"><button className="btn2 kucuk" onClick={() => ayrilisAc(x.kimlik)}>Ayrıntı</button>
        {v && <>{v.ihbar && <div>Bildirim Süresi: {v.ihbar.hafta} hafta{v.ihbar.tutar ? ` · İhbar: ${tl(v.ihbar.tutar)} (${v.ihbar.odeyen} öder)` : ''}{v.kidem != null ? ` · Kıdem: ${tl(v.kidem)}` : ''}</div>}{v.net && <div>Net (damga sonrası): {v.net.kidem ? `Kıdem ${tl(v.net.kidem.net)} (damga ${tl(v.net.kidem.damga)})` : ''}{v.net.ihbar.netDamgaSonrasi ? ` · İhbar ${tl(v.net.ihbar.netDamgaSonrasi)}; gelir vergisi bordroda` : ''}</div>}{v.uyari && <div className="hata">⚠ {v.uyari}</div>}{v.engel && <div className="hata">⚠ {v.engel}</div>}
          {v.devir.map((d) => <div key={d.kimlik}>{d.tur} · {d.aciklama} · {d.durum}{/* YG-986 */ d.durum === 'Devralan Kabulünde' ? ' (devralanın kabulü bekleniyor)' : ''}{d.durum === 'Bekliyor' && <>{secici(`dv-${d.kimlik}`, dv[d.kimlik] ?? '', (z) => setDv({ ...dv, [d.kimlik]: z }))}<button className="btn2 kucuk" disabled={!dv[d.kimlik]} onClick={() => void yap(() => istek(`/ayrilis-devir/${d.kimlik}`, { devralan: dv[d.kimlik] }).then(() => { ayrilisAc(x.kimlik); return { uyari: 'Devredildi.' }; }))}>Devret</button></>}</div>)}
          <input aria-label="Derhal Kapatma Gerekçesi" value={dv[`r${x.kimlik}`] ?? ''} onChange={(e) => setDv({ ...dv, [`r${x.kimlik}`]: e.target.value })} /><button className="btn hayir" disabled={!dv[`r${x.kimlik}`]?.trim()} onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/derhal-kapat`, { gerekce: dv[`r${x.kimlik}`] }).then(() => ({ uyari: 'Hesap kapatıldı.' })))}>Riskli Ayrılış: Hesabı Derhal Kapat</button>
          <button className="btn2 kucuk" disabled={Boolean(v.engel) || x.odeme_durumu !== 'Bekliyor'} onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/tazminat`, {}).then(() => { yk(yt); return { uyari: 'Tazminat onaya gönderildi.' }; }))}>Tazminat Onayına Gönder</button></>}</div></div>; })}
    </>}

    {kz.length > 0 && <div className="bolum">İş Kazası Bildirimleri</div>}
    {kz.map((x) => <div className="soru" key={x.olay_ref}><span>{x.ozet} · İşveren: {x.ticari_unvan ?? x.isveren} · Son: {tarih(x.son_zaman)}</span><div className="dugmeler">
      {yt.isg && x.isveren === 'LGM' && !x.bilgi_gonderme_zamani && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/bilgi-gonder`, {}).then(() => { yk(yt); return { uyari: 'Olay bilgisi gönderildi.' }; }))}>Olay Bilgisini Gönder</button>}
      {yt.isg && x.isveren !== 'LGM' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/belge-iste`, {}).then(() => ({ uyari: 'Belge istendi.' })))}>Belge İste</button>}
      {yt.ik && x.isveren === 'LGM' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/sgk`, { tarih: new Date().toISOString().slice(0, 10) }).then(() => { yk(yt); return { uyari: 'SGK bildirimi kaydedildi.' }; }))}>SGK Bildirimi Yapıldı</button>}
    </div></div>)}
    <IsgKayitlari yap={yap} />
  </>);
}

/** YG-1670: sağlık gözetimi (yalnız muayene tarihi ve sonuç) ve OSGB yazışma kaydı. İK yalnız sonuçları görür. */
function IsgKayitlari({ yap }: { yap: Yap }) {
  const [v, setV] = useState<{ isg: boolean; personel: { kimlik: string; ad_soyad: string }[]; gozetim: { kimlik: string; ad_soyad: string; muayene_tarihi: string; sonuc: string; sonraki_muayene: string | null }[]; osgb: { kimlik: string; yon: string; konu: string; tarih: string }[] } | null>(null);
  const [sg, setSg] = useState({ personel: '', tarih: '', sonuc: '', sonraki: '' }); const [os, setOs] = useState({ yon: "OSGB'den Gelen", konu: '', tarih: '' });
  const yk = () => istek<NonNullable<typeof v>>('/isg/kayitlar').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const tr = (x: string) => x.split('-').reverse().join('.');
  return <>
    <div className="bolum">Sağlık Gözetimi</div>
    <div className="not">Yalnız muayene tarihi ve sonuç kaydedilir; tanı veya sağlık bilgisi yazılmaz.</div>
    {v.gozetim.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {tr(x.muayene_tarihi)} · {x.sonuc}{x.sonraki_muayene ? ` · Sonraki: ${tr(x.sonraki_muayene)}` : ''}</span></div>)}
    {v.isg && <>
      <label htmlFor="sg-p">Personel</label><select required id="sg-p" value={sg.personel} onChange={(e) => setSg({ ...sg, personel: e.target.value })}><option value="">Seçiniz</option>{v.personel.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>
      <div className="iki-tarih"><div><label htmlFor="sg-t">Muayene Tarihi</label><input required id="sg-t" type="date" value={sg.tarih} onChange={(e) => setSg({ ...sg, tarih: e.target.value })} /></div><div><label htmlFor="sg-s">Sonraki Muayene</label><input id="sg-s" type="date" value={sg.sonraki} onChange={(e) => setSg({ ...sg, sonraki: e.target.value })} /></div></div>
      <label htmlFor="sg-r">Sonuç</label><select required id="sg-r" value={sg.sonuc} onChange={(e) => setSg({ ...sg, sonuc: e.target.value })}><option value="">Seçiniz</option><option>Çalışmaya Uygun</option><option>Çalışmaya Uygun Değil</option></select>
      <button className="btn2" disabled={!sg.personel || !sg.tarih || !sg.sonuc} onClick={() => void yap(() => istek('/isg/saglik-gozetimi', { ...sg, sonraki: sg.sonraki || undefined }).then(() => { setSg({ personel: '', tarih: '', sonuc: '', sonraki: '' }); void yk(); return { uyari: 'Sağlık gözetimi kaydedildi.' }; }))}>Kaydet</button>
      <div className="bolum">OSGB Yazışmaları</div>
      {v.osgb.map((x) => <div className="soru" key={x.kimlik}><span>{tr(x.tarih)} · {x.yon} · {x.konu}</span></div>)}
      <label htmlFor="os-y">Yön</label><select id="os-y" value={os.yon} onChange={(e) => setOs({ ...os, yon: e.target.value })}><option>OSGB'den Gelen</option><option>OSGB'ye İletilen</option></select>
      <label htmlFor="os-k">Konu</label><input required id="os-k" value={os.konu} onChange={(e) => setOs({ ...os, konu: e.target.value })} />
      <label htmlFor="os-t">Tarih</label><input required id="os-t" type="date" value={os.tarih} onChange={(e) => setOs({ ...os, tarih: e.target.value })} />
      <button className="btn2" disabled={!os.konu.trim() || !os.tarih} onClick={() => void yap(() => istek('/isg/osgb', os).then(() => { setOs({ ...os, konu: '', tarih: '' }); void yk(); return { uyari: 'OSGB yazışması kaydedildi.' }; }))}>Kaydet</button>
    </>}
  </>;
}
