import { useEffect, useState } from 'react';
import { istek } from './api';
import { tarihSaat } from './bicim';

interface V { yontemler: string[]; firmalar: { kimlik: string; ticari_unvan: string }[]; fotograf: number; kayitlar: { yontem: string; firma: string | null; firma_on_kesif_ozeti: string | null; gorusme_zamani: string | null; sonuc: string; acil_tedbir: string; zaman: string; degerlendiren: string }[] }

/** YG-1483: Kritik dosyada acil tedbir değerlendirmesi; Teknik Uzman bölgede değilse firma ön keşfi, yönlendirmeli fotoğraf ve görüntülü değerlendirme. */
export function AcilDegerlendirme({ id, tu }: { id: string; tu: boolean }) {
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState('');
  const [f, setF] = useState({ yontem: 'Yerinde', firma: '', firmaOzeti: '', gorusmeZamani: '', sonuc: '', tedbir: '' });
  const yukle = () => istek<V>(`/dosya/${id}/acil-degerlendirme`).then(setV).catch(() => setV(null));
  useEffect(() => { void yukle(); }, [id]);
  if (!v) return null;
  const uzak = f.yontem !== 'Yerinde';
  return <><div className="bolum">Acil Tedbir Değerlendirmesi</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x, n) => <div key={n}>{tarihSaat(x.zaman)} · {x.yontem}{x.firma ? ` · ${x.firma}` : ''}{x.gorusme_zamani ? ` · görüntülü ${tarihSaat(x.gorusme_zamani)}` : ''} · {x.sonuc} · Tedbir: {x.acil_tedbir} · {x.degerlendiren}</div>)}
    {v.kayitlar.length === 0 && <div className="not">Kritik dosya: acil tedbir değerlendirmesi sahaya ulaşma süresi içinde yapılır.</div>}
    {tu && <>
      <label htmlFor="ad-y">Yöntem</label><select id="ad-y" value={f.yontem} onChange={(e) => setF({ ...f, yontem: e.target.value })}>{v.yontemler.map((x) => <option key={x}>{x}</option>)}</select>
      {uzak && <>
        <label htmlFor="ad-f">Ön Keşfi Yapan Firma</label><select id="ad-f" value={f.firma} onChange={(e) => setF({ ...f, firma: e.target.value })}><option value="">Seçiniz</option>{v.firmalar.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ticari_unvan}</option>)}</select>
        <label htmlFor="ad-o">Firma Ön Keşif Özeti</label><textarea id="ad-o" value={f.firmaOzeti} onChange={(e) => setF({ ...f, firmaOzeti: e.target.value })} />
        <label htmlFor="ad-z">Görüntülü Değerlendirme Zamanı</label><input id="ad-z" type="datetime-local" value={f.gorusmeZamani} onChange={(e) => setF({ ...f, gorusmeZamani: e.target.value })} />
        {v.fotograf === 0 && <div className="uyari">Yönlendirmeli fotoğraf dosyaya yüklenmelidir.</div>}
      </>}
      <label htmlFor="ad-s">Değerlendirme Sonucu</label><textarea id="ad-s" value={f.sonuc} onChange={(e) => setF({ ...f, sonuc: e.target.value })} />
      <label htmlFor="ad-t">Acil Tedbir</label><textarea id="ad-t" value={f.tedbir} onChange={(e) => setF({ ...f, tedbir: e.target.value })} />
      <button className="btn2" disabled={!f.sonuc.trim() || !f.tedbir.trim() || (uzak && (!f.firma || !f.firmaOzeti.trim() || !f.gorusmeZamani))} onClick={() => void istek<{ yerindeKesif: boolean }>(`/dosya/${id}/acil-degerlendirme`, { ...f, gorusmeZamani: f.gorusmeZamani ? new Date(f.gorusmeZamani).toISOString() : undefined }).then((r) => { setM(r.yerindeKesif ? 'Değerlendirme kaydedildi; yerinde keşif görevi açıldı.' : 'Değerlendirme kaydedildi.'); return yukle(); }).catch((e) => setM(e.message))}>Değerlendirmeyi Kaydet</button>
    </>}
  </div></>;
}
