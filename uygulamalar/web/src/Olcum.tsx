import { useState } from 'react';
import { istek } from './api';
import { IsEmriSec } from './IsEmriBag';

type O = { olcum_no: string; olcum_noktasi: string; olculen_buyukluk: string; ozet_deger: string; birim: string; gecerlilik: string; sinir_disi: boolean };
type K = { kullanici: string; ad_soyad: string };
const sayi = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

/**
 * YG-134: ölçüm kaydı ekranı. Ham veri yuvarlanmadan saklanır; kalibrasyonu geçmiş cihaz sonucu kesin değer olarak kaydedilemez;
 * sınır dışı sonuçta farklı bir ikinci doğrulayan, geçersiz sonuçta gerekçe zorunludur. Kayıtlar silinmez.
 */
export function Olcum({ dosya, olcumler, ekip, yenile }: { dosya: string; olcumler: O[]; ekip: K[]; yenile: () => void }) {
  const bos = { nokta: '', buyukluk: '', birim: '', yontem: '', cihaz: '', kalibrasyon: 'Geçerli', ham: '', deger: '', nominal: '', tolerans: '', gecerlilik: 'Geçerli', ikinci: '', gerekce: '' };
  const [f, setF] = useState(bos); const [ie, setIe] = useState(''); const [m, setM] = useState('');
  const d = sayi(f.deger); const n = sayi(f.nominal); const t = sayi(f.tolerans);
  const sinirDisi = d !== undefined && n !== undefined && t !== undefined && Math.abs(d - n) > t;
  const al = (k: keyof typeof bos, et: string, ek: Record<string, unknown> = {}) => <><label htmlFor={`ol-${k}`}>{et}</label><input id={`ol-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...ek} /></>;
  const kaydet = () => void istek<{ olcumNo: string; sinirDisi: boolean }>(`/dosya/${dosya}/olcum`, { nokta: f.nokta, buyukluk: f.buyukluk, birim: f.birim, yontem: f.yontem, cihaz: f.cihaz, kalibrasyon: f.kalibrasyon, ham: f.ham, deger: d, nominal: n, tolerans: t, gecerlilik: f.gecerlilik, ikinci: f.ikinci || undefined, gerekce: f.gerekce || undefined, isEmri: ie || undefined })
    .then((r) => { setM(`Ölçüm kaydedildi: ${r.olcumNo}${r.sinirDisi ? ' (sınır dışı)' : ''}`); setF(bos); yenile(); }).catch((e) => setM(e.message));
  return <details><summary>Ölçüm Kayıtları ({olcumler.length})</summary>{m && <div className="not" role="status">{m}</div>}
    {olcumler.length > 0 && <table><thead><tr><th>No</th><th>Nokta</th><th>Büyüklük</th><th>Değer</th><th>Geçerlilik</th></tr></thead><tbody>
      {olcumler.map((x) => <tr key={x.olcum_no} className={x.sinir_disi ? 'uyari' : undefined}><td>{x.olcum_no}</td><td>{x.olcum_noktasi}</td><td>{x.olculen_buyukluk}</td><td>{String(x.ozet_deger).replace('.', ',')} {x.birim}{x.sinir_disi ? ' · Sınır dışı' : ''}</td><td>{x.gecerlilik}</td></tr>)}
    </tbody></table>}
    <div className="bolum">Yeni Ölçüm</div>
    {al('nokta', 'Ölçüm Noktası')}{al('buyukluk', 'Ölçülen Büyüklük')}{al('birim', 'Birim')}{al('yontem', 'Yöntem')}{al('cihaz', 'Cihaz')}
    <label htmlFor="ol-kalibrasyon">Kalibrasyon Durumu</label><select id="ol-kalibrasyon" value={f.kalibrasyon} onChange={(e) => setF({ ...f, kalibrasyon: e.target.value, gecerlilik: e.target.value === 'Süresi geçmiş' && f.gecerlilik === 'Geçerli' ? 'Sınırlı' : f.gecerlilik })}>{['Geçerli', 'Saha doğrulaması', 'Süresi geçmiş'].map((x) => <option key={x}>{x}</option>)}</select>
    {f.kalibrasyon === 'Süresi geçmiş' && <div className="uyari">Kalibrasyonu geçmiş cihaz sonucu kesin değer olarak kullanılmaz; bilgi olarak kaydedilir.</div>}
    <label htmlFor="ol-ham">Ham Veri (yuvarlanmadan)</label><textarea id="ol-ham" rows={2} value={f.ham} onChange={(e) => setF({ ...f, ham: e.target.value })} />
    {al('deger', 'Özet Değer', { inputMode: 'decimal' })}{al('nominal', 'Nominal Değer', { inputMode: 'decimal' })}{al('tolerans', 'Tolerans (±)', { inputMode: 'decimal' })}
    <label htmlFor="ol-gecerlilik">Geçerlilik</label><select id="ol-gecerlilik" value={f.gecerlilik} onChange={(e) => setF({ ...f, gecerlilik: e.target.value })}>{['Geçerli', 'Sınırlı', 'Geçersiz'].filter((x) => !(x === 'Geçerli' && f.kalibrasyon === 'Süresi geçmiş')).map((x) => <option key={x}>{x}</option>)}</select>
    {f.gecerlilik === 'Geçersiz' && al('gerekce', 'Geçersizlik Gerekçesi')}
    {sinirDisi && <><div className="uyari">Sonuç tolerans dışındadır; farklı bir ikinci doğrulayan zorunludur.</div>
      <label htmlFor="ol-ikinci">İkinci Doğrulayan</label><select id="ol-ikinci" value={f.ikinci} onChange={(e) => setF({ ...f, ikinci: e.target.value })}><option value="">Seçiniz</option>{ekip.map((x) => <option key={x.kullanici} value={x.kullanici}>{x.ad_soyad}</option>)}</select></>}
    <IsEmriSec dosya={dosya} deger={ie} degisti={setIe} kimlik="ol-ie" />
    <button className="btn2" disabled={!f.nokta.trim() || !f.buyukluk.trim() || !f.birim.trim() || !f.yontem.trim() || !f.cihaz.trim() || !f.ham.trim() || d === undefined || Number.isNaN(d) || (sinirDisi && !f.ikinci)} onClick={kaydet}>Ölçümü Kaydet</button>
  </details>;
}
