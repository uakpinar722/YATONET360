import { useEffect, useState } from 'react';
import { istek, type Ben } from './api';

type Sayfa = 'ana' | 'roller' | 'iz';
interface Rol { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string; ayricalikli_rol: boolean }
interface Iz { kimlik: string; olay_zamani: string; eylem: string; sonuc: string; gerekce: string | null; aktor: string | null }

const tarih = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Istanbul' });

function Tablo<T>({ yol, baslik, satir }: { yol: string; baslik: string[]; satir: (x: T) => (string | null)[] }) {
  const [d, setD] = useState<T[] | null>(null);
  const [h, setH] = useState('');
  useEffect(() => { istek<T[]>(yol).then(setD).catch((e) => setH(e.message)); }, [yol]);
  if (h) return <div className="hata" role="alert">{h}</div>;
  if (!d) return null;
  return (
    <div className="tablo"><table>
      <thead><tr>{baslik.map((b) => <th key={b}>{b}</th>)}</tr></thead>
      <tbody>{d.map((x, i) => <tr key={i}>{satir(x).map((c, j) => <td key={j}>{c ?? '—'}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

// Yetki menüde gizlenir, asıl denetim sunucudadır (YG-988, YG-1113).
export function Panel({ ben, cikti }: { ben: Ben; cikti: () => void }) {
  const [sayfa, setSayfa] = useState<Sayfa>('ana');
  const menu: { s: Sayfa; ad: string; izin?: string }[] = [
    { s: 'ana', ad: 'Bugün' },
    { s: 'roller', ad: 'Rol Kataloğu', izin: 'rol_katalogu.goruntule' },
    { s: 'iz', ad: 'İşlem İzi', izin: 'denetim_izi.goruntule' },
  ];
  const cik = () => istek('/kimlik/cikis', {}).finally(cikti);
  return (
    <div className="panel">
      <header>
        <img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" />
        <nav>{menu.filter((m) => !m.izin || ben.izinler.includes(m.izin)).map((m) => (
          <button key={m.s} className={sayfa === m.s ? 'secili' : ''} onClick={() => setSayfa(m.s)}>{m.ad}</button>
        ))}</nav>
        <button className="cikis" onClick={() => void cik()}>Çıkış</button>
      </header>
      <main>
        {sayfa === 'ana' && (
          <>
            <h1>Hoş Geldiniz, {ben.adSoyad}</h1>
            <div className="ozet">
              <dl>
                <dt>Rol</dt><dd>{ben.roller.map((r) => r.rol_adi).join(', ') || '—'}</dd>
                <dt>Birim</dt><dd>{ben.roller.map((r) => r.rol_sahibi_birim).join(', ') || '—'}</dd>
                <dt>Kademe</dt><dd>{ben.roller.map((r) => r.kademe).join(', ') || '—'}</dd>
              </dl>
            </div>
            <p className="not">Bu sayfa kimlik ve yetki diliminin denemesidir. Rolünüze özel Bugün ekranı Adım 2'de gelecektir.</p>
          </>
        )}
        {sayfa === 'roller' && (<><h1>Rol Kataloğu</h1><Tablo<Rol> yol="/yetki/roller" baslik={['Rol', 'Birim', 'Kademe', 'Ayrıcalıklı']} satir={(r) => [r.rol_adi, r.rol_sahibi_birim, r.kademe, r.ayricalikli_rol ? 'Evet' : 'Hayır']} /></>)}
        {sayfa === 'iz' && (<><h1>İşlem İzi</h1><p className="not">Son 100 kayıt. Bu görüntüleme de kayda geçmiştir.</p><Tablo<Iz> yol="/denetim/izler" baslik={['Zaman', 'Kullanıcı', 'İşlem', 'Sonuç', 'Açıklama']} satir={(r) => [tarih(r.olay_zamani), r.aktor, r.eylem, r.sonuc, r.gerekce]} /></>)}
      </main>
      <footer><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></footer>
    </div>
  );
}
