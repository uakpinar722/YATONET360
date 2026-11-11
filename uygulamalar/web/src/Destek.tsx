import { turYenidenBaslat } from './Yonlendirme';
import { useEffect, useState } from 'react';
import { istek } from './api';
import { BelgeSec } from './Kalite';

type Talep = { kimlik: string; talep_no: string; tur: string; seviye: string; durum: string; belirti: string; yanit_son: string; cozum_son: string | null; kullaniciya_sonuc: string | null; dosya_no: string | null };
const zaman = (s: string | null) => (s ? new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '-');

/** YG-1504: dosya veya iş emri ekranından açılan talep o dosyaya bağlanır ve dosyanın Dosya Sorumlusuna düşer. */
export function DosyaDestek({ dosya }: { dosya: string }) {
  const [b, setB] = useState(''); const [m, setM] = useState('');
  return <><div className="bolum">Bu Dosya İçin Destek Talebi</div>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor={`dd-${dosya}`}>Destek Talebi Açıklaması</label><input id={`dd-${dosya}`} value={b} onChange={(e) => setB(e.target.value)} />
    <button className="btn2 kucuk" disabled={!b.trim()} onClick={() => void istek<{ talepNo: string }>('/destek', { tur: 'Soru', belirti: b.trim(), dosya }).then((r) => { setM(`${r.talepNo} açıldı.`); setB(''); }).catch((e) => setM(e.message))}>Talep Aç</button></>;
}

/** YG-1409–1412, YG-1504: Yardım | BT Destek / LGM Merkez; talep açma, taleplerim, BT çözüm kaydı ve kullanıcı doğrulaması. */
export function DestekSayfasi({ lgm }: { lgm: boolean }) {
  const [f, setF] = useState({ tur: 'Hata', belirti: '', etki: '', beklenen: '', ekran: '', etkilenen: '1', sistemKullanilamiyor: false, kritikSurec: false, guvenlik: false, veriButunlugu: false, musteriMali: false });
  const [l, setL] = useState<Talep[]>([]); const [bt, setBt] = useState<Talep[] | null>(null); const [m, setM] = useState(''); const [son, setSon] = useState<string | null>(null); const [eg, setEg] = useState('');
  const [cz, setCz] = useState<Record<string, { yapilan: string; degisen: string; dogrulama: string; sonuc: string }>>({});
  const yk = () => { void istek<Talep[]>('/destek').then(setL).catch(() => setL([])); if (lgm) void istek<Talep[]>('/destek?hepsi=1').then(setBt).catch(() => setBt(null)); };
  useEffect(() => { yk(); }, []);
  const is = (u: string, g: object, ok: string) => void istek(u, g).then(() => { setM(ok); yk(); }).catch((e) => setM(e.message));
  const K = (k: 'sistemKullanilamiyor' | 'kritikSurec' | 'guvenlik' | 'veriButunlugu' | 'musteriMali', et: string) => <label className="kutu"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /><span>{et}</span></label>;
  const c = (id: string) => cz[id] ?? { yapilan: '', degisen: '', dogrulama: '', sonuc: '' };
  return <><h1>{lgm ? 'Yardım | BT Destek' : 'Yardım | LGM Merkez'}</h1>{lgm && <button className="btn2 kucuk" onClick={turYenidenBaslat}>İlk Kullanım Turunu Yeniden Başlat</button>}{m && <div className="not" role="status">{m}</div>}
    <div className="bolum">Yeni Talep</div>
    <label htmlFor="ds-t">Talep Türü</label><select id="ds-t" value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value })}>{['Hata', 'Öneri', 'Soru'].map((x) => <option key={x}>{x}</option>)}</select>
    <label htmlFor="ds-b">Kısa Açıklama</label><input id="ds-b" value={f.belirti} onChange={(e) => setF({ ...f, belirti: e.target.value })} />
    <label htmlFor="ds-e">Ekran veya İşlem</label><input id="ds-e" value={f.ekran} onChange={(e) => setF({ ...f, ekran: e.target.value })} />
    <label htmlFor="ds-k">Etkisi</label><input id="ds-k" value={f.etki} onChange={(e) => setF({ ...f, etki: e.target.value })} />
    <label htmlFor="ds-y">Beklenen Sonuç</label><input id="ds-y" value={f.beklenen} onChange={(e) => setF({ ...f, beklenen: e.target.value })} />
    {f.tur === 'Hata' && <>
      <label htmlFor="ds-n">Etkilenen Kullanıcı veya İş Sayısı</label><input id="ds-n" inputMode="numeric" value={f.etkilenen} onChange={(e) => setF({ ...f, etkilenen: e.target.value })} />
      {K('sistemKullanilamiyor', 'Sistem kullanılamıyor')}{K('kritikSurec', 'Kritik süreç durdu')}{K('guvenlik', 'Güvenlik olayı')}{K('veriButunlugu', 'Veri hatalı veya kayıp')}{K('musteriMali', 'Müşteriyi veya ödemeyi etkiliyor')}</>}
    <button className="btn2" disabled={!f.belirti.trim()} onClick={() => void istek<{ kimlik: string; talepNo: string; seviye: string }>('/destek', { ...f, etkilenen: Number(f.etkilenen) || 1 }).then((r) => { setM(`${r.talepNo} açıldı (${r.seviye}).`); setSon(r.kimlik); setEg(''); setF({ ...f, belirti: '', etki: '', beklenen: '', ekran: '' }); yk(); }).catch((e) => setM(e.message))}>Talep Gönder</button>
    {son && <BelgeSec ad="Ekran Görüntüsü (isteğe bağlı)" bagTuru="Destek Talebi" bagKimligi={son} deger={eg} sec={(x) => { setEg(x); void istek(`/destek/${son}/ekran-goruntusu`, { belge: x }).then(() => setM('Ekran görüntüsü eklendi.')).catch((e) => setM(e.message)); }} />}
    <div className="bolum">Taleplerim</div>
    <div className="ozet">{l.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{l.map((x) => <div key={x.kimlik}>{x.talep_no} · {x.seviye} · {x.tur} · {x.durum} · {x.belirti}{x.kullaniciya_sonuc ? ` · Sonuç: ${x.kullaniciya_sonuc}` : ''}
      {x.durum === 'Çözüldü' && <><button className="btn2 kucuk" onClick={() => is(`/destek/${x.kimlik}/dogrula`, { sonuc: 'Çözüldü' }, 'Talep kapatıldı.')}>Çözüldü</button><button className="btn2 kucuk" onClick={() => is(`/destek/${x.kimlik}/dogrula`, { sonuc: 'Sorun Sürüyor' }, 'Talep yeniden incelenecek.')}>Sorun Sürüyor</button></>}</div>)}</div>
    {bt && <><div className="bolum">Açık Destek Talepleri</div>
      <div className="ozet">{bt.length === 0 && <div className="not">Kayıt bulunmamaktadır.</div>}{bt.map((x) => <div key={x.kimlik}><div>{x.talep_no} · {x.seviye} · {x.durum}{x.dosya_no ? ` · ${x.dosya_no}` : ''} · {x.belirti} · Yanıt: {zaman(x.yanit_son)} · Çözüm: {zaman(x.cozum_son)}</div>
        {x.durum !== 'Çözüldü' && <>{(['yapilan', 'degisen', 'dogrulama', 'sonuc'] as const).map((k) => <span key={k}><label htmlFor={`dc-${k}-${x.kimlik}`}>{{ yapilan: 'Yapılan İşlem', degisen: 'Değişen Kayıt veya Sürüm', dogrulama: 'Doğrulama Yöntemi', sonuc: 'Kullanıcıya Bildirilen Sonuç' }[k]}</label><input id={`dc-${k}-${x.kimlik}`} value={c(x.kimlik)[k]} onChange={(e) => setCz({ ...cz, [x.kimlik]: { ...c(x.kimlik), [k]: e.target.value } })} /></span>)}
          <button className="btn2 kucuk" onClick={() => is(`/destek/${x.kimlik}/cozum`, c(x.kimlik), 'Çözüm kaydedildi; kullanıcı doğrulaması bekleniyor.')}>Çözümü Kaydet</button></>}</div>)}</div></>}</>;
}
