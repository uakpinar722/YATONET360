import { useEffect, useState } from 'react';
import { istek } from './api';

const tutar = (x: number) => x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type V = { asgari: number | null; yetkiVerir: boolean; bantlar: { rol: string; rol_adi: string; alt_tl: string; ust_tl: string }[]; yetkililer: { kimlik: string; ad_soyad: string }[] };
type Tk = { kimlik: string; aday_adi: string; rol_adi: string; brut_tl?: string; bant_disi: boolean; durum: string };
/** YG-1082: ücret bandı ve ücret teklifi; sınırlar yalnız yetkiliye görünür. */
export function UcretBandi() {
  const [v, setV] = useState<V | null>(null); const [tk, setTk] = useState<Tk[] | null>(null); const [roller, setRoller] = useState<{ kimlik: string; rol_adi: string }[]>([]);
  const [f, setF] = useState({ rol: '', alt: '', ust: '' }); const [t, setT] = useState({ aday: '', rol: '', brut: '', gerekce: '' }); const [yk, setYk] = useState(''); const [m, setM] = useState('');
  const yukle = () => { void istek<V>('/ucret-bandi').then(setV).catch(() => setV(null)); void istek<Tk[]>('/ucret-teklifi').then(setTk).catch(() => setTk(null)); };
  useEffect(() => { yukle(); void istek<{ kimlik: string; rol_adi: string }[]>('/ucret-teklifi/roller').then(setRoller).catch(() => setRoller([])); }, []);
  if (!v && !tk) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then((r) => { setM((r as { durum?: string }).durum === 'CEO Onayında' ? 'Ücret bant dışındadır; CEO onayına gönderildi.' : s); yukle(); }).catch((e) => setM(e.message));
  const rolSec = (id: string, d: string, k: (x: string) => void) => <select id={id} value={d} onChange={(e) => k(e.target.value)}><option value="">Seçiniz</option>{(roller.length ? roller : v?.bantlar.map((b) => ({ kimlik: b.rol, rol_adi: b.rol_adi })) ?? []).map((r) => <option key={r.kimlik} value={r.kimlik}>{r.rol_adi}</option>)}</select>;
  return <details><summary>Ücret Bandı ve Teklifleri</summary>{m && <div className="not" role="status">{m}</div>}
    {v && <><div className="not">Asgari Ücret (Brüt): {v.asgari === null ? 'İnsan Kaynakları Müdürü girmedi' : `${tutar(v.asgari)} TL`}</div>
      {v.bantlar.map((b) => <div className="soru" key={b.rol}><span>{b.rol_adi} · {tutar(Number(b.alt_tl))} TL – {tutar(Number(b.ust_tl))} TL</span></div>)}
      <label htmlFor="ub-r">Rol</label>{rolSec('ub-r', f.rol, (x) => setF({ ...f, rol: x }))}<label htmlFor="ub-a">Alt Sınır (TL)</label><input id="ub-a" inputMode="decimal" value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value })} /><label htmlFor="ub-u">Üst Sınır (TL)</label><input id="ub-u" inputMode="decimal" value={f.ust} onChange={(e) => setF({ ...f, ust: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek('/ucret-bandi', { rol: f.rol, alt: Number(f.alt.replace(/\./g, '').replace(',', '.')), ust: Number(f.ust.replace(/\./g, '').replace(',', '.')) }), 'Bant kaydedildi.')}>Bandı Kaydet</button>
      {v.yetkiVerir && <><div className="not">Bandı Görebilenler: {v.yetkililer.map((x) => x.ad_soyad).join(', ') || 'Yok'}</div><label htmlFor="ub-y">Personel Kimliği</label><input id="ub-y" value={yk} onChange={(e) => setYk(e.target.value)} /><button className="btn2 kucuk" onClick={() => is(istek('/ucret-bandi/yetki', { kullanici: yk }), 'Yetki verildi.')}>Yetki Ver</button><button className="btn2 kucuk" onClick={() => is(istek('/ucret-bandi/yetki', { kullanici: yk, kaldir: true }), 'Yetki kaldırıldı.')}>Yetkiyi Kaldır</button></>}</>}
    {tk && <><div className="bolum">Ücret Teklifleri</div>{tk.map((x) => <div className="soru" key={x.kimlik}><span>{x.aday_adi} · {x.rol_adi}{x.brut_tl ? ` · ${tutar(Number(x.brut_tl))} TL` : ''}{x.bant_disi ? ' · Bant Dışı' : ''} · {x.durum}</span></div>)}
      <label htmlFor="ut-a">Aday</label><input id="ut-a" value={t.aday} onChange={(e) => setT({ ...t, aday: e.target.value })} /><label htmlFor="ut-r">Rol</label>{rolSec('ut-r', t.rol, (x) => setT({ ...t, rol: x }))}<label htmlFor="ut-b">Brüt Ücret (TL)</label><input id="ut-b" inputMode="decimal" value={t.brut} onChange={(e) => setT({ ...t, brut: e.target.value })} /><label htmlFor="ut-g">Gerekçe (Bant Dışıysa)</label><input id="ut-g" value={t.gerekce} onChange={(e) => setT({ ...t, gerekce: e.target.value })} />
      <button className="btn2 kucuk" onClick={() => is(istek('/ucret-teklifi', { ...t, brut: Number(t.brut.replace(/\./g, '').replace(',', '.')) }), 'Teklif kaydedildi.')}>Teklifi Kaydet</button></>}</details>;
}
