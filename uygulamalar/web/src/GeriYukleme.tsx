import { useEffect, useState } from 'react';
import { tarihSaat } from './bicim';
import { istek } from './api';

/** YG-564, YG-015: gerçek geri yükleme kaydı; duyuru ve yeniden giriş görevleri sistemden çıkar. */
export function GeriYukleme() {
  const [l, setL] = useState<{ kimlik: string; tur: string; baslangic: string; durum: string }[] | null>(null); const [f, setF] = useState({ yedek: '', aciklama: '' }); const [m, setM] = useState('');
  useEffect(() => { void istek<{ yedekler: NonNullable<typeof l> }>('/yedekler').then((r) => setL(r.yedekler.filter((x) => x.durum === 'Başarılı'))).catch(() => setL(null)); }, []);
  if (!l) return null;
  return <details><summary>Gerçek Geri Yükleme Kaydı</summary>{m && <div className="not" role="status">{m}</div>}
    <label htmlFor="gy-y">Geri Yüklenen Yedek</label><select required id="gy-y" value={f.yedek} onChange={(e) => setF({ ...f, yedek: e.target.value })}><option value="">Seçiniz</option>{l.slice(0, 30).map((x) => <option key={x.kimlik} value={x.kimlik}>{tarihSaat(x.baslangic)} · {x.tur}</option>)}</select>
    <label htmlFor="gy-a">Olay Açıklaması</label><input required id="gy-a" value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.yedek || !f.aciklama.trim()} onClick={() => void istek<{ gorev: number }>('/geri-yukleme/kayit', f).then((r) => setM(`Duyuru yayımlandı; ${r.gorev} yeniden giriş görevi açıldı.`)).catch((e) => setM(e.message))}>Kaydet ve Duyur</button></details>;
}

/** YG-1277: yedek indirme, silme, saklama süresi ve geri yükleme ayrıcalıklı onayla yapılır. */
export function YedekIslemTalebi() {
  const [l, setL] = useState<{ kimlik: string; tur: string; baslangic: string }[] | null>(null);
  const [t, setT] = useState<{ kimlik: string; islem: string; gerekce: string; yeni_saklama_gun: number | null; durum: string; olusturma_zamani: string; tur: string; baslangic: string }[]>([]);
  const [f, setF] = useState({ yedek: '', islem: 'İndirme', gerekce: '', gun: '' }); const [m, setM] = useState('');
  const yukle = () => { void istek<{ yedekler: NonNullable<typeof l> }>('/yedekler').then((r) => setL(r.yedekler)).catch(() => setL(null)); void istek<{ talepler: typeof t }>('/yedek/islem-talepleri').then((r) => setT(r.talepler)).catch(() => setT([])); };
  useEffect(yukle, []);
  if (!l) return null;
  const sure = f.islem === 'Saklama Süresi Değişikliği';
  return <details><summary>Yedek İşlemi Talebi</summary>{m && <div className="not" role="status">{m}</div>}
    <p className="not">İndirme, silme, saklama süresi değişikliği ve geri yükleme Bilgi İşlem Müdürü ve BT ve Firma Yönetimi Direktörü onayından sonra yapılır.</p>
    <label htmlFor="yi-y">Yedek</label><select required id="yi-y" value={f.yedek} onChange={(e) => setF({ ...f, yedek: e.target.value })}><option value="">Seçiniz</option>{l.slice(0, 30).map((x) => <option key={x.kimlik} value={x.kimlik}>{tarihSaat(x.baslangic)} · {x.tur}</option>)}</select>
    <label htmlFor="yi-i">İşlem</label><select id="yi-i" value={f.islem} onChange={(e) => setF({ ...f, islem: e.target.value })}>{['İndirme', 'Silme', 'Saklama Süresi Değişikliği', 'Geri Yükleme'].map((x) => <option key={x}>{x}</option>)}</select>
    {sure && <><label htmlFor="yi-s">Yeni Saklama Süresi (gün)</label><input required id="yi-s" type="number" min={1} value={f.gun} onChange={(e) => setF({ ...f, gun: e.target.value })} /></>}
    <label htmlFor="yi-g">Gerekçe</label><input required id="yi-g" value={f.gerekce} onChange={(e) => setF({ ...f, gerekce: e.target.value })} />
    <button className="btn2 kucuk" disabled={!f.yedek || !f.gerekce.trim() || (sure && !f.gun)} onClick={() => void istek(`/yedek/${f.yedek}/islem-talebi`, { islem: f.islem, gerekce: f.gerekce, gun: sure ? Number(f.gun) : undefined }).then(() => { setM('Talep onaya gönderildi.'); setF({ ...f, gerekce: '', gun: '' }); yukle(); }).catch((e) => setM(e.message))}>Onaya Gönder</button>
    {t.length > 0 && <table className="tablo"><thead><tr><th>Yedek</th><th>İşlem</th><th>Gerekçe</th><th>Durum</th></tr></thead><tbody>{t.map((x) => <tr key={x.kimlik}><td>{tarihSaat(x.baslangic)} · {x.tur}</td><td>{x.islem}{x.yeni_saklama_gun ? ` (${x.yeni_saklama_gun} gün)` : ''}</td><td>{x.gerekce}</td><td>{x.durum}</td></tr>)}</tbody></table>}
  </details>;
}
