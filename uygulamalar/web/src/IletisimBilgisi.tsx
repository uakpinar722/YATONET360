import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { kimlik: string; taraf_rolu: string; kisi_adi_soyadi: string | null; tur: string; deger: string; kaynak: string; amac: string; dogrulama_zamani: string | null; gecerli: boolean; bildirim_hedefi: boolean };
/** YG-518: iletişim bilgisi geçmişi; eski bilgi kanıt olarak kalır, bildirim hedefi ayrıca seçilir. */
export function IletisimBilgisi({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ kaynaklar: string[]; amaclar: string[]; kayitlar: K[] } | null>(null); const [g, setG] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${dosya}/iletisim-bilgisi`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v || !v.kayitlar.length) return null;
  const is = (p: Promise<unknown>, t: string) => void p.then(() => { setM(t); return yk(); }).catch((e) => setM(e.message));
  return <details><summary>İletişim Bilgisi Geçmişi</summary>{m && <div className="not" role="status">{m}</div>}
    {v.kayitlar.map((x) => <div className="soru" key={x.kimlik}><span>{x.taraf_rolu}{x.kisi_adi_soyadi ? ` · ${x.kisi_adi_soyadi}` : ''} · {x.tur}: {x.deger} · {x.kaynak} · {x.amac}{x.dogrulama_zamani ? ` · Doğrulandı ${new Date(x.dogrulama_zamani).toLocaleDateString('tr-TR')}` : ' · Doğrulanmadı'}{x.bildirim_hedefi ? ' · Bildirim Hedefi' : ' · Eski (kanıt)'}</span>
      <div className="tam"><label htmlFor={`ib-k-${x.kimlik}`}>Kaynak</label><select id={`ib-k-${x.kimlik}`} value={g[x.kimlik] ?? ''} onChange={(e) => setG({ ...g, [x.kimlik]: e.target.value })}><option value="">Seçiniz</option>{v.kaynaklar.map((k) => <option key={k}>{k}</option>)}</select><button className="btn2 kucuk" disabled={!g[x.kimlik]} onClick={() => is(istek(`/iletisim-bilgisi/${x.kimlik}/dogrula`, { kaynak: g[x.kimlik] }), 'Doğrulama kaydedildi.')}>Doğrula</button>
        {!x.bildirim_hedefi && <button className="btn2 kucuk" onClick={() => is(istek(`/iletisim-bilgisi/${x.kimlik}/hedef`, {}), 'Bildirim hedefi değiştirildi.')}>Bildirim Hedefi Yap</button>}</div></div>)}</details>;
}
