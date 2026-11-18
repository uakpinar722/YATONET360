import { useEffect, useState } from 'react';
import { istek } from './api';

type S = { kimlik: string; sigortaci_adi: string | null; kurum: string | null; tur: string; oncelik: string; saat: number };

/** YG-147: sigorta şirketi veya kurumsal müşteri sözleşmesindeki taahhüt süreleri (Müşteri ve Paydaş İlişkileri Müdürü, Ticari İşler Direktörü). */
export function SozlesmeSureleri() {
  const [l, setL] = useState<S[]>([]); const [k, setK] = useState<{ kimlik: string; unvan: string }[]>([]); const [m, setM] = useState('');
  const [f, setF] = useState({ taraf: 'Sigorta Şirketi', sigortaci: '', kurum: '', tur: 'İlk Yanıt', oncelik: 'Normal', saat: '' });
  const yk = () => istek<S[]>('/sozlesme-hedef-sureleri').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); void istek<{ kimlik: string; unvan: string }[]>('/kurumsal-kurumlar').then(setK).catch(() => setK([])); }, []);
  const kaydet = () => void istek('/sozlesme-hedef-suresi', { sigortaci: f.taraf === 'Sigorta Şirketi' ? f.sigortaci : undefined, kurum: f.taraf === 'Kurumsal Müşteri' ? f.kurum : undefined, tur: f.tur, oncelik: f.oncelik, saat: Number(f.saat.replace(',', '.')) }).then(() => { setM('Süre kaydedildi.'); setF({ ...f, saat: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Sözleşme Taahhüt Süreleri</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 ? <div className="not">Kayıt bulunmamaktadır.</div> : l.map((x) => <div key={x.kimlik}>{x.sigortaci_adi ?? x.kurum} · {x.tur} · {x.oncelik} · {Number(x.saat).toLocaleString('tr-TR')} saat</div>)}</div>
    <label htmlFor="ss-t">Sözleşme Tarafı</label><select id="ss-t" value={f.taraf} onChange={(e) => setF({ ...f, taraf: e.target.value })}>{['Sigorta Şirketi', 'Kurumsal Müşteri'].map((x) => <option key={x}>{x}</option>)}</select>
    {f.taraf === 'Sigorta Şirketi' ? <><label htmlFor="ss-s">Sigorta Şirketi</label><input id="ss-s" value={f.sigortaci} onChange={(e) => setF({ ...f, sigortaci: e.target.value })} /></>
      : <><label htmlFor="ss-k">Kurumsal Müşteri</label><select id="ss-k" value={f.kurum} onChange={(e) => setF({ ...f, kurum: e.target.value })}><option value="">Seçiniz</option>{k.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.unvan}</option>)}</select></>}
    <label htmlFor="ss-r">Süre Türü</label><select id="ss-r" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['İlk Yanıt', 'Keşif', 'Teklif'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ss-o">Öncelik</label><select id="ss-o" value={f.oncelik} onChange={(e) => setF({ ...f, oncelik: e.target.value })}>{['Kritik', 'Yüksek', 'Normal', 'Planlı'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ss-h">Taahhüt Süresi (Saat)</label><input id="ss-h" inputMode="decimal" value={f.saat} onChange={(e) => setF({ ...f, saat: e.target.value })} />
    <button className="btn2" disabled={!f.saat || !(f.taraf === 'Sigorta Şirketi' ? f.sigortaci.trim() : f.kurum)} onClick={kaydet}>Süreyi Kaydet</button>
    <OdemeVadesi kurumlar={k} /></>;
}

type V = { kimlik: string; sigortaci_adi: string | null; kurum: string | null; gun: number; dayanak: string };
/** YG-900: sigorta şirketinin ödeme günü (en çok 30 gün) ve kurumsal müşteri sözleşme vadesi; fatura vadesi buradan hesaplanır. */
function OdemeVadesi({ kurumlar }: { kurumlar: { kimlik: string; unvan: string }[] }) {
  const [l, setL] = useState<V[]>([]); const [m, setM] = useState(''); const [f, setF] = useState({ taraf: 'Sigorta Şirketi', sigortaci: '', kurum: '', gun: '', dayanak: '' });
  const yk = () => istek<V[]>('/sozlesme-odeme-vadeleri').then(setL).catch(() => setL([]));
  useEffect(() => { void yk(); }, []);
  const kaydet = () => void istek('/sozlesme-odeme-vadesi', { sigortaci: f.taraf === 'Sigorta Şirketi' ? f.sigortaci : undefined, kurum: f.taraf === 'Kurumsal Müşteri' ? f.kurum : undefined, gun: Number(f.gun), dayanak: f.dayanak }).then(() => { setM('Ödeme vadesi kaydedildi.'); setF({ ...f, gun: '', dayanak: '' }); return yk(); }).catch((e) => setM(e.message));
  return <><div className="bolum">Tahsilat Vadesi</div>{m && <div className="not" role="status">{m}</div>}
    <div className="ozet">{l.length === 0 ? <div className="not">Kayıt bulunmamaktadır; sigortada 30 gün, diğer müşterilerde fatura günü uygulanır.</div> : l.map((x) => <div key={x.kimlik}>{x.sigortaci_adi ?? x.kurum} · {x.gun} gün · {x.dayanak}</div>)}</div>
    <label htmlFor="ov-t">Sözleşme Tarafı</label><select id="ov-t" value={f.taraf} onChange={(e) => setF({ ...f, taraf: e.target.value })}>{['Sigorta Şirketi', 'Kurumsal Müşteri'].map((x) => <option key={x}>{x}</option>)}</select>
    {f.taraf === 'Sigorta Şirketi' ? <><label htmlFor="ov-s">Sigorta Şirketi</label><input id="ov-s" value={f.sigortaci} onChange={(e) => setF({ ...f, sigortaci: e.target.value })} /></>
      : <><label htmlFor="ov-k">Kurumsal Müşteri</label><select id="ov-k" value={f.kurum} onChange={(e) => setF({ ...f, kurum: e.target.value })}><option value="">Seçiniz</option>{kurumlar.map((x) => <option key={x.kimlik} value={x.kimlik}>{x.unvan}</option>)}</select></>}
    <label htmlFor="ov-g">Vade (Fatura Tarihinden Gün)</label><input id="ov-g" inputMode="numeric" value={f.gun} onChange={(e) => setF({ ...f, gun: e.target.value })} />
    <label htmlFor="ov-d">Dayanak</label><input id="ov-d" value={f.dayanak} onChange={(e) => setF({ ...f, dayanak: e.target.value })} />
    <button className="btn2" disabled={!f.gun || !f.dayanak.trim() || !(f.taraf === 'Sigorta Şirketi' ? f.sigortaci.trim() : f.kurum)} onClick={kaydet}>Vadeyi Kaydet</button></>;
}
