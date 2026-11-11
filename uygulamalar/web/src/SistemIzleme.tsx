import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { oran: number | null; kesintiDakika: number | null };
type V = { uretim: string; kullanilabilirlik: { son24Saat: K; son7Gun: K }; akislar: { akis: string; adet: number; hata: number; hataOrani: number; ortalama_ms: number; azami_ms: number; hedefMs: number; ucGecikmeOrani: number }[]; kapasite: { vt_mb: number; baglanti: number; azami_baglanti: number; belge: number; acik_dosya: number }; kuyruk: { gonderim: number; gonderim_en_eski_dk: number | null; gonderim_tekrar: number; belge_uretim: number; geciken_is: number }; terk: { suresi_dolan_davet: number; bekleyen_talep: number; eski_taslak_teklif: number; ilk_girisi_bitmeyen: number } };
/** YG-778: kullanılabilirlik, yanıt süresi, kapasite, kuyruk ve terk edilen akışlar. */
export function SistemIzleme() {
  const [v, setV] = useState<V | null>(null);
  useEffect(() => { void istek<V>('/sistem-izleme').then(setV).catch(() => setV(null)); }, []);
  if (!v) return null;
  const k = (x: K) => (x.oran === null ? 'Ölçüm yok' : `%${x.oran.toLocaleString('tr-TR')} · Kesinti ${x.kesintiDakika} dk`);
  return <details><summary>Sistem İzleme</summary><div className="not">Üretim: {new Date(v.uretim).toLocaleString('tr-TR')}</div>
    <div className="bolum">Kullanılabilirlik</div><div className="soru"><span>Son 24 saat: {k(v.kullanilabilirlik.son24Saat)} · Son 7 gün: {k(v.kullanilabilirlik.son7Gun)}</span></div>
    <div className="bolum">Kritik İş Akışları (son 24 saat)</div>{v.akislar.length ? v.akislar.map((x) => <div className={x.hataOrani > 1 || x.ucGecikmeOrani > 5 ? 'soru hata' : 'soru'} key={x.akis}><span>{x.akis} · {x.adet} istek · Hata %{x.hataOrani} · Ortalama {x.ortalama_ms} ms · En uzun {x.azami_ms} ms · Hedef {x.hedefMs} ms · Hedefi aşan %{x.ucGecikmeOrani}</span></div>) : <div className="ozet bos">Ölçüm bulunmamaktadır.</div>}
    <div className="bolum">Kapasite</div><div className="soru"><span>Veri tabanı {v.kapasite.vt_mb} MB · Bağlantı {v.kapasite.baglanti}/{v.kapasite.azami_baglanti} · Belge {v.kapasite.belge} · Açık dosya {v.kapasite.acik_dosya}</span></div>
    <div className="bolum">Kuyruk</div><div className={v.kuyruk.gonderim_tekrar || v.kuyruk.geciken_is ? 'soru hata' : 'soru'}><span>Bekleyen gönderim {v.kuyruk.gonderim}{v.kuyruk.gonderim_en_eski_dk !== null ? ` (en eski ${v.kuyruk.gonderim_en_eski_dk} dk)` : ''} · Tekrar deneyen {v.kuyruk.gonderim_tekrar} · Belge üretimi {v.kuyruk.belge_uretim} · Süresi geçen iş {v.kuyruk.geciken_is}</span></div>
    <div className="bolum">Terk Edilen Akışlar</div><div className="soru"><span>Süresi dolan davet {v.terk.suresi_dolan_davet} · 24 saatten uzun bekleyen talep {v.terk.bekleyen_talep} · 7 günden eski taslak teklif {v.terk.eski_taslak_teklif} · İlk girişi tamamlanmayan dış kullanıcı {v.terk.ilk_girisi_bitmeyen}</span></div></details>;
}
