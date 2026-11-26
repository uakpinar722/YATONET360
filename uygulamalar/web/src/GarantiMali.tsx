import { OnayaGonder } from './Dugme';
import { useEffect, useState } from 'react';
import { istek } from './api';
import { eur, tarih } from './bicim';

type M = { kimlik: string; kayit_no: string; kalem: string; tutar_eur: string; karsilayan: string; mahsup_referansi: string | null; durum: string; garanti_no: string | null };
type B = { kimlik: string; basvuru_no: string; marka: string; model: string | null; seri_no: string | null; parca_no: string | null; ariza_tanimi: string; uretici: string; durum: string; karar_tarihi: string | null; karsilanan_eur: string | null; sonuc_notu: string | null };
const SONRAKI: Record<string, string[]> = { Hazırlanıyor: ['Gönderildi'], Gönderildi: ['Üretici İncelemesinde', 'Kabul', 'Kısmen Kabul', 'Ret'], 'Üretici İncelemesinde': ['Kabul', 'Kısmen Kabul', 'Ret'] };

/** YG-899: Garanti Maliyet Kaydı ve Üretici Garanti Başvurusu (dosya ekranı). */
export function GarantiMali({ id }: { id: string }) {
  const [v, setV] = useState<{ maliyetler: M[]; basvurular: B[]; garantiKayitlari: { kimlik: string; kayit_no: string }[] } | null>(null);
  const [m, setM] = useState(''); const [gm, setGm] = useState({ garanti: '', kalem: 'Parça', tutar: '', karsilayan: 'Çözüm Ortağı', mahsup: '', aciklama: '' });
  const [ub, setUb] = useState({ marka: '', model: '', seriNo: '', parcaNo: '', ariza: '', arizaTarihi: '', garantiBitis: '', uretici: '' });
  const [dg, setDg] = useState<Record<string, Record<string, string>>>({});
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${id}/garanti-maliyet`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [id]);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const al = (o: Record<string, string>, set: (x: Record<string, string>) => void, k: string, ad: string, tur = 'text') => <><label htmlFor={`gm-${k}`}>{ad}</label><input id={`gm-${k}`} type={tur} value={o[k]} onChange={(e) => set({ ...o, [k]: e.target.value })} /></>;
  return <details><summary>Garanti Maliyeti ve Üretici Başvurusu ({v.maliyetler.length + v.basvurular.length})</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Garanti Maliyet Kaydı</div>
    {v.maliyetler.map((x) => <div key={x.kimlik} className="soru"><span>{x.kayit_no} · {x.kalem} · {eur(Number(x.tutar_eur))} · {x.karsilayan}{x.mahsup_referansi ? ` · Mahsup: ${x.mahsup_referansi}` : ''}{x.garanti_no ? ` · ${x.garanti_no}` : ''} · {x.durum}</span></div>)}
    <div className="ozet">
      <label htmlFor="gm-g">Garanti Kaydı</label><select id="gm-g" value={gm.garanti} onChange={(e) => setGm({ ...gm, garanti: e.target.value })}><option value="">Seçiniz</option>{v.garantiKayitlari.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.kayit_no}</option>)}</select>
      <label htmlFor="gm-k">Maliyet Kalemi</label><select id="gm-k" value={gm.kalem} onChange={(e) => setGm({ ...gm, kalem: e.target.value })}>{['İşçilik', 'Parça', 'Malzeme', 'Ulaşım', 'Diğer'].map((x) => <option key={x}>{x}</option>)}</select>
      {al(gm, (x) => setGm(x as typeof gm), 'tutar', 'Garanti Maliyeti Tutarı (EUR)')}
      <label htmlFor="gm-c">Karşılayan</label><select id="gm-c" value={gm.karsilayan} onChange={(e) => setGm({ ...gm, karsilayan: e.target.value })}>{['Çözüm Ortağı', 'Tedarikçi', 'Üretici', 'LGM'].map((x) => <option key={x}>{x}</option>)}</select>
      {gm.karsilayan !== 'LGM' && al(gm, (x) => setGm(x as typeof gm), 'mahsup', 'Mahsup / Rücu Referansı')}
      {al(gm, (x) => setGm(x as typeof gm), 'aciklama', 'Garanti Maliyeti Açıklaması')}
      <OnayaGonder rol="Ticari İşler Direktörü" className="btn2 kucuk" disabled={!gm.tutar || (gm.karsilayan !== 'LGM' && !gm.mahsup.trim())} onClick={() => is(istek(`/dosya/${id}/garanti-maliyet`, { ...gm, garanti: gm.garanti || undefined }), 'Garanti maliyeti Ticari İşler Direktörü onayına gönderildi.')}>Onaya Gönder</OnayaGonder>
    </div>
    <div className="bolum">Üretici Garanti Başvurusu</div>
    {v.basvurular.map((x) => { const s = dg[x.kimlik] ?? {}; const set = (o: Record<string, string>) => setDg({ ...dg, [x.kimlik]: o }); return <div key={x.kimlik} className="ozet kart-sol"><b>{x.basvuru_no} · {x.marka}{x.model ? ` ${x.model}` : ''} · {x.durum}</b>
      <div>{x.ariza_tanimi} · {x.uretici}{x.seri_no ? ` · Seri ${x.seri_no}` : ''}{x.parca_no ? ` · Parça ${x.parca_no}` : ''}{x.karar_tarihi ? ` · Karar ${tarih(x.karar_tarihi)}` : ''}{x.karsilanan_eur !== null ? ` · Karşılanan ${eur(Number(x.karsilanan_eur))}` : ''}{x.sonuc_notu ? ` · ${x.sonuc_notu}` : ''}</div>
      {SONRAKI[x.durum] && <div className="tam">
        <label htmlFor={`ud-${x.kimlik}`}>Başvuru Durumu</label><select id={`ud-${x.kimlik}`} value={s.durum ?? ''} onChange={(e) => set({ ...s, durum: e.target.value })}><option value="">Seçiniz</option>{SONRAKI[x.durum]!.map((z) => <option key={z}>{z}</option>)}</select>
        {s.durum === 'Gönderildi' && <><label htmlFor={`ut-${x.kimlik}`}>Üreticiye Başvuru Tarihi</label><input id={`ut-${x.kimlik}`} type="date" value={s.basvuruTarihi ?? ''} onChange={(e) => set({ ...s, basvuruTarihi: e.target.value })} />
          <label htmlFor={`uk-${x.kimlik}`}>Başvuru Kanalı</label><select id={`uk-${x.kimlik}`} value={s.kanal ?? ''} onChange={(e) => set({ ...s, kanal: e.target.value })}><option value="">Seçiniz</option>{['E-posta', 'Üretici Portalı', 'Yetkili Servis', 'Posta', 'Diğer'].map((z) => <option key={z}>{z}</option>)}</select></>}
        {s.durum && s.durum !== 'Gönderildi' && <><label htmlFor={`ur-${x.kimlik}`}>Üretici Referans No</label><input id={`ur-${x.kimlik}`} value={s.referansNo ?? ''} onChange={(e) => set({ ...s, referansNo: e.target.value })} /></>}
        {['Kabul', 'Kısmen Kabul', 'Ret'].includes(s.durum ?? '') && <><label htmlFor={`uka-${x.kimlik}`}>Üretici Karar Tarihi</label><input id={`uka-${x.kimlik}`} type="date" value={s.kararTarihi ?? ''} onChange={(e) => set({ ...s, kararTarihi: e.target.value })} />
          {s.durum !== 'Ret' && <><label htmlFor={`uks-${x.kimlik}`}>Karşılanan Tutar (EUR)</label><input id={`uks-${x.kimlik}`} inputMode="decimal" value={s.karsilanan ?? ''} onChange={(e) => set({ ...s, karsilanan: e.target.value })} /></>}
          <label htmlFor={`un-${x.kimlik}`}>Üretici Sonuç Notu</label><input id={`un-${x.kimlik}`} value={s.sonucNotu ?? ''} onChange={(e) => set({ ...s, sonucNotu: e.target.value })} /></>}
        <button className="btn2 kucuk" disabled={!s.durum} onClick={() => is(istek(`/uretici-garanti-basvurusu/${x.kimlik}/durum`, s), 'Başvuru durumu güncellendi.')}>Kaydet</button></div>}</div>; })}
    <div className="ozet">
      {al(ub, (x) => setUb(x as typeof ub), 'marka', 'Ekipman Markası')}{al(ub, (x) => setUb(x as typeof ub), 'model', 'Ekipman Modeli')}{al(ub, (x) => setUb(x as typeof ub), 'seriNo', 'Ekipman Seri No')}{al(ub, (x) => setUb(x as typeof ub), 'parcaNo', 'Ekipman Parça No')}
      {al(ub, (x) => setUb(x as typeof ub), 'ariza', 'Arıza Tanımı')}{al(ub, (x) => setUb(x as typeof ub), 'arizaTarihi', 'Arıza Tarihi', 'date')}{al(ub, (x) => setUb(x as typeof ub), 'garantiBitis', 'Garanti Bitişi', 'date')}{al(ub, (x) => setUb(x as typeof ub), 'uretici', 'Üretici veya Yetkili Servis')}
      <button className="btn2 kucuk" disabled={!ub.marka.trim() || !ub.ariza.trim() || !ub.arizaTarihi || !ub.uretici.trim() || (!ub.seriNo.trim() && !ub.parcaNo.trim())} onClick={() => is(istek(`/dosya/${id}/uretici-garanti-basvurusu`, { ...ub, garantiBitis: ub.garantiBitis || undefined }), 'Üretici garanti başvurusu açıldı.')}>Başvuru Aç</button>
    </div>
  </details>;
}

/** YG-899: KDV İade Dosyası (Muhasebe ve Finans). */
export function KdvIade() {
  const [l, setL] = useState<{ kimlik: string; donem: string; iade_nedeni: string | null; fatura_sayisi: number; iade_tutari_tl: string; vergi_dairesi_basvuru_no: string | null; sonuc_tutari_tl: string | null; durum: string }[] | null>(null);
  const [f, setF] = useState({ donem: '', neden: '', faturalar: '', tutar: '' }); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof l>>('/kdv-iade').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const tl = (x: string) => `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
  const ilerlet = (x: (typeof l)[number]) => void istek(`/kdv-iade/${x.kimlik}/ilerlet`, x.durum === 'Hazırlanıyor' ? { gonderim: g[x.kimlik] } : x.durum === 'Mali Müşavirde' ? { basvuruNo: g[x.kimlik] } : { sonucTutari: g[x.kimlik] }).then(() => { setM('Dosya ilerletildi.'); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>KDV İade Dosyaları ({l.filter((x) => x.durum !== 'Sonuçlandı').length} açık)</summary>{m && <div className="not" role="status">{m}</div>}
    {l.map((x) => <div key={x.kimlik} className="soru"><span>{x.donem} · {tl(x.iade_tutari_tl)} · {x.fatura_sayisi} fatura · {x.durum}{x.vergi_dairesi_basvuru_no ? ` · Başvuru ${x.vergi_dairesi_basvuru_no}` : ''}{x.sonuc_tutari_tl !== null ? ` · Sonuç ${tl(x.sonuc_tutari_tl)}` : ''}{x.iade_nedeni ? ` · ${x.iade_nedeni}` : ''}</span>
      {x.durum !== 'Sonuçlandı' && <div className="tam"><label htmlFor={`ki-${x.kimlik}`}>{x.durum === 'Hazırlanıyor' ? 'Mali Müşavire Gönderim Tarihi' : x.durum === 'Mali Müşavirde' ? 'Vergi Dairesi Başvuru No' : 'Sonuç Tutarı (TL)'}</label>
        <input id={`ki-${x.kimlik}`} type={x.durum === 'Hazırlanıyor' ? 'date' : 'text'} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })} /><button className="btn2 kucuk" disabled={!g[x.kimlik]} onClick={() => ilerlet(x)}>İlerlet</button></div>}</div>)}
    <div className="ozet">
      <label htmlFor="kd-d">Dönem (YYYY-AA)</label><input id="kd-d" value={f.donem} onChange={(e) => setF({ ...f, donem: e.target.value })} />
      <label htmlFor="kd-n">İade Nedeni</label><input id="kd-n" value={f.neden} onChange={(e) => setF({ ...f, neden: e.target.value })} />
      <label htmlFor="kd-f">Fatura Kayıtları (virgülle)</label><input id="kd-f" value={f.faturalar} onChange={(e) => setF({ ...f, faturalar: e.target.value })} />
      <label htmlFor="kd-t">İade Tutarı (TL)</label><input id="kd-t" inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} />
      <button className="btn2 kucuk" disabled={!f.donem || !f.faturalar.trim() || !f.tutar} onClick={() => void istek('/kdv-iade', { donem: f.donem, neden: f.neden || undefined, faturalar: f.faturalar.split(',').map((x) => x.trim()).filter(Boolean), tutar: f.tutar }).then(() => { setM('KDV iade dosyası açıldı.'); return yk(); }).catch((e) => setM(e.message))}>Dosya Aç</button>
    </div>
  </details>;
}
