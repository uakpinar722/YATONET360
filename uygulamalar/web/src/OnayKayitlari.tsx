import { useEffect, useState } from 'react';
import { istek } from './api';

type K = { tur: string; zaman: string; konu: string; sonuc: string; onaylayan: string | null; kanal: string };
/** YG-160: dosyanın onay kayıtları türüne göre (Talimat, Teknik Onay, Bedel Kabulü, Değişiklik Onayı, Teslim Kabulü). */
export function OnayKayitlari({ dosya }: { dosya: string }) {
  const [v, setV] = useState<{ turler: string[]; kayitlar: K[] } | null>(null); const [tur, setTur] = useState('');
  useEffect(() => { void istek<NonNullable<typeof v>>(`/dosya/${dosya}/onay-kayitlari${tur ? `?tur=${encodeURIComponent(tur)}` : ''}`).then(setV).catch(() => setV(null)); }, [dosya, tur]);
  if (!v) return null;
  return <details><summary>Onay Kayıtları{v.kayitlar.length ? ` · ${v.kayitlar.length}` : ''}</summary>
    <label htmlFor="ok-t">Tür</label><select id="ok-t" value={tur} onChange={(e) => setTur(e.target.value)}><option value="">Tümü</option>{v.turler.map((x) => <option key={x}>{x}</option>)}</select>
    {v.kayitlar.length ? <div className="tablo"><table className="kartli"><thead><tr><th>Tür</th><th>Tarih</th><th>Konu</th><th>Sonuç</th><th>Onaylayan</th><th>Kanal</th></tr></thead>
      <tbody>{v.kayitlar.map((x, n) => <tr key={n}><td data-ad="Tür">{x.tur}</td><td data-ad="Tarih">{new Date(x.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' })}</td><td data-ad="Konu">{x.konu}</td><td data-ad="Sonuç">{x.sonuc}</td><td data-ad="Onaylayan">{x.onaylayan ?? '—'}</td><td data-ad="Kanal">{x.kanal}</td></tr>)}</tbody></table></div> : <div className="not">Kayıt yok.</div>}
  </details>;
}
