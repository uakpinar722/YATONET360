import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { varlik: string; alan: string; teknik: string; tip: string; zorunlu: string; sinif: string; kisisel: string; saklama: string };
/** YG-1243: ortak veri sözlüğü araması. */
export function VeriSozlugu() {
  const [q, setQ] = useState(''); const [v, setV] = useState<{ toplam: number; satirlar: S[] } | null>(null); const [m, setM] = useState('');
  return <details><summary>Veri Sözlüğü</summary>{m && <div className="not" role="alert">{m}</div>}
    <label htmlFor="vs-q">Alan veya Varlık</label><input id="vs-q" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn2 kucuk" disabled={q.trim().length < 2} onClick={() => void istek<NonNullable<typeof v>>(`/veri-sozlugu?q=${encodeURIComponent(q)}`).then((x) => { setV(x); setM(''); }).catch((e) => setM(e.message))}>Ara</button>
    {v && <div className="ozet"><div>Bulunan: {v.toplam}</div>{v.satirlar.map((x) => <div key={`${x.varlik}:${x.teknik}`}>{x.varlik} · {x.alan} ({x.teknik}) · {x.tip} · {x.zorunlu} · {x.sinif} · Kişisel Veri: {x.kisisel} · {x.saklama}</div>)}</div>}</details>;
}

type E = { varlik: string; alanSayisi: number; ozelNitelikli: number; saklama: string[]; ilgiliKisi: string | null; kategori: string | null; amac: string | null; hukuki: string | null; alici: string | null; tedbir: string | null; tamam: boolean };
const ALAN = [['ilgiliKisi', 'İlgili Kişi Grubu'], ['kategori', 'Veri Kategorisi'], ['amac', 'İşleme Amacı'], ['hukuki', 'Hukuki Sebep'], ['alici', 'Alıcı'], ['tedbir', 'Güvenlik Tedbiri']] as const;
/** YG-1179: kişisel veri envanteri; Hukuk tamamlar. */
export function VeriEnvanteri() {
  const [l, setL] = useState<E[] | null>(null); const [s, setS] = useState(''); const [f, setF] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<E[]>('/veri-envanteri').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  if (!l) return null;
  const sec = l.find((x) => x.varlik === s);
  return <details><summary>Kişisel Veri Envanteri · {l.filter((x) => x.tamam).length} / {l.length}</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="ve-v">Varlık</label><select id="ve-v" value={s} onChange={(e) => { const x = l.find((z) => z.varlik === e.target.value); setS(e.target.value); setF({ ilgiliKisi: x?.ilgiliKisi ?? '', kategori: x?.kategori ?? '', amac: x?.amac ?? '', hukuki: x?.hukuki ?? '', alici: x?.alici ?? '', tedbir: x?.tedbir ?? '' }); }}><option value="">Seçiniz</option>{l.map((x) => <option key={x.varlik} value={x.varlik}>{x.tamam ? '' : '• '}{x.varlik}</option>)}</select>
    {sec && <><div className="ozet"><div>{sec.alanSayisi} kişisel alan{sec.ozelNitelikli ? ` · ${sec.ozelNitelikli} özel nitelikli` : ''}</div><div>{sec.saklama.join(' · ')}</div></div>{ALAN.map(([k, et]) => <span key={k}><label htmlFor={`ve-${k}`}>{et}</label><input id={`ve-${k}`} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></span>)}<button className="btn2 kucuk" onClick={() => void istek('/veri-envanteri', { varlik: s, ...f }).then(() => { setM('Envanter kaydedildi.'); return yk(); }).catch((e) => setM(e.message))}>Kaydet</button></>}</details>;
}

type P = { kimlik: string; problem_no: string; kaynak: string; baslik: string; hedef_tarih: string; durum: string; sorumlu: string };
type B = { kimlik: string; bulgu_no: string; kosul: string; kok_neden: string; hedef_tarih: string; durum: string; sorumlu: string; iliskili: number };
type V = { problemler: P[]; bulgular: B[]; kisiler: { kimlik: string; ad_soyad: string }[] };
/** YG-1286, YG-1293: problem kaydı ve sistem denetimi bulguları. */
export function ProblemBulgu() {
  const [v, setV] = useState<V | null>(null); const [p, setP] = useState<Record<string, string>>({ kaynak: 'Tekrarlayan Olay' }); const [b, setB] = useState<Record<string, string>>({}); const [n, setN] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<V>('/problem-kayitlari').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (x: Promise<unknown>, t: string) => void x.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  const K = (d: Record<string, string>, set: (x: Record<string, string>) => void, k: string, et: string, tip = 'text') => <span key={k}><label htmlFor={`pb-${k}`}>{et}</label><input id={`pb-${k}`} type={tip} value={d[k] ?? ''} onChange={(e) => set({ ...d, [k]: e.target.value })} /></span>;
  const S = (d: Record<string, string>, set: (x: Record<string, string>) => void, id: string) => <><label htmlFor={id}>Sorumlu</label><select id={id} value={d.sorumlu ?? ''} onChange={(e) => set({ ...d, sorumlu: e.target.value })}><option value="">Seçiniz</option>{v.kisiler.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.ad_soyad}</option>)}</select></>;
  return <details><summary>Problem ve Denetim Bulguları</summary>{m && <div className="not" role="status">{m}</div>}
    {v.problemler.map((x) => <div className="soru" key={x.kimlik}><span>{x.problem_no} · {x.kaynak} · {x.baslik} · {x.sorumlu} · {x.durum}</span>{x.durum === 'Açık' && <div className="tam">{K(n, setN, `k-${x.kimlik}`, 'Kök Neden')}{K(n, setN, `c-${x.kimlik}`, 'Kalıcı Çözüm')}<button className="btn2 kucuk" onClick={() => is(istek(`/problem-kaydi/${x.kimlik}/kapat`, { kokNeden: n[`k-${x.kimlik}`], cozum: n[`c-${x.kimlik}`] }), 'Problem kapatıldı.')}>Kapat</button></div>}</div>)}
    <label htmlFor="pb-kaynak">Problem Kaynağı</label><select id="pb-kaynak" value={p.kaynak} onChange={(e) => setP({ ...p, kaynak: e.target.value })}><option>Tekrarlayan Olay</option><option>Yüksek Etkili Olay</option><option>Denetim Bulgusu</option><option>Eğilim</option></select>
    {K(p, setP, 'baslik', 'Başlık')}{K(p, setP, 'aciklama', 'Açıklama')}{S(p, setP, 'pb-ps')}{K(p, setP, 'hedef', 'Hedef Tarih', 'date')}{K(p, setP, 'geciciCozum', 'Geçici Çözüm')}<button className="btn2 kucuk" onClick={() => is(istek('/problem-kaydi', p).then(() => setP({ kaynak: 'Tekrarlayan Olay' })), 'Problem kaydı açıldı.')}>Problem Aç</button>
    <div className="bolum">Denetim Bulguları</div>
    {v.bulgular.map((x) => <div className="soru" key={x.kimlik}><span>{x.bulgu_no} · {x.kosul} · {x.sorumlu} · {x.durum}{x.iliskili ? ` · ${x.iliskili} ilişkili bulgu` : ''}</span>{x.durum !== 'Kapalı' && <div className="tam">{K(n, setN, `d-${x.kimlik}`, 'Bağımsız Doğrulama Kanıtı')}<button className="btn2 kucuk" onClick={() => is(istek(`/sistem-bulgusu/${x.kimlik}/kapat`, { dogrulama: n[`d-${x.kimlik}`] }), 'Bulgu kapatıldı.')}>Kapat</button>{K(n, setN, `b-${x.kimlik}`, 'İstisna Bitişi', 'date')}{K(n, setN, `r-${x.kimlik}`, 'Kalan Risk')}<button className="btn2 kucuk" onClick={() => is(istek(`/sistem-bulgusu/${x.kimlik}/istisna`, { bitis: n[`b-${x.kimlik}`], kalanRisk: n[`r-${x.kimlik}`] }), 'İstisna kaydedildi.')}>Süreli İstisna</button></div>}</div>)}
    {K(b, setB, 'kosul', 'Koşul')}{K(b, setB, 'olcut', 'Ölçüt')}{K(b, setB, 'kanit', 'Kanıt')}{K(b, setB, 'neden', 'Neden / Risk')}{K(b, setB, 'kapsam', 'Kapsam')}{K(b, setB, 'kokNeden', 'Kök Neden')}{S(b, setB, 'pb-bs')}{K(b, setB, 'hedef', 'Hedef Tarih', 'date')}<button className="btn2 kucuk" onClick={() => is(istek('/sistem-bulgusu', b).then(() => setB({})), 'Bulgu kaydedildi.')}>Bulgu Ekle</button></details>;
}
