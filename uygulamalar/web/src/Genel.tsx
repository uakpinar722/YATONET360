import { useState, type FormEvent, type ReactNode } from 'react';
import { istek } from './api';

const Kabuk = ({ baslik, children }: { baslik: string; children: ReactNode }) => (
  <div className="ilk"><div className="ilk-kart">
    <div className="ilk-bas"><img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" /></div>
    <div className="ilk-ic"><h2>{baslik}</h2>{children}</div>
    <div className="ilk-dip"><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></div>
  </div></div>
);

interface Sonuc { ad: string; surum: number; durum: string; onayZamani: string | null; ozet: string }

/** YG-691: belgedeki M7 doğrulama kodu giriş yapmadan sorgulanır. */
export function BelgeDogrula({ ilkKod }: { ilkKod: string }) {
  const [kod, setKod] = useState(ilkKod); const [s, setS] = useState<Sonuc | null>(null); const [hata, setHata] = useState('');
  const sor = async (e: FormEvent) => {
    e.preventDefault(); setS(null); setHata('');
    try { setS(await istek<Sonuc>(`/dogrula/${encodeURIComponent(kod.trim())}`)); } catch (x) { setHata((x as Error).message); }
  };
  return (
    <Kabuk baslik="Belge Doğrulama">
      <form onSubmit={(e) => void sor(e)}>
        <label htmlFor="dg">Doğrulama Kodu</label>
        <input id="dg" value={kod} onChange={(e) => setKod(e.target.value)} placeholder="7KQ4-M2XD" />
        {hata && <div className="hata" role="alert">{hata}</div>}
        <button className="btn" disabled={!kod.trim()}>Doğrula</button>
      </form>
      {s && <div className="ozet"><dl>
        <dt>Belge</dt><dd>{s.ad}</dd>
        <dt>Sürüm</dt><dd>{s.surum}</dd>
        <dt>Durum</dt><dd>{s.durum}</dd>
        <dt>Onay Tarihi</dt><dd>{s.onayZamani ? new Date(s.onayZamani).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }) : '—'}</dd>
      </dl></div>}
    </Kabuk>
  );
}

/** YG-611: paylaşılan belge, kayıtlı alıcıya giden kodla açılır. */
export function PaylasimAc({ belirtec }: { belirtec: string }) {
  const [bilgi, setBilgi] = useState<{ belge: string; alici: string; izin: string } | null>(null);
  const [kod, setKod] = useState(''); const [hata, setHata] = useState(''); const [tamam, setTamam] = useState(false);
  const iste = async () => {
    setHata('');
    try { setBilgi(await istek('/paylasim/kod', { belirtec })); } catch (x) { setHata((x as Error).message); }
  };
  const ac = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    const r = await fetch('/api/paylasim/ac', { method: 'POST', headers: { 'content-type': 'application/json', 'x-yatonet': '1' }, body: JSON.stringify({ belirtec, kod }) });
    if (!r.ok) { setHata(((await r.json()) as { hata: string }).hata); return; }
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = u; a.download = /filename\*=UTF-8''(.+)$/.exec(r.headers.get('content-disposition') ?? '')?.[1] ? decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(r.headers.get('content-disposition')!)![1]!) : 'belge'; a.click();
    URL.revokeObjectURL(u); setTamam(true);
  };
  return (
    <Kabuk baslik="Paylaşılan Belge">
      {hata && <div className="hata" role="alert">{hata}</div>}
      {!bilgi && <><div className="not">Belgeyi açmak için kayıtlı e-posta adresinize kod gönderilecektir.</div><button className="btn" onClick={() => void iste()}>Kod Gönder</button></>}
      {bilgi && !tamam && (
        <form onSubmit={(e) => void ac(e)}>
          <div className="not">{bilgi.belge} · Kod {bilgi.alici} adresine gönderilmiştir.</div>
          <label htmlFor="pk">Kod</label>
          <input id="pk" inputMode="numeric" autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} />
          <button className="btn" disabled={kod.length !== 6}>Belgeyi Aç</button>
        </form>
      )}
      {tamam && <div className="basari">Belge bilgisayarınıza indirilmiştir.</div>}
    </Kabuk>
  );
}
