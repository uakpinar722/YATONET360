import { useEffect, useState } from 'react';

/** YG-1653 (1): her sayfa için tek cümlelik "Bu sayfada…" açıklaması. */
export const SAYFA_ACIKLAMA: Record<string, string> = {
  ana: 'Bu sayfada onayınızı bekleyen işler, süre uyarıları, görevleriniz ve günün özetleri yer alır.',
  dosya: 'Bu sayfada yetkili olduğunuz dosyaları arar, açar ve dosya işlemlerini yürütürsünüz.',
  nobet: 'Bu sayfada nöbet çizelgesi, acil ihbarlar ve nöbet devirleri yönetilir.',
  sicil: 'Bu sayfada Çözüm Ortağı ve aday firma sicil kayıtları incelenir ve güncellenir.',
  roller: 'Bu sayfada sistemdeki rollerin birimi, kademesi ve ayrıcalık durumu listelenir.',
  iz: 'Bu sayfada sistemde yapılan işlemlerin değiştirilemez kayıtları aranır; görüntüleme de kayda geçer.',
  erisimrol: 'Bu sayfada onaylı erişim taleplerinin uygulanması ve rol atamaları yürütülür.',
  kurtarma: 'Bu sayfada hesap kurtarma talepleri kimlik teyidiyle sonuçlandırılır.',
  erisim: 'Bu sayfada yeni bir rol veya yetki için erişim talebi açarsınız.',
  vekalet: 'Bu sayfada izin ve yokluklarınız için vekil tanımlarsınız; vekil süre içinde işlerinizi görür.',
  duyuru: 'Bu sayfada LGM içi veya dış kapsamlı duyuru hazırlanır ve yayımlanır.',
  toplanti: 'Bu sayfada toplantılar planlanır, gündem ve kararlar kayda geçer.',
  idari: 'Bu sayfada idari talepler, raporlar, göstergeler ve yönetim ekranları yer alır.',
  kvkk: 'Bu sayfada kişisel veri başvuruları, saklama ve ihlal kayıtları yönetilir.',
  bildirim: 'Bu sayfada size gelen bildirimler listelenir; okunanlar işaretlenir.',
  profil: 'Bu sayfada iletişim bilgileriniz, dil tercihiniz ve izinleriniz yer alır.',
  mesaj: 'Bu sayfada dosya taraflarıyla yazışmalar yürütülür.',
  yardim: 'Bu sayfada destek talebi açar, kılavuzlara ulaşır ve ilk kullanım turunu yeniden başlatırsınız.',
  ara: 'Bu sayfada dosya numarası, yat adı veya taraf adıyla arama sonuçları listelenir.',
};
const SAKLA = 'yatonet-yonlendirme-acik';
const oku = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(SAKLA) ?? '{}'); } catch { return {}; } };

/** Başlığın yanında sabit "?" simgesi; açıklama varsayılan kapalı, kullanıcının tercihi sayfa başına hatırlanır. */
export function SayfaAciklama({ sayfa }: { sayfa: string }) {
  const [acik, setAcik] = useState(() => Boolean(oku()[sayfa]));
  const metin = SAYFA_ACIKLAMA[sayfa]; if (!metin) return null;
  const degistir = () => { const y = !acik; setAcik(y); try { localStorage.setItem(SAKLA, JSON.stringify({ ...oku(), [sayfa]: y })); } catch { /* tarayıcı depolaması kapalı */ } };
  return <div className="sayfa-aciklama"><button type="button" className="soru-isareti" aria-expanded={acik} aria-label="Bu sayfa hakkında" onClick={degistir}>?</button>{acik && <span className="not">{metin}</span>}</div>;
}

/** YG-1653 (2): ilk girişte 5 adımlık tur; "Atla" serbest; Yardım sayfasından yeniden başlatılır. */
const TUR = [
  { b: 'Onayınızı Bekleyenler', m: 'Sizden karar bekleyen işler ana sayfanın en üstündedir; kartı açıp onaylar, iade eder veya reddedersiniz.' },
  { b: 'Süre Uyarıları', m: 'Süreli işlerinizin kalan süresi burada görünür; son iki saatte sayaç uyarı verir.' },
  { b: 'Sekmeler', m: 'Sol menüdeki sekmeler rolünüze göre açılır; yalnız yetkili olduğunuz ekranları görürsünüz.' },
  { b: '"?" Simgesi', m: 'Her sayfa başlığının yanındaki "?" simgesi o sayfanın ne işe yaradığını tek cümleyle açıklar.' },
  { b: 'Yardım ve Vekâlet', m: 'Sağ üstteki Yardım düğmesiyle destek alırsınız; izne çıkarken Vekâlet sayfasından vekil tanımlarsınız.' },
];
const TUR_ANAHTAR = 'yatonet-ilk-tur-bitti';
export const turYenidenBaslat = () => { try { localStorage.removeItem(TUR_ANAHTAR); } catch { /* yok */ } window.dispatchEvent(new Event('ilk-tur')); };
export function IlkKullanimTuru() {
  const bitti = () => { try { return localStorage.getItem(TUR_ANAHTAR) === '1'; } catch { return true; } };
  const [adim, setAdim] = useState<number | null>(() => (bitti() ? null : 0));
  useEffect(() => { const f = () => setAdim(0); window.addEventListener('ilk-tur', f); return () => window.removeEventListener('ilk-tur', f); }, []);
  if (adim === null) return null;
  const kapat = () => { try { localStorage.setItem(TUR_ANAHTAR, '1'); } catch { /* yok */ } setAdim(null); };
  const a = TUR[adim]!;
  return <div className="ilk-tur" role="dialog" aria-label="İlk kullanım turu"><b>{a.b}</b><p>{a.m}</p><div className="dugmeler">
    <button className="btn2 kucuk" onClick={kapat}>Atla</button>
    {adim < TUR.length - 1 ? <button className="btn kucuk" onClick={() => setAdim(adim + 1)}>İleri ({adim + 1}/{TUR.length})</button> : <button className="btn kucuk" onClick={kapat}>Bitir</button>}</div></div>;
}

/** YG-1653 (3): işlem düğmesine basınca ne olacağını anlatan tek satır; fiilden türetilir (web'de üzerine gelince, telefonda düğme altında). */
const OZEL: Record<string, string> = {
  'Onaya Gönder': 'Kayıt onay zincirindeki makama gider; karar verilene kadar değiştirilemez.',
  'Kontrole Gönder': 'Kayıt kontrol eden role gider; sonuçlanana kadar değiştirilemez.',
  'Gerekçeyle İade Et': 'Kayıt gerekçeyle hazırlayana geri döner.',
  'İptal Et': 'Kayıt iptal edilir; iptal geri alınamaz.',
  'Geri Çek': 'Gönderdiğiniz kayıt karar verilmeden geri alınır.',
  Vazgeç: 'Değişiklikler kaydedilmeden kapanır.',
  Atla: 'Turu kapatır; Yardım sayfasından yeniden başlatabilirsiniz.',
  Kapat: 'Pencere kapanır; kayıt değişmez.',
};
const FIIL: [RegExp, string][] = [
  [/Kaydet$/, 'Girilen bilgiler kayda geçer.'],
  [/Gönder$/, 'Kayıt ilgili kişiye veya makama iletilir ve iz kaydına geçer.'],
  [/Onayla$/, 'Onayınız kayda geçer; kayıt bir sonraki adıma ilerler.'],
  [/Reddet$/, 'Kayıt reddedilir; gerekçe kayda geçer.'],
  [/İade Et$/, 'Kayıt hazırlayana geri döner.'],
  [/(Aç|Oluştur)$/, 'Yeni kayıt açılır.'],
  [/Ekle$/, 'Listeye yeni kalem eklenir.'],
  [/(Kaldır|Çıkar)$/, 'Kalem listeden kaldırılır; işlem iz kaydına geçer.'],
  [/Kapat$/, 'Kayıt kapanır; kapanış bilgileri kayda geçer.'],
  [/Bildir$/, 'Bildirim ilgili role iletilir.'],
  [/İste$/, 'Talep ilgili kişiye iletilir; yanıt beklenir.'],
  [/Öner$/, 'Öneri karar verecek role iletilir.'],
  [/Doğrula$/, 'Bilgi doğrulanır; sonuç kayda geçer.'],
  [/Başlat$/, 'İşlem başlatılır.'],
  [/Durdur$/, 'İşlem durdurulur; gerekçe kayda geçer.'],
  [/(Güncelle|Değiştir|Düzenle|Düzelt)$/, 'Kayıt güncellenir; önceki değer iz kaydında kalır.'],
  [/(Göster|Ara|İncele)$/, 'Sonuçlar ekranda gösterilir; kayıt değişmez.'],
  [/Yükle$/, 'Seçilen dosya kayda eklenir.'],
  [/(Bağla|Seç)$/, 'Seçilen kayıt bu kayda bağlanır.'],
  [/(Planla)$/, 'Planlanan tarih kayda geçer ve ilgililere bildirilir.'],
  [/(Ver|Al|Gir|Yap|İşle|Uygula|İşaretle|Tanımla)$/, 'İşlem kayda geçer.'],
  [/^←|Dön$/, 'Önceki ekrana döner.'],
];
export const dugmeAciklamasi = (ad: string): string | null => OZEL[ad] ?? FIIL.find(([r]) => r.test(ad))?.[1] ?? null;
export function DugmeAciklamalari() {
  useEffect(() => {
    const isle = (dugmeler: Iterable<HTMLButtonElement>) => {
      for (const b of dugmeler) {
        const ad = (b.textContent ?? '').trim();
        if (!ad || b.dataset.aciklamaAd === ad || b.classList.contains('soru-isareti')) continue;
        b.dataset.aciklamaAd = ad; const a = dugmeAciklamasi(ad);
        if (!a) { if (b.dataset.aciklama) { b.removeAttribute('aria-label'); b.removeAttribute('aria-description'); if (b.dataset.aciklamaOto) { b.removeAttribute('title'); delete b.dataset.aciklamaOto; } } delete b.dataset.aciklama; continue; }
        b.dataset.aciklama = a; b.setAttribute('aria-label', ad); b.setAttribute('aria-description', a);
        if (!b.title || b.dataset.aciklamaOto) { b.title = a; b.dataset.aciklamaOto = '1'; }
      }
    };
    // Gözlemci değişiklikleri toplu verir; yalnız değişen bölgedeki düğmeler işlenir, ad görünen metinle aynı anda güncellenir.
    const g = new MutationObserver((kayitlar) => {
      const s = new Set<HTMLButtonElement>();
      for (const k of kayitlar) {
        const h = k.target instanceof Element ? k.target : k.target.parentElement; const d = h?.closest('button'); if (d) s.add(d);
        for (const n of Array.from(k.addedNodes)) if (n instanceof Element) { if (n instanceof HTMLButtonElement) s.add(n); n.querySelectorAll('button').forEach((x) => s.add(x)); }
      }
      if (s.size) isle(s);
    });
    isle(Array.from(document.querySelectorAll('button'))); g.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => g.disconnect();
  }, []);
  return null;
}
