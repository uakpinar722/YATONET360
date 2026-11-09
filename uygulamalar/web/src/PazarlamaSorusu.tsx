import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';
import { AMAC, IZIN_METNI, KANAL } from './IlkGiris';

/** YG-1209: ilk girişteki onaylı izin metni talep ve teslim adımında kullanılır. */
export function PazarlamaSorusu({ ben }: { ben: Ben }) {
  const [adim, setAdim] = useState<string | null>(null); const [s, setS] = useState<Set<string>>(new Set()); const [h, setH] = useState('');
  useEffect(() => { void istek<{ adim: string | null }>('/portal/pazarlama-sorusu').then((x) => setAdim(x.adim)).catch(() => setAdim(null)); }, []);
  if (!adim) return null;
  const t = IZIN_METNI[ben.dil];
  const gonder = (cevap: string, sec: Set<string>) => void istek('/portal/pazarlama-sorusu', { cevap, amaclar: AMAC.filter((x) => sec.has(x)), kanallar: KANAL.filter((x) => sec.has(x)) }).then(() => setAdim(null)).catch((e) => setH(e.message));
  const K = (a: string, et: string) => <label key={a}><input type="checkbox" checked={s.has(a)} onChange={(e) => { const n = new Set(s); if (e.target.checked) n.add(a); else n.delete(a); setS(n); }} /> {et}</label>;
  return <div className="ozet"><b>{t.izB}</b><div className="not">{t.izN}</div>{h && <div className="hata" role="alert">{h}</div>}<label>{t.soru}</label>{K(AMAC[0]!, t.am1)}{K(AMAC[1]!, t.am2)}<label>{t.ka}</label><div className="kanallar">{K('SMS', t.k1)}{K('E-posta', t.k2)}{K('Telefon', t.k3)}{K('WhatsApp', t.k4)}</div><button type="button" className="btn2 kucuk" onClick={() => gonder('Onay', new Set([...AMAC, ...KANAL]))}>{t.tum}</button><button className="btn kucuk" onClick={() => gonder('Onay', s)}>{t.devam}</button><button type="button" className="lnk" onClick={() => gonder('Şimdilik Geç', new Set())}>{t.gec}</button></div>;
}
