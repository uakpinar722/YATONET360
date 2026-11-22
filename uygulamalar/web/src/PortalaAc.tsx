import { useEffect, useRef, useState } from 'react';
import { istek } from './api';
import { belgeYukle } from './Kalite';

type Alan = { x: number; y: number; w: number; h: number };
/** YG-458, YG-462, YG-1170: fotoğraf, video veya PDF kanıtı yat sahibi portalına açılır; fotoğrafta firma adı, logosu ve imzası sürüklenerek kapatılır, PDF ve videoda görünmediği teyit edilir. */
export function PortalaAc({ dosya }: { dosya: string }) {
  const [belge, setBelge] = useState(''); const [onizleme, setOnizleme] = useState(''); const [alanlar, setAlanlar] = useState<Alan[]>([]);
  const [aciklama, setAciklama] = useState(''); const [teyit, setTeyit] = useState(false); const [m, setM] = useState(''); const [h, setH] = useState('');
  const bas = useRef<{ x: number; y: number } | null>(null); const [taslak, setTaslak] = useState<Alan | null>(null); const kutu = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (onizleme) URL.revokeObjectURL(onizleme); }, [onizleme]);
  const konum = (e: React.PointerEvent) => { const r = kutu.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const alan = (a: { x: number; y: number }, b: { x: number; y: number }): Alan => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const sec = (f: File) => {
    setH(''); setM(''); setAlanlar([]); setTeyit(false); setBelge('');
    setOnizleme(/\.(jpe?g|png|webp)$/i.test(f.name) ? URL.createObjectURL(f) : '');
    void belgeYukle(f, 'Dosya', dosya).then(setBelge).catch((x) => setH((x as Error).message));
  };
  const kutuStil = (a: Alan) => ({ position: 'absolute' as const, left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%`, background: '#000' });
  const gonder = () => void istek(`/dosya/${dosya}/ilerleme-fotografi`, { belge, aciklama, ...(alanlar.length ? { maske: alanlar } : { teyit }) })
    .then(() => { setM('Yat sahibi portalına açıldı.'); setBelge(''); setOnizleme(''); setAlanlar([]); setAciklama(''); setTeyit(false); }).catch((x) => setH((x as Error).message));
  return <>
    <div className="bolum">İlerleme Fotoğrafını Portala Aç</div>
    {m && <div className="not" role="status">{m}</div>}
    <label htmlFor="pf-d">Fotoğraf, Video veya PDF</label><input id="pf-d" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) sec(f); }} />
    {h && <div className="hata" role="alert">{h}</div>}
    {onizleme && <><div className="not">Firma adı, logosu veya imzası görünen alanları fareyle ya da parmakla sürükleyerek kapatınız; yat sahibine yalnız kapatılmış kopya gider.</div>
      <div ref={kutu} style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
        onPointerDown={(e) => { bas.current = konum(e); (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (bas.current) setTaslak(alan(bas.current, konum(e))); }}
        onPointerUp={(e) => { if (bas.current) { const a = alan(bas.current, konum(e)); if (a.w > 0.01 && a.h > 0.01) setAlanlar([...alanlar, a]); } bas.current = null; setTaslak(null); }}>
        <img src={onizleme} alt="Önizleme" draggable={false} style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh' }} />
        {alanlar.map((a, n) => <div key={n} style={kutuStil(a)} />)}{taslak && <div style={{ ...kutuStil(taslak), background: 'rgba(0,0,0,.5)' }} />}
      </div>
      {alanlar.length > 0 && <div className="dugmeler"><span>{alanlar.length} alan kapatıldı</span><button className="btn2 kucuk" onClick={() => setAlanlar(alanlar.slice(0, -1))}>Son Alanı Geri Al</button></div>}</>}
    {belge && !alanlar.length && <label className="secim"><input type="checkbox" checked={teyit} onChange={(e) => setTeyit(e.target.checked)} /> Firma adı, logosu ve imzası görünmüyor{onizleme ? '' : ' (PDF ve videoda kapatılmış sürüm yüklenmiştir)'}</label>}
    <label htmlFor="pf-a">Yat Sahibinin Göreceği Açıklama</label><input required id="pf-a" value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
    <button className="btn2 kucuk" disabled={!belge || !aciklama.trim() || (!alanlar.length && !teyit)} onClick={gonder}>Portala Aç</button>
  </>;
}
