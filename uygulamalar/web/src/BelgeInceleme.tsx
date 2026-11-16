import { useEffect, useState } from 'react';
import { istek } from './api';

type B = { kimlik: string; ad: string; belge_turu: string; bag_turu: string; inceleme_sonucu: string | null; inceleme_notu: string | null; gecerlilik_bitis: string | null };

/** YG-1440: teknik personel dosya ve yat belgelerini inceler, Uygun / Eksik işaretler. */
export function BelgeInceleme({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ teknik: boolean; belgeler: B[] } | null>(null); const [not, setNot] = useState<Record<string, string>>({}); const [gb, setGb] = useState<Record<string, string>>({}); const [m, setM] = useState('');
  const yk = () => istek<NonNullable<typeof v>>(`/dosya/${dosya}/belge-inceleme`).then(setV).catch(() => setV(null));
  useEffect(() => { void yk(); }, [dosya]);
  if (!v?.teknik || !v.belgeler.length) return null;
  const isle = (b: string, sonuc: string) => void istek(`/dosya/${dosya}/belge/${b}/inceleme`, { sonuc, not: not[b] || undefined, gecerlilikBitis: gb[b] || undefined }).then(() => { setM('İnceleme kaydedildi.'); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Belge İncelemesi</div><div className="ozet">{m && <div className="not" role="status">{m}</div>}
    {v.belgeler.map((b) => <div className="soru" key={b.kimlik}><span>{b.ad} · {b.belge_turu} · {b.bag_turu === 'Yat' ? 'Yat Kaydı' : 'Dosya'}{b.inceleme_sonucu ? ` · ${b.inceleme_sonucu}` : ' · İncelenmedi'}{b.inceleme_notu ? ` · ${b.inceleme_notu}` : ''}{b.gecerlilik_bitis ? ` · Geçerlilik: ${b.gecerlilik_bitis.split('-').reverse().join('.')}` : ''}</span>
      <span className="tam"><label htmlFor={`bi-${b.kimlik}`}>Not</label><input id={`bi-${b.kimlik}`} value={not[b.kimlik] ?? ''} onChange={(e) => setNot({ ...not, [b.kimlik]: e.target.value })} />
        <label htmlFor={`bg-${b.kimlik}`}>Geçerlilik Bitişi (Varsa)</label><input id={`bg-${b.kimlik}`} type="date" value={gb[b.kimlik] ?? ''} onChange={(e) => setGb({ ...gb, [b.kimlik]: e.target.value })} />
        <button className="btn2 kucuk" onClick={() => isle(b.kimlik, 'Uygun')}>Uygun</button><button className="btn hayir kucuk" disabled={!not[b.kimlik]?.trim()} onClick={() => isle(b.kimlik, 'Eksik')}>Eksik</button></span></div>)}</div></>;
}
