import { useEffect, useState } from 'react';
import { bekleyenDinle } from './api';

/** YG-1634: işlem 5 saniyeyi aşarsa logo sıfırdan çizilerek gelir; bitince kapanır, altında hiç çıkmaz. */
export function Bekleme() {
  const [acik, setAcik] = useState(false);
  useEffect(() => {
    let z: number | undefined;
    return bekleyenDinle((n) => {
      if (n > 0 && z === undefined) z = window.setTimeout(() => setAcik(true), 5000);
      if (n === 0) { if (z !== undefined) { clearTimeout(z); z = undefined; } setAcik(false); }
    });
  }, []);
  if (!acik) return null;
  return <div className="bekleme" role="status" aria-label="İşlem sürüyor"><img src="/lgm_yatay_tr.png" alt="" /></div>;
}
