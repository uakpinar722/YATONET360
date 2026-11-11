import { useEffect, useState } from 'react';
import { istek } from './api';

type P = { kimlik: string; ad: string; rol: string; yuk: number; esik: number; kullanilabilir: number; doluluk: number | null; kritikDosya: number; ortalamaZorluk: number | null; izinGunu: number; nobetVardiyasi: number; planliKesif: string[] };
type F = { firma: string; kapasite: number | null; aktifIs: number; doluluk: number | null; kritikIs: number; branslar: string[]; kullanilabilirEkipman: number; suresiGecenEkipman: number; isgSuresiGecenPersonel: number; teyitEski: boolean };
/** YG-749: kapasite analizi. */
export function Kapasite() {
  const [v, setV] = useState<{ ufukGun: number; personel: P[]; firmalar: F[] } | null>(null);
  useEffect(() => { void istek<NonNullable<typeof v>>('/kapasite').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const renk = (d: number | null) => (d !== null && d >= 100 ? 'soru hata' : 'soru');
  return <details><summary>Kapasite Analizi (önümüzdeki {v.ufukGun} gün)</summary>
    <div className="bolum">Personel</div>{v.personel.map((p) => <div className={renk(p.doluluk)} key={`${p.kimlik}${p.rol}`}><span>{p.ad} · {p.rol} · Yük {p.yuk}/{p.kullanilabilir} (eşik {p.esik}){p.doluluk !== null ? ` · %${p.doluluk}` : ''} · Kritik/Yüksek {p.kritikDosya}{p.ortalamaZorluk !== null ? ` · Ortalama zorluk ${p.ortalamaZorluk}` : ''}{p.izinGunu ? ` · İzin ${p.izinGunu} gün` : ''}{p.nobetVardiyasi ? ` · Nöbet ${p.nobetVardiyasi}` : ''}{p.planliKesif.length ? ` · Keşif: ${p.planliKesif.join(', ')}` : ''}</span></div>)}
    <div className="bolum">Çözüm Ortakları</div>{v.firmalar.map((f) => <div className={renk(f.doluluk)} key={f.firma}><span>{f.firma} · Aktif iş {f.aktifIs}{f.kapasite ? `/${f.kapasite} (%${f.doluluk})` : ' · Kapasite tanımsız'} · Kritik {f.kritikIs} · Ekipman {f.kullanilabilirEkipman}{f.suresiGecenEkipman ? ` · Bakımı/kalibrasyonu geçen ${f.suresiGecenEkipman}` : ''}{f.isgSuresiGecenPersonel ? ` · İSG eğitimi geçen ${f.isgSuresiGecenPersonel}` : ''}{f.teyitEski ? ' · Kapasite teyidi eski' : ''}{f.branslar.length ? ` · ${f.branslar.join(', ')}` : ''}</span></div>)}</details>;
}
