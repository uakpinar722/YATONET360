import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';

type S = { kimlik: string; dosya_no: string; yat_adi?: string; hasar_no?: string | null; is_emri_no?: string; siparis_no?: string; statu?: string };

/** YG-1374: LGM dışı kullanıcıda arama yalnız kendi kayıtlarında; Çözüm Ortağı ve tedarikçide hasar dosya numarası aranmaz ve gösterilmez. */
export function KendiArama({ ben, q }: { ben: Ben; q: string }) {
  const [l, setL] = useState<S[] | null>(null); const [h, setH] = useState('');
  const yol = ben.grup.startsWith('Sigorta') ? '/sigorta/ara' : ben.grup === 'İş Birliği Firması' ? '/firma-portal/ara' : ben.grup === 'Tedarikçi' ? '/tedarikci-portal/ara' : '/portal/ara';
  useEffect(() => { setL(null); void istek<S[]>(`${yol}?q=${encodeURIComponent(q)}`).then(setL).catch((e) => setH(e.message)); }, [q, yol]);
  return <><h1>Arama: {q}</h1>{h && <div className="hata" role="alert">{h}</div>}
    {l && (l.length === 0 ? <div className="ozet bos">Sonuç bulunamadı.</div> : <div className="ozet">{l.map((x) => <div key={x.kimlik}>{x.is_emri_no ?? x.siparis_no ?? x.dosya_no}{x.is_emri_no || x.siparis_no ? ` · ${x.dosya_no}` : ''}{x.hasar_no ? ` · Hasar Dosya No: ${x.hasar_no}` : ''}{x.yat_adi ? ` · ${x.yat_adi}` : ''}{x.statu ? ` · ${x.statu}` : ''}</div>)}</div>)}</>;
}
