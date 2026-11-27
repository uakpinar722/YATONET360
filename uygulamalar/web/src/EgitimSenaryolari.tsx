import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kod: string; ad: string; ozet: string; sure_dk: number; adim: number; en_iyi: number | null; basarili: boolean; suren: string | null };
type L = { ortam: string; kapi: number; basarili: number; senaryolar: S[] };
type A = { no: number; toplam: number; rol: string; durum: string; soru: string; puan: number; secenekler: string[] };
type D = { deneme: string; ad: string; dosya: Record<string, string>; sureDk: number; baslangic: string; puan: number; durdurma: number; adim: A | null };
type C = { dogru: boolean; durduruldu: boolean; sistemMesaji: string | null; dogruCevap: string | null; aciklama: string; puan: number; durdurma: number; adim: A | null; sonuc: null | { durum: string; puan: number; azami: number; sureSn: number; sureAsildi: boolean } };

const dk = (sn: number) => `${Math.floor(sn / 60)}:${String(sn % 60).padStart(2, '0')}`;

/** YG-1398, YG-1399, YG-1400: puanlı ve süreli eğitim senaryoları; rol değiştirerek sanal dosyada oynanır, engellenecek işlemde sistem durdurur, senaryo sıfırlanabilir. Canlı ortamda görünmez. */
export function EgitimSenaryolari() {
  const [l, setL] = useState<L | null>(null); const [d, setD] = useState<D | null>(null); const [c, setC] = useState<C | null>(null); const [m, setM] = useState(''); const [an, setAn] = useState(Date.now());
  const yk = () => istek<L>('/egitim/senaryolar').then(setL).catch(() => setL(null));
  useEffect(() => { void yk(); }, []);
  useEffect(() => { if (!d) return; const t = setInterval(() => setAn(Date.now()), 1000); return () => clearInterval(t); }, [d]);
  if (!l) return null;
  const basla = (kod: string) => void istek<D>(`/egitim/senaryo/${kod}/basla`, {}).then((x) => { setD(x); setC(null); setM(''); }).catch((e) => setM(e.message));
  const sifirla = (kod: string) => void istek(`/egitim/senaryo/${kod}/sifirla`, {}).then(() => { setD(null); setC(null); setM('Senaryo sıfırlandı.'); return yk(); }).catch((e) => setM(e.message));
  const cevap = (secim: number) => d && void istek<C>(`/egitim/deneme/${d.deneme}/cevap`, { secim }).then((x) => { setC(x); setD({ ...d, puan: x.puan, durdurma: x.durdurma }); if (x.sonuc) void yk(); }).catch((e) => setM(e.message));
  const kod = (ad: string) => l.senaryolar.find((x) => x.ad === ad)?.kod ?? '';
  if (d) {
    const gecen = Math.max(0, Math.round((an - new Date(d.baslangic).getTime()) / 1000));
    const a = c ? c.adim : d.adim;
    return <><div className="bolum">Eğitim Senaryosu · {d.ad}</div>{m && <div className="not" role="status">{m}</div>}
      <p className="ince">Dosya {d.dosya.no} · {d.dosya.yat} · {d.dosya.olay}</p>
      <p>Puan: <b>{d.puan}</b> · Sistemin durdurduğu adım: <b>{d.durdurma}</b> · Süre: <b className={gecen > d.sureDk * 60 ? 'kirmizi' : ''}>{dk(gecen)}</b> / {d.sureDk}:00</p>
      {c && <div className={c.dogru ? 'not' : 'hata'} role="status">
        {c.durduruldu && <p><b>Sistem durdurdu:</b> {c.sistemMesaji}</p>}
        <p><b>{c.dogru ? 'Doğru.' : 'Yanlış.'}</b> {c.aciklama}</p>
        {!c.dogru && c.dogruCevap && <p>Doğru adım: {c.dogruCevap}</p>}
      </div>}
      {c?.sonuc ? <div className="kart"><p><b>Sonuç: {c.sonuc.durum}</b> · {c.sonuc.puan} / {c.sonuc.azami} puan · {dk(c.sonuc.sureSn)}{c.sonuc.sureAsildi ? ' (süre aşıldı)' : ''}</p>
          <button className="btn2" onClick={() => { setD(null); setC(null); }}>Senaryolara Dön</button></div>
        : a && <div className="kart">
          <p className="ince">Adım {a.no} / {a.toplam} · Rolünüz: <b className="koyu">{a.rol}</b></p>
          <p>{a.durum}</p><p><b>{a.soru}</b></p>
          {a.secenekler.map((x, n) => <p key={n}><button className="btn2" onClick={() => cevap(n)}>{x}</button></p>)}
        </div>}
      {!c?.sonuc && <p><button className="btn2 hayir kucuk" onClick={() => sifirla(kod(d.ad))}>Senaryoyu Sıfırla</button> <button className="btn2 kucuk" onClick={() => { setD(null); setC(null); }}>Ara Ver</button></p>}
    </>;
  }
  return <><div className="bolum">Eğitim Senaryoları</div>{m && <div className="not" role="status">{m}</div>}
    {l.kapi > 0 && <p>Yeni personel ilk gerçek dosyasından önce {l.kapi} senaryoyu başarıyla tamamlar. Tamamladığınız: <b>{l.basarili}</b></p>}
    <table><thead><tr><th>Senaryo</th><th>Adım</th><th>Süre</th><th>En İyi</th><th>Durum</th><th></th></tr></thead><tbody>
      {l.senaryolar.map((x) => <tr key={x.kod}><td><b>{x.ad}</b><div className="ince">{x.ozet}</div></td><td>{x.adim}</td><td>{x.sure_dk} dk</td><td>{x.en_iyi != null ? `%${x.en_iyi}` : '—'}</td><td>{x.basarili ? 'Geçti' : x.suren ? 'Sürüyor' : '—'}</td>
        <td><button className="btn2 kucuk" onClick={() => basla(x.kod)}>{x.suren ? 'Devam Et' : 'Başla'}</button>{x.suren && <> <button className="btn2 hayir kucuk" onClick={() => sifirla(x.kod)}>Sıfırla</button></>}</td></tr>)}
    </tbody></table></>;
}
