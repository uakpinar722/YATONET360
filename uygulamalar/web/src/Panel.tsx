import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { istek, type Ben } from './api';
import { Bildirimler, Bugun, type BugunVeri } from './Bugun';
import { AramaSonucu, Dosyalar } from './Dosya';
import { ErisimTalebi, ErisimVeRol } from './Erisim';
import { Profilim } from './Hesabim';
import { YatSahibiAna } from './Portal';
import { FirmaAna, IdariIslemler, NobetAcil, SigortaAna, SigortaEk2, TedarikciOdemeleri } from './Ticari';
import { KarneParametreleri, FirmaSicil } from './Sicil';
import { KurumHesap, TedarikciAna, TesisAna } from './Portallar';
import { DuyuruYayimla, Mesajlar } from './Iletisim';
import { HesapKurtarma } from './Kurtarma';
import { Toplantilar } from './Toplanti';
import { VekaletSayfasi } from './Vekalet';

type Sayfa = 'karnepar' | 'firmaisemri' | 'ek2' | 'tedodeme' | 'tedsiparis' | 'tedteklif' | 'kurum' | 'ana' | 'bildirim' | 'roller' | 'iz' | 'profil' | 'mesaj' | 'idari' | 'yardim' | 'erisim' | 'erisimrol' | 'kurtarma' | 'vekalet' | 'duyuru' | 'toplanti' | 'dosya' | 'ara' | 'nobet' | 'sicil';
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
  const [araQ, setAraQ] = useState(''); const [acikDosya, setAcikDosya] = useState<string | null>(null);
  const lgm = ben.grup === 'LGM İç Rolü';
  const yenile = useCallback(() => istek<BugunVeri>('/bugun').then((v) => { setVeri(v); setHata(''); }).catch((e) => setHata(e.message)), []);
  useEffect(() => { void yenile(); }, [yenile, sayfa]);
  const git = (s: Sayfa) => setSayfa(s);
  const menu: { s: Sayfa; ad: string; ik: string; izin?: string }[] = [
    { s: 'ana', ad: lgm ? 'Bugün' : 'Ana Sayfa', ik: '☀' },
    ...(lgm ? [{ s: 'dosya' as Sayfa, ad: 'Dosyalar', ik: '▣' }, { s: 'nobet' as Sayfa, ad: 'Nöbet ve Acil', ik: '✚' }] : []),
    { s: 'sicil', ad: 'Firma Sicili', ik: '▦', izin: 'firma.kayit' },
    { s: 'roller', ad: 'Rol Kataloğu', ik: '▤', izin: 'rol_katalogu.goruntule' },
    { s: 'iz', ad: 'İşlem İzi', ik: '☰', izin: 'denetim_izi.goruntule' },
    { s: 'erisimrol', ad: 'Erişim ve Rol', ik: '⚿', izin: 'erisim.uygula' },
    { s: 'kurtarma', ad: 'Hesap Kurtarma', ik: '⚿', izin: 'hesap_kurtarma.ac' },
    ...(lgm ? [{ s: 'erisim' as Sayfa, ad: 'Erişim Talebi', ik: '＋' }, { s: 'vekalet' as Sayfa, ad: 'Vekâlet', ik: '⇄' }, { s: 'duyuru' as Sayfa, ad: 'Duyuru Yayımla', ik: '📣' }, { s: 'toplanti' as Sayfa, ad: 'Toplantılar', ik: '▦' }] : []),
    ...(ben.roller.some((r) => r.rol_adi === 'Müşteri ve Paydaş İlişkileri Müdürü') ? [{ s: 'ek2' as Sayfa, ad: 'Sigorta Ek-2', ik: '✉' }] : []),
    ...(ben.roller.some((r) => ['Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)', 'Muhasebe ve Finans Yöneticisi', 'Muhasebe ve Finans Müdürü'].includes(r.rol_adi)) ? [{ s: 'tedodeme' as Sayfa, ad: 'Tedarikçi Ödemeleri', ik: '₺' }] : []),
    ...(ben.roller.some((r) => r.rol_adi === 'Teknik ve Operasyon Direktörü') ? [{ s: 'karnepar' as Sayfa, ad: 'Karne Parametreleri', ik: '⚙' }] : []),
    ...(ben.grup === 'İş Birliği Firması' ? [{ s: 'firmaisemri' as Sayfa, ad: 'İş Emirleri', ik: '▣' }] : []),
    ...(ben.grup === 'Tedarikçi' ? [{ s: 'tedsiparis' as Sayfa, ad: 'Siparişler', ik: '▣' }, { s: 'tedteklif' as Sayfa, ad: 'Teklifler', ik: '▤' }] : []),
    { s: 'bildirim', ad: 'Bildirimler', ik: '🔔' },
    ...(ben.grup === 'İş Birliği Firması' ? [{ s: 'kurum' as Sayfa, ad: 'Firma', ik: '▦' }] : ben.grup === 'Tedarikçi' || ben.grup.startsWith('Tesis') ? [{ s: 'kurum' as Sayfa, ad: 'Hesap', ik: '▦' }] : []),
  ];
  const b = veri?.okunmamisBildirim ?? 0;
  const icerik: Record<Sayfa, ReactNode> = {
    ana: ben.grup.startsWith('Bireysel') || ben.grup === 'Kurumsal Müşteri' ? <YatSahibiAna ben={ben} /> : ben.grup === 'İş Birliği Firması' ? <FirmaAna ben={ben} /> : ben.grup.startsWith('Sigorta') ? <SigortaAna ben={ben} /> : ben.grup.startsWith('Tesis Yetkilisi') ? <TesisAna ben={ben} /> : ben.grup === 'Tedarikçi' ? <TedarikciAna ben={ben} /> : <Bugun ben={ben} veri={veri} hata={hata} yenile={yenile} />,
    bildirim: <Bildirimler yenile={yenile} />,
    profil: <Profilim />,
    erisim: <ErisimTalebi />,
    erisimrol: <ErisimVeRol />,
    kurtarma: <HesapKurtarma />,
    vekalet: <VekaletSayfasi />,
    mesaj: <Mesajlar lgm={lgm} yenile={() => void yenile()} />,
    duyuru: <DuyuruYayimla />,
    toplanti: <Toplantilar />,
    dosya: <Dosyalar ben={ben} acikDosya={acikDosya} acildi={() => setAcikDosya(null)} />,
    ara: <AramaSonucu q={araQ} ac={(id) => { setAcikDosya(id); git('dosya'); }} />,
    idari: <IdariIslemler />,
    ek2: <SigortaEk2 />,
    firmaisemri: <FirmaAna ben={ben} bolum="isemri" />,
    karnepar: <KarneParametreleri />,
    tedodeme: <TedarikciOdemeleri />,
    tedsiparis: <TedarikciAna ben={ben} bolum="siparis" />,
    tedteklif: <TedarikciAna ben={ben} bolum="teklif" />,
    kurum: <KurumHesap baslik={ben.grup === 'İş Birliği Firması' ? 'Firma' : 'Hesap'} />,
    sicil: <FirmaSicil ben={ben} />,
    nobet: <NobetAcil cizelge={ben.izinler.includes('nobet.hazirla')} izinli={ben.izinler.includes('ihbar.kaydet')} dosyaAc={(id) => { setAcikDosya(id); git('dosya'); }} />,
    yardim: <Yakinda ad="Yardım" adim="sonraki adımlar" />,
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
        <input aria-label="Ara" placeholder={lgm ? 'Ara: Dosya No, Hasar Dosya No, Yat, Firma, Kişi' : 'Ara: Dosya No, Yat Adı'} onKeyDown={(e) => { const q = e.currentTarget.value.trim(); if (e.key === 'Enter' && q.length >= 2 && lgm) { setAraQ(q); git('ara'); } }} />
        <div className="ara-bag">
          <button className="ust-bag" onClick={() => git('mesaj')}>✉ Mesajlar <em className="sayi">{veri?.okunmamisMesaj ?? 0}</em></button>
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
          {icerik[sayfa]}
          <footer><span className="ayrac" aria-hidden="true" /><img src="/yatonet.png" alt="YATONET 360" /></footer>
        </main>
      </div>
    </div>
  );
}
