import { useEffect, useState } from 'react';
import { istek } from './api';
import { tarih, tarihSaat } from './bicim';

interface V {
  onKosul: string[]; ds: boolean; aktarimlar: string[]; oneri: string | null;
  katilimcilar: { kullanici: string; ad: string; rol: string; gorsel: boolean }[];
  kontrolListesi: { madde: string; uyari: boolean; aciklama: string }[];
  toplanti: { kimlik: string; baslangic: string; sureDk: number; durum: string; baglanti: string | null; tutanak: string | null } | null;
  kararlar: { kimlik: string; metin: string; aktarim_hedefi: string | null; hedef: string; sorumlu: string; gorev_durumu: string | null }[];
}
const yerel = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

/** YG-1598: Kapsam Hazırlık Toplantısı (TPL-06): ön koşullar, ortak boşluk önerisi, sistemce doldurulan kontrol listesi, aktarım hedefli kararlar ve kapanış. */
export function KapsamToplantisi({ id }: { id: string }) {
  const [v, setV] = useState<V | null>(null); const [m, setM] = useState(''); const [h, setH] = useState('');
  const [p, setP] = useState({ baslangic: '', baglanti: '' }); const [k, setK] = useState({ metin: '', aktarim: 'Teknik Rapor', hedef: '' }); const [tt, setTt] = useState('');
  const yukle = () => istek<V>(`/dosya/${id}/kapsam-toplantisi`).then((r) => { setV(r); if (r.oneri) setP((x) => (x.baslangic ? x : { ...x, baslangic: yerel(r.oneri!) })); }).catch(() => setV(null));
  useEffect(() => { void yukle(); }, [id]);
  if (!v) return null;
  const yap = (f: () => Promise<unknown>, t: string) => { setH(''); setM(''); void f().then(() => { setM(t); return yukle(); }).catch((e) => setH((e as Error).message)); };
  const t = v.toplanti; const gorsel = v.katilimcilar.some((x) => x.gorsel);
  return <>
    <div className="bolum">Kapsam Hazırlık Toplantısı (TPL-06)</div>
    <div className="ozet">
      {h && <div className="hata" role="alert">{h}</div>}{m && <div className="not" role="status">{m}</div>}
      <div>Katılımcılar: {v.katilimcilar.map((x) => `${x.ad} (${x.rol}${x.gorsel ? ', görüntülü' : ''})`).join(', ') || '---'}</div>
      {!t && <>
        {v.onKosul.length > 0 ? <div className="not">Toplantı ön koşulları: {v.onKosul.join(' ')}</div> : <div>Önerilen zaman (ilk ortak boşluk): {v.oneri ? tarihSaat(v.oneri) : 'Önümüzdeki 10 günde ortak boşluk bulunamadı; zaman seçiniz.'}</div>}
        {v.ds && v.onKosul.length === 0 && <>
          <label htmlFor="kt-b">Toplantı Zamanı</label><input id="kt-b" type="datetime-local" value={p.baslangic} onChange={(e) => setP({ ...p, baslangic: e.target.value })} />
          <label htmlFor="kt-l">Görüntülü Görüşme Bağlantısı{gorsel ? ' (Saha Sorumlusu görüntülü katılır)' : ''}</label><input id="kt-l" value={p.baglanti} onChange={(e) => setP({ ...p, baglanti: e.target.value })} />
          <button className="btn2" disabled={!p.baslangic || (gorsel && !p.baglanti.trim())} onClick={() => yap(() => istek(`/dosya/${id}/kapsam-toplantisi`, { baslangic: new Date(p.baslangic).toISOString(), baglanti: p.baglanti || undefined }), 'Toplantı planlandı; davetler gönderildi.')}>Toplantıyı Onayla</button>
        </>}
      </>}
      {t && <div>{tarihSaat(t.baslangic)} · {t.sureDk} dk · {t.durum}{t.baglanti ? <> · <a href={t.baglanti} target="_blank" rel="noreferrer">Görüntülü Görüşme</a></> : ''}</div>}
      <div className="bolum">Kontrol Listesi</div>
      <div className="not">Toplantıda yalnız ⚠ işaretli maddeler görüşülür.</div>
      {v.kontrolListesi.map((x) => <div key={x.madde} className={x.uyari ? 'uyari' : undefined}>{x.uyari ? '⚠' : '✓'} {x.madde}: {x.aciklama}</div>)}
      {t && <>
        <div className="bolum">Kararlar</div>
        {v.kararlar.length === 0 && <div className="bos">Karar girilmedi.</div>}
        {v.kararlar.map((x) => <div key={x.kimlik}>{x.aktarim_hedefi ?? 'Karar'} · {x.metin} · {x.sorumlu} · {tarih(x.hedef)}{x.gorev_durumu ? ` · Görev: ${x.gorev_durumu}` : ''}</div>)}
        {v.ds && t.durum === 'Planlandı' && <>
          <label htmlFor="kt-a">Aktarım Hedefi</label><select id="kt-a" value={k.aktarim} onChange={(e) => setK({ ...k, aktarim: e.target.value })}>{v.aktarimlar.map((x) => <option key={x}>{x}</option>)}</select>
          <label htmlFor="kt-m">Karar</label><textarea id="kt-m" value={k.metin} onChange={(e) => setK({ ...k, metin: e.target.value })} />
          <label htmlFor="kt-h">Hedef Tarih</label><input id="kt-h" type="date" value={k.hedef} onChange={(e) => setK({ ...k, hedef: e.target.value })} />
          <button className="btn2 kucuk" disabled={!k.metin.trim() || !k.hedef} onClick={() => yap(() => istek(`/kapsam-toplantisi/${t.kimlik}/karar`, k).then(() => setK({ ...k, metin: '' })), 'Karar eklendi.')}>Kararı Ekle</button>
          <label htmlFor="kt-t">Tutanak</label><textarea id="kt-t" value={tt} onChange={(e) => setTt(e.target.value)} />
          <button className="btn2" disabled={!tt.trim() || new Date(t.baslangic).getTime() > Date.now()} onClick={() => yap(() => istek(`/toplanti/${t.kimlik}/tutanak`, { tutanak: tt }).then(() => istek(`/toplanti/${t.kimlik}/kapat`, {})), 'Toplantı kapandı; kararlar görev olarak aktarıldı.')}>Tutanağı Kaydet ve Toplantıyı Kapat</button>
        </>}
      </>}
    </div>
  </>;
}
