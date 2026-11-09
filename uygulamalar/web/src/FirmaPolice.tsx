import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kimlik: string; ticari_unvan: string; sicil_no: string; bitis: string | null; limit_eur: string | null; durum: string; tavsiye: boolean };

/** YG-1471: eksik, düşük ve süresi dolan firma poliçeleri; gözetim ve muhafaza tavsiyedir, ağa kabul şartı değildir. */
export function PoliceListesi() {
  const [l, setL] = useState<S[] | null>(null); const [f, setF] = useState({ brans: '', limit: '' }); const [m, setM] = useState('');
  useEffect(() => { void istek<S[]>('/firma/police-listesi').then(setL).catch(() => setL(null)); }, []);
  if (!l) return null;
  const sorunlu = l.filter((x) => x.durum !== 'Uygun' || x.tavsiye);
  return <><div className="bolum">Firma Poliçe Listesi</div><div className="ozet">{sorunlu.length ? sorunlu.map((x) => <div key={x.kimlik}>{x.ticari_unvan} · {x.durum}{x.limit_eur ? ` · ${Number(x.limit_eur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} EUR` : ''}{x.bitis ? ` · ${x.bitis.split('-').reverse().join('.')}` : ''}{x.tavsiye ? ' · Gözetim ve Muhafaza Tavsiyesi' : ''}</div>) : <div>Kayıt bulunmamaktadır.</div>}</div>{m && <div className="not" role="status">{m}</div>}<label htmlFor="fp-b">Branş</label><input id="fp-b" value={f.brans} onChange={(e) => setF({ ...f, brans: e.target.value })} /><label htmlFor="fp-l">Asgari Limit (EUR)</label><input id="fp-l" inputMode="decimal" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /><button className="btn2 kucuk" disabled={!f.brans.trim() || !f.limit} onClick={() => void istek('/firma/police-brans-limit', { brans: f.brans, limit: Number(f.limit.replace(/\./g, '').replace(',', '.')) }).then(() => { setM('Limit kaydedildi.'); setF({ brans: '', limit: '' }); return istek<S[]>('/firma/police-listesi').then(setL); }).catch((e) => setM(e.message))}>Branş Limiti Kaydet</button></>;
}
