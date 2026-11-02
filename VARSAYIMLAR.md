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
| V-12 | 3 | Sabah özeti ve toplu gönderim | YG-521 (mesai dışı 09:00 toplu) uygulandı; mesai içinde e-posta hemen gider (YG-527). YG-522'nin 08.30 tek özeti henüz yok, Bugün sayfası bu işi görüyor. İki madde çakışıyor, sunulacak | `bildirim.ts` | Sunulacak |
| V-13 | 3 | Müdür Yardımcısı duyurusu | Dış kapsamlı duyuruyu hazırlayıp onaya gönderebilir; LGM içi duyuruyu yayımlayamaz | `iletisim.ts` | Sunulacak |
| V-14 | 3 | Dış kanal sağlayıcıları | E-posta, SMS, WhatsApp hesapları açılana kadar deneme kutusuna yazılır; gerçek kişiye gitmez | `bildirim.ts` | Sunulacak |
| V-15 | 3 | Resmî tatil | Mesai hesabı şimdilik Pzt–Cum 09–18, Cmt 09–15; resmî tatil takvimi eklenince daralır | `bildirim.ts` | Sunulacak |
