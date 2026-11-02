import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Kisi { kimlik: string; ad_soyad: string }
interface Mesaj { kimlik: string; zaman: string; metin: string; okunma_zamani: string | null; benden: boolean; gonderen: string; alici: string; karsi: string }
interface Yayim { kimlik: string; baslik: string; zorunlu: boolean; kapsam: string; durum: string; yayim_zamani: string; okuyan: number; hedef: number }
const saat = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
const KAPSAM_AD: Record<string, string> = { LGM: 'LGM Personeli', Dış: 'Dış Kullanıcılar', Tümü: 'Tümü' };

/** YG-1663: İç Mesaj LGM personeli içindir; mesaj silinmez, düzeltilmez. Dosya Yazışması dosya modülüyle gelir. */
export function Mesajlar({ lgm, yenile }: { lgm: boolean; yenile: () => void }) {
  const [kisiler, setKisiler] = useState<Kisi[]>([]); const [liste, setListe] = useState<Mesaj[]>([]);
  const [secili, setSecili] = useState(''); const [metin, setMetin] = useState(''); const [hata, setHata] = useState('');
  const yukle = () => istek<Mesaj[]>('/mesaj/ic').then(setListe).catch((e) => setHata(e.message));
  useEffect(() => { if (lgm) { void istek<Kisi[]>('/mesaj/kisiler').then(setKisiler).catch((e) => setHata(e.message)); void yukle(); } }, [lgm]);
  useEffect(() => {
    if (!secili || !liste.some((m) => m.karsi === secili && !m.benden && !m.okunma_zamani)) return;
    void istek('/mesaj/ic/okundu', { karsi: secili }).then(() => { yenile(); return yukle(); });
  }, [secili, liste]);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata('');
    try { await istek('/mesaj/ic', { alici: secili, metin }); setMetin(''); await yukle(); } catch (x) { setHata((x as Error).message); }
  };
  if (!lgm) return <><h1>Mesajlar</h1><div className="ozet bos">Dosya yazışmalarınız, dosyanız açıldığında burada görünecektir.</div></>;
  const konusma = liste.filter((m) => m.karsi === secili).reverse();
  const karsilar = [...new Set(liste.map((m) => m.karsi))];
  const ad = (k: string) => kisiler.find((x) => x.kimlik === k)?.ad_soyad ?? liste.find((m) => m.karsi === k && !m.benden)?.gonderen ?? liste.find((m) => m.karsi === k)?.alici ?? '';
  return (
    <>
      <h1>Mesajlar</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      <div className="bolum">İç Mesaj</div>
      {karsilar.map((k) => {
        const n = liste.filter((m) => m.karsi === k && !m.benden && !m.okunma_zamani).length;
        return <button key={k} type="button" className={`secenek orta${secili === k ? ' secili-kart' : ''}`} onClick={() => setSecili(k)}><b>{ad(k)}</b>{n > 0 && <em className="sayi">{n}</em>}</button>;
      })}
      <form className="ozet" onSubmit={(e) => void gonder(e)}>
        <label htmlFor="m-k">Kime</label>
        <select id="m-k" value={secili} onChange={(e) => setSecili(e.target.value)}><option value="">Seçiniz</option>{kisiler.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad_soyad}</option>)}</select>
        {konusma.map((m) => <div key={m.kimlik} className="not"><b>{m.benden ? 'Siz' : m.gonderen}</b> · {saat(m.zaman)}{m.benden && m.okunma_zamani ? ' · Okundu' : ''}<br />{m.metin}</div>)}
        <label htmlFor="m-m">Mesaj</label>
        <textarea id="m-m" rows={3} maxLength={4000} value={metin} onChange={(e) => setMetin(e.target.value)} />
        <div className="not">Acil durumlarda lütfen Acil Durum düğmesini kullanınız. Gönderilen mesaj silinemez ve düzeltilemez.</div>
        <button className="btn" disabled={!secili || !metin.trim()}>Gönder</button>
      </form>
    </>
  );
}

/** YG-560, YG-561: LGM içi duyuruyu Müdür ve üstü yayımlar; dış kapsamlı duyuru bir üst kademenin onayına gider; CEO onaysızdır. */
export function DuyuruYayimla() {
  const [yetki, setYetki] = useState<{ kapsamlar: string[]; onaysiz: string[] } | null>(null); const [liste, setListe] = useState<Yayim[]>([]);
  const [baslik, setBaslik] = useState(''); const [govde, setGovde] = useState(''); const [kapsam, setKapsam] = useState(''); const [zorunlu, setZorunlu] = useState(false); const [bitis, setBitis] = useState('');
  const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yukle = () => istek<Yayim[]>('/duyuru/yayimlarim').then(setListe).catch((e) => setHata(e.message));
  useEffect(() => { void istek<{ kapsamlar: string[]; onaysiz: string[] }>('/duyuru/yetkim').then((y) => { setYetki(y); setKapsam(y.kapsamlar[0] ?? ''); }).catch((e) => setHata(e.message)); void yukle(); }, []);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata(''); setNot('');
    try {
      const r = await istek<{ durum: string }>('/duyuru', { baslik, govde, kapsam, zorunlu, bitis: bitis || undefined });
      setNot(r.durum === 'Yayında' ? 'Duyuru yayımlanmıştır.' : 'Duyuru onaya gönderilmiştir.');
      setBaslik(''); setGovde(''); setZorunlu(false); setBitis(''); await yukle();
    } catch (x) { setHata((x as Error).message); }
  };
  return (
    <>
      <h1>Duyuru Yayımla</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="basari">{not}</div>}
      {yetki && yetki.kapsamlar.length === 0 && <div className="ozet bos">Duyuru yayımlama yetkiniz bulunmamaktadır.</div>}
      {yetki && yetki.kapsamlar.length > 0 && (
        <form className="ozet" onSubmit={(e) => void gonder(e)}>
          <label htmlFor="d-b">Başlık</label>
          <input id="d-b" value={baslik} onChange={(e) => setBaslik(e.target.value)} />
          <label htmlFor="d-g">Metin</label>
          <textarea id="d-g" rows={4} value={govde} onChange={(e) => setGovde(e.target.value)} />
          <label htmlFor="d-k">Hedef Kitle</label>
          <select id="d-k" value={kapsam} onChange={(e) => setKapsam(e.target.value)}>{yetki.kapsamlar.map((k) => <option key={k} value={k}>{KAPSAM_AD[k]}</option>)}</select>
          <div className="not">{yetki.onaysiz.includes(kapsam) ? 'Bu duyuru doğrudan yayımlanır.' : 'Bu duyuru bir üst kademenin onayından sonra yayımlanır.'}</div>
          <label htmlFor="d-s">Bitiş Tarihi (İsteğe Bağlı)</label>
          <input id="d-s" type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
          <label className="kutu"><input type="checkbox" checked={zorunlu} onChange={(e) => setZorunlu(e.target.checked)} /><span>Okunması Zorunlu</span></label>
          <button className="btn" disabled={!baslik.trim()}>{yetki.onaysiz.includes(kapsam) ? 'Yayımla' : 'Onaya Gönder'}</button>
        </form>
      )}
      <div className="bolum">Duyurularım</div>
      {liste.length === 0 && <div className="ozet bos">Duyuru bulunmamaktadır.</div>}
      {liste.length > 0 && (
        <div className="tablo"><table className="kartli">
          <thead><tr><th>Başlık</th><th>Hedef Kitle</th><th>Durum</th><th>Okunma</th></tr></thead>
          <tbody>{liste.map((d) => (
            <tr key={d.kimlik}><td data-ad="Başlık">{d.baslik}</td><td data-ad="Hedef Kitle">{KAPSAM_AD[d.kapsam] ?? d.kapsam}</td><td data-ad="Durum">{d.durum}</td><td data-ad="Okunma">{d.okuyan} / {d.hedef}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
