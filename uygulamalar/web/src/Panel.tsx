import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { Bildirimler, Bugun, type BugunVeri } from './Bugun';
import { Profilim } from './Hesabim';

type Sayfa = 'ana' | 'bildirim' | 'roller' | 'iz' | 'profil' | 'mesaj' | 'idari' | 'yardim';
interface Rol { kimlik: string; rol_adi: string; rol_sahibi_birim: string; kademe: string; ayricalikli_rol: boolean }
interface Iz { kimlik: string; olay_zamani: string; eylem: string; sonuc: string; gerekce: string | null; aktor: string | null }

const tarih = (s: string) => new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Istanbul' });

/** YG-1638: telefonda her satır kart olur, her bilginin başında sütun adı yazar. */
function Tablo<T>({ yol, baslik, satir }: { yol: string; baslik: string[]; satir: (x: T) => (string | null)[] }) {
  const [d, setD] = useState<T[] | null>(null);
  const [h, setH] = useState('');
  useEffect(() => { istek<T[]>(yol).then(setD).catch((e) => setH(e.message)); }, [yol]);
  if (h) return <div className="hata" role="alert">{h}</div>;
  if (!d) return null;
  return (
    <div className="tablo"><table className="kartli">
      <thead><tr>{baslik.map((b) => <th key={b}>{b}</th>)}</tr></thead>
      <tbody>{d.map((x, i) => <tr key={i}>{satir(x).map((c, j) => <td key={j} data-ad={baslik[j]}>{c ?? '—'}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

const Yakinda = ({ ad, adim }: { ad: string; adim: string }) => <><h1>{ad}</h1><div className="ozet"><div className="not">Bu bölüm {adim} kapsamında açılacaktır.</div></div></>;

// Menüde yalnız yetkili sayfalar görünür; asıl denetim sunucudadır (YG-988, YG-1113).
export function Panel({ ben, cikti }: { ben: Ben; cikti: () => void }) {
  const [sayfa, setSayfa] = useState<Sayfa>('ana');
  const [veri, setVeri] = useState<BugunVeri | null>(null);
  const [hata, setHata] = useState('');
  const [araNot, setAraNot] = useState(false);
  const lgm = ben.grup === 'LGM İç Rolü';
  const yenile = useCallback(() => istek<BugunVeri>('/bugun').then((v) => { setVeri(v); setHata(''); }).catch((e) => setHata(e.message)), []);
  useEffect(() => { void yenile(); }, [yenile, sayfa]);
  const git = (s: Sayfa) => { setSayfa(s); setAraNot(false); };
  const menu: { s: Sayfa; ad: string; ik: string; izin?: string }[] = [
    { s: 'ana', ad: lgm ? 'Bugün' : 'Ana Sayfa', ik: '☀' },
    { s: 'roller', ad: 'Rol Kataloğu', ik: '▤', izin: 'rol_katalogu.goruntule' },
    { s: 'iz', ad: 'İşlem İzi', ik: '☰', izin: 'denetim_izi.goruntule' },
    { s: 'bildirim', ad: 'Bildirimler', ik: '🔔' },
  ];
  const b = veri?.okunmamisBildirim ?? 0;
  const icerik: Record<Sayfa, ReactNode> = {
    ana: <Bugun ben={ben} veri={veri} hata={hata} yenile={yenile} />,
    bildirim: <Bildirimler yenile={yenile} />,
    profil: <Profilim />,
    mesaj: <Yakinda ad="Mesajlar" adim="Adım 3" />,
    idari: <Yakinda ad="İdari İşlemlerim" adim="Adım 7" />,
    yardim: <Yakinda ad="Yardım" adim="Adım 3" />,
    roller: <><h1>Rol Kataloğu</h1><Tablo<Rol> yol="/yetki/roller" baslik={['Rol', 'Birim', 'Kademe', 'Ayrıcalıklı']} satir={(r) => [r.rol_adi, r.rol_sahibi_birim, r.kademe, r.ayricalikli_rol ? 'Evet' : 'Hayır']} /></>,
    iz: <><h1>İşlem İzi</h1><p className="not">Son 100 kayıt. Bu görüntüleme de kayda geçmiştir.</p><Tablo<Iz> yol="/denetim/izler" baslik={['Zaman', 'Kullanıcı', 'İşlem', 'Sonuç', 'Açıklama']} satir={(r) => [tarih(r.olay_zamani), r.aktor, r.eylem, r.sonuc, r.gerekce]} /></>,
  };
  return (
    <div className="kabuk">
      <header className="ust-satir">
        <img src="/lgm_yatay_tr.png" alt="LİMİT GLOBAL MARINE" />
        <div className="ust-sag">
          <button className="hap" onClick={() => git('yardim')}>{lgm ? 'Yardım | BT Destek' : 'Yardım | LGM Merkez'}</button>
          <button className="cikis" onClick={() => void istek('/kimlik/cikis', {}).finally(cikti)}>Çıkış</button>
        </div>
      </header>
      <div className="ara-satir">
        <input aria-label="Ara" placeholder={lgm ? 'Ara: Dosya No, Hasar Dosya No, Yat, Firma, Kişi' : 'Ara: Dosya No, Yat Adı'} onKeyDown={(e) => { if (e.key === 'Enter') setAraNot(true); }} />
        <div className="ara-bag">
          <button className="ust-bag" onClick={() => git('mesaj')}>✉ Mesajlar <em className="sayi">0</em></button>
          {lgm && <button className="ust-bag" onClick={() => git('idari')}>İdari İşlemlerim</button>}
          <button className="ust-bag" onClick={() => git('profil')}>☺ Profil</button>
        </div>
      </div>
      {veri?.olaganustu && <div className="ood" role="alert">⚠ Olağanüstü Olay Dönemi · Başlangıç: {new Date(veri.olaganustu).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })} · Süreler Askıdadır</div>}
      <div className="govde">
        <nav className="yan-menu">
          {menu.filter((m) => !m.izin || ben.izinler.includes(m.izin)).map((m) => (
            <button key={m.s} className={sayfa === m.s ? 'secili' : ''} onClick={() => git(m.s)}>
              <i aria-hidden="true">{m.ik}</i><span>{m.ad}</span>{m.s === 'bildirim' && b > 0 && <em className="sayi" aria-label={`${b} okunmamış`}>{b}</em>}
            </button>
          ))}
        </nav>
        <main>
          {araNot && <div className="not ara-not">Arama, kayıtlar eklendikçe Adım 4'te açılacaktır.</div>}
          {icerik[sayfa]}
          <footer><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></footer>
        </main>
      </div>
    </div>
  );
}
