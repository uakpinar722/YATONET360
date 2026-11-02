# Kod Varsayımları

Katalogda veya kararlarda cevabı olmayan konularda kodda alınan varsayımlar. Modül adımı sonunda CEO'ya toplu sunulur; onaylanan veya değiştirilen satır kataloğa işlenir.

| No | Adım | Konu | Varsayım | Yer | Durum |
|---|---|---|---|---|---|
| V-1 | 1 | Rol Kataloğunu görenler | Sistem Yöneticisi, Bilgi İşlem Müdürü, Bilgi Teknolojileri ve Firma Yönetimi Direktörü | `kurulum.ts` | Sunuldu, itiraz yok |
| V-2 | 1 | İşlem İzini görenler | İç Denetçi, İç Denetim Müdürü, Bilgi İşlem Müdürü; CEO görmez | `kurulum.ts` | Sunuldu, itiraz yok |
| V-3 | 1 | Erişim talebini kim açar | Tüm LGM personeli | `erisim.ts` | Sunulacak |
| V-4 | 1 | Bireysel yat sahibinde kurtarma | SMS kullandığı için hesap kurtarma gerekmez | `hesap_kurtarma.ts` | Sunulacak |
| V-5 | 1 | Hesap kurtarma kapsamı | Yalnız ikinci faktör sıfırlanır, parola değişmez; kullanıcı parolasını Parolamı Unuttum ile yeniler | `hesap_kurtarma.ts` | Sunulacak |
| V-6 | 1 | İç Denetim Müdürü erişim talebi | Risk ve Kalite Direktörü onaylar (idari bağlılık) | `erisim.ts` | Sunulacak |
| V-7 | 1 | Vekil uygunluğu | Aynı rol; aynı birim ve kademe; Müdür ve Müdür Yardımcısı birbirine; yoksa onay makamı rolü. CEO'ya GMY veya T&O Direktörü (YG-1058). Direktör vekilleri Cilt II listesi bağlanınca daralır | `vekalet.ts` | Sunulacak |
| V-8 | 1 | Vekâlet kapsamı | Vekil, asıl rolün kartlarını ve izinlerini alır; asıl da görmeye devam eder. Parasal limit kontrolü Adım 5'te | `yetki.ts` | Sunulacak |
| V-9 | 1 | Kayıtlı cihaz | Doğrulama kurulumundaki cihaz kaydolur; yeni cihaz için kod doğru olsa da oturum açılmaz, rolün onay makamına kart düşer | `cihaz.ts` | Sunulacak |
| V-10 | 1 | Çakışan rol listesi | Şimdilik yalnız Teknik Uzman × Kalite Uzmanı (YG-1037); uyarı verir, engellemez. Rol birleştirme tablosu kadro planıyla genişler | `kurulum.ts` | Sunulacak |
| V-11 | 1 | Kendi kaydı | Makamda hazırlayandan başka kimse yoksa kayıt açılışta üst makama düşer | `makam.ts` | Sunulacak |
| V-12 | 3 | Sabah özeti ve toplu gönderim | CEO kararı BLD-1a: YG-521 ve YG-527 geçerli, YG-522 pasif | `bildirim.ts` | Karara bağlandı |
| V-13 | 3 | Müdür Yardımcısı duyurusu | Dış kapsamlı duyuruyu hazırlayıp onaya gönderebilir; LGM içi duyuruyu yayımlayamaz | `iletisim.ts` | Sunulacak |
| V-14 | 3 | Dış kanal sağlayıcıları | E-posta, SMS, WhatsApp hesapları açılana kadar deneme kutusuna yazılır; gerçek kişiye gitmez | `bildirim.ts` | Sunulacak |
| V-15 | 3 | Resmî tatil | Mesai hesabı şimdilik Pzt–Cum 09–18, Cmt 09–15; resmî tatil takvimi eklenince daralır | `bildirim.ts` | Sunulacak |
| V-16 | 3 | Virüs taraması | Gerçek antivirüs bağlanana kadar deneme tarayıcısı yalnız EICAR sınama imzasını yakalar; kayıtta kaynağı Deneme yazar. Üretim ayarıyla sunucu tarayıcı olmadan açılmaz | `depo.ts`, `belge.ts` | Sunulacak |
| V-17 | 3 | Belge bağı | Şimdilik Görev ve Onay kayıtlarına bağlanır; Yat, Taraf, Dosya, İş Emri, Ödeme kendi modülleriyle eklenir. Belge ekranı Adım 4 Dosya Ayrıntısıyla gelir | `belge.ts` | Sunulacak |
| V-18 | 3 | Kritik belge | Yalnız yükleyen görür, bağlantıyla paylaşılamaz; isim bazlı erişim listesi sonra eklenir | `belge.ts` | Sunulacak |
| V-19 | 3 | Belge onay makamı | Belgeyi yükleyenin ilk aktif rolünün onay makamı. Türe göre özel onay silsileleri (Teknik Rapor vb.) ilgili modülde | `belge.ts` | Sunulacak |
| V-20 | 3 | Paylaşım kodu metni | "Belge erişim kodunuz [kod]. Kodu kimseyle paylaşmayınız; LİMİT GLOBAL MARINE kodunuzu hiçbir zaman sormaz." ONY-20'den türetildi, katalogda yok. Bağlantıyı personel iletir; kod alıcının e-postasına gider, 5 hatalı denemede bağlantı kapanır | `belge.ts` | Sunulacak |
| V-21 | 3 | PDF yazı tipi | Cambria ve Calibri (YG-669) kuruluysa kullanılır; Linux sunucuda ölçüleri aynı olan açık lisanslı Caladea ve Carlito devreye girer | `pdf.ts` | Sunulacak |
| V-22 | 3 | PDF alt bilgisi | Yalnız resmî unvan. Web, telefon ve sicil NUM-1 gereği yazılmaz; şirket bilgileri (ŞB) kesinleşince parametreden gelir. Logo olarak onaylı taslaktaki gibi YATONET 360 | `pdf.ts` | Sunulacak |
| V-23 | 3 | PDF üretim aracı | Üretim sunucusuna Chromium kurulur; geliştirmede Edge kullanılır | `pdf.ts` | Sunulacak |
| V-24 | 3 | Toplantı başkanı | Katalogda başkan rolü varsa o rolün katılımcısı (TPL-01…06); yoksa en üst kademedeki LGM katılımcısı. Eşitlikte düzenleyen, sonra alfabetik ilk kişi | `toplanti.ts` | Sunulacak |
| V-25 | 3 | TPL-02 temsilcileri | Kalite, ticari ve firma yönetimi temsilcilerini düzenleyen kişi olarak seçer; rolü belli olanlar otomatik eklenir | `0010` | Sunulacak |
| V-26 | 3 | Dosyaya bağlı toplantılar | TPL-01, 06, 07, 08, 09 Adım 4 Dosya modülüyle açılır; şimdilik planlanamaz | `toplanti.ts` | Sunulacak |
| V-27 | 3 | Görüntülü toplantı | YG-588 otomatik bağlantı, sağlayıcı seçilince bağlanır; şimdilik alan var, form göstermiyor | `toplanti.ts` | Sunulacak |
| V-28 | 3 | Gündem | Şimdilik yalnız Süresi Aşan Onay sayısı otomatik dolar; dosya, uygunsuzluk ve KPI kaynakları modülleriyle gelir | `toplanti.ts` | Sunulacak |
| V-29 | 3 | Periyodik takvim | Motor hazır, liste boş: YG-806 kalemlerinin sahibi ve tarihi ilgili modüllerle eklenir | `toplanti.ts` | Sunulacak |
| V-30 | 3 | Yalnız Bilgi katılımcısı | Davet alır, hatırlatma almaz | `toplanti.ts` | Sunulacak |
