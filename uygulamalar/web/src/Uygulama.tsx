import { useEffect, useState } from 'react';
import { ApiHatasi, istek, type Ben } from './api';
import { BelgeDogrula, PaylasimAc } from './Genel';
import { Giris } from './Giris';
import { ParolaYenile } from './Hesabim';
import { Davet, IlkAdimlar } from './IlkGiris';
import { Panel } from './Panel';

const davetBelirteci = () => /^#davet=(.+)$/.exec(location.hash)?.[1] ?? null;

export function Uygulama() {
  const [ben, setBen] = useState<Ben | null>(null);
  const [hazir, setHazir] = useState(false);
  const [davet, setDavet] = useState(davetBelirteci);
  const [parola, setParola] = useState(() => /^#parola=(.+)$/.exec(location.hash)?.[1] ?? null);
  // Adımlar bu oturumda başladıysa son "Hesabınız Hazır" ekranı da gösterilir.
  const [adimda, setAdimda] = useState(false);
  const yenile = () => istek<Ben>('/ben')
    .then((b) => { setBen(b); if (b.eksik.length) setAdimda(true); })
    .catch((e) => { if (e instanceof ApiHatasi) setBen(null); })
    .finally(() => setHazir(true));
  useEffect(() => { void yenile(); }, []);
  // Bağlantı, sayfa açıkken aynı sekmeye yapıştırılırsa da karşılanır.
  useEffect(() => {
    const degisti = () => { setDavet(davetBelirteci()); setParola(/^#parola=(.+)$/.exec(location.hash)?.[1] ?? null); };
    addEventListener('hashchange', degisti);
    return () => removeEventListener('hashchange', degisti);
  }, []);
  if (!hazir) return null;
  // Giriş gerektirmeyen sayfalar (YG-611, YG-691).
  const genel = /^#(dogrula|paylasim)=?(.*)$/.exec(location.hash);
  if (genel?.[1] === 'dogrula') return <BelgeDogrula ilkKod={genel[2] ?? ''} />;
  if (genel?.[1] === 'paylasim' && genel[2]) return <PaylasimAc belirtec={genel[2]} />;
  if (davet) return <Davet belirtec={davet} bitti={() => { setDavet(null); void yenile(); }} />;
  if (parola) return <ParolaYenile belirtec={parola} bitti={() => { history.replaceState(null, '', location.pathname); setParola(null); setBen(null); }} />;
  if (!ben) return <Giris girdi={yenile} />;
  if (adimda) return <IlkAdimlar ben={ben} bitti={() => { setAdimda(false); void yenile(); }} />;
  return <Panel ben={ben} cikti={() => setBen(null)} />;
}
