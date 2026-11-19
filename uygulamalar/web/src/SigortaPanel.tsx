import { useEffect, useState } from 'react';
import { istek } from './api';

type V = {
  direktor: boolean; hukuk: boolean; belgeler: string[]; sirketler: { tsb_kodu: string; tam_unvan: string }[];
  basvurular: { kimlik: string; tam_unvan: string; belgeler: string[]; durum: string; gonderim_zamani: string | null; not_metni: string | null; deneme: string | null }[];
  denetimler: { kimlik: string; tam_unvan: string; konu: string; son_tarih: string; durum: string; hukuk_gorusu: string | null; yanit_ozeti: string | null }[];
  itibar: { kimlik: string; konu: string; dosya_no: string | null; durum: string }[];
};
const gun = (x: string) => x.split('-').reverse().join('.');

/** YG-1702 (A54): Sigorta ve Panel; panel başvuruları ve deneme dosyaları, sigorta şirketi denetim talepleri, kurumsal itibar riski. Çözüm Ortağı kimliği hiçbir iletişimde yer almaz. */
export function SigortaPanel() {
  const [v, setV] = useState<V | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/sigorta-panel').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); setG({}); return yk(); }).catch((e) => setM(e.message));
  const al = (k: string, et: string, tur = 'text') => <><label htmlFor={`sp-${k}`}>{et}</label><input id={`sp-${k}`} type={tur} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></>;
  const sirket = (k: string) => <><label htmlFor={`sp-${k}`}>Sigorta Şirketi</label><select id={`sp-${k}`} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })}><option value="">Seçiniz</option>{v.sirketler.map((s) => <option key={s.tsb_kodu} value={s.tsb_kodu}>{s.tam_unvan}</option>)}</select></>;
  return <details><summary>Sigorta ve Panel</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Kurumsal İtibar Riski</div>
    {v.itibar.map((x) => <div key={x.kimlik} className={x.durum === 'Açık' ? 'hata kart-sol' : 'soru'}><span>{x.konu}{x.dosya_no ? ` · ${x.dosya_no}` : ''} · {x.durum}</span>{v.direktor && x.durum === 'Açık' && <button className="btn2 kucuk" onClick={() => is(istek(`/kurumsal-itibar-riski/${x.kimlik}/ceoya-ilet`, { not: g[`in${x.kimlik}`] }), "CEO'ya iletildi.")}>CEO&apos;ya İlet</button>}</div>)}
    {al('ik', 'Yeni İtibar Riski · Konu')}{al('id', 'Dosya No (varsa)')}<button className="btn2 kucuk" disabled={!g.ik?.trim()} onClick={() => is(istek('/kurumsal-itibar-riski', { konu: g.ik, dosyaNo: g.id }), 'Kayıt açıldı; Strateji ve Kurumsal Gelişim Direktörüne acil kart düştü.')}>Bildir</button>
    <div className="bolum">Sigorta Şirketi Denetim Talepleri</div>
    {v.denetimler.map((x) => <div key={x.kimlik} className="soru"><span>{x.tam_unvan} · {x.konu} · Son: {gun(x.son_tarih)} · {x.durum}{x.hukuk_gorusu ? ` · Hukuk ve Uyum: ${x.hukuk_gorusu}` : ''}{x.yanit_ozeti ? ` · Yanıt: ${x.yanit_ozeti}` : ''}</span>
      {x.durum !== 'Yanıtlandı' && <div className="tam">{al(`dm${x.kimlik}`, v.hukuk && !v.direktor ? 'Görüşünüz' : 'Yanıt Özeti / Görüş')}
        {v.direktor && x.durum === 'Açık' && <button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-denetim-talebi/${x.kimlik}`, { islem: 'Hukuk ve Uyum Görüşü İste' }), 'Hukuk ve Uyum görüşü istendi.')}>Hukuk ve Uyum Görüşü İste</button>}
        {v.hukuk && x.durum === 'Hukuk Görüşünde' && <button className="btn2 kucuk" disabled={!g[`dm${x.kimlik}`]?.trim()} onClick={() => is(istek(`/sigorta-denetim-talebi/${x.kimlik}`, { islem: 'Görüşü Gönder', metin: g[`dm${x.kimlik}`] }), 'Görüş gönderildi.')}>Görüşü Gönder</button>}
        {v.direktor && <button className="btn2 kucuk" disabled={!g[`dm${x.kimlik}`]?.trim()} onClick={() => is(istek(`/sigorta-denetim-talebi/${x.kimlik}`, { islem: 'Yanıtı Gönder', metin: g[`dm${x.kimlik}`] }), 'Yanıt kaydedildi.')}>Yanıtı Gönder</button>}</div>}</div>)}
    {v.direktor && <>{sirket('ds')}{al('dk', 'Denetim Konusu')}{al('dt', 'Yanıt Son Tarihi', 'date')}<button className="btn2 kucuk" disabled={!g.ds || !g.dk?.trim() || !g.dt} onClick={() => is(istek('/sigorta-denetim-talebi', { tsbKodu: g.ds, konu: g.dk, sonTarih: g.dt }), 'Denetim talebi kaydedildi.')}>Denetim Talebini Kaydet</button></>}
    {v.direktor && <><div className="bolum">Panel Başvuruları</div>
      {v.basvurular.map((x) => <div key={x.kimlik} className="soru"><span>{x.tam_unvan} · {x.durum}{x.deneme ? ` · Deneme: ${x.deneme}` : ''}{x.not_metni ? ` · ${x.not_metni}` : ''}</span>
        {x.durum === 'Hazırlanıyor' && <div className="tam">{v.belgeler.map((b) => <label key={b}><input type="checkbox" checked={x.belgeler.includes(b)} onChange={(e) => is(istek(`/sigorta-panel/basvuru/${x.kimlik}`, { islem: 'Belgeler', belgeler: e.target.checked ? [...x.belgeler, b] : x.belgeler.filter((y) => y !== b) }), 'Başvuru dosyası güncellendi.')} /> {b}</label>)}
          <button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-panel/basvuru/${x.kimlik}`, { islem: 'Başvuruyu Gönder' }), 'Başvuru gönderildi olarak kaydedildi; sigorta şirketine yalnız e-postayla iletilir.')}>Başvuruyu Gönder</button></div>}
        {['Gönderildi', 'Deneme Dosyasında'].includes(x.durum) && <div className="tam">{al(`dd${x.kimlik}`, 'Deneme Dosyası No')}<button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-panel/basvuru/${x.kimlik}`, { islem: 'Deneme Dosyasını Kabul Et', dosyaNo: g[`dd${x.kimlik}`] }), 'Deneme dosyası kabul edildi.')}>Deneme Dosyasını Kabul Et</button>
          <button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-panel/basvuru/${x.kimlik}`, { islem: 'Sonuç', sonuc: 'Panele Alındı' }), 'Kaydedildi.')}>Panele Alındı</button><button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-panel/basvuru/${x.kimlik}`, { islem: 'Sonuç', sonuc: 'Kabul Edilmedi' }), 'Kaydedildi.')}>Kabul Edilmedi</button></div>}</div>)}
      {sirket('ps')}<button className="btn2 kucuk" disabled={!g.ps} onClick={() => is(istek('/sigorta-panel/basvuru', { tsbKodu: g.ps }), 'Panel başvurusu açıldı.')}>Panel Başvurusu Aç</button></>}
  </details>;
}
