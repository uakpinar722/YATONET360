import { useEffect, useState } from 'react';
import { istek } from './api';

type Mesaj = { kimlik: string; zaman: string; metin: string; lgm: boolean; gonderen: string; oncelik?: string; bekleyen_oncelik?: string | null; tehlike?: boolean; yanit_son?: string | null; yanitlandi_zamani?: string | null; dis_taraf_ref?: string; taraf?: string };
type Veri = { yazabilir: boolean; yanitBekleyen?: number; taraflar?: { kimlik: string; ad_soyad: string }[]; mesajlar: Mesaj[] };
const zaman = (z: string) => new Date(z).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });

/** YG-1663, YG-1666: dosyaya bağlı yazışma. Dış taraf yalnız kendi yazışmasını görür; LGM tarafı rolle görünür. Gönderen öncelik seçmez. */
export function DosyaYazismasi({ id, ic, dosyaSorumlusu }: { id: string; ic?: boolean; dosyaSorumlusu?: boolean }) {
  const [v, setV] = useState<Veri | null>(null); const [metin, setMetin] = useState(''); const [taraf, setTaraf] = useState(''); const [m, setM] = useState('');
  const [onc, setOnc] = useState<Record<string, { oncelik: string; gerekce: string }>>({});
  const yk = () => void istek<Veri>(`/dosya/${id}/yazisma`).then(setV).catch(() => setV(null));
  useEffect(yk, [id]);
  if (!v) return null;
  const liste = ic && taraf ? v.mesajlar.filter((x) => x.dis_taraf_ref === taraf) : v.mesajlar;
  const gonder = () => void istek(`/dosya/${id}/yazisma`, { metin, taraf: ic ? taraf : undefined }).then(() => { setMetin(''); setM('Mesajınız gönderildi.'); yk(); }).catch((e) => setM(e.message));
  return (
    <div>
      <div className="bolum">Dosya Yazışması{ic && v.yanitBekleyen ? ` · Yanıt Bekleyen: ${v.yanitBekleyen}` : ''}</div>
      {ic && !v.yazabilir && <div className="not">Dosyaya atanmadığınız için yazışmayı salt okunur izlersiniz.</div>}
      {ic && (v.taraflar?.length ?? 0) > 0 && <><label htmlFor={`dy-t-${id}`}>Dış Taraf</label><select id={`dy-t-${id}`} value={taraf} onChange={(e) => setTaraf(e.target.value)}><option value="">Tümü</option>{v.taraflar!.map((t) => <option key={t.kimlik} value={t.kimlik}>{t.ad_soyad}</option>)}</select></>}
      <div className="ozet">{liste.length === 0 ? 'Mesaj bulunmamaktadır.' : liste.map((x) => <div key={x.kimlik}>
        <div className="not">{zaman(x.zaman)} · {x.gonderen}{ic && x.taraf ? ` · ${x.taraf}` : ''}{ic && x.oncelik ? ` · ${x.oncelik}${x.bekleyen_oncelik ? ` (Düşürme onayda: ${x.bekleyen_oncelik})` : ''}` : ''}{ic && !x.lgm && !x.yanitlandi_zamani && x.yanit_son ? ` · Yanıt son: ${zaman(x.yanit_son)}` : ''}</div>
        <div>{x.metin}</div>
        {ic && dosyaSorumlusu && x.oncelik && !x.bekleyen_oncelik && <span><label htmlFor={`dy-o-${x.kimlik}`}>Öncelik</label><select id={`dy-o-${x.kimlik}`} value={onc[x.kimlik]?.oncelik ?? x.oncelik} onChange={(e) => setOnc({ ...onc, [x.kimlik]: { oncelik: e.target.value, gerekce: onc[x.kimlik]?.gerekce ?? '' } })}>{['Kritik', 'Yüksek', 'Normal', 'Planlı'].map((o) => <option key={o}>{o}</option>)}</select>
          <label htmlFor={`dy-g-${x.kimlik}`}>Gerekçe (Düşürmede Zorunlu)</label><input id={`dy-g-${x.kimlik}`} value={onc[x.kimlik]?.gerekce ?? ''} onChange={(e) => setOnc({ ...onc, [x.kimlik]: { oncelik: onc[x.kimlik]?.oncelik ?? x.oncelik!, gerekce: e.target.value } })} />
          <button className="btn2 kucuk" disabled={!onc[x.kimlik] || onc[x.kimlik]!.oncelik === x.oncelik} onClick={() => void istek<{ durum?: string }>(`/dosya-yazismasi/${x.kimlik}/oncelik`, onc[x.kimlik]).then((r) => { setM(r.durum ? 'Öncelik düşürme Operasyon Müdürü onayına gönderildi.' : 'Öncelik yükseltildi.'); yk(); }).catch((e) => setM(e.message))}>Önceliği Kaydet</button></span>}
      </div>)}</div>
      {v.yazabilir && <>
        <label htmlFor={`dy-m-${id}`}>Mesaj</label><textarea id={`dy-m-${id}`} rows={3} maxLength={4000} value={metin} onChange={(e) => setMetin(e.target.value)} />
        <div className="not">Acil durumlarda lütfen Acil Durum düğmesini kullanınız. Gönderilen mesaj silinemez ve düzeltilemez; mesaj onay yerine geçmez.</div>
        <button className="btn2 kucuk" disabled={!metin.trim() || (ic && !taraf)} onClick={gonder}>Gönder</button>
      </>}
      {m && <div className="not" role="status">{m}</div>}
    </div>
  );
}
