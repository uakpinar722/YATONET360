import { useEffect, useState } from 'react';
import { istek } from './api';

const VARYANT = ['Garanti Değerlendirme Sonucu', 'Şikâyet Yanıtı', 'İtiraz İnceleme Sonucu', 'Ara Bilgilendirme', 'Takip Kontrolü', 'Talep Yanıtı'];
interface Durum { yazilar: { kimlik: string; yazi_no: string; varyant: string; durum: string }[]; hazirlar: boolean; itiraz: { zaman: string | null; son: string | null; makam: string | null; sonuc: string | null }; itirazKarar: boolean; yanitVar: boolean; takipSon: string | null }

/** YG-728: FR-KLT-016 yanıt yazısı (6 varyant), itiraz kaydı ve üst kademe kararı. */
export function GarantiYanit({ id, yap }: { id: string; yap: (f: () => Promise<any>, tamam?: string) => Promise<void> }) {
  const [v, setV] = useState<Durum | null>(null); const [f, setF] = useState({ varyant: '', inceleme: '', islemler: '', duzeltme: '' });
  const [it, setIt] = useState(''); const [ik, setIk] = useState({ sonuc: '', gerekce: '' });
  const yukle = () => void istek<Durum>(`/garanti-sikayet/${id}/yanit`).then(setV).catch(() => setV(null));
  useEffect(yukle, [id]);
  if (!v) return null;
  const tarih = (x: string | null) => (x ? new Date(x).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '---');
  const islemler = f.islemler.split('\n').map((s) => s.split('|').map((x) => x.trim())).filter((x) => x[0]).map(([islem, tarih, durum]) => ({ islem, tarih, durum }));
  return <div className="tam">
    <GarantiGecmis id={id} />
    {v.yazilar.map((x) => <div key={x.kimlik}>{x.yazi_no} · {x.varyant} · {x.durum}</div>)}
    {v.itiraz.zaman && <div className="not">İtiraz: {tarih(v.itiraz.zaman)} · İnceleyen: {v.itiraz.makam} · Son: {tarih(v.itiraz.son)}{v.itiraz.sonuc ? ` · Sonuç: ${v.itiraz.sonuc}` : ''}</div>}
    {v.takipSon && <div className="not">Takip Kontrolü: {tarih(v.takipSon)}</div>}
    {v.hazirlar && <>
      <label htmlFor={`gy-v-${id}`}>Yanıt Yazısı Varyantı</label><select id={`gy-v-${id}`} value={f.varyant} onChange={(e) => setF({ ...f, varyant: e.target.value })}><option value="">Seçiniz</option>{VARYANT.map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor={`gy-i-${id}`}>İnceleme</label><textarea id={`gy-i-${id}`} value={f.inceleme} onChange={(e) => setF({ ...f, inceleme: e.target.value })} />
      <label htmlFor={`gy-l-${id}`}>Yapılan ve Yapılacak İşlemler (her satır: İşlem | Tarih | Durum)</label><textarea id={`gy-l-${id}`} value={f.islemler} onChange={(e) => setF({ ...f, islemler: e.target.value })} />
      {f.varyant === 'Şikâyet Yanıtı' && <><label htmlFor={`gy-d-${id}`}>Düzeltmenin Tamamlandığı Tarih</label><input id={`gy-d-${id}`} type="date" value={f.duzeltme} onChange={(e) => setF({ ...f, duzeltme: e.target.value })} /></>}
      <button className="btn2 kucuk" disabled={!f.varyant} onClick={() => void yap(() => istek(`/garanti-sikayet/${id}/yanit-yazisi`, { varyant: f.varyant, inceleme: f.inceleme, islemler, duzeltmeTarihi: f.duzeltme || undefined }), 'Yanıt yazısı Müşteri ve Paydaş İlişkileri Müdürü onayına gönderildi.').then(yukle)}>Yanıt Yazısını Onaya Gönder</button>
      {v.yanitVar && !v.itiraz.zaman && <><label htmlFor={`gy-it-${id}`}>Yat Sahibinin İtirazı</label><input id={`gy-it-${id}`} value={it} onChange={(e) => setIt(e.target.value)} />
        <button className="btn2 kucuk" disabled={!it.trim()} onClick={() => void yap(() => istek(`/garanti-sikayet/${id}/itiraz`, { aciklama: it }), 'İtiraz kaydedildi; üst kademe incelemesine gönderildi.').then(yukle)}>İtirazı Kaydet</button></>}
    </>}
    {v.itirazKarar && <>
      <label htmlFor={`gy-is-${id}`}>İtiraz Sonucu</label><select id={`gy-is-${id}`} value={ik.sonuc} onChange={(e) => setIk({ ...ik, sonuc: e.target.value })}><option value="">Seçiniz</option>{['Kabul', 'Kısmen Kabul', 'Ret'].map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor={`gy-ig-${id}`}>İtiraz Gerekçesi</label><input id={`gy-ig-${id}`} value={ik.gerekce} onChange={(e) => setIk({ ...ik, gerekce: e.target.value })} />
      <button className="btn2 kucuk" disabled={!ik.sonuc || !ik.gerekce.trim()} onClick={() => void yap(() => istek(`/garanti-sikayet/${id}/itiraz-karar`, ik), 'İtiraz kararı kaydedildi.').then(yukle)}>İtiraz Kararını Kaydet</button></>}
  </div>;
}

interface Gecmis { dosya: { dosya_no: string; teslim_tarihi: string | null } | undefined; oncekiDosyalar: { kimlik: string; dosya_no: string; statu: string }[]; firmalar: { is_emri_no: string; is_emri_turu: string; statu: string; firma: string | null }[]; parcalar: { siparis_no: string; urun_tanimi: string; uretici_parca_no: string; tedarikci: string | null; lot: string | null }[]; testler: { test_no: string; test_grubu: string; durum: string; sonuc: string | null }[]; teslim: { durum: string; teslim_alan: string | null; karar: string | null }[]; belgeler: { kimlik: string; ad: string }[]; oncekiKayitlar: { kayit_no: string; statu: string; karar: string | null }[] }

/** YG-084: önceki dosya, parça, firma, test ve teslim kanıtları. */
function GarantiGecmis({ id }: { id: string }) {
  const [v, setV] = useState<Gecmis | null>(null); const [ac, setAc] = useState(false);
  useEffect(() => { if (ac && !v) void istek<Gecmis>(`/garanti-sikayet/${id}/gecmis`).then(setV).catch(() => setV(null)); }, [ac, id, v]);
  if (!ac) return <button className="lnk" onClick={() => setAc(true)}>Önceki Kanıtları Göster</button>;
  if (!v) return null;
  const s = (b: string, l: string[]) => l.length > 0 && <div><b>{b}</b>{l.map((x) => <div key={x}>{x}</div>)}</div>;
  return <div className="not">
    {s('Dosya', v.dosya ? [`${v.dosya.dosya_no}${v.dosya.teslim_tarihi ? ` · Teslim: ${v.dosya.teslim_tarihi.split('-').reverse().join('.')}` : ''}`] : [])}
    {s('Aynı Yatın Önceki Dosyaları', v.oncekiDosyalar.map((x) => `${x.dosya_no} · ${x.statu}`))}
    {s('Firmalar ve İş Emirleri', v.firmalar.map((x) => `${x.is_emri_no} · ${x.is_emri_turu} · ${x.firma ?? '—'} · ${x.statu}`))}
    {s('Parçalar', v.parcalar.map((x) => `${x.siparis_no} · ${x.urun_tanimi} · ${x.uretici_parca_no} · ${x.tedarikci ?? '—'}${x.lot ? ` · Lot: ${x.lot}` : ''}`))}
    {s('Testler', v.testler.map((x) => `${x.test_no} · ${x.test_grubu} · ${x.sonuc ?? x.durum}`))}
    {s('Teslim', v.teslim.map((x) => `${x.durum}${x.karar ? ` · ${x.karar}` : ''}${x.teslim_alan ? ` · ${x.teslim_alan}` : ''}`))}
    {s('Belgeler', v.belgeler.map((x) => x.ad))}
    {s('Önceki Garanti ve Şikâyet Kayıtları', v.oncekiKayitlar.map((x) => `${x.kayit_no} · ${x.statu}${x.karar ? ` · ${x.karar}` : ''}`))}
  </div>;
}
