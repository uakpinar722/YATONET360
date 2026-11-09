import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kimlik: string; ticari_unvan: string; sicil_no: string; bitis: string | null; limit_eur: string | null; durum: string; tavsiye: boolean };

/** YG-1471: eksik, düşük ve süresi dolan firma poliçeleri; gözetim ve muhafaza tavsiyedir, ağa kabul şartı değildir. */
export function PoliceListesi() {
  const [l, setL] = useState<S[] | null>(null);
  useEffect(() => { void istek<S[]>('/firma/police-listesi').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  const sorunlu = l.filter((x) => x.durum !== 'Uygun' || x.tavsiye);
  return <><div className="bolum">Firma Poliçe Listesi</div><div className="ozet">{sorunlu.length ? sorunlu.map((x) => <div key={x.kimlik}>{x.ticari_unvan} · {x.durum}{x.limit_eur ? ` · ${Number(x.limit_eur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR` : ''}{x.bitis ? ` · ${x.bitis.split('-').reverse().join('.')}` : ''}{x.tavsiye ? ' · Gözetim ve Muhafaza Tavsiyesi' : ''}</div>) : <div>Kayıt bulunmamaktadır.</div>}</div></>;
}
