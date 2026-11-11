import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type M = { marka: string; model: string; tekne_turu: string | null; boy_m: string | null; govde_malzemesi: string | null; tahrik_turu: string | null; katalog_seri: number | null; katalog_no: string | null; fotograf: string | null; teknik_veri: string | null; durum: string | null; foto_belge_ref: string | null; teknik_bilgi: string | null; bilgi_kaynagi: string | null; bilgi_zamani: string | null };
/** YG-1532 (yalnız LGM iç referans), YG-1533 (keşif ve ruhsat bilgisinin ana veriye işlenmesi), YG-1535 (branş önerisi). */
export function KatalogReferansi({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ model: M | null; bransOnerisi: string[]; teknik: boolean } | null>(null); const [g, setG] = useState({ belge: '', teknik: '', kaynak: 'Teknik Uzman keşfi' }); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${dosya}/katalog-referansi`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v?.model) return null;
  const x = v.model;
  return <details><summary>Ana Veri Model Referansı (LGM içi) · {x.durum ?? '—'}</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="not">Bu bilgi yalnız LGM personeline iç referanstır; yat sahibine, firmaya veya sigortaya gösterilmez, dışa giden belgeye konmaz ve yat sahibinden model teyidi istenmez.</div>
    <div className="soru"><span>{x.marka} {x.model}{x.tekne_turu ? ` · ${x.tekne_turu}` : ''}{x.boy_m ? ` · ${Number(x.boy_m).toLocaleString('tr-TR')} m` : ''}{x.govde_malzemesi ? ` · ${x.govde_malzemesi}` : ''}{x.tahrik_turu ? ` · ${x.tahrik_turu}` : ''}{x.katalog_seri ? ` · Katalog ${x.katalog_seri}/${x.katalog_no ?? ''}` : ''} · Fotoğraf: {x.fotograf ?? '—'} · Teknik veri: {x.teknik_veri ?? '—'}</span></div>
    {x.teknik_bilgi && <div className="soru"><span>Teknik bilgi: {x.teknik_bilgi}{x.bilgi_kaynagi ? ` · Kaynak: ${x.bilgi_kaynagi}` : ''}</span></div>}
    {x.foto_belge_ref && <div className="soru"><span><a href={`/api/belge/${x.foto_belge_ref}/surum/1/indir`} target="_blank" rel="noreferrer">Keşif fotoğrafı</a></span></div>}
    {v.bransOnerisi.length > 0 && <div className="soru"><span>Teknik Uzman ataması için branş önerisi: {v.bransOnerisi.join(', ')}</span></div>}
    {v.teknik && x.durum !== 'Tamam' && <div className="tam"><div className="not">Eksik bilgiyi keşiften veya ruhsattan işleyiniz.</div>
      <label htmlFor="kr-k">Kaynak</label><select id="kr-k" value={g.kaynak} onChange={(e) => setG({ ...g, kaynak: e.target.value })}><option>Teknik Uzman keşfi</option><option>Ruhsat / plaka</option></select>
      <BelgeSec ad="Keşif Fotoğrafı" bagTuru="Dosya" bagKimligi={dosya} deger={g.belge} sec={(b) => setG({ ...g, belge: b })} />
      <label htmlFor="kr-t">Teknik Bilgi (boy, gövde, tahrik vb.)</label><input id="kr-t" value={g.teknik} onChange={(e) => setG({ ...g, teknik: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => void istek<{ durum: string }>(`/dosya/${dosya}/katalog-bilgisi`, { belge: g.belge || undefined, teknikBilgi: g.teknik || undefined, kaynak: g.kaynak }).then((r) => { setM(`Ana veri güncellendi: ${r.durum}.`); return yk(); }).catch((e) => setM(e.message))}>Ana Veriye İşle</button></div>}</details>;
}
