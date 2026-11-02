import { useEffect, useState } from 'react';
import { ApiHatasi, istek, type Ben } from './api';
import { Giris } from './Giris';
import { Panel } from './Panel';

export function Uygulama() {
  const [ben, setBen] = useState<Ben | null>(null);
  const [hazir, setHazir] = useState(false);
  const yenile = () => istek<Ben>('/ben').then(setBen).catch((e) => { if (e instanceof ApiHatasi) setBen(null); }).finally(() => setHazir(true));
  useEffect(() => { void yenile(); }, []);
  if (!hazir) return null;
  return ben ? <Panel ben={ben} cikti={() => setBen(null)} /> : <Giris girdi={yenile} />;
}
