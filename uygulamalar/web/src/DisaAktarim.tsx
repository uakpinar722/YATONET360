import { useEffect, useState } from 'react';
import { istek } from './api';

type Set_ = { ad: string; alanlar: Record<string, string>; hassas: Record<string, string> };
type T = { kimlik: string; veri_seti: string; alanlar: string[]; kayit_sayisi: number; hassas: boolean; durum: string; son_gecerlilik: string | null };
/** YG-755: Yönetici ve üstü; gerekçeli, sınırlı, büyük veya hassas aktarım ek onaylı; indirme dosya kimliğiyle kaydedilir. */
export function DisaAktarim() {
  const [v, setV] = useState<{ setler: Set_[]; talepler: T[] } | null>(null); const [f, setF] = useState({ veriSeti: '', amac: '', gerekce: '' }); const [sec, setSec] = useState<string[]>([]); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/disa-aktarim').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const st = v.setler.find((x) => x.ad === f.veriSeti);
  const kutu = (k: string, et: string, h = false) => <label key={k}><input type="checkbox" checked={sec.includes(k)} onChange={(e) => setSec(e.target.checked ? [...sec, k] : sec.filter((x) => x !== k))} /> {et}{h ? ' (Hassas)' : ''}</label>;
  return <details><summary>Toplu Dışa Aktarma</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="da-s">Veri Seti</label><select id="da-s" value={f.veriSeti} onChange={(e) => { setF({ ...f, veriSeti: e.target.value }); setSec([]); }}><option value="">Seçiniz</option>{v.setler.map((x) => <option key={x.ad}>{x.ad}</option>)}</select>
    {st && <div className="tam">{Object.entries(st.alanlar).map(([k, et]) => kutu(k, et))}{Object.entries(st.hassas).map(([k, et]) => kutu(k, et, true))}</div>}
    <label htmlFor="da-a">Amaç</label><input id="da-a" value={f.amac} onChange={(e) => setF({ ...f, amac: e.target.value })} /><label htmlFor="da-g">Gerekçe</label><input id="da-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2 kucuk" disabled={!st || !sec.length || !f.amac.trim() || !f.gerekce.trim()} onClick={() => void istek<{ durum: string; kayit: number }>('/disa-aktarim', { ...f, alanlar: sec, bicim: 'CSV' }).then((r) => { setM(r.durum === 'Onayda' ? `${r.kayit} kayıt; ek onaya gönderildi.` : `${r.kayit} kayıt hazır; 24 saat içinde bir kez indirebilirsiniz.`); return yk(); }).catch((e) => setM(e.message))}>Talep Et</button>
    {v.talepler.map((t) => <div className="soru" key={t.kimlik}><span>{t.veri_seti} · {t.kayit_sayisi} kayıt{t.hassas ? ' · Hassas' : ''} · {t.durum}</span>{t.durum === 'Hazır' && <a href={`/api/disa-aktarim/${t.kimlik}/indir`} onClick={() => setTimeout(() => void yk(), 1500)}>İndir</a>}</div>)}</details>;
}
