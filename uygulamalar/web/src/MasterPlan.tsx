import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { islem_no: string; faz: string; yapilacak: string; muhatap: string; hedef_tarih: string | null; durum: string; verildigi_tarih: string | null; tamamlanma_tarihi: string | null; kayit_no: string | null; ceo_notu: string | null; renk: 'yesil' | 'kirmizi' | null; beklenen_cikti: string | null; kabul_makami: string | null };
type O = { ad: string; kart: number; tamamlandi: number; suruyor: number; bekliyor: number; verilecek: number; gecikti: number; oran: number };
const DURUM = ['Verilecek', 'Görev Verildi', 'Sürüyor', 'Bekliyor', 'Düzeltilecek', 'Tamamlandı'];
const tr = (s: string | null) => (s ? s.split('-').reverse().join('.') : '—');
/** YG-776: Master Plan kart takip listesi. */
export function MasterPlan() {
  const [v, setV] = useState<{ kartlar: K[]; faz: O[]; muhatap: O[]; yonetir: boolean; ceo: boolean } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState(''); const [f, setF] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/master-plan').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const oz = (x: O) => <div className="soru" key={x.ad}><span>{x.ad} · {x.kart} kart · Tamamlandı {x.tamamlandi} · Sürüyor {x.suruyor} · Bekliyor {x.bekliyor} · Verilecek {x.verilecek}{x.gecikti ? ` · Gecikti ${x.gecikti}` : ''} · %{x.oran}</span></div>;
  const al = (k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`mp-${k}`}>{et}</label><input id={`mp-${k}`} type={tip} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  const liste = v.kartlar.filter((k) => !f || k.faz === f);
  return <details><summary>Master Plan Takip · {v.kartlar.filter((k) => k.durum === 'Tamamlandı').length}/{v.kartlar.length} tamamlandı</summary>{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Faz Özeti</div>{v.faz.map(oz)}{v.yonetir && <><div className="bolum">Muhatap Özeti</div>{v.muhatap.map(oz)}</>}
    <label htmlFor="mp-f">Faz</label><select id="mp-f" value={f} onChange={(e) => setF(e.target.value)}><option value="">Tümü</option>{v.faz.map((x) => <option key={x.ad}>{x.ad}</option>)}</select>
    {liste.map((k) => <div className={k.renk === 'kirmizi' ? 'soru hata' : k.renk === 'yesil' ? 'soru basari' : 'soru'} key={k.islem_no}><span><b>{k.islem_no}</b> · {k.yapilacak} · {k.muhatap} · Hedef {tr(k.hedef_tarih)} · {k.durum}{k.verildigi_tarih ? ` · Verildi ${tr(k.verildigi_tarih)}` : ''}{k.tamamlanma_tarihi ? ` · Tamamlandı ${tr(k.tamamlanma_tarihi)}` : ''}{k.kayit_no ? ` · Kayıt ${k.kayit_no}` : ''}{k.ceo_notu ? ` · CEO Notu: ${k.ceo_notu}` : ''}</span>
      {g.ac === k.islem_no ? <div className="tam"><label htmlFor={`mp-d-${k.islem_no}`}>Durum</label><select id={`mp-d-${k.islem_no}`} value={g.durum ?? k.durum} onChange={(e) => setG({ ...g, durum: e.target.value })}>{DURUM.map((d) => <option key={d}>{d}</option>)}</select>
        {al('verildigi', 'Verildiği Tarih', 'date')}{al('tamamlanma', 'Tamamlanma Tarihi', 'date')}{al('kayitNo', 'Kayıt No')}{v.ceo && al('ceoNotu', 'CEO Notu')}
        <button className="btn2 kucuk" onClick={() => void istek(`/master-plan/${encodeURIComponent(k.islem_no)}`, { durum: g.durum ?? k.durum, verildigi: g.verildigi || undefined, tamamlanma: g.tamamlanma || undefined, kayitNo: g.kayitNo || undefined, ...(v.ceo && g.ceoNotu !== undefined ? { ceoNotu: g.ceoNotu } : {}) }).then(() => { setM('Kart güncellendi.'); setG({}); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>
        : <button className="btn2 kucuk" onClick={() => setG({ ac: k.islem_no, verildigi: k.verildigi_tarih ?? '', tamamlanma: k.tamamlanma_tarihi ?? '', kayitNo: k.kayit_no ?? '', ...(v.ceo ? { ceoNotu: k.ceo_notu ?? '' } : {}) })}>Güncelle</button>}</div>)}</details>;
}

type U = Record<string, string | number | boolean | null> & { mum_no: string; yukumluluk: string };
/** YG-1551: Mevzuat Uyum Matrisi yönetimi, sürüm geçmişi ve Excel'e dışa aktarma. */
export function UyumMatrisi() {
  const [v, setV] = useState<{ kurallar: U[]; yonetir: boolean; gecmis: { mum_no: string; gerekce: string; zaman: string; ad_soyad: string | null }[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState(''); const [q, setQ] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/uyum-matrisi').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const al = (k: string, et: string) => <span key={k}><label htmlFor={`um-${k}`}>{et}</label><input id={`um-${k}`} value={g[k] ?? ''} onChange={(e) => setG({ ...g, [k]: e.target.value })} /></span>;
  const s = q.trim().toLocaleLowerCase('tr'); const l = v.kurallar.filter((k) => !s || `${k.mum_no} ${k.mevzuat ?? ''} ${k.yukumluluk}`.toLocaleLowerCase('tr').includes(s));
  return <details><summary>Mevzuat Uyum Matrisi · {v.kurallar.length} kural</summary>{m && <div className="not" role="status">{m}</div>}
    <a className="btn2 kucuk" href="/api/uyum-matrisi/excel">Excel'e Aktar</a>
    <label htmlFor="um-q">Ara</label><input id="um-q" value={q} onChange={(e) => setQ(e.target.value)} />
    {l.map((k) => <div className="soru" key={k.mum_no}><span><b>{k.mum_no}</b> · {String(k.mevzuat ?? '')} {String(k.madde ?? '')} · {k.yukumluluk} · Sorumlu: {String(k.sorumlu_rol ?? '—')} · Süre: {String(k.sure_metni ?? '—')}{k.engelleyici ? ' · Engelleyici' : ''}</span>
      {v.yonetir && <button className="btn2 kucuk" onClick={() => setG(Object.fromEntries(Object.entries(k).map(([a, b]) => [a, b === null ? '' : String(b)])))}>Düzenle</button>}</div>)}
    {v.yonetir && <div className="tam"><div className="bolum">{g.mum_no ? `${g.mum_no} · Düzenle` : 'Yeni Kural'}</div>{al('mum_no', 'MUM No')}{al('alan', 'Alan')}{al('mevzuat', 'Mevzuat')}{al('madde', 'Madde')}{al('yukumluluk', 'Yükümlülük')}{al('tetikleyici', 'Tetikleyici')}{al('sorumlu_rol', 'Sorumlu Rol')}{al('sure_metni', 'Süre')}{al('gerekli_kanit', 'Gerekli Kanıt')}{al('dogrulayan_rol', 'Doğrulayan Rol')}{al('sure_gun', 'Süre (gün)')}{al('gerekce', 'Değişiklik Gerekçesi')}
      <button className="btn2 kucuk" onClick={() => void istek('/uyum-kurali', { ...g, sure_gun: g.sure_gun === '' ? undefined : Number(g.sure_gun), engelleyici: g.engelleyici === 'true' }).then(() => { setM('Kural kaydedildi; değişiklik geçmişe yazıldı.'); setG({}); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></div>}
    <div className="bolum">Değişiklik Geçmişi</div>{v.gecmis.length ? v.gecmis.map((x, i) => <div className="soru" key={i}><span>{new Date(x.zaman).toLocaleString('tr-TR')} · {x.mum_no} · {x.gerekce}{x.ad_soyad ? ` · ${x.ad_soyad}` : ''}</span></div>) : <div className="ozet bos">Değişiklik bulunmamaktadır.</div>}</details>;
}
