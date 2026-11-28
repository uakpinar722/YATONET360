import { useEffect, useState } from 'react';
import { istek } from './api';
import { Bos, kalan, Rozet } from './Bugun';

type Kisi = { kimlik: string; ad: string; yuk: number; ust: number | null };
type Satir = { kimlik: string; dosya_no: string; oncelik: string; yat_adi: string; son: string | null; eksik: string[]; oneri: Record<string, string | null> };
type Bolum = { vekaletRolu: string; ekip: Record<string, Kisi[]>; kuyruk: Satir[] };

const yukYazi = (k: Kisi) => k.ust === null ? k.ad : `${k.ad} · ${k.yuk.toLocaleString('tr-TR')}/${k.ust}${k.yuk >= k.ust ? ' · Dolu' : ''}`;

/** YG-1583, YG-1587: Müdür Yardımcısının Atama sayfası; yalnız vekâlette görünür, YATONET önerisi ve yük ile; atama kabul adımı olmadan yürürlüğe girer. */
export function AtamaSayfasi() {
  const [v, setV] = useState<{ operasyon?: Bolum; teknik?: Bolum } | null>(null); const [n, setN] = useState(0);
  const [sec, setSec] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  useEffect(() => { void istek<{ operasyon?: Bolum; teknik?: Bolum }>('/atama-sayfasi').then(setV).catch((e) => setM(e.message)); }, [n]);
  if (!v) return <><h1>Atama</h1>{m && <div className="hata" role="alert">{m}</div>}</>;
  const bolumler = [v.operasyon, v.teknik].filter(Boolean) as Bolum[];
  const [tal, setTal] = useState<Record<string, string>>({});
  const ata = (dosya: string, rol: string, kisi: string, talimat?: string) => void istek<{ uyari?: string | null }>(`/dosya/${dosya}/ekip`, { kullanici: kisi, rol, talimat: talimat?.trim() || undefined })
    .then((r) => { setM(`${rol} atandı.${r?.uyari ? ` ${r.uyari}` : ''}`); setN(n + 1); }).catch((e) => setM(e.message));
  return <>
    <h1>Atama</h1>
    {m && <div className="not" role="status">{m}</div>}
    {bolumler.length === 0 && <Bos m="Atama sayfası Müdür vekâletinde açılır; şu an yürüttüğünüz bir vekâlet bulunmamaktadır." />}
    {bolumler.map((b) => <div key={b.vekaletRolu}>
      <div className="bolum">{b.vekaletRolu} Vekâleten · Atama Bekleyenler</div>
      {b.kuyruk.length === 0 ? <Bos m="Atama bekleyen dosya bulunmamaktadır." /> : b.kuyruk.map((k) => { const kl = k.son ? kalan(k.son) : null; return <div key={k.kimlik} className={`ozet kart-sol${k.oncelik === 'Kritik' ? ' hata' : ''}`}>
        <div className="ust2"><b>{k.dosya_no} · {k.yat_adi}</b>{kl && <Rozet s={kl.sinif} y={kl.yanip} c={kl.yazi} />}</div>
        <div className="not">{k.oncelik} · Atanacak: {k.eksik.join(', ')}</div>
        {k.eksik.map((rol) => { const a = `${k.kimlik}:${rol}`; const l = b.ekip[rol] ?? []; const on = k.oneri[rol]; const deger = sec[a] ?? on ?? '';
          return <div key={rol}>
            <label htmlFor={`at-${a}`}>{rol}{on ? ` · YATONET önerisi: ${l.find((x) => x.kimlik === on)?.ad ?? ''}` : ''}</label>
            <select id={`at-${a}`} value={deger} onChange={(e) => setSec({ ...sec, [a]: e.target.value })}><option value="">Seçiniz</option>{l.map((x) => <option key={x.kimlik} value={x.kimlik} disabled={x.ust !== null && x.yuk >= x.ust}>{yukYazi(x)}</option>)}</select>
            <label htmlFor={`tl-${a}`}>Talimat (isteğe bağlı)</label><input id={`tl-${a}`} value={tal[a] ?? ''} onChange={(e) => setTal({ ...tal, [a]: e.target.value })} />
            <button className="btn evet" disabled={!deger} onClick={() => ata(k.kimlik, rol, deger, tal[a])}>Ata</button>
          </div>; })}
      </div>; })}
      <div className="bolum">Ekip Yükü</div>
      {Object.entries(b.ekip).map(([rol, l]) => <div key={rol} className="ozet"><b>{rol}</b>{l.length === 0 ? <div className="not">Bu rolde aktif personel bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik} className="not">{yukYazi(x)}</div>)}</div>)}
    </div>)}
  </>;
}
