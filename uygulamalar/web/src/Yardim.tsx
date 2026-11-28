import { useEffect, useState } from 'react';
import { istek } from './api';

type Icerik = { kimlik: string; tur: string; baslik: string; metin: string | null; dil: string; hedef: string; sira: number; durum: string; dosya: { uzanti: string; surum: number } | null };
type V = { yonetici: 'Tam' | 'SSS' | null; hedefler: string[]; icerik: Icerik[] };

async function dosyaYukle(f: File, kimlik: string) {
  const q = new URLSearchParams({ ad: f.name, tur: 'Yardım İçeriği', bagTuru: 'Yardım İçeriği', bagKimligi: kimlik, kaynak: 'Sistem', dosya: f.name, sinif: 'Kamuya Açık', gerekce: 'Güncel sürüm' });
  const r = await fetch(`/api/belge/yukle?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Yatonet': '1' }, body: f, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.hata ?? 'Yükleme tamamlanamadı.');
}

/** YG-1502, YG-1503, YG-1581: Yardım sayfası ve Akademide videolar (izlemek zorunlu değil), sıkça sorulan sorular ve kılavuzlar; sayfa içi arama. */
export function YardimIcerigi({ yalnizVideo = false, videoBasligi = 'Eğitim Videoları' }: { yalnizVideo?: boolean; videoBasligi?: string }) {
  const [v, setV] = useState<V | null>(null); const [q, setQ] = useState(''); const [m, setM] = useState('');
  const [f, setF] = useState({ tur: 'Sıkça Sorulan Soru', baslik: '', metin: '', dil: 'Türkçe', hedef: 'Tüm Kullanıcılar' });
  const yk = (ara = q) => istek<V>(`/yardim?${new URLSearchParams({ q: ara, ...(yalnizVideo ? { tur: 'Video' } : {}) })}`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(''); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM((e as Error).message));
  const grup = (tur: string, baslik: string) => { const l = v.icerik.filter((x) => x.tur === tur); return l.length > 0 && <><div className="bolum">{baslik}</div>{l.map((x) => <div className="ozet" key={x.kimlik}>
    {tur === 'Sıkça Sorulan Soru' ? <details><summary>{x.baslik}</summary><div className="not">{x.metin}</div></details> : <b>{x.baslik}</b>}
    {tur !== 'Sıkça Sorulan Soru' && x.metin && <div className="not">{x.metin}</div>}
    {x.dosya && (x.dosya.uzanti === 'pdf' ? <a href={`/api/yardim-icerigi/${x.kimlik}/dosya`} target="_blank" rel="noreferrer">Kılavuzu Aç</a> : <video controls preload="metadata" src={`/api/yardim-icerigi/${x.kimlik}/dosya`} style={{ width: '100%', maxWidth: 640 }} />)}
    {v.yonetici && <div className="not">{x.hedef} · {x.dil} · {x.durum}{tur === 'Video' && !x.dosya ? ' · Video yüklenmedi' : ''}</div>}
    {v.yonetici && (v.yonetici === 'Tam' || tur === 'Sıkça Sorulan Soru') && <div className="dugmeler">
      <button className="btn2 kucuk" onClick={() => is(istek(`/yardim-icerigi/${x.kimlik}`, { durum: x.durum === 'Aktif' ? 'Pasif' : 'Aktif' }), x.durum === 'Aktif' ? 'İçerik yayından kaldırıldı.' : 'İçerik yayımlandı.')}>{x.durum === 'Aktif' ? 'Yayından Kaldır' : 'Yayımla'}</button>
      {v.yonetici === 'Tam' && tur !== 'Sıkça Sorulan Soru' && <><label htmlFor={`yd-f-${x.kimlik}`}>{tur === 'Video' ? 'Video Dosyası (MP4)' : 'Kılavuz Dosyası (PDF)'}</label><input id={`yd-f-${x.kimlik}`} type="file" accept={tur === 'Video' ? '.mp4,.mov' : '.pdf'} onChange={(e) => { const d = e.target.files?.[0]; if (d) is(dosyaYukle(d, x.kimlik), 'Dosya yüklendi.'); }} /></>}</div>}
  </div>)}</>; };
  return <>{m && <div className="not" role="status">{m}</div>}
    {!yalnizVideo && <><label htmlFor="yd-q">Yardımda Ara</label><input id="yd-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); void yk(e.target.value); }} /></>}
    {grup('Video', videoBasligi)}
    {!yalnizVideo && grup('Sıkça Sorulan Soru', 'Sıkça Sorulan Sorular')}
    {!yalnizVideo && grup('Kılavuz', 'Kılavuzlar')}
    {!yalnizVideo && v.icerik.length === 0 && <div className="ozet bos">{q ? 'Aramanıza uyan içerik bulunamadı.' : 'Henüz yardım içeriği eklenmemiştir.'}</div>}
    {!yalnizVideo && v.yonetici && <details><summary>Yardım İçeriği Ekle</summary>
      <label htmlFor="yd-t">İçerik Türü</label><select id="yd-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{(v.yonetici === 'Tam' ? ['Video', 'Sıkça Sorulan Soru', 'Kılavuz'] : ['Sıkça Sorulan Soru']).map((x) => <option key={x}>{x}</option>)}</select>
      <label htmlFor="yd-b">{f.tur === 'Sıkça Sorulan Soru' ? 'Soru' : 'Başlık'}</label><input id="yd-b" value={f.baslik} onChange={(e) => setF({ ...f, baslik: e.target.value })} />
      <label htmlFor="yd-m">{f.tur === 'Sıkça Sorulan Soru' ? 'Yanıt' : 'Açıklama'}</label><textarea id="yd-m" rows={3} value={f.metin} onChange={(e) => setF({ ...f, metin: e.target.value })} />
      <label htmlFor="yd-d">Dil</label><select id="yd-d" value={f.dil} onChange={(e) => setF({ ...f, dil: e.target.value })}><option>Türkçe</option><option>İngilizce</option></select>
      <label htmlFor="yd-h">Hedef Kitle</label><select id="yd-h" value={f.hedef} onChange={(e) => setF({ ...f, hedef: e.target.value })}>{v.hedefler.map((x) => <option key={x}>{x}</option>)}</select>
      <button className="btn2 kucuk" disabled={!f.baslik.trim()} onClick={() => is(istek('/yardim-icerigi', f).then((r) => { setF({ ...f, baslik: '', metin: '' }); return r; }), 'İçerik eklendi.')}>Ekle</button>
    </details>}
  </>;
}
