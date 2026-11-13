import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

interface Madde { madde: string; kritik: boolean; sonuc: string | null; aciklama: string | null; kanit_tanimi: string | null; kanit_belge_ref: string | null }
interface Kayit { kimlik: string; kayitNo: string; kod: string; ad: string | null; statu: string; eksikler: string | null; hazirlayanBenim: boolean; maddeler: Madde[] }

/** YG-685: kontrol listesi Evet / Hayır / Uygulanmaz; renkli durum tablosu PDF. */
export function KontrolListeleri({ dosya, kayitlar, yap }: { dosya: string; kayitlar: { kimlik: string; kayit_no: string; kontrol_listesi: string; statu: string }[]; yap: (f: () => Promise<any>, tamam?: string) => Promise<void> }) {
  const [kodlar, setKodlar] = useState<{ kod: string; ad: string | null }[]>([]); const [kod, setKod] = useState('');
  const [acik, setAcik] = useState<Kayit | null>(null); const [ac, setAc] = useState<Record<string, string>>({}); const [kn, setKn] = useState<Record<string, string>>({}); const [eksik, setEksik] = useState('');
  useEffect(() => { void istek<typeof kodlar>('/kontrol-listesi-kodlari').then(setKodlar).catch(() => setKodlar([])); }, []);
  const getir = (id: string) => void istek<Kayit>(`/kontrol-listesi/${id}`).then(setAcik).catch(() => setAcik(null));
  const yanit = (m: Madde, sonuc: string) => void yap(() => istek(`/kontrol-listesi/${acik!.kimlik}/madde`, { madde: m.madde, sonuc, aciklama: ac[m.madde] || undefined, kanit: kn[m.madde] || undefined })).then(() => getir(acik!.kimlik));
  const renk = (s: string | null) => (s === 'Evet' ? 'rozet' : s === 'Hayır' ? 'rozet kirmizi' : 'rozet gri');
  return <div className="tam">
    {kayitlar.map((x) => <div key={x.kimlik} className="soru"><span>{x.kayit_no} · {x.statu}</span><div className="dugmeler"><button className="btn2 kucuk" onClick={() => getir(x.kimlik)}>Aç</button><a className="btn2 kucuk" href={`/api/kontrol-listesi/${x.kimlik}/pdf`} target="_blank" rel="noreferrer">Durum Tablosu</a></div></div>)}
    <label htmlFor={`kl-k-${dosya}`}>Kontrol Listesi</label><select id={`kl-k-${dosya}`} value={kod} onChange={(e) => setKod(e.target.value)}><option value="">Seçiniz</option>{kodlar.map((x) => <option key={x.kod} value={x.kod}>{x.kod}{x.ad ? ` · ${x.ad}` : ''}</option>)}</select>
    <button className="btn2 kucuk" disabled={!kod} onClick={() => void yap(() => istek<{ kimlik: string }>(`/dosya/${dosya}/kontrol-listesi`, { kod }).then((r) => getir(r.kimlik)), 'Kontrol listesi açıldı.')}>Kontrol Listesi Aç</button>
    {acik && <div className="tam"><b>{acik.kayitNo}{acik.ad ? ` · ${acik.ad}` : ''} · {acik.statu}</b>
      {acik.maddeler.map((m) => <div key={m.madde} className="soru"><span>{m.madde.replace(/^[A-Z]{2}-[A-Z]{3}-\d{3} \/ /, '')}{m.kritik ? ' (kritik)' : ''}{m.kanit_tanimi ? ` · Kanıt: ${m.kanit_tanimi}` : ''} · <span className={renk(m.sonuc)}>{m.sonuc ?? 'Yanıtsız'}</span>{m.aciklama ? ` · ${m.aciklama}` : ''}</span>
        {acik.statu === 'Taslak' && <div className="tam">
          <label htmlFor={`kl-a-${m.madde}`}>Açıklama</label><input id={`kl-a-${m.madde}`} value={ac[m.madde] ?? ''} onChange={(e) => setAc({ ...ac, [m.madde]: e.target.value })} />
          {m.kanit_tanimi && <BelgeSec ad="Kanıt Belgesi" bagTuru="Dosya" bagKimligi={dosya} deger={kn[m.madde] ?? ''} sec={(x) => setKn({ ...kn, [m.madde]: x })} />}
          <div className="dugmeler">{['Evet', 'Hayır', 'Uygulanmaz'].map((s) => <button key={s} className={m.sonuc === s ? 'btn kucuk' : 'btn2 kucuk'} onClick={() => yanit(m, s)}>{s}</button>)}</div></div>}
      </div>)}
      {acik.statu === 'Taslak' && !acik.hazirlayanBenim && <><label htmlFor="kl-e">Eksikler</label><input id="kl-e" value={eksik} onChange={(e) => setEksik(e.target.value)} />
        <button className="btn2" onClick={() => void yap(() => istek(`/kontrol-listesi/${acik.kimlik}/tamamla`, { eksikler: eksik || undefined }), 'Kontrol listesi onaylandı.').then(() => getir(acik.kimlik))}>Kontrol Listesini Onayla</button></>}
    </div>}
  </div>;
}
