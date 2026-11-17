/** YG-760 (KS-10, CEO 17.11.2026): portal giriş ekranında hedef gösterilmez; yalnız kullanıcının kendi dosya ve iş durum sayıları. */
export function DurumSayilari({ ogeler }: { ogeler: [string, number][] }) {
  return <div className="sayilar" data-t="durum-sayilari">{ogeler.map(([ad, n]) => <div key={ad} className="sayi"><b>{n}</b><span>{ad}</span></div>)}</div>;
}
