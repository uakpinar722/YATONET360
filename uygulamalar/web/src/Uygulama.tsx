import { useEffect, useState } from 'react';
import { ApiHatasi, istek, type Ben } from './api';
import { Giris } from './Giris';
import { Davet, IlkAdimlar } from './IlkGiris';
import { Panel } from './Panel';

const davetBelirteci = () => /^#davet=(.+)$/.exec(location.hash)?.[1] ?? null;

export function Uygulama() {
  const [ben, setBen] = useState<Ben | null>(null);
  const [hazir, setHazir] = useState(false);
  const [davet, setDavet] = useState(davetBelirteci);
  // Adımlar bu oturumda başladıysa son "Hesabınız Hazır" ekranı da gösterilir.
  const [adimda, setAdimda] = useState(false);
  const yenile = () => istek<Ben>('/ben')
    .then((b) => { setBen(b); if (b.eksik.length) setAdimda(true); })
    .catch((e) => { if (e instanceof ApiHatasi) setBen(null); })
    .finally(() => setHazir(true));
  useEffect(() => { void yenile(); }, []);
  if (!hazir) return null;
  if (davet) return <Davet belirtec={davet} bitti={() => { setDavet(null); void yenile(); }} />;
  if (!ben) return <Giris girdi={yenile} />;
  if (adimda) return <IlkAdimlar ben={ben} bitti={() => { setAdimda(false); void yenile(); }} />;
  return <Panel ben={ben} cikti={() => setBen(null)} />;
}
