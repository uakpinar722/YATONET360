import { useEffect, useState, type FormEvent } from 'react';
import { istek } from './api';

interface Secenek { kimlik: string; ad: string; rol: string; rolAdi: string; vekiller: { kimlik: string; ad: string; rol: string }[] }
interface Kayit { kimlik: string; baslangic: string; bitis: string; durum: string; neden: string; asil: string; vekil: string; rol: string; benim: boolean }
const NEDEN = ['İzin', 'Hastalık', 'Görev değişikliği', 'Ayrılık', 'Ulaşım veya olağanüstü durum'];
const gun = (s: string) => s.split('-').reverse().join('.');

/** YG-1056, YG-1478: vekili birim amiri atar; vekâlet süreli ve en fazla 30 gündür. */
export function VekaletSayfasi() {
  const [v, setV] = useState<{ secenek: Secenek[]; kayitlar: Kayit[] } | null>(null);
  const [sec, setSec] = useState(''); const [vekil, setVekil] = useState(''); const [neden, setNeden] = useState('İzin'); const [kapsam, setKapsam] = useState('');
  const [bas, setBas] = useState(''); const [bit, setBit] = useState(''); const [hata, setHata] = useState(''); const [not, setNot] = useState('');
  const yukle = () => istek<{ secenek: Secenek[]; kayitlar: Kayit[] }>('/vekalet').then(setV).catch((e) => setHata(e.message));
  useEffect(() => { void yukle(); }, []);
  const asil = v?.secenek.find((s) => `${s.kimlik}|${s.rol}` === sec);
  const gonder = async (e: FormEvent) => {
    e.preventDefault(); setHata(''); setNot('');
    try {
      const r = await istek<{ kimlik: string }>('/vekalet', { asil: asil!.kimlik, rol: asil!.rol, vekil, neden, kapsam, baslangic: bas, bitis: bit });
      setNot(`${r.kimlik} numaralı vekâlet tanımlanmıştır; asıl görevliye ve vekile bildirim gönderilmiştir.`);
      setSec(''); setVekil(''); setKapsam(''); setBas(''); setBit(''); void yukle();
    } catch (x) { setHata((x as Error).message); }
  };
  const bitir = (id: string) => istek(`/vekalet/${id}/bitir`, {}).then(yukle).catch((e) => setHata(e.message));
  return (
    <>
      <h1>Vekâlet</h1>
      {hata && <div className="hata" role="alert">{hata}</div>}
      {not && <div className="basari">{not}</div>}
      {v && v.secenek.length > 0 && (
        <form className="ozet" onSubmit={(e) => void gonder(e)}>
          <label htmlFor="v-a">Asıl Görevli</label>
          <select id="v-a" value={sec} onChange={(e) => { setSec(e.target.value); setVekil(''); }}><option value="">Seçiniz</option>{v.secenek.map((s) => <option key={`${s.kimlik}|${s.rol}`} value={`${s.kimlik}|${s.rol}`}>{s.ad} · {s.rolAdi}</option>)}</select>
          <label htmlFor="v-v">Vekil</label>
          <select id="v-v" value={vekil} disabled={!asil} onChange={(e) => setVekil(e.target.value)}><option value="">Seçiniz</option>{asil?.vekiller.map((k) => <option key={k.kimlik} value={k.kimlik}>{k.ad} · {k.rol}</option>)}</select>
          {asil && asil.vekiller.length === 0 && <div className="not">Bu role vekâlet edebilecek uygun kişi bulunmamaktadır.</div>}
          <label htmlFor="v-n">Vekâlet Nedeni</label>
          <select id="v-n" value={neden} onChange={(e) => setNeden(e.target.value)}>{NEDEN.map((n) => <option key={n}>{n}</option>)}</select>
          <label htmlFor="v-k">Kapsam</label>
          <textarea id="v-k" rows={2} value={kapsam} onChange={(e) => setKapsam(e.target.value)} />
          <div className="iki-tarih">
            <div><label htmlFor="v-b">Başlangıç Tarihi</label><input id="v-b" type="date" value={bas} onChange={(e) => setBas(e.target.value)} /></div>
            <div><label htmlFor="v-s">Bitiş Tarihi</label><input id="v-s" type="date" value={bit} onChange={(e) => setBit(e.target.value)} /></div>
          </div>
          <div className="not">Vekâlet en fazla 30 gün olabilir; bitiş tarihinde kendiliğinden kapanır.</div>
          <button className="btn" disabled={!asil || !vekil || !kapsam.trim() || !bas || !bit}>Vekâlet Tanımla</button>
        </form>
      )}
      {v && v.secenek.length === 0 && <div className="ozet bos">Vekil atayabileceğiniz bağlı personel bulunmamaktadır.</div>}
      <div className="bolum">Vekâlet Kayıtları</div>
      {v?.kayitlar.length === 0 && <div className="ozet bos">Vekâlet kaydı bulunmamaktadır.</div>}
      {v && v.kayitlar.length > 0 && (
        <div className="tablo"><table className="kartli">
          <thead><tr><th>No</th><th>Asıl Görevli</th><th>Vekil</th><th>Rol</th><th>Tarih</th><th>Durum</th><th /></tr></thead>
          <tbody>{v.kayitlar.map((k) => (
            <tr key={k.kimlik}>
              <td data-ad="No">{k.kimlik}</td><td data-ad="Asıl Görevli">{k.asil}</td><td data-ad="Vekil">{k.vekil}</td><td data-ad="Rol">{k.rol}</td>
              <td data-ad="Tarih">{gun(k.baslangic)} – {gun(k.bitis)}</td><td data-ad="Durum">{k.durum}</td>
              <td data-ad="İşlem">{k.benim && k.durum === 'Aktif' ? <button className="btn2 kucuk" onClick={() => void bitir(k.kimlik)}>Sonlandır</button> : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
