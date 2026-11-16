import { useEffect, useState } from 'react';
import { istek } from './api';

type R = Record<string, string | number | boolean | null>;
type V = { kimlik: R; sozlesmeler: R[]; branslar: R[]; belgeler: R[]; tesisler: R[]; kapasite: R[]; sayilar: R };

/** YG-346: firma ana kayıt görünümü — tüm ilişkiler tek özet. */
export function FirmaOzet({ id }: { id: string }) {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => { setV(null); void istek<V>(`/firma/${id}/ozet`).then(setV).catch(() => setV(null)); }, [id]);
  if (!v) return null;
  const k = v.kimlik; const s = v.sayilar; const tr = (x: unknown) => (x ? String(x).split('-').reverse().join('.') : '---');
  const liste = (b: string, l: R[], f: (x: R) => string) => <><div className="bolum">{b}</div>{l.length ? l.map((x, n) => <div key={n}>{f(x)}</div>) : <div className="not">Kayıt bulunmamaktadır.</div>}</>;
  return <details className="ozet" open><summary>Firma Ana Kaydı</summary>
    <div>{k.sicil_no} · {k.kayit_rolu} · {k.kayit_asamasi} · Ağ: {k.ag_statusu ?? '---'}{k.risk_derecesi ? ` · Risk: ${k.risk_derecesi}` : ''}</div>
    <div>{k.il ?? '---'}{k.ilce ? `/${k.ilce}` : ''}{k.ilce_teyitli ? ' (ilçe teyitli)' : ''}{k.hizmet_kumesi ? ` · Hizmet kümesi: ${k.hizmet_kumesi}` : ''}{k.acil_hizmet_verir ? ' · Acil hizmet verir' : ''}</div>
    <div>Personel: {s.personel} (kritik {s.kritik_personel}) · Kullanıcı: {s.kullanici} · Ekipman: {s.ekipman}{Number(s.ekipman_suresi_dolan) ? ` (süresi dolan ${s.ekipman_suresi_dolan})` : ''} · İş emri: {s.acik_is_emri} açık / {s.toplam_is_emri} toplam</div>
    {liste('Sözleşmeler', v.sozlesmeler, (x) => `${x.sozlesme_turu} · ${tr(x.yururluk)}${x.bitis ? ` – ${tr(x.bitis)}` : ''} · ${x.durum}`)}
    {liste('Branş Yetkinlikleri', v.branslar, (x) => `${x.ana_brans} · ${x.kapsama}${x.bolge ? ` · ${x.bolge}` : ''} · ${x.durum}`)}
    {liste('Belgeler', v.belgeler, (x) => `${x.tur} · ${tr(x.gecerlilik_bitis)}${x.suresi_dolmus ? ' · Süresi dolmuş' : ''}`)}
    {liste('Tesisler', v.tesisler, (x) => `${x.tesis_kodu} · ${x.ad}${x.il ? ` · ${x.il}${x.ilce ? `/${x.ilce}` : ''}` : ''}${x.aktif ? '' : ' · Pasif'}`)}
    {liste('Kapasite', v.kapasite, (x) => `${x.ana_brans} · ${x.gorev_sinifi ?? 'Tüm sınıflar'} · ${x.tesis ?? 'Tüm yerler'} · ${x.es_zamanli_is} eş zamanlı iş`)}
  </details>;
}
