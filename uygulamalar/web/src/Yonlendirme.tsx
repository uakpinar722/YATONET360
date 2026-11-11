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
