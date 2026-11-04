import { useEffect, useState } from 'react';
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
    <div className="iki-tarih"><div><label htmlFor="pu-t">Tarih</label><input id="pu-t" type="date" value={p.tarih} onChange={(e) => setP({ ...p, tarih: e.target.value })} /></div><div><label htmlFor="pu-g">Gün Türü</label><select id="pu-g" value={p.gunTuru} onChange={(e) => setP({ ...p, gunTuru: e.target.value })}>{['Çalışma', 'Hafta tatili', 'Resmî tatil'].map((x) => <option key={x}>{x}</option>)}</select></div></div>
    <div className="iki-tarih"><div><label htmlFor="pu-i">Giriş</label><input id="pu-i" type="time" value={p.giris} onChange={(e) => setP({ ...p, giris: e.target.value })} /></div><div><label htmlFor="pu-c">Çıkış</label><input id="pu-c" type="time" value={p.cikis} onChange={(e) => setP({ ...p, cikis: e.target.value })} /></div></div>
    <label htmlFor="pu-n">Nöbette Fiilî Çalışma (dakika)</label><input id="pu-n" inputMode="numeric" value={p.nobetFiili} onChange={(e) => setP({ ...p, nobetFiili: e.target.value })} />
    <button className="btn2" disabled={!p.tarih} onClick={() => void yap(() => istek<{ netDakika: number; fazlaDakika: number }>('/puantaj', { tarih: p.tarih, gunTuru: p.gunTuru, giris: p.giris || undefined, cikis: p.cikis || undefined, nobetFiili: Number(p.nobetFiili) || 0 }).then((r) => ({ uyari: `Kaydedildi: ${saat(r.netDakika)}${r.fazlaDakika ? `, fazla çalışma ${saat(r.fazlaDakika)}` : ''}.` })))}>Puantaj Kaydet</button>

    {d.length > 0 && <div className="bolum">Disiplin Kayıtlarım</div>}
    {d.map((x) => <div className="ozet" key={x.kimlik}><div>{x.kademe} · {x.konu}{x.karar ? ` · Karar: ${x.karar}` : ''}</div>
      {!x.karar && !x.savunma && x.savunma_son && <><label htmlFor={`sv-${x.kimlik}`}>Savunmanız (son tarih: {x.savunma_son})</label><textarea id={`sv-${x.kimlik}`} value={m[x.kimlik] ?? ''} onChange={(e) => setM({ ...m, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!m[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/savunma`, { metin: m[x.kimlik] }).then(() => { yk(); return { uyari: 'Savunmanız alındı.' }; }))}>Savunmayı Gönder</button></>}
      {x.karar && !x.itiraz && x.kademe !== 'Sözlü Uyarı' && <><label htmlFor={`it-${x.kimlik}`}>İtiraz (5 iş günü)</label><input id={`it-${x.kimlik}`} value={m[x.kimlik] ?? ''} onChange={(e) => setM({ ...m, [x.kimlik]: e.target.value })} /><button className="btn2" disabled={!m[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/itiraz`, { metin: m[x.kimlik] }).then(() => { yk(); return { uyari: 'İtirazınız alındı.' }; }))}>İtiraz Et</button></>}
    </div>)}

    {a.map((x) => <div className="ozet" key={x.kimlik}><div>Ayrılış · Son İş Günü: {x.son_is_gunu}</div>
      {!x.gizlilik_okundu_zamani && <button className="btn2" onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/beyan`, { gizlilik: true }).then(() => { yk(); return { uyari: 'Okundu onayınız kaydedildi.' }; }))}>Gizlilik Yükümlülüğünü Okudum</button>}
      {!x.cihaz_beyan_zamani && <><label htmlFor="cb-b">Cihaz İadesi Beyanı</label><input id="cb-b" value={cb} onChange={(e) => setCb(e.target.value)} /><button className="btn2" disabled={!cb.trim()} onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/beyan`, { cihaz: cb }).then(() => { yk(); return { uyari: 'Beyanınız kaydedildi.' }; }))}>Beyan Et</button></>}
    </div>)}

    <div className="bolum">Yurt Dışı Görevlendirme</div>
    <label htmlFor="yd-u">Ülke</label><input id="yd-u" value={yd.ulke} onChange={(e) => setYd({ ...yd, ulke: e.target.value })} />
    <div className="iki-tarih"><div><label htmlFor="yd-b">Başlangıç</label><input id="yd-b" type="date" value={yd.baslangic} onChange={(e) => setYd({ ...yd, baslangic: e.target.value })} /></div><div><label htmlFor="yd-s">Bitiş</label><input id="yd-s" type="date" value={yd.bitis} onChange={(e) => setYd({ ...yd, bitis: e.target.value })} /></div></div>
    <button className="btn2" disabled={!yd.ulke.trim() || !yd.baslangic || !yd.bitis} onClick={() => void yap(() => istek('/yurtdisi-gorev', yd).then(() => ({ uyari: 'Görevlendirme onaya gönderildi.' })))}>Onaya Gönder</button>
  </>);
}

/** İnsan Kaynakları: personel kartı, eğitim, puantaj özeti, disiplin, ayrılış, iş kazası. */
export function IkYonetimi({ yap }: { yap: Yap }) {
  const [yt, setYt] = useState<{ ik: boolean; isg: boolean; tid: boolean } | null>(null); const [l, setL] = useState<Pers[]>([]); const [k, setK] = useState({ kisi: '', iseGiris: '', brut: '', ek3Yil: '', ek3Serbest: false }); const [eg, setEg] = useState({ personel: '', tur: 'İSG', ad: '', saat: '', tesis: '', tamamlanma: '', gecerlilik: '' }); const [ay, setAy] = useState(''); const [oz, setOz] = useState<{ kimlik: string; ad_soyad: string; net: number; fazla: number; izin: number; devamsizlik: number; serbestDakika: number; fazlaUcretTl: number }[]>([]); const [ds, setDs] = useState({ personel: '', olayTarihi: '', konu: '', kademe: 'Yazılı Uyarı', savunmaSon: '' }); const [dl, setDl] = useState<{ kimlik: string; ad_soyad: string; konu: string; kademe: string; savunma: string | null; karar: string | null; savunma_son: string | null }[]>([]); const [kr, setKr] = useState<Record<string, string>>({}); const [ay2, setAy2] = useState({ personel: '', tur: 'İşveren Feshi', bildirim: '', son: '', dilekce: '' }); const [al, setAl] = useState<{ kimlik: string; ad_soyad: string; tur: string; son_is_gunu: string; odeme_durumu: string; durum: string }[]>([]); const [dt, setDt] = useState<Record<string, { devir: { kimlik: string; tur: string; aciklama: string; durum: string }[]; engel: string | null; ihbar?: { hafta: number; tutar: number; odeyen: string | null }; kidem?: number | null; uyari?: string | null }>>({}); const [dv, setDv] = useState<Record<string, string>>({}); const [par, setPar] = useState(''); const [kz, setKz] = useState<{ olay_ref: string; isveren: string; ticari_unvan: string | null; son_zaman: string; bilgi_gonderme_zamani: string | null; ozet: string }[]>([]); const [sg, setSg] = useState('');
  const yk = (r: { ik: boolean; isg: boolean }) => {
    if (r.ik) { void istek<Pers[]>('/ik/personel').then(setL).catch(() => {}); void istek<typeof dl>('/disiplin').then(setDl).catch(() => {}); void istek<typeof al>('/ayrilis').then(setAl).catch(() => {}); }
    if (r.ik || r.isg) void istek<typeof kz>('/is-kazasi').then(setKz).catch(() => {});
  };
  useEffect(() => { void istek<NonNullable<typeof yt>>('/ik/yetki').then((r) => { setYt(r); yk(r); }).catch(() => {}); }, []);
  if (!yt || (!yt.ik && !yt.isg && !yt.tid)) return null;
  const secici = (id: string, v: string, f: (x: string) => void) => <select id={id} value={v} onChange={(e) => f(e.target.value)}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select>;
  const ayrilisAc = (id: string) => void istek<(typeof dt)[string]>(`/ayrilis/${id}`).then((r) => setDt({ ...dt, [id]: r }));
  return (<>
    {yt.tid && <><div className="bolum">Günlük Harcırah</div><label htmlFor="hr-t">Günlük Tutar (EUR)</label><input id="hr-t" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} /><button className="btn2" disabled={!par} onClick={() => void yap(() => istek('/ik/parametre', { kod: 'harcirah_gunluk_eur', deger: Number(par.replace(',', '.')) }).then(() => ({ uyari: 'Tutar kaydedildi.' })))}>Kaydet</button></>}
    {yt.ik && <>
      <div className="bolum">Personel Kartı</div>
      <label htmlFor="pk-k">Personel</label>{secici('pk-k', k.kisi, (x) => { const s = l.find((y) => y.kimlik === x); setK({ kisi: x, iseGiris: s?.ise_giris_tarihi ?? '', brut: s?.brut_aylik_tl ?? '', ek3Yil: s?.ek3_yil ? String(s.ek3_yil) : '', ek3Serbest: Boolean(s?.ek3_serbest_zaman) }); })}
      <div className="iki-tarih"><div><label htmlFor="pk-g">İşe Giriş</label><input id="pk-g" type="date" value={k.iseGiris} onChange={(e) => setK({ ...k, iseGiris: e.target.value })} /></div><div><label htmlFor="pk-b">Brüt Aylık (TL)</label><input id="pk-b" inputMode="decimal" value={k.brut} onChange={(e) => setK({ ...k, brut: e.target.value })} /></div></div>
      <label htmlFor="pk-e">Ek-3 Onay Yılı</label><input id="pk-e" inputMode="numeric" value={k.ek3Yil} onChange={(e) => setK({ ...k, ek3Yil: e.target.value })} />
      <label className="kutu"><input type="checkbox" checked={k.ek3Serbest} onChange={(e) => setK({ ...k, ek3Serbest: e.target.checked })} /><span>Fazla Çalışma Karşılığı Serbest Zaman</span></label>
      <button className="btn2" disabled={!k.kisi || !k.iseGiris} onClick={() => void yap(() => istek(`/ik/personel/${k.kisi}`, { iseGiris: k.iseGiris, brut: k.brut ? Number(k.brut.replace(',', '.')) : undefined, ek3Yil: Number(k.ek3Yil) || undefined, ek3Serbest: k.ek3Serbest }).then(() => { yk(yt); return { uyari: 'Personel kartı kaydedildi.' }; }))}>Kartı Kaydet</button>
      <label htmlFor="kt-t">Kıdem Tavanı (TL, İnsan Kaynakları Müdürü)</label><input id="kt-t" inputMode="decimal" value={sg} onChange={(e) => setSg(e.target.value)} /><button className="btn2" disabled={!sg} onClick={() => void yap(() => istek('/ik/parametre', { kod: 'kidem_tavani_tl', deger: Number(sg.replace(',', '.')) }).then(() => ({ uyari: 'Tavan kaydedildi.' })))}>Tavanı Kaydet</button>

      <div className="bolum">Puantaj Özeti</div>
      <label htmlFor="po-a">Ay (YYYY-AA)</label><input id="po-a" value={ay} onChange={(e) => setAy(e.target.value)} />
      <div className="dugmeler"><button className="btn2" disabled={!ay} onClick={() => void yap(() => istek<typeof oz>(`/puantaj/ozet?ay=${ay}`).then(setOz))}>Getir</button><button className="btn2" disabled={!ay} onClick={() => void yap(() => istek<{ adet: number }>('/puantaj/bordro', { ay }).then((r) => ({ uyari: `${r.adet} kayıt bordroya aktarıldı.` })))}>Bordroya Aktar</button></div>
      {oz.map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {saat(x.net)} · Fazla: {saat(x.fazla)} · İzin: {x.izin} · Devamsızlık: {x.devamsizlik}{x.serbestDakika ? ` · Serbest Zaman: ${saat(x.serbestDakika)}` : ''}{x.fazlaUcretTl ? ` · Fazla Ücret: ${tl(x.fazlaUcretTl)}` : ''}</span></div>)}
    </>}
    <div className="bolum">Eğitim Kaydı</div>
    {!yt.ik && <input aria-label="Personel Kimliği" value={eg.personel} onChange={(e) => setEg({ ...eg, personel: e.target.value })} />}
    {yt.ik && <><label htmlFor="eg-p">Personel</label>{secici('eg-p', eg.personel, (x) => setEg({ ...eg, personel: x }))}</>}
    <label htmlFor="eg-t">Tür</label><select id="eg-t" value={eg.tur} onChange={(e) => setEg({ ...eg, tur: e.target.value })}>{['İSG', 'Tesis Oryantasyonu', 'Mesleki Belge', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="eg-a">Ad</label><input id="eg-a" value={eg.ad} onChange={(e) => setEg({ ...eg, ad: e.target.value })} />
    {eg.tur === 'İSG' && <><label htmlFor="eg-s">Süre (saat)</label><input id="eg-s" inputMode="numeric" value={eg.saat} onChange={(e) => setEg({ ...eg, saat: e.target.value })} /></>}
    {eg.tur === 'Tesis Oryantasyonu' && <><label htmlFor="eg-z">Tesis</label><input id="eg-z" value={eg.tesis} onChange={(e) => setEg({ ...eg, tesis: e.target.value })} /></>}
    <div className="iki-tarih"><div><label htmlFor="eg-b">Tamamlanma</label><input id="eg-b" type="date" value={eg.tamamlanma} onChange={(e) => setEg({ ...eg, tamamlanma: e.target.value })} /></div>{eg.tur !== 'İSG' && <div><label htmlFor="eg-g">Geçerlilik Sonu</label><input id="eg-g" type="date" value={eg.gecerlilik} onChange={(e) => setEg({ ...eg, gecerlilik: e.target.value })} /></div>}</div>
    <button className="btn2" disabled={!eg.personel || !eg.ad.trim() || !eg.tamamlanma} onClick={() => void yap(() => istek('/ik/egitim', { ...eg, saat: eg.saat ? Number(eg.saat) : undefined, gecerlilik: eg.gecerlilik || undefined }).then(() => ({ uyari: 'Eğitim kaydedildi.' })))}>Eğitimi Kaydet</button>

    {yt.ik && <>
      <div className="bolum">Disiplin</div>
      <label htmlFor="ds-p">Personel</label>{secici('ds-p', ds.personel, (x) => setDs({ ...ds, personel: x }))}
      <label htmlFor="ds-k">Kademe</label><select id="ds-k" value={ds.kademe} onChange={(e) => setDs({ ...ds, kademe: e.target.value })}>{['Sözlü Uyarı', 'Yazılı Uyarı', 'Ücret Kesme', 'Fesih'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="ds-z">Konu</label><input id="ds-z" value={ds.konu} onChange={(e) => setDs({ ...ds, konu: e.target.value })} />
      <div className="iki-tarih"><div><label htmlFor="ds-o">Olay Tarihi</label><input id="ds-o" type="date" value={ds.olayTarihi} onChange={(e) => setDs({ ...ds, olayTarihi: e.target.value })} /></div>{ds.kademe !== 'Sözlü Uyarı' && <div><label htmlFor="ds-s">Savunma Son Tarihi</label><input id="ds-s" type="date" value={ds.savunmaSon} onChange={(e) => setDs({ ...ds, savunmaSon: e.target.value })} /></div>}</div>
      <button className="btn2" disabled={!ds.personel || !ds.konu.trim() || !ds.olayTarihi} onClick={() => void yap(() => istek('/disiplin', { ...ds, savunmaSon: ds.savunmaSon || undefined }).then(() => { yk(yt); return { uyari: 'Disiplin kaydı açıldı.' }; }))}>Kaydı Aç</button>
      {dl.filter((x) => !x.karar).map((x) => <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.kademe} · {x.konu} · {x.savunma ? 'Savunma Alındı' : `Savunma Bekleniyor (${x.savunma_son ?? ''})`}</span><div className="tam"><label htmlFor={`dk-${x.kimlik}`}>Karar</label><input id={`dk-${x.kimlik}`} value={kr[x.kimlik] ?? ''} onChange={(e) => setKr({ ...kr, [x.kimlik]: e.target.value })} />{x.kademe === 'Ücret Kesme' && <><label htmlFor={`dg-${x.kimlik}`}>Kesinti (gündelik)</label><input id={`dg-${x.kimlik}`} inputMode="decimal" value={kr[`${x.kimlik}g`] ?? ''} onChange={(e) => setKr({ ...kr, [`${x.kimlik}g`]: e.target.value })} /></>}<button className="btn2 kucuk" disabled={!kr[x.kimlik]?.trim()} onClick={() => void yap(() => istek(`/disiplin/${x.kimlik}/karar`, { karar: kr[x.kimlik], gundelik: kr[`${x.kimlik}g`] ? Number(kr[`${x.kimlik}g`]!.replace(',', '.')) : undefined }).then(() => { yk(yt); return { uyari: 'Karar kaydedildi.' }; }))}>Kararı Kaydet</button></div></div>)}

      <div className="bolum">Ayrılış</div>
      <label htmlFor="ay-p">Personel</label>{secici('ay-p', ay2.personel, (x) => setAy2({ ...ay2, personel: x }))}
      <label htmlFor="ay-t">Ayrılış Türü</label><select id="ay-t" value={ay2.tur} onChange={(e) => setAy2({ ...ay2, tur: e.target.value })}>{['İşveren Feshi', 'İstifa', 'Haklı Fesih (25/II)', 'Emeklilik', 'Askerlik', 'Evlilik', 'Ölüm', 'Mutabakat'].map((x) => <option key={x}>{x}</option>)}</select>
      <div className="iki-tarih"><div><label htmlFor="ay-b">Bildirim Tarihi</label><input id="ay-b" type="date" value={ay2.bildirim} onChange={(e) => setAy2({ ...ay2, bildirim: e.target.value })} /></div><div><label htmlFor="ay-s">Son İş Günü</label><input id="ay-s" type="date" value={ay2.son} onChange={(e) => setAy2({ ...ay2, son: e.target.value })} /></div></div>
      {ay2.tur === 'İstifa' && ay2.personel && <BelgeSec ad="İmzalı İstifa Dilekçesi" bagTuru="Personel" bagKimligi={ay2.personel} deger={ay2.dilekce} sec={(x: string) => setAy2({ ...ay2, dilekce: x })} />}
      <button className="btn2" disabled={!ay2.personel || !ay2.bildirim || !ay2.son} onClick={() => void yap(() => istek('/ayrilis', { personel: ay2.personel, tur: ay2.tur, bildirim: ay2.bildirim, son: ay2.son, dilekce: ay2.dilekce || undefined }).then(() => { yk(yt); return { uyari: 'Ayrılış başlatıldı, devir listesi çıkarıldı.' }; }))}>Ayrılışı Başlat</button>
      {al.filter((x) => x.durum === 'Açık').map((x) => { const v = dt[x.kimlik]; return <div className="soru" key={x.kimlik}><span>{x.ad_soyad} · {x.tur} · Son İş Günü: {x.son_is_gunu} · {x.odeme_durumu}</span><div className="tam"><button className="btn2 kucuk" onClick={() => ayrilisAc(x.kimlik)}>Ayrıntı</button>
        {v && <>{v.ihbar && <div>Bildirim Süresi: {v.ihbar.hafta} hafta{v.ihbar.tutar ? ` · İhbar: ${tl(v.ihbar.tutar)} (${v.ihbar.odeyen} öder)` : ''}{v.kidem != null ? ` · Kıdem: ${tl(v.kidem)}` : ''}</div>}{v.uyari && <div className="hata">⚠ {v.uyari}</div>}{v.engel && <div className="hata">⚠ {v.engel}</div>}
          {v.devir.map((d) => <div key={d.kimlik}>{d.tur} · {d.aciklama} · {d.durum}{d.durum === 'Bekliyor' && <>{secici(`dv-${d.kimlik}`, dv[d.kimlik] ?? '', (z) => setDv({ ...dv, [d.kimlik]: z }))}<button className="btn2 kucuk" disabled={!dv[d.kimlik]} onClick={() => void yap(() => istek(`/ayrilis-devir/${d.kimlik}`, { devralan: dv[d.kimlik] }).then(() => { ayrilisAc(x.kimlik); return { uyari: 'Devredildi.' }; }))}>Devret</button></>}</div>)}
          <button className="btn2 kucuk" disabled={Boolean(v.engel) || x.odeme_durumu !== 'Bekliyor'} onClick={() => void yap(() => istek(`/ayrilis/${x.kimlik}/tazminat`, {}).then(() => { yk(yt); return { uyari: 'Tazminat onaya gönderildi.' }; }))}>Tazminat Onayına Gönder</button></>}</div></div>; })}
    </>}

    {kz.length > 0 && <div className="bolum">İş Kazası Bildirimleri</div>}
    {kz.map((x) => <div className="soru" key={x.olay_ref}><span>{x.ozet} · İşveren: {x.ticari_unvan ?? x.isveren} · Son: {new Date(x.son_zaman).toLocaleDateString('tr-TR')}</span><div className="dugmeler">
      {yt.isg && x.isveren === 'LGM' && !x.bilgi_gonderme_zamani && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/bilgi-gonder`, {}).then(() => { yk(yt); return { uyari: 'Olay bilgisi gönderildi.' }; }))}>Olay Bilgisini Gönder</button>}
      {yt.isg && x.isveren !== 'LGM' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/belge-iste`, {}).then(() => ({ uyari: 'Belge istendi.' })))}>Belge İste</button>}
      {yt.ik && x.isveren === 'LGM' && <button className="btn2 kucuk" onClick={() => void yap(() => istek(`/is-kazasi/${x.olay_ref}/sgk`, { tarih: new Date().toISOString().slice(0, 10) }).then(() => { yk(yt); return { uyari: 'SGK bildirimi kaydedildi.' }; }))}>SGK Bildirimi Yapıldı</button>}
    </div></div>)}
  </>);
}
