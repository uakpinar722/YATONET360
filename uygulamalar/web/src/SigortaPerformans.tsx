import { useEffect, useState } from 'react';
import { istek } from './api';

type R = { kimlik: string; sigortaci_adi: string; donem: string; durum: string; veri_son: string; hazir_son: string; mudur_notu: string | null; veri: { dosyaSayisi: number; kapananDosya: number; ortalamaDosyaSuresiGun: number | null; sureUyumuYuzde: number | null; sikayet: number } | null };
/** YG-767: sigortacı aylık performans raporu (RP-TIC-001 ile birlikte). */
export function SigortaPerformans() {
  const [v, setV] = useState<{ raporlar: R[]; my: boolean; mudur: boolean } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>('/sigorta-performans').then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, []);
  if (!v) return null;
  const is = (p: Promise<unknown>, s: string) => void p.then(() => { setM(s); return yk(); }).catch((e) => setM(e.message));
  const z = (s: string) => new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return <details><summary>Sigortacı Aylık Performans Raporları</summary>{m && <div className="not" role="status">{m}</div>}
    {v.raporlar.length ? v.raporlar.map((r) => <div className="soru" key={r.kimlik}><span>{r.sigortaci_adi} · {r.donem} · {r.durum} · Veri son {z(r.veri_son)} · Rapor son {z(r.hazir_son)}{r.veri ? ` · Dosya ${r.veri.dosyaSayisi} · Kapanan ${r.veri.kapananDosya} · Ortalama süre ${r.veri.ortalamaDosyaSuresiGun ?? '—'} gün · Süre uyumu ${r.veri.sureUyumuYuzde !== null ? `%${r.veri.sureUyumuYuzde}` : '—'} · Şikâyet ${r.veri.sikayet}` : ''}{r.mudur_notu ? ` · ${r.mudur_notu}` : ''}</span>
      <div className="tam">{v.my && r.durum === 'Veri Bekleniyor' && <button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-performans/${r.kimlik}/veri`, {}), 'Veri kaydedildi; Müdüre iletildi.')}>Veriyi Kaydet</button>}
        {v.mudur && r.durum === 'Hazırlanıyor' && <><label htmlFor={`sp-${r.kimlik}`}>Değerlendirme Notu</label><input id={`sp-${r.kimlik}`} value={g[r.kimlik] ?? ''} onChange={(e) => setG({ ...g, [r.kimlik]: e.target.value })} /><button className="btn2 kucuk" onClick={() => is(istek(`/sigorta-performans/${r.kimlik}/onaya`, { not: g[r.kimlik] }), 'Direktör onayına gönderildi.')}>Onaya Gönder</button></>}</div></div>) : <div className="ozet bos">Rapor bulunmamaktadır.</div>}</details>;
}
