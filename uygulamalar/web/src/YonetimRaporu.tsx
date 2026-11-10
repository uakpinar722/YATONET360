import { useEffect, useState } from 'react';
import { istek } from './api';

const t = (x: number | string) => Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type R = { donem: string; wip: { dosya_no: string; satis: string; faturalanan: string; wip: string }[]; tahsil: { dosya_no: string; fatura_no: string; muhatap: string; kalan: string; vade: string | null; gecikme: number | null }[]; firma: { dosya_no: string; tahsil: string; odenmemis: string }[]; toplam: { wip: number; tahsil: number; firma: number } };
/** YG-761: RP-TIC-002 aylık yönetim raporu. */
export function YonetimRaporu() {
  const [d, setD] = useState(''); const [r, setR] = useState<R | null>(null);
  useEffect(() => { void istek<R>(`/yonetim-raporu${d ? `?donem=${d}` : ''}`).then(setR).catch(() => setR(null)); }, [d]);
  if (!r) return null;
  return <details><summary>RP-TIC-002 Aylık Yönetim Raporu · {r.donem}</summary>
    <label htmlFor="yr-d">Dönem</label><input id="yr-d" type="month" value={d || r.donem} onChange={(e) => setD(e.target.value)} />
    <div className="bolum">Faturalanmamış İş · {t(r.toplam.wip)} EUR</div>{r.wip.map((x) => <div className="soru" key={x.dosya_no}><span>{x.dosya_no} · Onaylı {t(x.satis)} · Faturalanan {t(x.faturalanan)} · Kalan {t(x.wip)} EUR</span></div>)}
    <div className="bolum">Tahsil Edilmemiş Fatura · {t(r.toplam.tahsil)} EUR</div>{r.tahsil.map((x) => <div className={x.gecikme ? 'soru hata' : 'soru'} key={x.fatura_no}><span>{x.dosya_no} · {x.fatura_no} · {x.muhatap} · {t(x.kalan)} EUR{x.vade ? ` · Vade ${x.vade.split('-').reverse().join('.')}` : ''}{x.gecikme ? ` · ${x.gecikme} gün gecikme` : ''}</span></div>)}
    <div className="bolum">Tahsil Edildi, Firmaya Ödenmedi · {t(r.toplam.firma)} EUR</div>{r.firma.map((x) => <div className="soru" key={x.dosya_no}><span>{x.dosya_no} · Tahsil {t(x.tahsil)} · Ödenmemiş hakediş {t(x.odenmemis)} EUR</span></div>)}</details>;
}
