# YATONET 360 API Dokümanı

Kaynak koddan üretilmiştir (`npm run api-dokumani`); 201 modül, 1364 uç nokta. Elle düzeltilmez; kod değişince yeniden üretilir.

## Genel Kurallar

- Tüm uç noktalar `/api` önekiyle sunulur; istek ve yanıt gövdesi JSON'dur (belge yükleme `application/octet-stream`).
- Oturum çerezle taşınır; durum değiştiren isteklerde `X-Yatonet: 1` üst bilgisi zorunludur.
- Hata yanıtı `{ "hata": "<tek cümle açıklama>" }` biçimindedir; takılan adımda `islem` (düğme adı) ve `hedef` (ekran alanı) eklenebilir.
- Durum kodları: 400 eksik veya geçersiz bilgi, 401 oturum yok, 403 yetki yok, 404 kayıt yok veya erişim yok, 409 iş kuralı engeli, 428 ilk giriş adımları eksik.
- Erişim sütunu: "Oturum" tam oturum ister; "Oturum + izin" ayrıca belirtilen izni ister; rol ve dosya erişimi uç nokta içinde ayrıca denetlenir.

## Modüller

### acil

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/nobet/adaylar` | Oturum + izin: nobet.hazirla | — |
| GET | `/api/nobet/teknik-adaylar` | Oturum | — |
| POST | `/api/nobet/teknik-taraf` | Oturum | — |
| GET | `/api/nobet/teknik-taraf` | Oturum | — |
| GET | `/api/is/:id/nobet-cizelgesi` | Oturum | YG-1584: nöbet çizelgesi onay ekranı; vardiyalar ve kontroller (her gün her katmanda kapsama, aynı kişide çakışan vardiya, onaylı izindeki kişiye vardiya). |
| POST | `/api/nobet/cizelge` | Oturum + izin: nobet.hazirla | — |
| GET | `/api/nobet/simdi` | Oturum | — |
| GET | `/api/nobet/takvim` | Oturum | YG-244: günlük nöbet takvimi; yürürlükteki çizelgenin vardiyaları İstanbul gününe göre (bir vardiya birden çok güne yayılabilir). |
| POST | `/api/nobet/devir` | Oturum | YG-246, YG-247: dijital devir; kontrol listesi tamamlanmadan olmaz; devralan onaylar. |
| GET | `/api/nobet/devir` | Oturum | YG-247: devir ekranı için kontrol listesi, devredilebilecek kişiler ve onay bekleyen devirler. |
| POST | `/api/nobet/devir/:id/onayla` | Oturum | — |
| POST | `/api/acil/cagri` | Oturum + izin: ihbar.kaydet | YG-263, YG-253, YG-255: Acil Çağrı; kısa kayıt, dosya geçici açılır, tedbir beklemeden başlar, bildirim anında ve silsilesiz gider. |
| GET | `/api/firma-portal/acil-cagrilar` | Oturum | YG-267: çağrı fiyatsız; konum, yat tipi, olay türü, tehlike ve erişim. |
| POST | `/api/firma-portal/acil-cagri/:id/yanit` | Oturum | YG-268, YG-269, YG-1473: Kabul ediyorum, yola çıkıyorum / Müsait değilim. Kabulle AC iş emri kendiliğinden açılır; tutar ön değeri girilir. |
| POST | `/api/firma-portal/is-emri/:id/acil-tutar` | Oturum | — |
| POST | `/api/acil/:dosya/elle-kabul` | Oturum | YG-1456, YG-270: firmayla başka kanaldan temas: elle kayıt, AC iş emri, sıralı arama durur. |
| POST | `/api/acil/:dosya/kapat` | Oturum | YG-254, YG-274, YG-1595: kapanış sonuç, risk ve devam kararıyla; sigortalıda ilk bilgi tutarsız. BLD-55 tutar içermez. |
| GET | `/api/isg/sahadaki-isler` | Oturum | — |
| POST | `/api/dosya/:id/is-durdur` | Oturum | — |
| POST | `/api/dosya/:id/is-baslat` | Oturum + izin: dosya.ata.teknik | — |
| POST | `/api/portal/acil` | Oturum | YG-1656, YG-1657: yat sahibi Acil Durum: tür seçimi; Diğer açıklama ister; önce 112 uyarısı. Nöbetçi Dosya Sorumlusuna düşer. |

### acil_degerlendirme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/acil-degerlendirme` | Oturum | — |
| POST | `/api/dosya/:id/acil-degerlendirme` | Oturum | YG-1483: Teknik Uzman değerlendirmeyi kaydeder; uzaktan yöntemde firma ön keşfi, yönlendirmeli fotoğraf ve görüntülü görüşme zamanı zorunludur ve yerinde keşif Yüksek süreyle görev olur. |

### acil_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/nobet/cagri` | Oturum | YG-243: gelen çağrıyı nöbetçi kaydeder; santral bağlantısı olmadığından çağrı elle girilir. |
| GET | `/api/nobet/yukselen-cagrilarim` | Oturum | YG-1582, YG-1586, YG-1587: üst katmana yükselen ve dönülmemiş çağrılar, o katmanın rolündeki kullanıcıya kart olarak görünür. |
| GET | `/api/nobet/cagrilar` | Oturum | — |
| POST | `/api/nobet/cagri/:id/donus` | Oturum | — |
| GET | `/api/olay/yoneticisi-oldugum` | Oturum | YG-1584: açık olaylarda olay yöneticisi rolündeki kullanıcıya "Olay Yöneticisi: Siz" kartı ve bilgilendirilecek makamlar. |
| POST | `/api/olay/:id/devral` | Oturum | — |
| POST | `/api/olay/:id/sureklilik` | Oturum | — |
| POST | `/api/olay-komutasi` | Oturum | YG-261: olay türüne göre ilk müdahale eden, olay yöneticisi ve bilgilendirilecekler. |
| GET | `/api/olay/:id/kurtarma` | Oturum | YG-1282: kurtarma adımları sırayla işlenir; önceki hizmet açılmadan sonraki açılmaz, başarısız adımda geri dönüş kaydedilir. Adımı Teknik Kurtarma Lideri (Bilgi İşlem Müdürü) veya Sistem Yöneticisi girer. |
| POST | `/api/olay/:id/kurtarma-adimi` | Oturum | — |
| POST | `/api/olaganustu/oneri` | Oturum | YG-1489, D-028: Operasyon Müdürü (gece yönetici nöbetçisi) önerir, GMY görüş, CEO ilan eder; ulaşılamazsa GMY. |
| POST | `/api/olaganustu/oneri/:id/gmy-ilan` | Oturum | — |
| POST | `/api/olaganustu/bitir` | Oturum | — |
| GET | `/api/olaganustu/sira` | Oturum | — |
| POST | `/api/acil/:dosya/temas` | Oturum | YG-1481, YG-277: 112, marina, Operasyon Müdürü ve resmî muhatap temas kayıtları; refakatli girişte BLD-56 ve görev. |
| GET | `/api/acil/:dosya/temas` | Oturum | — |
| GET | `/api/acil/resmi-bildirim-sureleri` | Oturum | YG-277, TZ-3 (CEO 26.11.2026): çevresel olayda resmî bildirim süreleri; değer girilmeden "süre parametresi bekleniyor" görünür. Değeri Hukuk ve Uyum Direktörü girer. |
| POST | `/api/acil/resmi-bildirim-suresi` | Oturum | — |
| POST | `/api/firma/:id/acil-bilgi` | Oturum | YG-273: arama sırası ve hizmet verme sicilde; müsaitlik ve beyan edilen yanıt süresi firma tarafından güncel tutulur. |
| POST | `/api/firma-portal/acil-musaitlik` | Oturum | — |
| POST | `/api/dosya/:id/kurtarma` | Oturum | YG-210, K-216: firma, yat sahibi ve koordinatör kodlu onayı; acilde iş beklemez, acil olmayanda başlamadan tamamlanır. |
| GET | `/api/dosya/:id/kurtarma` | Oturum | — |
| POST | `/api/kurtarma/:id/koordinator-onay` | Oturum | — |
| GET | `/api/firma-portal/kurtarma` | Oturum | — |
| POST | `/api/firma-portal/kurtarma/:id/onay` | Oturum | — |
| POST | `/api/kurtarma/:id/baslat` | Oturum | YG-276: liman izni, dalış planı ve enerji izolasyonu olmadan dalış başlamaz; acil olmayanda üçlü onay başlamadan tamamlanır. |
| POST | `/api/kurtarma/:id/saglayici-gorunur` | Oturum | YG-486 |
| POST | `/api/portal/acil/:talep/konum` | Oturum | YG-1658: konum 10 dakikada bir; izin yoksa yatın kayıtlı konumu; nöbetçi ve kullanıcı durdurabilir; firma varınca kendiliğinden durur. |
| POST | `/api/portal/acil/:talep/konum-durdur` | Oturum | — |
| GET | `/api/acil-konum` | Oturum | — |
| POST | `/api/acil-konum/:talep/durdur` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/varis` | Oturum | — |

### acil_fiyat

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma/:id/acil-birim-fiyat` | Oturumsuz | — |
| POST | `/api/firma/:id/acil-birim-fiyat` | Oturumsuz | YG-1473: ağa kabulde acil birim fiyatları (çıkış, ekip-saat, ekipman) girilir; ekip-saat kartela bandı dışındaysa gerekçe zorunludur. |
| GET | `/api/firma-portal/acil-on-deger` | Oturum | — |

### akademi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/akademi` | Oturum | YG-937, YG-938, YG-943: ders listesi kişinin rolüne göre; katılım personel beyanıyla, imza alınmaz. |
| POST | `/api/akademi/ders` | Oturum | — |
| POST | `/api/akademi/ders/:id/revize` | Oturum | YG-938: revizyonda etkilenen rollere "ne değişti" bildirimi; okudum beyanı yeni sürüm için yeniden istenir. |
| POST | `/api/akademi/ders/:id/beyan` | Oturum | — |
| GET | `/api/deneme/bekleyen` | Oturum | — |
| POST | `/api/deneme/:personel/hazirla` | Oturum | — |

### alacak

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/hukuk-karari` | Oturum | YG-820, YG-914: dava, icra, şüpheli alacak, alacak silme, ihtiyati haciz; öneri HUD, GMY görüş, CEO karar. |
| POST | `/api/dosya/:id/is-acma-onayi` | Oturum | — |
| GET | `/api/faiz-orani` | Oturum | YG-872: faiz oranını Muhasebe ve Finans Müdürü dayanağıyla girer; değer sistemde sabit yazılmaz. |
| POST | `/api/faiz-orani` | Oturum | — |
| POST | `/api/fatura/:id/itiraz` | Oturum | YG-887: itiraz kalem, gerekçe ve belgeyle; sigortada faturadan 8 gün; 48 saat yanıt; itiraz edilmeyen kısım vadesinde ödenir. |
| POST | `/api/fatura-itirazi/:id/yanit` | Oturum | — |
| POST | `/api/firma/:id/haciz-ihbari` | Oturum | YG-915: haciz ihbarnamesiyle cari bloke; cevap süresi görevle izlenir. |
| POST | `/api/haciz-ihbari/:id/cevap` | Oturum | — |
| POST | `/api/taraf-tarama` | Oturum | YG-916: tarama sonucu; risk olayı işaretlenince Hukuk ve Uyum Direktörüne bildirim. |
| POST | `/api/taraf-risk-olayi` | Oturum | — |
| POST | `/api/dosya/:id/ucuncu-kisi-odeme` | Oturum | — |
| POST | `/api/dosya/:id/uyusmazlik` | Oturum | YG-107: uyuşmazlık alt kaydı ve dışa aktarım paketi (FR-KLT-012). |
| POST | `/api/uyusmazlik/:id/paket` | Oturum | — |
| GET | `/api/firma/:id/sozlesme` | Oturum | YG-923: sözleşme taslağı imzalı nüsha ve birlikte imzayla yürürlüğe girer; eski sözleşme silinmez. |
| POST | `/api/firma/:id/sozlesme` | Oturum | — |
| POST | `/api/sozlesme/:id/yururluk` | Oturum | — |

### alan

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/alan-erisim` | Oturumsuz | — |

### ana_veri

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ana-veri/mukerrer` | Oturum | — |
| POST | `/api/ana-veri/mukerrer` | Oturum | — |
| GET | `/api/baglama-noktalari` | Oturum | — |
| POST | `/api/baglama-noktasi/:id/tesis` | Oturum | ANV-1: yalnız sözleşmeli tesis kaydına bağlanır; bağlama noktası tek başına iş alan kayıt değildir. |

### ana_veri_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/baglama-noktasi/:id/teyit` | Oturum | YG-1266: teyit durumu, son teyit tarihi, enlem, boylam kullanıcıya doldurtulur; mükerrer grubu varsa karar önce verilir. |
| GET | `/api/dosya/:id/katalog-referansi` | Oturum | YG-1532: katalog fotoğrafı ve teknik bilgi yalnız LGM personeline iç referanstır; dosyayı gören LGM kullanıcısı görür. |
| POST | `/api/dosya/:id/katalog-bilgisi` | Oturum | YG-1533: Teknik Uzman keşif fotoğrafını ve ruhsat/plaka teknik bilgisini ana veri kaydına işler; durum kendiliğinden güncellenir, kaynak kaydedilir. |

### analiz

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/analiz` | Oturum | — |
| GET | `/api/veri-profili/:tablo` | Oturum | — |

### arayuz_metni

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/arayuz-metinleri` | Oturum | — |
| GET | `/api/arayuz-metni/yonetim` | Oturum | — |
| POST | `/api/arayuz-metni/oneri` | Oturum | — |
| POST | `/api/arayuz-metni/onay` | Oturum | — |

### arsiv_firma

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/arsivle` | Oturum | YG-1235, YG-1236: yalnız Kapalı dosya devredilir; olağan listeden çıkar, erişim dosya erişimiyle aynı kalır; dış paylaşım kapanır. |
| GET | `/api/firma/:id/aday-durum` | Oturumsuz | — |
| POST | `/api/firma/:id/aday-temas` | Oturumsuz | — |

### aydinlatma_acik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/acik/aydinlatma/:kod` | Oturumsuz | — |

### baglama_noktasi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/bulundugu-tesis` | Oturum | YG-331: yatın bulunduğu tesis; dosya konumundan öneri, Dosya Sorumlusu (dosyaya erişimi olan LGM personeli) seçer. |
| POST | `/api/dosya/:id/bulundugu-tesis` | Oturum | — |
| GET | `/api/firma-tesis/:id/bilgi` | Oturum | — |
| POST | `/api/firma-tesis/:id/bilgi` | Oturum | — |
| GET | `/api/dosya/:id/onerilen-tesisler` | Oturum | YG-115, YG-333: kapasitesi yatın tonaj ve boyunu karşılayan aktif tesisler en yakından sıralanır; dış firmaya yasak tesis önerilmez. |

### bekleme_muhafaza

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/bekleme-muhafaza` | Oturum | — |
| POST | `/api/dosya/:id/bekleme-muhafaza` | Oturum | Dosya Sorumlusu, onay beklenen teklif için tesisin günlük fiilî gider tutarını (tarifeden) girer; sayım teklifin iletildiği andan başlar. |

### belge

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/belge/yukle` | Oturum | YG-602, YG-1269, YG-1270: tür, boyut, içerik ve virüs denetimi; özgün dosya özetiyle saklanır. YG-592: aynı adla yükleme yeni sürüm açar. |
| GET | `/api/belge` | Oturum | YG-591, YG-593, YG-598: varsayılan görünüm güncel sürüm; geçmiş ve gerekçeler yalnız LGM personeline. |
| GET | `/api/belge/:id/surum/:no/indir` | Oturum | — |
| POST | `/api/belge/:id/surum/:no/onaya-gonder` | Oturum | YG-594, YG-597: Taslak → İncelemede; onay kart motorundan geçer. |
| GET | `/api/dogrula/:kod` | Oturumsuz | YG-691: M7 doğrulaması. Giriş istemez; yalnız kimlik bilgisi döner, içerik dönmez. |
| POST | `/api/belge/:id/surum/:no/paylas` | Oturum | YG-611: alıcısı, süresi (varsayılan 7, en çok 30 gün) ve izni belli bağlantı. Güvenliğiniz için Kritik belgeler bağlantıyla paylaşılmıyor. |
| POST | `/api/paylasim/:id/iptal` | Oturum | — |
| POST | `/api/paylasim/kod` | Oturumsuz | Bağlantı anonim açılmaz: kayıtlı alıcıya tek kullanımlık kod gider. |
| POST | `/api/paylasim/ac` | Oturumsuz | — |

### belge_kural

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/belge-kurallari` | Oturum | — |
| POST | `/api/belge-kurallari/tur` | Oturum | YG-605: tür kuralı BT ve Firma Yönetimi Direktörünce tanımlanır. |
| POST | `/api/dosya-siniri/oneri` | Oturum | YG-604: sınır değişikliğini Bilgi İşlem Müdürü önerir, BT ve Firma Yönetimi Direktörü onaylar. |

### belge_onceligi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/belge-onceligi` | Oturum | — |
| POST | `/api/dosya/:id/belge-celiskisi` | Oturum | Çelişki bildirimi: otomatik sonuç kurulmaz; Hukuk ve Uyum Direktörüne inceleme görevi açılır. |

### bolge_katsayisi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/bolge-katsayisi` | Oturum | — |
| POST | `/api/bolge-katsayisi/talep` | Oturum | — |

### broker

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/broker/ana` | Oturum | — |
| GET | `/api/broker/yetki-belgeleri` | Oturum | — |
| POST | `/api/broker/yetki/:id/yenile` | Oturum | Yenilenmiş belge yüklenir; Dosya Sorumlusu doğrular ve yeni yetki kaydını açar. |

### butce

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/butce/:yil` | Oturum | — |
| POST | `/api/butce/:yil/talep` | Oturum | — |
| POST | `/api/butce/:yil/onay` | Oturum | — |

### calisma_belgesi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/personel/:id/calisma-belgesi.pdf` | Oturum | — |

### destek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/destek` | Oturum | YG-1409, YG-1504: her ekrandan açılır; dosyalı talep dosyanın Dosya Sorumlusuna, teknik veya dosyasız talep BT ve Firma Yönetimi Direktörlüğüne görev olur. |
| GET | `/api/destek` | Oturum | — |
| POST | `/api/destek/:id/mesaj` | Oturum | — |
| GET | `/api/destek/:id` | Oturum | — |
| POST | `/api/destek/:id/ekran-goruntusu` | Oturum | — |
| POST | `/api/destek/:id/gecici-cozum` | Oturum | — |
| POST | `/api/destek/:id/ust-kademe` | Oturum | YG-1412: çözüm kaydı dört unsurla; kullanıcı doğrulamadan kayıt kapanmaz, sessizlik memnuniyet sayılmaz. YG-1645: Destek Sorumlusu çözemediği talebi gerekçeyle Bilgi İşlem Müdür Yardımcısına gönderir (yoksa Bilgi İşlem Müdürüne). |
| POST | `/api/destek/:id/cozum` | Oturum | — |
| POST | `/api/destek/:id/dogrula` | Oturum | — |
| POST | `/api/destek/:id/kapat` | Oturum | Kullanıcıya ulaşılamazsa BT yönetimi gerekçeyle kapatır; kapanış memnuniyet olarak kaydedilmez. |

### disa_aktarim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/disa-aktarim` | Oturum | — |
| POST | `/api/disa-aktarim` | Oturum | — |
| GET | `/api/disa-aktarim/:id/indir` | Oturum | — |

### dosya

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/ihbar/:id/acilis` | Oturum | YG-030: açılış kararı olmadan sahaya görev açılmaz. Kabul doğrulanmış yetki ister; Koşullu Açılışta izinli ve yasak işler yazılır. |
| GET | `/api/dosya` | Oturum | — |
| POST | `/api/dosya-tarafi/:id/bitir` | Oturum | YG-092, YG-515: rolün bitmesi kimliği silmez; ilişki bitiş tarihi ve gerekçesiyle kapanır, bitmiş ilişkiye bildirim gitmez (aktif = false). |
| GET | `/api/dosya/:id` | Oturum | — |
| GET | `/api/dosya/:id/ekip-oneri` | Oturum | YG-047, YG-146, YG-1535: atama önerisi kapasiteye göre sıralanır; %100 kişi seçilemez. |
| POST | `/api/dosya/:id/ekip` | Oturum | YG-047: atama talimattır, kabul/ret adımı yoktur; önceki atama silinmez. Tekil rolde devir notu olmadan yeni sorumluya geçilmez. |
| POST | `/api/dosya/:id/yat-bilgisi` | Oturum | YG-1530: eksik bilgi tamamlanınca teknik atama kartı açılır. |
| POST | `/api/dosya/:id/asama` | Oturum | YG-061, YG-065, YG-067: aşama yalnız ileri ve kapı koşullarıyla değişir. Engel tek cümleyle gösterilir. |
| POST | `/api/dosya/:id/oncelik` | Oturum | YG-036: yükseltme serbest; Normal veya Planlı'ya düşürme gerekçeyle talep edilir, Operasyon Yöneticisi ve Teknik Yönetici birlikte onaylar. |
| POST | `/api/dosya/:id/ulasim-plani` | Oturum | YG-1486: yurt dışı dosyada Dosya Sorumlusu ulaşım planı tarihini girer; randevu sayacı bu tarihten kurulur. |
| POST | `/api/dosya/:id/risk-kontrol` | Oturum | YG-1595: Kritik yalnız acil evrede geçerlidir; risk kontrol altına alınınca kendiliğinden Yüksek olur, keşif Yüksek sürelerle yürür. |
| GET | `/api/dosya/:id/talimatlar` | Oturum | YG-068, YG-1491: Beklemede statü değildir; neden, sorumlu, hedef tarih ve kanıt olmadan konamaz. Dosya statüsü korunur. YG-569, YG-570: dış kanaldan alınan talimat/karar özgün metin, tarih ve göndereniyle kaydedilir; kayıt değiştirilemez, aktaranın notu ayrı alandadır. |
| POST | `/api/talimat/:id/kaynak` | Oturum | YG-158: yetkisiz kaynaktan gelen talimat/kararı Dosya Sorumlusu yetkili taraftan teyit alarak doğrular ya da dikkate almaz; gerekçe zorunlu. |
| POST | `/api/dosya/:id/talimat` | Oturum | — |
| POST | `/api/dosya/:id/beklemede` | Oturum | — |
| POST | `/api/beklemede/:id/kaldir` | Oturum | — |
| POST | `/api/beklemede/:id/uzat` | Oturum | YG-070: her seferinde 15 gün; ilk üç uzatma Operasyon Müdürü, sonrası üst makam. |
| POST | `/api/beklemede/:id/karar` | Oturum + izin: dosya.ata.operasyon | YG-069: 45. gün kararı. Kontrollü Askıda dosyayı askıya alır; Kapanış ilgili kapanış adımını açar, otomatik kapanmaz. |
| POST | `/api/dosya/:id/konu` | Oturum | YG-059: sahipsiz açılamaz, hedef tarih zorunlu; kapanış kanıt ve bağımsız yeniden kontrolle. |
| POST | `/api/konu/:id/hedef` | Oturum | YG-059: hedef tarih yalnız Dosya Sorumlusunca gerekçeyle değiştirilir; eski ve yeni tarih iz kaydına yazılır, konu sahibine bildirilir. |
| POST | `/api/konu/:id/durum` | Oturum | — |
| GET | `/api/dosya/:id/belge-inceleme` | Oturum | — |
| POST | `/api/dosya/:id/belge/:belge/inceleme` | Oturum | — |
| GET | `/api/ara` | Oturum | YG-024: eski numara aramada bulunur ve ana dosyaya yönlendirir. YG-1112 benzeri: yalnız erişilebilir dosya döner. |

### dosya_yazisma

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/yazisma` | Oturum | — |
| POST | `/api/dosya/:id/yazisma` | Oturum | — |
| POST | `/api/dosya-yazismasi/:id/oncelik` | Oturum | YG-1666: Dosya Sorumlusu önceliği hemen yükseltir; düşürme Operasyon Müdürü onayından geçer. |

### doviz

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/doviz-kurlari` | Oturum | YG-1356: ana sayfa kur şeridi (bilgi amaçlı); son yayın tarihi ile. |
| POST | `/api/doviz-kuru` | Oturum | TCMB yayınına erişilemediğinde Muhasebe ve Finans rolü günün satış kurunu elle girer; TCMB kaydı varsa değiştirilemez. |

### durum_boyutlari

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/durum-boyutlari` | Oturum | — |

### durum_sozlugu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/durum-sozlugu` | Oturum | Tüm LGM personeli okur; tanımsız durumlar ve aynı adın farklı anlamları ayrıca listelenir. |
| POST | `/api/durum-sozlugu` | Oturum | Aynı durum adı başka bir kayıt türünde farklı anlamla tanımlıysa kayıt reddedilir. |

### egitim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ortam` | Oturumsuz | Oturum gerektirmez: giriş ekranı da EĞİTİM işaretini gösterir. |
| GET | `/api/egitim/senaryolar` | Oturum | — |
| POST | `/api/egitim/senaryo/:kod/basla` | Oturum | Başlat: süren deneme varsa kaldığı adımdan döner; sıfırla ile baştan başlanır (YG-1399). |
| POST | `/api/egitim/deneme/:id/cevap` | Oturum | Cevap: doğru seçenek puan kazandırır; engellenmesi gereken işlemde sistem kullanıcıyı durdurur ve durdurma sayılır. |
| POST | `/api/egitim/senaryo/:kod/sifirla` | Oturum | Sıfırla: süren deneme kapanır, senaryo baştan başlar (YG-1399). |

### eksper

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/eksper` | Oturum | Dosya Sorumlusu dosyaya eksperi ekler; hesabı yoksa eksper grubunda hesap ve 7 gün geçerli davet açılır, varsa mevcut hesap bağlanır. |
| GET | `/api/dosya/:id/eksper` | Oturum | Dosya Sorumlusu dosyadaki eksperleri ve randevu taleplerini görür. |
| GET | `/api/eksper/ana` | Oturum | Eksper ana ekranı: profil, yanıt bekleyen davetler ve parça incelemeleri. Dosyalar ve onay bekleyen teklifler /sigorta/ana'dan gelir. |
| POST | `/api/eksper/davet/:id/yanit` | Oturum | Tanıklık/bekletme davetine katılım yanıtı; planlanan zamana kadar değiştirilebilir. Dosya Sorumlusu ve daveti açan bilgilendirilir. |
| POST | `/api/eksper/dosya/:id/randevu` | Oturum | Bekletilen parçalar için inceleme randevusu talebi; istenen zaman bekletme süresi içinde olmalıdır. Dosya Sorumlusuna görev düşer. |
| POST | `/api/eksper-randevu/:id/planla` | Oturum | Dosya Sorumlusu randevu zamanını kaydeder; eksper bilgilendirilir, görev kapanır. |

### entegrasyon

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/entegrasyon` | Oturum | — |
| POST | `/api/entegrasyon` | Oturum | — |
| POST | `/api/entegrasyon/:id/askiya-al` | Oturum | — |
| POST | `/api/entegrasyon/:id/yeniden-ac` | Oturum | — |

### entegrasyon_envanter

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/entegrasyon-envanteri` | Oturum | YG-1297, 1298, 1317: envanter; her bağlantının son veri zamanı (son gelen kayıt veya toplu aktarım) gösterilir. |
| POST | `/api/entegrasyon-envanteri/:id` | Oturum | YG-1297, YG-1300: envanter alanları ve veri sözleşmesi (kaynak-hedef alan, dönüşüm, eşleştirme, varsayılan değer, güncellenme). |
| POST | `/api/entegrasyon-envanteri/:id/dogrula` | Oturum | — |
| POST | `/api/entegrasyon-envanteri/:id/toplu-aktarim` | Oturum | — |

### entegrasyon_uzlastirma

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/entegrasyon/karantina` | Oturum | — |
| POST | `/api/entegrasyon/kayit/:id/yeniden-dene` | Oturum | YG-1308: yetkili yeniden deneme talebi kaydedilir; kayıt karantinada ve donmuş kalır, sonuç gelince entegrasyonSonucu yeni kayıt açar. |
| GET | `/api/entegrasyon/kayit/:id` | Oturum | — |
| POST | `/api/entegrasyon/kayit/:id/uzlastir` | Oturum | Manuel uzlaştırma: yetkili doğrulama olmadan en yeni zaman damgası doğru kabul edilmez; karar ve gerekçe yazılır. |

### erisim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/erisim/secenekler` | Oturum | Formda yalnız etkin LGM personeli ve iç roller listelenir; rol serbest metinle girilmez (YG-1008). |
| POST | `/api/erisim/talep` | Oturum | — |
| GET | `/api/erisim/taleplerim` | Oturum | — |
| GET | `/api/erisim/uygulanacak` | Oturumsuz | — |
| POST | `/api/erisim/:id/uygula` | Oturumsuz | A33-2: Uygula ve Kullanıcıya Bildir. YG-1008: talep eden, onaylayan ve atayan farklı kişi; kendi hesabına yetki yok. YG-1042: gerçek izin karşılaştırılır. |

### erisim_inceleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/erisim-inceleme` | Oturum | YG-1045: rol açıklaması, görev, son giriş ve önceki karar görünür. |
| POST | `/api/erisim-inceleme/kalem/:id` | Oturum | — |
| POST | `/api/erisim-inceleme/:id/onaya-gonder` | Oturum | — |
| POST | `/api/erisim-inceleme/kalem/:id/uygulandi` | Oturum | YG-1644: daraltma Sistem Yöneticisince uygulanır, kararı verene "Uygulandı" gider. |

### ertelenen

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/ertelenen` | Oturum | — |
| GET | `/api/dosya/:id/alt-talepler` | Oturum | — |

### etik_denetim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/etik-bildirim` | Oturum | — |
| GET | `/api/etik-bildirim` | Oturum | — |
| POST | `/api/etik-bildirim/:id/karar` | Oturum | — |
| GET | `/api/ic-denetim` | Oturum | — |
| POST | `/api/ic-denetim` | Oturum | YG-1673: açılışta çıkar çatışması beyanı; son 12 ayda süreçte görev alan denetleyemez. |
| POST | `/api/ic-denetim/:id/ata` | Oturum | YG-1679: İç Denetim Müdürü denetçiyi atar; erişim atamayla kendiliğinden açılır, bitiş tarihine kadar ve denetim açıkken sürer, salt okunurdur. |
| GET | `/api/ic-denetim/:id/izler` | Oturum | — |
| POST | `/api/ic-denetim/:id/bulgu` | Oturum | — |
| POST | `/api/ic-denetim/:id/rapor` | Oturum | YG-1675, YG-1681, YG-1682: İç Denetçi → Müdür → CEO; Müdür yürüttüyse veya yoksa doğrudan CEO; GMY ve Risk Direktörü zincirde değildir. |

### firma

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma/sicil` | Oturum + izin: firma.kayit | YG-009, YG-345: sicil no LGM-SC-NNNNN; başvuruda verilir, ayrı numara yok. Vergi no mükerrerlik anahtarı. ANV-1: aday havuzu ayrı gösterilir; YG-356: Arşiv, kapanmış kayıtların görünümüdür |
| POST | `/api/firma` | Oturum + izin: firma.kayit | — |
| POST | `/api/firma/:id/birim-gorusu` | Oturum + izin: firma.onay | — |
| GET | `/api/firma-birim-gorusu/bekleyen` | Oturum | — |
| POST | `/api/firma-birim-gorusu/:id/gonder` | Oturum | — |
| GET | `/api/firma/:id/birim-gorusleri` | Oturum + izin: firma.kayit | — |
| POST | `/api/firma/:id/sahte-belge-suphesi` | Oturum + izin: firma.kayit | YG-1650, YG-1651: Sahte Belge veya Yanıltıcı Beyan Şüphesi; Firma Yönetimi Müdür Yardımcısı ve Müdürüne Kritik (acil, sayaçsız) kart; başvuru Reddedildi önerisiyle üst kademeye arz edilir. |
| GET | `/api/firma-hukuk-gorusu/bekleyen` | Oturum | — |
| POST | `/api/firma-hukuk-gorusu/:id/gonder` | Oturum | — |
| POST | `/api/firma/:id/hukuk-gorusu` | Oturum + izin: firma.onay | — |
| POST | `/api/firma/:id/statu` | Oturum + izin: firma.onay | — |
| POST | `/api/firma/:id/eksik-belge` | Oturum + izin: firma.kayit | MTN-4 (CEO 26.11.2026): sicil başvurusunda eksik belgeler firmaya BLD-103 ile bildirilir (portal + e-posta). |
| POST | `/api/firma/:id/statu-onerisi` | Oturum + izin: firma.kayit | YG-360: statü, aşama veya risk derecesi değişikliğini Sicil Sorumlusu gerekçesiyle hazırlar; karar Firma Yönetimi Müdüründedir. |
| POST | `/api/firma/:id/kullanici` | Oturum + izin: firma.onay | — |
| GET | `/api/firma/:id/brans-oneri` | Oturum + izin: firma.kayit | YG-308: Y seviyesi ölçütlerden önerilir; ölçütün üstünde seviye verilmez. Kısıt ve istisnalar ayrı tutulur. |
| POST | `/api/firma/:id/brans` | Oturum + izin: firma.onay | — |
| POST | `/api/firma/:id/belge` | Oturum + izin: firma.kayit | — |
| GET | `/api/firma/uygunluk` | Oturum | YG-301, YG-303: Dosya Sorumlusu uygunluk listesinden seçer; uygun olmayan neden yazılı görünür. |
| GET | `/api/dosya/:id/atik-onerisi` | Oturum | YG-435: KN, ON, EK Operasyon Yöneticisi; GR Teknik Yönetici çıkarır. YG-322: mali ve kapsam doğrulanmadan yayımlanmaz. YG-322: Dosya Sorumlusu (veya ekipteki Operasyon Yöneticisi) eşleşmeyen konumda bölgeyi listeden seçer. YG-330 |
| GET | `/api/dosya/:id/bolge` | Oturum | — |
| POST | `/api/dosya/:id/bolge-sec` | Oturum | — |
| POST | `/api/dosya/:id/is-emri` | Oturum | — |
| GET | `/api/firma-portal/ana` | Oturum | — |
| POST | `/api/firma-portal/rehber-okundu` | Oturum | — |
| GET | `/api/firma-portal/bekleyenler` | Oturum | YG-1574: İşleminizi Bekleyenler; acil iş emri, rapor/fiyat son zamanı, uygunsuzluk yanıtı ve kapatılmamış günlük kayıt; en yakın son zaman önce. |
| GET | `/api/firma-portal/is-emri/:id` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/yanit` | Oturum | YG-224, YG-325: Kabul / Koşullu Kabul / Çekince / Ret; kabul onay koduyla tek adımda. Sessizlik kabul sayılmaz. |
| POST | `/api/firma-portal/dosya/:id/fiyat` | Oturum | YG-426, YG-1540: firma fiyatı yalnız firma ekranından girilir; geçerlilik 30 gün, kısaltılamaz. |
| GET | `/api/firma-portal/dosya/:id/kapsam` | Oturum | Firma kapsamı fiyatsız görür (YG-293). |
| POST | `/api/firma-portal/is-emri/:id/ilerleme` | Oturum | YG-377: ilerleme miktar ve kanıtla; yalnız yüzde resmî ilerleme sayılmaz. YG-318: kapsam dışında iş durdurulur. |
| POST | `/api/firma-portal/is-emri/:id/durdur` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/tamamlandi` | Oturum | — |
| POST | `/api/is-emri/:id/firma-birakti` | Oturum | YG-1660: firma işi bırakırsa iş emri kapanır, Dosya Sorumlusuna firma değiştirme görevi açılır; rücu ve mahsup için hakediş, kesinti ve ödeme bilgisi Muhasebe ve Finans Müdürüne gider. |
| POST | `/api/is-emri/:id/firmaya-gonder` | Oturum | YG-1597, YG-042, KSF-1: keşif iş emrini Dosya Sorumlusu firmaya gönderir; keşif süresi gönderimle başlar. |
| POST | `/api/is-emri/:id/baslangic` | Oturum | YG-369: başlangıç kontrolü firma kabulünden sonra; Başlanabilir / Koşullu Başlanabilir / Bekletilir. BLD-02 yat sahibine. |
| GET | `/api/is-emri/:id/ilerlemeler` | Oturum | YG-378: LGM doğrular; doğrulanan miktar ilerlemeye girer. YG-386: uygulayıcı kendi işini kabul edemez (ayrı hesap ve portal). |
| POST | `/api/is-emri/:id/ilerleme/:no/dogrula` | Oturum | — |
| POST | `/api/is-emri/:id/teknik-kabul` | Oturum | YG-387: firma işinin teknik kabulü (kısmi kabul dahil) LGM yetkilisince; YG-413: kanıt eksikse kapanmaz; YG-330: tehlikeli atık belgesi. |
| POST | `/api/is-emri/:id/kapat` | Oturum | — |

### firma_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/firma/:id/sicil-ek` | Oturum | Sicil: yetkili servis, çıkar beyanı, kapasite, kaptan. |
| GET | `/api/firma/:id/ozet` | Oturum | YG-346: firma ana kayıt görünümü; tüm ilişkiler tek yerde (sicil rollerine). |
| POST | `/api/firma/:id/kapasite` | Oturum | YG-309: branş, görev sınıfı (boşsa tüm sınıflar) ve tesis (boşsa tüm yerler) bazında eş zamanlı iş kapasitesi. |
| GET | `/api/firma/:id/kapasite` | Oturum | — |
| POST | `/api/firma/:id/kaptan` | Oturum | — |
| GET | `/api/kaptanlar` | Oturum | — |
| POST | `/api/dosya/:id/kaptan-gorevlendirme` | Oturum | — |
| POST | `/api/dosya/:id/hiza-kontrolu` | Oturum | YG-409 |
| POST | `/api/firma-portal/is-emri/:id/alt-yuklenici` | Oturum | YG-411: alt yüklenici önceden onaya bağlıdır. |
| GET | `/api/firma-portal/itirazlar` | Oturum | YG-423: garanti kararına 2 iş günü, rücu ve mahsuba 5 iş günü itiraz. |
| POST | `/api/firma-portal/garanti/:id/itiraz` | Oturum | — |
| POST | `/api/firma-portal/mahsup/:id/itiraz` | Oturum | — |
| GET | `/api/mahsup-itirazlar` | Oturum | V-186: itiraz sonuçlanana kadar mahsup durur. Kabulde mahsup iptal edilir, önceden düşülen tutar için iade görevi açılır; retle kaldığı yerden sürer. |
| POST | `/api/mahsup/:id/itiraz-karar` | Oturum | — |
| POST | `/api/firma/:id/kalici-aski-onerisi` | Oturum | YG-1660: görüşleri Firma Yönetimi Müdürü ister; Teknik Müdür, Hukuk ve Uyum, Operasyon Müdürü sırayla görüş verir, Direktör karar verir. |
| GET | `/api/firma-portal/oryantasyon` | Oturum | YG-938: Çözüm Ortağı saha oryantasyonu; firma yetkilisi dersin hangi personeline verildiğini kaydeder. |
| POST | `/api/firma-portal/oryantasyon/:ders` | Oturum | — |
| GET | `/api/firma-portal/personel` | Oturum | YG-304, YG-339: firma kendi personelini kaydeder; ayrılan personelin ekip kartları iptal olur, bağlı hesabı kapanır, geçmiş korunur. |
| POST | `/api/firma-portal/personel` | Oturum | — |
| POST | `/api/firma-portal/personel/:id/ayrildi` | Oturum | — |
| GET | `/api/firma/:id/personel` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/ekip-karti` | Oturum | YG-424: Görevli Ekip Kartı; firma unvanı yazılmaz, QR kodu herkese açık doğrulamaya gider. Geçerlilik iş emrinin hedef bitişi, yoksa 30 gün. |
| GET | `/api/ekip-karti/:kod` | Oturumsuz | — |
| GET | `/api/sicil/suresi-dolmus-belgeler` | Oturum | YG-1660: geçici askı iş kararı; öneri öndeğerdir. Güvenli Durdurma iş emrini durdurur, Devir firma değiştirme görevi açar. YG-1648: aktif firmada süresi dolmuş ve aynı türde geçerli yenisi olmayan belge; SGK ve vergi borcu yazısında yeni iş emri verilmez, hakediş ödemesi bekletilir. |
| GET | `/api/firma/donem-kartlari` | Oturum | — |
| POST | `/api/firma/donem-kartlari/kaydet` | Oturum | YG-1655: dönem kartı puanı sistemce hesaplanır; Müdür Yardımcısı "Dönem Kartlarını Kaydet" ile dönemi kaydeder, ayrı onay adımı yoktur. |
| POST | `/api/firma/karne-ozeti` | Oturum | YG-1654: üç aylık karne özeti gözden geçirme paketi; Firma Yönetimi Müdür Yardımcısı veya Yöneticisi hazırlar, Firma Yönetimi Müdürü onaylar. |
| POST | `/api/firma/:id/kademeli-dusus-onerisi` | Oturum | — |
| GET | `/api/firma-denetim-plani` | Oturum | — |
| POST | `/api/firma-denetim-programi` | Oturum | YG-1654: yıllık firma denetim programı taslağı; İç Denetim planı ve açık iç denetimlerle çakışma kontrol edilir, program Firma Yönetimi Müdürü onayına gider. |
| POST | `/api/firma/:id/denetim-plani` | Oturum | — |
| POST | `/api/firma-denetim/:id/ertele` | Oturum | — |
| POST | `/api/firma-denetim/:id/sonuc` | Oturum | — |
| POST | `/api/firma/:id/on-incelemeye-gonder` | Oturum | YG-1650 (A37): Sicil Sorumlusu belge kontrolünü bitirip başvuruyu ön incelemeye gönderir; karara sunma süresi 15 iş günü. |
| GET | `/api/firma/:id/karar-onerisi` | Oturum | — |
| POST | `/api/firma/:id/karar-onerisi` | Oturum | — |
| GET | `/api/iletisim/cozum-ortagi-basvurusu` | Oturumsuz | YG-1648 (A36): C-1 Çözüm Ortağı Başvurusu sihirbazı (herkese açık). Başvuru ayrı numara almaz; açıldığı anda verilen sicil numarasıyla "Başvuru" aşamasında izlenir. |
| POST | `/api/iletisim/cozum-ortagi-basvurusu` | Oturumsuz | — |
| GET | `/api/firma/kabul-sistemi` | Oturum | YG-1650 (A37): Dağıtım Bekleyen Başvurular, aylık kabul göstergeleri ve yıllık iyileştirme önerisi. |
| POST | `/api/firma/:id/sicil-ata` | Oturum | — |
| POST | `/api/firma/kabul-gostergeleri/onaya-gonder` | Oturum | — |
| POST | `/api/firma/kabul-iyilestirme` | Oturum | — |
| GET | `/api/sicil/kalite` | Oturum | YG-1648 (A36): Sicil Kalitesi — yıldönümü paketi bekleyen firmalar ve 12 aydır güncellenmeyen kayıtlar. |
| POST | `/api/sicil/yildonumu/:id/onaya-gonder` | Oturum | — |
| GET | `/api/aski/acik-isler` | Oturum | YG-1654: geçici askıdaki firmaların karar bekleyen açık işleri (dosya bazında öneri); Firma Yönetimi Müdürlüğü izler, kararı Dosya Sorumlusu veya Operasyon Müdürü verir. |
| POST | `/api/aski-karari/:id` | Oturum | — |
| POST | `/api/firma/yurt-disi-talep` | Oturum | YG-1660: yurt dışı yerel firma talebini Operasyon Müdürü açar; iki onay kartı aynı anda açılır. |
| GET | `/api/firma/yurt-disi-talep` | Oturum | — |
| POST | `/api/dosya/:id/gecici-onarim` | Oturum | YG-141: geçici onarım en çok 30 gün; Teknik Yönetici en çok 2 uzatma, toplam 60 gün. |
| GET | `/api/dosya/:id/gecici-onarim` | Oturum | — |
| POST | `/api/gecici-onarim/:id/uzat` | Oturum | — |
| POST | `/api/gecici-onarim/:id/kapat` | Oturum | — |
| POST | `/api/dosya/:id/tasima-onayi` | Oturum | YG-142, YG-143: kapasite ağırlığı karşılamalı; yeni hasarda görev; tedbirli yat Hukuk ve Uyum onayına bağlı. |
| POST | `/api/dosya/:id/kaldirma-tasima` | Oturum | — |
| GET | `/api/dosya/:id/kaldirma-tasima` | Oturum | YG-376: FR-OPS-012 Kaldırma ve Taşıma Tutanağı; kaydeden kişi adıyla değil dosyadaki rolüyle yazılır. |
| GET | `/api/kaldirma-tasima/:id/tutanak` | Oturum | — |
| GET | `/api/onayli-parca` | Oturum | YG-867: onaylı parça ve muadil listesi ana veri. |
| POST | `/api/onayli-parca` | Oturum | — |

### firma_haritasi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-haritasi` | Oturum | — |

### firma_islev

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-portal/kullanicilar` | Oturum | — |
| POST | `/api/firma-portal/kullanici/:id/islev` | Oturum | — |

### firma_police

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/firma/police-brans-limit` | Oturum | YG-343: branşa göre asgari limit; tanımsız branşta LMT-1 geçerlidir. |
| POST | `/api/firma/:id/police-hatirlat` | Oturum | YG-1471 (BLD-95, CEO 17.11.2026): poliçe tavsiye hatırlatması; varyant listedeki duruma göre seçilir, aynı firmaya aynı gün bir kez. |
| GET | `/api/firma/police-listesi` | Oturum | — |

### firma_tesis

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-tesis/secenekler` | Oturum | YG-348: tesis formunun seçim listeleri (yalnız sözlükteki değerler, YG-1379). |
| GET | `/api/firma/:id/tesis` | Oturum | — |
| POST | `/api/firma/:id/tesis` | Oturum | — |
| POST | `/api/firma-tesis/:id/yerlesim` | Oturum | YG-348: sicil başvurusundan veya eski kayıttan gelen eksik tesis bilgisi tamamlanır; eski ve yeni değer işlem izine yazılır. |
| POST | `/api/firma-tesis/:id/pasif` | Oturum | — |

### form_katalogu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/form-katalogu` | Oturum | Katalog: secim=1 yalnız yürürlükteki araçları verir (yeni kayıtta seçim listesi). |
| GET | `/api/form-katalogu/:kod/alanlar` | Oturum | — |
| GET | `/api/form-katalogu/:kod/bos.pdf` | Oturum | YG-666: boş şablon; kimlik bandı, dosya ve yat kutusu, sözlükten alan kutuları ve onay bölümü aynı tasarım düzeninde. |
| POST | `/api/form-katalogu/:kod/degisiklik-talebi` | Oturum | YG-1691: Kalite Müdürü Ek II Değişiklik Talebini hazırlar, "Onaya Gönder" → Risk ve Kalite Direktörü. |
| POST | `/api/form-katalogu` | Oturum | Yeni araç Taslak doğar; kod tekildir ve iptal edilmiş kod yeniden verilemez (birincil anahtar, silme yasağı). |
| POST | `/api/form-katalogu/:kod/durum` | Oturum | — |

### garanti_belgesi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/bakim-onerileri` | Oturum | — |
| POST | `/api/dosya/:id/bakim-onerileri` | Oturum | — |

### garanti_mali

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/garanti-maliyet` | Oturum | Garanti Maliyet Kaydı: Ticari Sorumlu girer, Ticari İşler Direktörü onaylar; LGM dışı karşılayanda mahsup referansı zorunlu. |
| POST | `/api/dosya/:id/garanti-maliyet` | Oturum | — |
| POST | `/api/dosya/:id/uretici-garanti-basvurusu` | Oturum | Üretici Garanti Başvurusu: dosyaya erişimi olan LGM personeli açar ve günceller; durum sırası durum sözlüğündeki gibidir. |
| POST | `/api/uretici-garanti-basvurusu/:id/durum` | Oturum | — |
| GET | `/api/kdv-iade` | Oturum | KDV İade Dosyası: Muhasebe ve Finans birimi açar ve yürütür; iade nedeni mali müşavir görüşüne bağlı olduğundan serbest metindir. |
| POST | `/api/kdv-iade` | Oturum | — |
| POST | `/api/kdv-iade/:id/ilerlet` | Oturum | — |

### garanti_yanit

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/garanti-sikayet/:id/gecmis` | Oturum | YG-084: geri dönüşte önceki dosya, parça (tedarik ve giriş kabulü), firma (iş emri), test, teslim ve belge kanıtları tek görünümde; aynı yatın önceki dosyaları da listelenir. |
| GET | `/api/garanti-sikayet/:id/yanit` | Oturum | — |
| POST | `/api/garanti-sikayet/:id/yanit-yazisi` | Oturum | — |
| POST | `/api/garanti-sikayet/:id/itiraz` | Oturum | YG-728: yat sahibinin itirazı yanıttan sonra 15 gün içinde kaydedilir; ilk kararı vermeyen üst kademe 120 saat içinde karar verir. |
| POST | `/api/garanti-sikayet/:id/teknik-gorus-iste` | Oturum | YG-1701 (A53-Z1): Müşteri ve Paydaş İlişkileri Müdürü "Görüş İste"; dosyanın Teknik Yöneticisi (atanmamışsa Teknik Yönetici rolü) "Görüşü Gönder". |
| GET | `/api/sikayet-teknik-gorus/bekleyen` | Oturum | — |
| POST | `/api/sikayet-teknik-gorus/:id/gonder` | Oturum | — |
| POST | `/api/garanti-sikayet/:id/bagimsiz-sorveyor` | Oturum | — |
| POST | `/api/garanti-sikayet/:id/bagimsiz-sorveyor/sonuc` | Oturum | — |
| POST | `/api/garanti-sikayet/:id/kaliteye-yonlendir` | Oturum | YG-1701 (A53-S2): tekrarlayan şikâyette Müşteri ve Paydaş İlişkileri Müdürü sistemsel neden incelemesi için Kalite Müdürüne yönlendirir. |
| POST | `/api/garanti-sikayet/:id/itiraz-karar` | Oturum | — |

### gelen_talep

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/iletisim/gelen-talep-konulari` | Oturumsuz | — |
| POST | `/api/iletisim/gelen-talep` | Oturumsuz | Herkese açık (web sitesi formu); saatte 5'ten fazla talep aynı adresten kabul edilmez. |
| GET | `/api/gelen-talepler` | Oturum | — |
| POST | `/api/gelen-talep/:id/operasyona-aktar` | Oturum | YG-1699 (A52-S2): Müdür Yardımcısı hasar içerikli talebi Operasyon Müdürüne aktarır. |
| POST | `/api/gelen-talep/:id/yonlendir` | Oturum | "Diğer" veya yanlış konudaki talep Müşteri ve Paydaş İlişkileri Müdürlüğünce seçilen role yönlendirilir. |

### genel_form

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/form-genel` | Oturum | Seçim listesi: yalnız yürürlükteki genel araçlar; firma kullanıcısına yalnız firmanın doldurduğu araçlar. |
| GET | `/api/form/:kod/tanim` | Oturum | — |
| GET | `/api/form-kaydi` | Oturum | — |
| POST | `/api/form-kaydi` | Oturum | Kayıt Açık doğar; yalnız yürürlükteki araç seçilir (YG-601); kayıt, doldurulduğu şablon sürümünü taşır. |
| POST | `/api/form-kaydi/:id` | Oturum | — |
| POST | `/api/form-kaydi/:id/gonder` | Oturum | Kontrole gönderim: onaylayan katalogdan; onaylayan tanımlı değilse kayıt doğrudan onaylı olur. |

### geri_yukleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/geri-yukleme/kayit` | Oturum | — |

### goc

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/goc` | Oturum | — |
| POST | `/api/goc/degisiklik` | Oturum | YG-1291: dondurmadan sonraki zorunlu değişikliği veri sahibi kaydeder, GMY uygun görür; gerçek göçten sonra uygulanır. |
| POST | `/api/goc/degisiklik/:id/uygulandi` | Oturum | — |

### gorev_erteleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/is/:id/ertele` | Oturum | — |
| GET | `/api/is/:id/ertelemeler` | Oturum | — |

### gorsel_gizlilik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/belge/:id/hassas` | Oturum | Hassas işaret, dosya sorumlusuna erişim seviyesi gözden geçirme görevi açar; bilgi sınıfı en az Gizli olur. |
| POST | `/api/belge/:id/maskeli-kopya` | Oturum | Maskeleme özgün üzerinde değil, ayrı yüklenen kopya üzerinde yapılır; özgün değişmez. |

### gosterge

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/gosterge/hedef` | Oturum | Cilt I §9.3: hedef ve eşiği iş sahibi belirler; CEO ve GMY yürürlüğe alır. Değişiklik izlenir. |
| POST | `/api/ramak-kala` | Oturum | Cilt I Tablo 9.7: ramak kala bildirimi tüm ekiplerden; cezalandırıcı değildir. |

### guvenlik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/denetim/arama` | Oturum + izin: denetim_izi.goruntule | YG-1187: denetim erişimi olay, dönem ve amaçla; arama ve dışa aktarım ayrıca kaydedilir. |
| POST | `/api/olay/:id/adim` | Oturum | YG-1285: müdahale, karar ve iletişim adımları zaman çizelgesine yazılır. |
| GET | `/api/olay/:id/zaman-cizelgesi` | Oturum | — |
| POST | `/api/olay/:id/bagla` | Oturum | YG-1285: aynı kesintiden gelen kayıt ana olaya bağlanır; ana olay kapanınca bağlı kayıtlar da kapanır. |
| POST | `/api/olay/:id/guncelle` | Oturum | — |
| POST | `/api/olay/:id/yanit` | Oturum | — |
| POST | `/api/olay/:id/gecici-cozum` | Oturum | — |
| GET | `/api/olaylar` | Oturum | — |
| POST | `/api/olay/:id/kapat` | Oturum | — |
| POST | `/api/olay/:id/aciklama-yetkilisi` | Oturum | — |

### guvenlik_izleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/guvenlik` | Oturum | — |
| POST | `/api/guvenlik/alarm/:id/adim` | Oturum | — |
| POST | `/api/guvenlik/alarm/:id/tedbir` | Oturum | — |
| POST | `/api/guvenlik/kural/:kod` | Oturum | YG-1194: eşik gevşetme ve istisna gerekçeli, süreli ve görünürdür; Direktör bilgilendirilir. |
| POST | `/api/guvenlik/kir-cam` | Oturum | YG-1190: onay makamı Bilgi İşlem Müdürü; Müdürün kendi erişimini Direktör onaylar; kişisel veride veri sahibi onayı aranır; kapanışta sır yenileme ve bağımsız inceleme zorunludur. |
| POST | `/api/guvenlik/kir-cam/:id/onay` | Oturum | — |
| POST | `/api/guvenlik/kir-cam/:id/kapat` | Oturum | — |
| POST | `/api/guvenlik/destek-erisim` | Oturum | YG-1188: geçici destek erişiminin ekran paylaşımı, dosya indirme ve uzaktan yönetim kaydı. |

### hatirlatma_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/yat-karada` | Oturum | YG-1453: Dosya Sorumlusu yatın karaya alındığını işaretler; hatırlatma hemen çalışır. |

### hesabim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/kimlik/parola-talep` | Oturumsuz | YG-1156. Yanıt her durumda aynıdır; hesabın varlığı anlaşılmaz. |
| POST | `/api/kimlik/parola-yenile` | Oturumsuz | İkinci faktör değişmez; yeni parolayla girişte doğrulama kodu yine istenir. |
| GET | `/api/profil` | Oturum | — |
| POST | `/api/profil/dil` | Oturum | — |
| POST | `/api/profil/eposta-talep` | Oturum | YG-1211: tek adımda verilir veya geri alınır; önceki kayıt silinmez (YG-1210). YG-1156, EP-M1: kod yeni adrese, uyarı eski adrese. |
| POST | `/api/profil/eposta-onay` | Oturum | — |
| POST | `/api/profil/izin` | Oturum | — |

### hesap_birlestirme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/hesap-birlestirme/onizleme` | Oturum | — |
| POST | `/api/hesap-birlestirme` | Oturum | — |
| POST | `/api/hesap-birlestirme/:id/geri-al` | Oturum | — |
| GET | `/api/hesap-birlestirme` | Oturum | — |

### hesap_kurtarma

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/hesap-kurtarma/bul` | Oturumsuz | Yalnız tam e-posta veya telefonla bulunur; destek rolü kullanıcı listesi görmez (YG-992). |
| POST | `/api/hesap-kurtarma` | Oturumsuz | — |
| GET | `/api/hesap-kurtarma` | Oturumsuz | — |

### hukuki_metin

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/hukuki-metinler` | Oturum | — |
| POST | `/api/hukuki-metin/:kod` | Oturum | Sürüm metin koduna bağlıdır (yeni sürüm rızanın yeniden alınmasını tetikler); metnin mevcut tüm dilleri aynı sürümle birlikte onaya gider ve birlikte yürürlüğe girer. |

### ic_denetci

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ic-denetim/:id/kanitlar` | Oturum | — |
| POST | `/api/ic-denetim/:id/kanit` | Oturum | — |
| POST | `/api/ic-denetim/:id/kanit-talebi` | Oturum | Kanıt talebi (¶2236): denetçi LGM personelinden belge veya açıklama ister; yanıt süresi Süre Uyarılarında. |
| GET | `/api/ic-denetim-kanit-talebi/bana` | Oturum | — |
| POST | `/api/ic-denetim-kanit-talebi/:id/yanit` | Oturum | — |
| GET | `/api/ic-denetim/orneklemim` | Oturum | Dosya örneklemi incelemesi (YG-808, ¶2206, ¶2218): atanan denetçi sonucu ve FR-KLT-011 denetim bulguları alanını (sınıf, kanıt, sorumlu, hedef tarih) kaydeder. |
| POST | `/api/ic-denetim/orneklem/:donem/:dosya/inceleme` | Oturum | — |

### ic_denetim_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ic-denetim/ek` | Oturum | — |
| POST | `/api/ic-denetim/plan` | Oturum | — |
| POST | `/api/ic-denetim/bulgu/:id/takip` | Oturum | — |
| POST | `/api/ic-denetim/bulgu-raporu` | Oturum | — |

### ic_ilerleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/ic-ilerleme` | Oturum | — |
| POST | `/api/dosya/:id/ic-ilerleme` | Oturum | — |

### idari_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/idari-ana` | Oturum | A30 / A31 özet verisi. |
| POST | `/api/idari-talep/:id/satin-alma` | Oturum | YG-1617: satın alma talebi teknik şart, miktar ve en az bir fiyat kartıyla Müdüre gider; siparişe dönüştürme Müdürdedir. |
| POST | `/api/idari-talep/:id/bt-sartname` | Oturum | — |
| POST | `/api/idari-talep/:id/mudur-iade` | Oturum | — |
| POST | `/api/idari-talep/:id/teslim` | Oturum | Teslim: irsaliye ve fatura siparişle eşleştirilir. |
| POST | `/api/idari-tedarikci` | Oturum | İdari tedarikçi listesi; IBAN değişikliği Muhasebe ve Finans onayına gider. |
| POST | `/api/idari-tedarikci/:id/iban-onay` | Oturum | — |
| POST | `/api/varlik/:id/kayip` | Oturum | Kayıp cihaz: 1 saat içinde Bilgi İşlem Müdürü ve Hukuk ve Uyum Direktörüne veri ihlali değerlendirmesi düşer. |
| POST | `/api/varlik/:id/ariza` | Oturum | — |
| POST | `/api/varlik/sayim` | Oturum | — |
| POST | `/api/sarf` | Oturum | — |
| POST | `/api/ofis-sozlesmesi` | Oturum | YG-1620: ofis hizmet sözleşmeleri LGM-SZ-NNNN; yenileme veya fesih önerisi TİD'e gider. |
| POST | `/api/ofis-sozlesmesi/:id/oneri` | Oturum | — |
| POST | `/api/idari-butce` | Oturum | — |

### idari_talep

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/idari-talep` | Oturum | — |
| POST | `/api/idari-talep` | Oturum | — |
| POST | `/api/idari-talep/:id/siparis` | Oturum | YG-1620: siparişe dönüştürme ve onaya sunma İdari İşler Müdüründe; tedarikçi ve tutar seçilen fiyat kartından gelir. Kart geçerliliği, BT alımında Bilgi İşlem şartnamesi ve bölünme kontrolü (aynı tedarikçiye 30 günlük toplam) uygulanır; son onay makamı toplam tutara göre belirlenir. |
| GET | `/api/masraf/ceo-raporu` | Oturum | YG-1677: CEO, Muhasebe ve Finans Müdürü ve mali müşavir görür; kayıt silinemez. |

### ihbar

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ihbar/secenek` | Oturum | — |
| POST | `/api/alternatif-form/blok` | Oturum | YG-033: form doldurulurken önerilen öncelik. YG-278: kesinti öncesi nöbet için numaralı alternatif kayıt formu bloğu; numaralar tekildir, boş formlar PDF olarak yazdırılır. |
| GET | `/api/alternatif-form/blok/:id/pdf` | Oturum | — |
| POST | `/api/ihbar/oncelik-oner` | Oturum | — |
| POST | `/api/ihbar` | Oturum | — |
| GET | `/api/ihbar` | Oturum | — |
| GET | `/api/ihbar/:id` | Oturum | — |
| POST | `/api/ihbar/:id/ilk-yanit` | Oturum | — |
| POST | `/api/ihbar/:id/yetki` | Oturum | — |
| POST | `/api/ihbar/:id/mukerrerlik` | Oturum | YG-023, YG-007: kontrol tamamlanmadan ilk kayıt tamamlanmış sayılmaz; ikinci ihbar ilk dosyaya bağlanır, yat sahibine ilk dosyanın numarası bildirilir. |

### ik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ik/izin-kontrol` | Oturum | YG-1615: birim amirinden geçip İK kontrolüne gelen izinler; başlangıca kalan gün ve yıllık izinde güncel bakiye. |
| GET | `/api/ik/yetki` | Oturum | — |
| GET | `/api/ik/personel` | Oturum | — |
| POST | `/api/ik/personel/:id` | Oturum | — |
| POST | `/api/ik/parametre` | Oturum | Kıdem tavanı resmî tutardan İK Müdürü, harcırah TİD girer; sistem tutar uydurmaz. |
| POST | `/api/ik/egitim` | Oturum | YG-941, YG-944: İSG eğitimi çok tehlikeli sınıfta en az 16 saat, bir yıl geçerli; saha personeline tesis oryantasyonu. |
| POST | `/api/puantaj` | Oturum | YG-953, YG-957, YG-1492: puantaj; haftalık 45 saat üstü fazla çalışma; Ek-3 ve 270 saat sınırı; nöbette dinlenme kontrolü yok, fiilî çalışma sayılır. |
| GET | `/api/puantaj/ozet` | Oturum | — |
| GET | `/api/puantaj/bordro.csv` | Oturum | YG-953, V-1123: bordro dış aktarım dosyası; aylık puantaj özeti noktalı virgüllü CSV (Excel uyumlu, tutarlar 1.234,56 biçiminde). |
| POST | `/api/puantaj/bordro` | Oturum | — |
| POST | `/api/disiplin` | Oturum | YG-954, Yönetmelik 13–15: sözlü uyarı savunmasız kaydedilir; diğerlerinde en az 2 iş günü savunma süresi; süresinde gelmezse vazgeçilmiş sayılır. |
| GET | `/api/disiplin` | Oturum | Yönetmelik 16.1: yalnız yetkili roller. |
| GET | `/api/disiplin/benim` | Oturum | — |
| POST | `/api/disiplin/:id/savunma` | Oturum | — |
| POST | `/api/disiplin/:id/karar` | Oturum | — |
| POST | `/api/disiplin/:id/itiraz` | Oturum | — |
| POST | `/api/disiplin/:id/itiraz-karar` | Oturum | — |
| POST | `/api/istifa-bildirimi` | Oturum | YG-976: personel istifasını kendisi bildirir; bildirim zamanı kayda geçer, İnsan Kaynaklarına görev düşer. Ayrılış kaydı İK'ca imzalı istifa dilekçesiyle açılır. |
| POST | `/api/ayrilis` | Oturum | — |
| GET | `/api/ayrilis` | Oturum | — |
| GET | `/api/ayrilis/:id` | Oturum | — |
| POST | `/api/ayrilis-devir/:id` | Oturum | — |
| POST | `/api/ayrilis/:id/beyan` | Oturum | YG-932, YG-980: imza yok; personel beyanı, gizlilik okundu. |
| POST | `/api/ayrilis/:id/cihaz-onay` | Oturum | — |
| POST | `/api/ayrilis/:id/derhal-kapat` | Oturum | YG-1052: riskli ayrılış |
| POST | `/api/ayrilis/:id/tazminat` | Oturum | YG-979 |
| POST | `/api/olay/:id/is-kazasi` | Oturum | YG-981, YG-1669: iş kazası; LGM'de İK e-SGK 3 iş günü, Çözüm Ortağında belge sayacı. |
| GET | `/api/is-kazasi` | Oturum | — |
| POST | `/api/is-kazasi/:id/bilgi-gonder` | Oturum | İSG olay bilgisini İK'ya gönderir. |
| POST | `/api/is-kazasi/:id/sgk` | Oturum | — |
| POST | `/api/is-kazasi/:id/belge-iste` | Oturum | — |
| POST | `/api/firma-portal/is-kazasi/:id/belge` | Oturum | — |
| POST | `/api/yurtdisi-gorev` | Oturum | YG-1492: yurt dışı görevlendirme; harcırah TİD sabit günlük tutar, onay birim amiri ve GMY. |

### ik_plan

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ik/egitim-plani` | Oturum | Gerçekleşme: hedef rollerdeki görevdeki personelden plan yılında dersi beyanla tamamlayan (ders bağlı) veya aynı adlı eğitim kaydı bulunan (ders bağsız) oran. |
| POST | `/api/ik/egitim-plani` | Oturum | — |
| GET | `/api/ik/personel-akademi` | Oturum | YG-1615: Personel ve Akademi; sertifika geçerlilikleri (dolmuş veya 60 gün içinde dolacak, her belgenin son kaydı), zorunlu ders tamamlama ve özel gün rıza durumu (tarih gösterilmez). |
| GET | `/api/ik/yan-hak` | Oturum | — |
| POST | `/api/ik/yan-hak` | Oturum | — |
| POST | `/api/ik/yan-hak/:id/sonlandir` | Oturum | — |

### iletisim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/surum-notu` | Oturum | YG-560, YG-561: LGM içi duyuruyu Müdür ve üstü doğrudan yayımlar; dış kapsamda bir üst kademe onaylar; CEO onaysızdır. YG-1413, YG-1141: güncelleme sürüm kaydıyla birlikte sürüm notu olarak Duyuru'da yayımlanır (tüm kullanıcılar); acil platform değişikliği sonradan BT ve Firma Yönetimi Direktörü onayına sunulur. |
| GET | `/api/surumler` | Oturum | — |
| POST | `/api/duyuru` | Oturum | — |
| POST | `/api/duyuru/:id/ek` | Oturum | YG-560: ek, duyuru kaydına yüklenen belgedir; yalnız yayımlayan bağlar. |
| GET | `/api/duyuru/yetkim` | Oturum | — |
| GET | `/api/duyuru/yayimlarim` | Oturum | YG-560: okunma oranı. Hedef kitle zorunlu duyuruda kapsamdaki aktif hesaplardır. |
| GET | `/api/mesaj/kisiler` | Oturum | — |
| GET | `/api/mesaj/ic` | Oturum | — |
| POST | `/api/mesaj/ic` | Oturum | — |
| POST | `/api/mesaj/ic/okundu` | Oturum | — |
| POST | `/api/profil/kanal` | Oturum | YG-519: dış kullanıcı kanalını kendisi seçer; iş bildirimleri kapatılamaz (YG-520). |

### iletisim_bilgisi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/iletisim-bilgisi` | Oturum | — |
| POST | `/api/iletisim-bilgisi/:id/dogrula` | Oturum | — |
| POST | `/api/iletisim-bilgisi/:id/hedef` | Oturum | Eski bir değer yeniden hedef seçilirse dosya tarafındaki iletişim alanı ona döner; diğer değerler kanıt olarak kalır. |

### ilk_giris

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/ilk-giris/davet` | Oturumsuz | — |
| POST | `/api/ilk-giris/parola` | Oturumsuz | G2-1, G2-2: dil ve parola. Bağlantı burada tüketilir, ardından doğrulama uygulaması kurulumuna geçilir. |
| GET | `/api/ilk-giris/metin/:tur` | Oturum (ilk giriş adımlarında da) | Tam metin aynı ekranda açılır (KVKK-10). Kullanıcının kendi grubuna ait olmayan metin verilmez. |
| GET | `/api/ilk-giris/egitim` | Oturum (ilk giriş adımlarında da) | YG-1396 (G2-7): Çözüm Ortağı portal rehberi; imza yok, "Okudum, anladım" beyanı kaydedilir. YG-1396: gerekli eğitimler ilk giriş adımında okunur ve beyan edilir; imza alınmaz. |
| POST | `/api/ilk-giris/egitim/:id` | Oturum (ilk giriş adımlarında da) | — |
| POST | `/api/ilk-giris/rehber` | Oturum (ilk giriş adımlarında da) | — |
| POST | `/api/ilk-giris/kosullar` | Oturum (ilk giriş adımlarında da) | — |
| POST | `/api/ilk-giris/aydinlatma` | Oturum (ilk giriş adımlarında da) | — |
| POST | `/api/ilk-giris/izinler` | Oturum (ilk giriş adımlarında da) | Rıza isteğe bağlıdır; boş seçim de geçerlidir ve hizmeti etkilemez (YG-1207, KVKK-10). |

### ilk_kapsam

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/ilk-kapsam` | Oturum | — |
| POST | `/api/dosya/:id/ilk-kapsam` | Oturum | — |
| POST | `/api/dosya/:id/ilk-kapsam/:surum/kontrol` | Oturum | Teknik Uzman eksik alanları tamamlayabilir; değişiklik aynı sürüme kontrol kaydıyla işlenir, onay veya gerekçeli iade verir. |

### imza_beyani

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/imza-beyani` | Oturum | — |
| GET | `/api/imza-beyanlari` | Oturum | — |
| POST | `/api/imza-beyani/:id/onayla` | Oturum | YATONET 360 onayı: yalnız belgedeki kişi, kendi oturumundan verir. |
| POST | `/api/imza-beyani/:id/islak-imza` | Oturum | Islak imza istisnası: kişinin sistem erişimi yoksa hazırlayan, beyana yüklediği ıslak imzalı taranmış belgeyi gerekçesiyle bağlar. |

### is_emri_bag

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/is-emri-secenekleri` | Oturum | — |
| GET | `/api/is-emri/:id/izlenebilirlik` | Oturum | — |

### is_gorunumu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kalite-pano` | Oturum | YG-814–817: iş birimi iş emri; tedarik kolunda sipariş. Listeler iş emri başlangıç, kabul/teslim ve sipariş kayıtlarından oluşur. YG-1685: Kalite Kontrolörün atandığı dosyalardaki açık kontrol noktaları ve Kritik uygunsuzluklar (acil kart; kontrol noktası kapatılmaz). |
| GET | `/api/kalite/kritik-uygunsuzluklar` | Oturum | YG-1691, YG-1693: Kalite Müdürü, Müdür Yardımcısı ve Risk ve Kalite Direktörüne tüm açık Kritik uygunsuzluklar acil kart olarak (karar seviyesi; günlük izleme). |
| POST | `/api/uygunsuzluk/:id/direktor-karar` | Oturum | YG-1694: Kritik ve emniyet işaretli uygunsuzlukta Risk ve Kalite Direktörü kapanış için sorumlu birimi ve hedef tarihi "Kararı Kaydet" ile tanımlar. |
| GET | `/api/raporlarim` | Oturum | YG-1585: Raporlarım; hazırlanan teknik raporların durumu yalnız "[Makam] Kontrolünde", "Onaylandı" (son 30 gün) veya "İade Edildi" olarak gösterilir; ara onaylar ayrıca bildirilmez. |
| GET | `/api/teknik-pano` | Oturum | YG-1586, YG-1587: teknik gözetim panosu. Teknik Yönetici gözetimindeki, Teknik Müdür ve Yardımcısı tüm açık dosyaları kapsar; Teknik Uzman yükü gösterilmez. |
| GET | `/api/kalite/eksik-planlar` | Oturum | — |
| POST | `/api/dosya/:id/kalite-eksikligi-bildir` | Oturum | — |
| POST | `/api/dosya/:id/saha-sorumlusu-bildir` | Oturum | YG-1586: Teknik Yönetici Saha Sorumlusu ihtiyacını Teknik Müdüre bildirir; atama ayrı onay aranmadan Teknik Müdürdedir. |
| POST | `/api/dosya/:id/gozetim-notu` | Oturum | — |
| GET | `/api/operasyon-pano` | Oturum | YG-1582, YG-1583: Operasyon panosu. Operasyon Yöneticisi gözetimindeki dosyaları, Müdür ve Müdür Yardımcısı tüm aktif dosyaları kapsar. |
| GET | `/api/is-listeleri` | Oturum | — |
| GET | `/api/konum-plani/ben` | Oturum | YG-812: kişinin kendisi, amirleri (aynı birimde Müdür ve üstü), Operasyon ve Teknik Müdürlükleri, GMY ve CEO görür; dış kullanıcı göremez. YG-1631: kişinin kendi 7 günlük konum planı (Bugün şeridi). |
| GET | `/api/konum-plani` | Oturum | — |
| GET | `/api/dosya-haritasi` | Oturum | YG-810, YG-811: dosya haritası; konum bağlama noktasıyla eşleşir, bölge özetleri ve dosya özet kartı. Sigorta kullanıcısı yalnız kendi dosyalarını görür. |

### is_motoru

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/bugun` | Oturum | — |
| GET | `/api/takvim/gorevlerim.ics` | Oturum | YG-502: süreli kartlar son zamandan önceki 30 dakikalık olay, toplantılar kendi süresiyle kişisel takvime aktarılır. |
| POST | `/api/is/:id/karar` | Oturum | — |
| GET | `/api/bildirimler` | Oturum | YG-1626: okunmamışlar önde. |
| POST | `/api/bildirim/:id/gizle` | Oturum | — |
| POST | `/api/bildirimler/okundu` | Oturum | — |
| POST | `/api/duyuru/:id/okudum` | Oturum | YG-1632: okundu kaydı yalnız kişinin kapsamındaki duyuruya yazılır. |

### isg_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/isg/kayitlar` | Oturum | — |
| POST | `/api/isg/saglik-gozetimi` | Oturum | — |
| POST | `/api/isg/osgb` | Oturum | — |

### islak_kabul

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/is-emri/:id/islak-imza-kabul` | Oturum | — |
| POST | `/api/tedarik-siparisi/:id/islak-imza-kabul` | Oturum | — |

### islem_katalogu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/islem-katalogu` | Oturum | Kataloğu tüm LGM personeli arar. |
| GET | `/api/kartela/:kod/islemler` | Oturum | YG-858: kartela kaleminin kapsadığı işlemler, ortak tali branş kodu üzerinden. |
| POST | `/api/brans-kodu` | Oturum | Yeni kod: biçim ve üst kod veritabanı kısıtıyla doğrulanır; kaldırılmış kodun numarası yeniden verilemez (kod birincil anahtardır). |
| POST | `/api/brans-kodu/:kod/kaldir` | Oturum | — |

### isletme_gideri

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yatonet-giderleri` | Oturum | — |
| POST | `/api/yatonet-gideri` | Oturum | Tavanı aşan gider yalnız BT ve FY Direktörünce gerekçeyle girilir ve CEO onayına gider. |

### kalan

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/iade` | Oturum | YG-1499: iade (avans iadesi, fazla ödeme, itiraz sonucu) Ticari Sorumluca hazırlanır, Ticari İşler Direktörü onaylar; onayla BLD-47 yat sahibine gider. |
| GET | `/api/veri-duzeltme-alanlari` | Oturum | YG-1246: hatalı alan, doğru değer, doğru değerin kaynağı ve etkilenen dosya/işlemler yazılarak düzeltme istenir; Operasyon Müdürü onaylar; önceki değer denetim izinde korunur. |
| POST | `/api/veri-duzeltme-talebi` | Oturum | — |
| POST | `/api/dosya/:id/musteri-talimati` | Oturum | YG-437: kurumsal müşteri tarafında LGM'yi görevlendiren kayıt "Müşteri Talimatı"dır (sigortada Sigorta Görevlendirmesi; İş Emri yalnız firmaya verilen belgedir). BLD-67 kurumsal onay e-postasına gider. |
| GET | `/api/dosya/:id/malikler` | Oturum | — |
| POST | `/api/dosya/:id/malik` | Oturum | — |
| POST | `/api/dosya/:id/malik/:malik/yetkili` | Oturum | — |
| GET | `/api/sozlesme-hedef-sureleri` | Oturum | YG-147: sözleşme taahhüt süreleri Müşteri ve Paydaş İlişkileri Müdürü veya Ticari İşler Direktörünce girilir. |
| POST | `/api/sozlesme-hedef-suresi` | Oturum | — |
| GET | `/api/sozlesme-odeme-vadeleri` | Oturum | YG-900: tahsilat vadesi; sigortada şirketin bildirdiği ödeme günü (en çok 30 gün), kurumsalda sözleşme vadesi. |
| POST | `/api/sozlesme-odeme-vadesi` | Oturum | — |
| GET | `/api/sigorta-kesif-bedelleri` | Oturum | YG-1487: sigorta şirketiyle Ek-1 keşif bedeli mutabakatı; keşif bedeli proforması bu kayıttan okunur. |
| POST | `/api/sigorta-kesif-bedeli` | Oturum | — |
| GET | `/api/dosya/:id/kapanis-asamalari` | Oturum | YG-073 |
| POST | `/api/dosya/:id/saha-sorumlusu-talebi` | Oturum | YG-051, YG-052: Operasyon tarafı Saha Sorumlusu ister veya iş bitmeden geri çekilmesini ister; karar Teknik Müdürde. Kritik öncelikte atama zaten zorunludur (YG-050). |
| POST | `/api/dosya/:id/saha-sorumlusu-talebi/direktor` | Oturum | YG-051: Teknik Müdür reddederse (uygun personel yok veya anlaşmazlık) Operasyon tarafı kararı T&O Direktörüne taşır. |
| POST | `/api/teklif/:id/imzali-on-bilgi` | Oturum | — |
| POST | `/api/dosya/:id/cayma-formu` | Oturum | — |
| POST | `/api/portal/dosya/:id/cayma` | Oturum | YG-1450: yat sahibi cayma düğmesi; ONY-18 kodlu ekran açılır. |
| GET | `/api/cayma-iadeleri` | Oturum | — |
| POST | `/api/cayma/:id/iade-hesabi` | Oturum | YG-1493: Ticari Sorumlu hesaplar, TİD onaylar, MFM öder. |
| POST | `/api/cayma/:id/iade-odendi` | Oturum | — |
| POST | `/api/dosya/:id/vefat-temsilci` | Oturum | YG-1521: temsilci kaydedilince vefat askısı kalkar; kararı Hukuk ve Uyum Direktörü verir. |
| GET | `/api/dosya/:id/firma-adaylari` | Oturum | YG-304: atama listesi kapsamadan süzülür, tüm kapılar birlikte değerlendirilir; en yakın veya en ucuz otomatik seçilmez, fiyat ve mesafe sıralamaya girmez. |
| GET | `/api/portal/yetkililerim` | Oturum | — |
| POST | `/api/portal/yetkili/:id/atama` | Oturum | — |
| GET | `/api/kurumsal-kurumlar` | Oturum | — |
| GET | `/api/kurumsal-kurum/:id/ek2-taslak` | Oturum | YG-1449: Ek-2 taslağı Yetki ve Onay Sınırı kayıtlarından doldurulur: yetkili kullanıcı sözleşme muhatabı, en yüksek sınırlı Onaylayan fiyat ve ödeme ile teknik kapsam, Talep Açan teslim yetkilisi, kurum yatlarına atanmış kaptan (Yat Yetkilisi kaydı, limit), yatlar kurumun yatları. Müdür gözden geçirip gönderir. |
| POST | `/api/kurumsal-kurum/:id/ek2` | Oturum | — |
| GET | `/api/kurumsal-kurum/:id/ek2.pdf` | Oturum | — |
| GET | `/api/rapor/gorev-ayriligi` | Oturum | YG-990: gözetim raporu İç Denetim, Hukuk ve Uyum, GMY ve CEO'ya açıktır. |
| POST | `/api/is-emri/:id/alt-yuklenici-tespit` | Oturum | YG-411: sahada onaysız alt yüklenici tespiti; kayıt, Firma Yönetimi Müdürü ve Operasyon Müdürüne görev. |
| GET | `/api/firma/:id/ekipman` | Oturum | — |
| POST | `/api/firma/:id/ekipman` | Oturum | — |
| GET | `/api/kurum-belgesi` | Oturum | — |
| POST | `/api/kurum-belgesi` | Oturum | — |
| GET | `/api/takvim` | Oturum | YG-1472: resmî tatil ve arife takvimi; yıllık parametre, CEO veya GMY girer. |
| POST | `/api/takvim` | Oturum | — |
| GET | `/api/rapor/yasal-ayip.csv` | Oturum | YG-1078: dışa aktarım; görüntüleme gibi iz kaydına girer. |
| GET | `/api/dosya/:id/gonderimler` | Oturum | YG-1145: kayıt tamamlanıp dış gönderim (e-posta, SMS, WhatsApp) beklerse ya da başarısız olursa parçalar ayrı durumla görünür; hedef maskelenir. |
| GET | `/api/dosya/:id/ek-yetki` | Oturum | YG-995: dosya bazlı süreli ek erişim; dosya ekibi talep eder, Operasyon Müdürü onaylar; geniş rol verilmez. |
| POST | `/api/dosya/:id/ek-yetki` | Oturum | — |
| GET | `/api/dosya/:id/taraf-gorevleri` | Oturum | — |
| POST | `/api/dosya/:id/taraf-gorevi` | Oturum | — |
| POST | `/api/taraf-gorevi/:id/sonlandir` | Oturum | — |
| GET | `/api/dosya/:id/durum-ozeti` | Oturum | YG-539: tek görünüm. Açık iş, sahibi ve hedefi; bekleyen onayın makamı ve o makamdaki kişiler; durma nedeni (beklemede işareti, entegrasyon karantinası); eksik yat bilgisi ve zorunlu form; engelleyen işler bağımlılık olarak; sonraki işlem ilk engel, yoksa en yakın hedefli iştir. |
| POST | `/api/ag-gelistirme-onerisi` | Oturum | YG-1662 (V-1146): firması olmayan veya tek firmaya bağlı branş-bölge için Direktörün ağ geliştirme önerisi Genel Müdür Yardımcısı onayına gider. |
| GET | `/api/ag-gelistirme-onerisi` | Oturum | — |
| GET | `/api/rapor/firma-kapsama` | Oturum | YG-1660: Firma Kapsama Raporu ve aday raporu ekranda da görülür. |
| GET | `/api/saglayici-matrisi` | Oturum | — |
| POST | `/api/saglayici-matrisi` | Oturum | — |
| GET | `/api/dosya/:id/ticari-ozet` | Oturum | YG-1024: Ticari Sorumlu (ve ticari yöneticiler) dosyanın teklif, iş emri, hakediş, fatura ve teknik rapor özetini tek yerde görür. |
| GET | `/api/dosya/:id/yazismalar` | Oturum | YG-1601: dosyaya ait giden yazışmaların kopyası (ticari koldan gidenler dahil); yalnız dosyaya erişimi olan LGM personeli. |
| POST | `/api/kalici-iletim/:kart` | Oturum | YG-466: Kalıcı Saklayıcıyla İletim görevinin sahibi iletimi saklayıcı türü, teslim alan ve teslim zamanıyla kaydeder; görev kapanır. |
| GET | `/api/unvan-rol` | Oturum | YG-1017: unvan–rol eşleşmesi (LGM personeli). |
| GET | `/api/parametreler` | Oturum | YG-1367: katalogda sahip (öneren rol, YG-853) ve onaylayan (GMY uygun görüşüyle CEO) ile yürürlük tarihi ve son değişiklik gösterilir. |
| GET | `/api/ara-kademesiz-donem` | Oturum | YG-176 (KS-8): Ara Kademesiz Dönemi yalnız CEO açar ve kapatır; her değişiklik gerekçeyle geçmişe yazılır. |
| POST | `/api/ara-kademesiz-donem` | Oturum | — |
| POST | `/api/parametre/:kod` | Oturum | — |
| GET | `/api/rapor/yasal-ayip` | Oturum | YG-1078: yasal ayıp ve rücu listesi yalnız Direktör ve üstü; Müdürler göremez. |
| POST | `/api/firma/:id/on-kayit` | Oturum | YG-344: FR-SCL-001 ön kayıt alanları. |

### kalite

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/kalite-plani` | Oturum | YG-288, YG-289: plan Teknik Uzmandan; Teknik Yönetici, A sınıfında Teknik Müdür onaylar. Her gereklilik doğrulamaya bağlanır. |
| POST | `/api/gereklilik/:id/kanit` | Oturum | — |
| POST | `/api/dosya/:id/uygunsuzluk` | Oturum | YG-283, YG-388, YG-390: uygunsuzluk açılır; Kritik veya Emniyette ilgili iş derhal durur. |
| POST | `/api/uygunsuzluk/:id/tasarruf` | Oturum | YG-392, YG-388: tasarrufu Kalite Kontrolör verir; Kritik'te Olduğu Gibi Kabul engelli; son karar Kritik ve Emniyette Kalite Müdüründe. |
| POST | `/api/uygunsuzluk/:id/kok-neden` | Oturum | YG-285: kişiye veya yalnız dikkatsizliğe dayalı kök neden kabul edilmez. |
| POST | `/api/kok-neden/:id/faaliyet` | Oturum | — |
| POST | `/api/faaliyet/:id/etkinlik` | Oturum | YG-285: Etkisiz ise faaliyet sistemce yeniden açılır. |
| POST | `/api/uygunsuzluk/:id/kapat` | Oturum | YG-284, YG-393: Kalite Kontrolör düzeltmeyi doğrular; yalnız imza veya fotoğrafla kapanmaz; Majör, Kritik, yaygın veya tekrarlayanda kök neden; kapanınca durdurulan iş yeniden açılır. |
| GET | `/api/firma-portal/uygunsuzluklar` | Oturum | YG-292, YG-388: firma yalnız kendi uygunsuzluğunu görür ve yanıtlar. |
| POST | `/api/firma-portal/uygunsuzluk/:id/yanit` | Oturum | — |
| POST | `/api/is-emri/:id/kontrol-noktasi` | Oturum | YG-315, YG-383, YG-389: kontrol noktası KPnn; davet en az 24 saat, eksper veya klas 48 saat, Kritik dosyada süre aranmaz. |
| POST | `/api/kontrol-noktasi/:id/sonuc` | Oturum | — |
| GET | `/api/test/:id/pdf` | Oturum | YG-1451: RP-RAP-003 Test Kaydı standart akışta dışa gitmez; sigorta şirketi istediğinde LGM personeli PDF'i üretir. |
| POST | `/api/olcum-cihazi` | Oturum | — |
| GET | `/api/olcum-cihazi` | Oturum | YG-1691: kalibrasyon envanteri; geçerlilik sonu = kalibrasyon tarihi + aralık; süresi geçen, 60 gün içinde dolan ve karantinadaki cihaz ayrıca işaretlenir. |
| POST | `/api/olcum-cihazi/:id/ara-dogrulama` | Oturum | YG-402: kritik cihazın ara doğrulaması kaydedilir. |
| POST | `/api/dosya/:id/test` | Oturum | YG-286, YG-396, YG-397: ölçüt test açılırken kilitlenir; cihaz kalibrasyonu; yeniden test yeni numara; hazırlayan, kontrol eden ve karar veren ayrı. |
| POST | `/api/test/:id/sonuc` | Oturum | — |
| POST | `/api/test/:id/kontrol` | Oturum | — |
| POST | `/api/test/:id/karar` | Oturum | — |
| POST | `/api/is-emri/:id/kosullu-kabul` | Oturum | YG-287, YG-290: koşullu kabul en geç 30 gün; Kalite Müdürü bir kez 15 gün uzatır; çekince açık iş kalemine bağlanır. |
| GET | `/api/dosya/:id/kosullu-kabuller` | Oturum | — |
| POST | `/api/kabul/:id/uzatma-talebi` | Oturum | — |
| POST | `/api/kabul/:id/uzat` | Oturum | — |
| POST | `/api/acik-is/:id/kapat` | Oturum | — |
| GET | `/api/dosya/:id/garanti` | Oturum | YG-400, YG-401: birden çok sistem grubunda test varsa bütünleşik test olmadan nihai kabul yok; garanti Nihai Kabulle başlar. YG-082, YG-870 (KS-1): garanti dosyada Dosya Sorumlusunun açık kararıyla tanımlanır; 12 ay yalnız önerilen değerdir. |
| POST | `/api/dosya/:id/garanti` | Oturum | — |
| POST | `/api/dosya/:id/nihai-kabul` | Oturum | — |
| POST | `/api/is-emri/:id/izin-gerekli` | Oturum | YG-371, YG-372, YG-373, YG-374, YG-375, YG-1432: izni firma tesisten alır, belgesini yükler; LGM düzenlemez, onaylamaz, yalnız görür. En fazla 12 saat geçerli. |
| POST | `/api/firma-portal/is-emri/:id/calisma-izni` | Oturum | — |
| POST | `/api/firma-portal/calisma-izni/:id/kapat` | Oturum | — |
| GET | `/api/dosya/:id/kalite` | Oturum | — |

### kalite_disiplin

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kalite/eksik-kontrol-kayitlari` | Oturum | — |
| GET | `/api/kalite/takvim` | Oturum | YG-1685: Kalite Uzmanı takvimi (7 gün): kontrolörü olduğu dosyalarda kontrol noktaları ve tanıklıklar, katıldığı TPL-07/08/09 toplantıları; bekleyen garanti yeniden doğrulamaları. |
| GET | `/api/kalite/veri-dogrulama` | Oturum | — |
| POST | `/api/kalite/veri-dogrulama/:id/tamamlatma-iste` | Oturum | — |
| POST | `/api/kalite/eksik-kontrol-kaydi/:id/duzeltme-iste` | Oturum | — |

### kapanis_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/kapanis-ozeti/yeniden` | Oturum | — |
| GET | `/api/dosya/:id/zorunlu-formlar` | Oturum | — |
| POST | `/api/dosya/:id/zorunlu-form-istisnasi` | Oturum | Ek II: kullanılmayan zorunlu form için Dosya Sorumlusu gerekçeli istisna ve eşdeğer kontrolü kaydeder; kayıt değişmez. |
| GET | `/api/dosya/:id/performans` | Oturum | YG-785: hedef ve gerçekleşen süreler kayıttan gelir; müşteri kararı, erişim ve üçüncü taraf beklemesi düşülür. |
| POST | `/api/dosya/:id/performans` | Oturum | YG-786: Kalite Kontrolör değerlendirir, Kalite Müdürü onaylar; dosya başına bir değerlendirme. |

### kapasite

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kapasite` | Oturum | — |

### kapasite_istisnasi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/kapasite-istisnasi` | Oturum | — |
| GET | `/api/kapasite-istisnasi` | Oturum | — |
| POST | `/api/kapasite-istisnasi/:id/karar` | Oturum | — |

### kapsam_toplantisi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/kapsam-toplantisi` | Oturum | — |
| POST | `/api/dosya/:id/kapsam-toplantisi` | Oturum | YG-1598: Dosya Sorumlusu önerilen (veya seçtiği) zamanı onaylar; toplantı kontrol listesiyle açılır. Saha Sorumlusu varsa görüntülü katılır. |
| POST | `/api/kapsam-toplantisi/:id/karar` | Oturum | YG-1598: kararı Dosya Sorumlusu toplantı sırasında girer ve aktarım hedefini seçer; sorumlu hedefe göre sistemce belirlenir. |

### karar_kontrol

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/is/:id/karar-kontrolleri` | Oturum | — |

### karne

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-portal/karne` | Oturum | YG-351: firma kendi puanını ve boyut dökümünü görür; risk derecesi önerisini görmez. |
| POST | `/api/firma-portal/karne/:id/itiraz` | Oturum | K-193, YG-425: puan itirazı; geçmiş silinmez. |
| GET | `/api/firma/:id/karne` | Oturum + izin: firma.kayit | YG-794: öneri yalnız yetkili LGM rolüne; nihai risk derecesi Firma Statü Kararı ile verilir. |
| GET | `/api/karne-parametre` | Oturum | — |
| POST | `/api/karne-parametre` | Oturum | — |

### kartela_norm

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kartela/norm` | Oturum | — |
| POST | `/api/kartela/taslak/norm` | Oturum | — |

### katalog_ad_farki

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ana-veri/test-suphesi` | Oturum | YG-1259, TZ-4 (CEO 26.11.2026): şüpheli test kayıtları; Sicil Sorumlusu "Ayıklandı" (listelerden çıkar, silinmez) veya "Gerçek Kayıt" der. |
| POST | `/api/ana-veri/test-suphesi/:tur/:id` | Oturum | — |
| GET | `/api/ana-veri/ad-farki` | Oturum | — |
| POST | `/api/ana-veri/ad-farki/:seri/:no` | Oturum | Teyit: aday veya aranıp bulunan model seçilir; katalog seri/no modele bağlanır ve durum fotoğraf/teknik varlığından kendiliğinden hesaplanır. |

### kayit_birlestirme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/birlestirme/turler` | Oturum | — |
| GET | `/api/birlestirme/ara` | Oturum | — |
| GET | `/api/birlestirme/onizleme` | Oturum | Önizleme: çelişen alanlar ve taşınacak ilişkiler kararı verecek kişiye gösterilir. |
| POST | `/api/birlestirme` | Oturum | — |
| POST | `/api/birlestirme/:id/geri-al` | Oturum | — |
| GET | `/api/birlestirme` | Oturum | — |
| GET | `/api/birlestirme/yonlendir/:tur/:id` | Oturum | Eski kimlik yönlendirmesi: birleştirilmiş kayda gelen istek ana kayda yönlendirilir. |

### kesif_talebi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/kesif-talebi` | Oturum | Hazır talep: iş emri formuna yer ve kapsam dolu gelir; Operasyon Yöneticisi düzeltebilir. |

### kesinti

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kesinti` | Oturum | — |
| POST | `/api/kesinti` | Oturum | Kesinti hemen açılır; olağan dışı istisna BT ve Firma Yönetimi Direktörü onayıyla açılır. |
| POST | `/api/kesinti/:id/referans` | Oturum | Benzersiz geçici referanslar kesinti boyunca kullanılmak üzere kişiye üretilir (GR-YYYY-NNNNN); yeniden verilmez. |
| POST | `/api/gecici-referans/:id/geri-giris` | Oturum | Sisteme geri giriş: kanal, yetkili kişi, asgari veri, saklama yeri ve ana dosya bağı zorunlu. |
| POST | `/api/kesinti/:id/kapat` | Oturum | — |

### kilit_rol

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kilit-rol` | Oturum | — |
| POST | `/api/kilit-rol/talep` | Oturum | — |

### kilometre

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/kilometre` | Oturum | — |
| POST | `/api/dosya/:id/kilometre` | Oturum | — |
| POST | `/api/kilometre/:id` | Oturum | Baz tarih değişmez; güncel tarih baz tarihi aşarsa üç açıklama zorunludur. |

### kimlik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/kimlik/giris` | Oturumsuz | — |
| GET | `/api/kimlik/kurulum` | Oturumsuz | Doğrulama uygulaması ilk kurulumu. Kurulu hesapta çalışmaz: faktör değişimi hesap kurtarma sürecindedir (YG-1156). |
| POST | `/api/kimlik/sms` | Oturumsuz | — |
| POST | `/api/kimlik/dogrula` | Oturumsuz | — |
| POST | `/api/kimlik/cikis` | Oturum (ilk giriş adımlarında da) | — |
| POST | `/api/kimlik/parola` | Oturum | — |

### kislik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/kislik` | Oturum | — |
| POST | `/api/dosya/:id/kislik` | Oturum | — |

### kontrol_listesi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kontrol-listesi-kodlari` | Oturum | — |
| GET | `/api/kontrol-listesi/:id` | Oturum | — |
| GET | `/api/kontrol-listesi/:id/pdf` | Oturum | Durum tablosu: Evet yeşil, Hayır kırmızı, Uygulanmaz renksiz; iç kayıttır. |

### kritik_bulgu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/kritik-bulgular` | Oturum | — |
| POST | `/api/bulgu/:id/kritik-karar` | Oturum | — |

### kurtarma_mali

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/kurtarma/:id/saglayici-faturasi` | Oturum | — |
| POST | `/api/kurtarma-saglayici-faturasi/:id/odendi` | Oturum | Ödeme kaydı Muhasebe ve Finans Müdürünce, faturayı kaydedenden başka kişi tarafından girilir; mahsup kaydı LGM fiyatıyla birlikte tutulur. |
| GET | `/api/dosya/:id/kurtarma-mali` | Oturum | — |

### kurtarma_sonuc

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-portal/kurtarma/:id/sonuc` | Oturum | — |
| POST | `/api/firma-portal/kurtarma/:id/talimat` | Oturum | YG-275: Sahil Güvenlik veya liman talimatı hızlı kaydedilir, Sapma / Talimat satırına geçer. |
| POST | `/api/firma-portal/kurtarma/:id/sonuc` | Oturum | — |
| GET | `/api/dosya/:id/kurtarma-sonuc` | Oturum | — |
| POST | `/api/kurtarma/:id/sonuc-kontrol` | Oturum | — |

### kurum_hesap

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kurum/hesap` | Oturum | YG-425, YG-1574, YG-1575, YG-1577: firma bilgileri ve kullanıcılar; kurum yalnız kendini görür. |
| POST | `/api/kurum/banka` | Oturum | YG-928, YG-1272: yeni hesap karantinada başlar; sicildeki numaradan geri aranıp Muhasebe ve Finans Müdürü teyit etmeden geçerli olmaz. |
| POST | `/api/kurum/bilgi-degisikligi` | Oturum | — |
| POST | `/api/kurum/kabul-itiraz` | Oturum | K-178, YG-425: ağa kabul kararına 15 gün içinde bir kez itiraz. |
| GET | `/api/kurum-kabul-itirazlari` | Oturum | — |
| POST | `/api/kurum-kabul-itirazi/:id/karar` | Oturum | — |
| GET | `/api/firma-portal/cari` | Oturum | YG-422, K-193: cari ekstre portalda; firma yalnız kendi hakedişini görür, müşteri adı ve müşteri fiyatı yazmaz. |
| GET | `/api/dosya/:id/tedarik-suresi` | Oturum | YG-202: gerçekleşen teslimlerden parça bazında ortalama tedarik süresi; Dosya Sorumlusu teklifte tahmini süre olarak görür. |
| POST | `/api/kurum/kullanici` | Oturum | — |
| POST | `/api/dis-kullanici/:id/ayrilis-bildirimi` | Oturum | YG-1053: dış taraf ayrılışı veya görev değişikliğini e-posta/telefon/yazıyla bildirdiyse Sicil Sorumlusu veya Müşteri ve Paydaş İlişkileri Müdürü kaydeder; hesap hemen kapanır, bildirim zamanı ve kanalı tutulur. |
| POST | `/api/kurum/kullanici/:id/kapat` | Oturum | YG-1004: kurum bildirdiğinde hesap hemen kapanır, oturumları biter; Sicil Sorumlusu 24 saat içinde kaydı gözden geçirir. Hesap yeni temsilciye devredilmez. |
| GET | `/api/tedarikci-odemeleri` | Oturum | YG-845: tedarikçi ödemesi tahsilattan bağımsız, faturadan 60 gün vadeli planlanır; üçlü eşleşme tamamlanmadan ödenmez. |
| GET | `/api/odeme-plani` | Oturum | YG-845: 60 gün vadeli ödeme planı; tedarikçi faturaları ile kurtarma, çekme ve dalış sağlayıcı faturaları müşteri tahsilatından bağımsız vadeye göre. |
| POST | `/api/tedarikci-odemeleri/:id/odendi` | Oturum | — |

### kurum_talebi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/iletisim/kurum-talebi` | Oturumsuz | Herkese açık; aynı adresten 24 saatte yinelenen talep yeni görev açmaz, yanıt aynıdır. |
| GET | `/api/kurum-talebi` | Oturum | — |
| POST | `/api/kurum-talebi/:id/yonlendir` | Oturum | — |
| POST | `/api/kurum-talebi/:id/karar` | Oturum | YG-1701 (A53-S1): sigorta şirketi, broker, acente ve kurumsal müşteri talebinde Müşteri ve Paydaş İlişkileri Müdürü "Kararı Kaydet"; hesap açılacaksa davet kendiliğinden gider. |
| POST | `/api/kurum-talebi/:id/sonuc` | Oturum | — |

### kurumsal

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/kurumsal-kurum` | Oturum | Kurumu ve ilk yetkiliyi A53 Müşteri ve Paydaş İlişkileri Müdürü tanımlar; sınır Ek-2'den gelir. |
| GET | `/api/kurumsal/kullanicilar` | Oturum | — |
| POST | `/api/kurumsal/kullanici` | Oturum | YG-1563: onay adımı yok; Müşteri ve Paydaş İlişkileri Müdürüne bilgi gider. |
| POST | `/api/kurumsal/kullanici/:id/kapat` | Oturum | YG-1004: kurumdan ayrılan kişinin hesabı kapatılır, yeni temsilciye devredilmez. |

### kurumsal_rapor

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kurumsal/filo` | Oturum | Portal filo panosu ve gönderilmiş raporlar; yalnız kendi kurumunun kaydı. |
| GET | `/api/kurumsal/rapor/:id` | Oturum | — |
| POST | `/api/kurumsal/rapor/:id/itiraz` | Oturum | — |

### kvkk

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kvkk/saklama-plani` | Oturum | YG-1224: saklama planı; veri grubu, iş amacı, bilgi sınıfı, süre, başlangıç olayı, sorumlu ve imha yöntemi (LGM personeline açık). |
| GET | `/api/kvkk/yetki` | Oturum | — |
| POST | `/api/veri-ihlali` | Oturum | YG-1201: her kullanıcı bildirebilir. |
| GET | `/api/veri-ihlali` | Oturum | — |
| POST | `/api/veri-ihlali/:id/degerlendir` | Oturum | YG-1201: HUD üst yönetimi bilgilendirir. |
| POST | `/api/veri-ihlali/:id/bulgu` | Oturum | YG-1204: sürümlü bulgu. |
| POST | `/api/veri-ihlali/:id/bildirim-karari` | Oturum | — |
| POST | `/api/veri-ihlali/:id/kurul-bildirimi` | Oturum | YG-1202, YG-1203 |
| POST | `/api/veri-ihlali/:id/ilgili-kisi-bildirimi` | Oturum | — |
| POST | `/api/veri-ihlali/:id/kapat` | Oturum | YG-1203: kanıtlı düzeltme olmadan kapanmaz. |
| POST | `/api/kvkk-basvuru` | Oturum | — |
| GET | `/api/kvkk-basvuru` | Oturum | — |
| POST | `/api/kvkk-basvuru/:id/dogrula` | Oturum | — |
| POST | `/api/kvkk-basvuru/:id/arama` | Oturum | YG-1220 |
| POST | `/api/kvkk-basvuru/:id/karar` | Oturum | YG-1218: hazırlayan ile onaylayan farklı. |
| POST | `/api/kvkk-basvuru/:id/yanit` | Oturum | — |
| POST | `/api/hukuki-koruma` | Oturum | YG-1231: hukuki koruma. |
| GET | `/api/hukuki-koruma` | Oturum | — |
| POST | `/api/hukuki-koruma/:id/kaldir` | Oturum | — |
| GET | `/api/imha-listesi` | Oturum | — |
| POST | `/api/imha-kalemi/:id/cikar` | Oturum | — |
| POST | `/api/imha-listesi/:id/birime-gonder` | Oturum | — |
| POST | `/api/imha-listesi/:id/birim-onay` | Oturum | — |
| GET | `/api/imha-listesi/:id/tutanak` | Oturum | YG-1232: tutanak; imha kayıtları 3 yıl saklanır. |
| GET | `/api/saklama-plani` | Oturum | — |

### lehtar_muvafakat

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/lehtar-muvafakat.pdf` | Oturum | Örnek yazıyı Dosya Sorumlusu lehtara gönderir; gelen muvafakat belgesi /dosya/:id/muvafakat ile girilir. |

### mali_kontrol

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/mali-kontrol` | Oturum | Kontrol Uyarıları: 24 saati aşan, cariye eşleşmemiş banka hareketi; fatura kuru ile kayıtlı TCMB satış kuru arasında fark. |
| POST | `/api/mali-kontrol/eslestir/:id` | Oturum | — |

### marka_model

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/yat/marka-model/yenile` | Oturum | — |
| GET | `/api/yat/marka-model/aktarimlar` | Oturum | — |

### master_plan

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/master-plan` | Oturum | YG-776: CEO ve GMY tüm kartları, muhatap rol kendi kartlarını görür; faz ve muhatap özeti. |
| POST | `/api/master-plan/:no` | Oturum | — |
| GET | `/api/uyum-matrisi` | Oturum | YG-1551: matris program içinden yönetilir; her değişiklik önceki ve sonraki değerle geçmişe yazılır; Excel'e dışa aktarma. |
| POST | `/api/uyum-kurali` | Oturum | — |
| GET | `/api/uyum-matrisi/excel` | Oturum | — |

### memnuniyet

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/anket/:b` | Oturumsuz | Giriş gerektirmez; belirteç dışında bilgi döndürmez, firma adı yer almaz. |
| POST | `/api/anket/:b` | Oturumsuz | — |
| GET | `/api/anket-gorusme` | Oturum | — |
| POST | `/api/anket-gorusme/:id` | Oturum | — |
| GET | `/api/gorev-tanimim` | Oturum | YG-973: personel kendi rolünün görev tanımını görür; karne göstergeleri Karnem ekranındadır. |

### menfaat_masraf

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/firma-portal/is-emri/:id/menfaat-bildirimi` | Oturum | YG-412: firma kaptan veya mürettebattan gelen menfaat talebini bildirir; kayıt yalnız Hukuk ve Uyum Direktörüne görünür. |
| GET | `/api/menfaat-bildirimleri` | Oturum | — |
| GET | `/api/masraf/asil-bekleyen` | Oturum | YG-1622: Muhasebe ve Finans Yöneticisi kâğıt fişin aslını teslim aldığını kaydeder. |
| POST | `/api/masraf/:id/asil-teslim` | Oturum | — |

### mobil

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/mobil/surum` | Oturumsuz | YG-498 YG-490: sürüm kontrolü oturum açılmadan yapılır (eski uygulama giriş ekranına gelmeden durdurulur). Değerleri Sistem Yöneticisi girer. |
| POST | `/api/mobil/surum` | Oturum | — |
| POST | `/api/mobil/cihaz` | Oturum | — |
| GET | `/api/mobil/cihazlarim` | Oturum | — |
| POST | `/api/mobil/cihaz/:id/kayip` | Oturum | — |
| POST | `/api/mobil/esitle` | Oturum | YG-494: kuyruktaki kayıt asıl yolundan aynı oturumla işlenir; tekrar gönderim yinelenmez; nesne değiştiyse sunucu kaydı esas alınır. |
| GET | `/api/mobil/cakismalar` | Oturum | — |
| POST | `/api/mobil/cakisma/:id/karar` | Oturum | — |
| POST | `/api/mobil/izin` | Oturum | YG-500: izin aydınlatmayla istenir; yalnız iş amaçlı; izin olmadan konum alınmaz. |
| POST | `/api/mobil/saha-konum` | Oturum | — |
| POST | `/api/hesabim/kapatma-talebi` | Oturum | YG-492: hesap kapanır; dosya kayıtları yasal süre korunur. LGM personeli ayrılış akışına tabidir. |
| GET | `/api/iletisim/ret` | Oturumsuz | YG-484: ret bağlantısı oturum istemez; imza kişiye ve kanala özeldir. İYS geri alması aynı işlemi yapar (entegrasyon anahtarıyla). |
| POST | `/api/iletisim/iys-ret` | Oturumsuz | — |
| GET | `/api/yetkilerim` | Oturum | YG-1561, YG-1566: Yetkilerim; onay adımı yok, belge kontrolünü Müşteri ve Paydaş İlişkileri Müdürü yapar. |
| POST | `/api/yetkilerim/belge` | Oturum | — |
| POST | `/api/yat-yetkilisi/:id/dogrula` | Oturum | — |

### nakit_karlilik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/nakit-tahmini` | Oturum | — |
| POST | `/api/nakit-gider-plani` | Oturum | — |
| POST | `/api/nakit-gider-plani/:id/kapat` | Oturum | — |

### neden_metni

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/neden` | Oturum | Ekranlardaki Neden? bağlantısı: yalnız yürürlükteki metin; yoksa bağlantı gösterilmez. |
| GET | `/api/neden-metinleri` | Oturum | Yönetim: sistemdeki onay iş türleri ve metin durumları. |
| POST | `/api/neden-metni` | Oturum | — |

### odeme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-odemeleri` | Oturum | — |
| GET | `/api/odeme-listesi/:id/on-kontrol` | Oturum | YG-1611: ödeme listesi ön kontrolü; kalem başına fatura no, cari, plan (vade), brüt, mahsup, tutulan ve net tutar ile eksik fatura no ve onaysız banka hesabı uyarısı. |
| POST | `/api/odeme-listesi` | Oturum | YG-830: mükerrerlik uyarısı çözülmeden liste onaya gitmez. |
| POST | `/api/odeme-talimati/:id/acil` | Oturum | YG-833: listeyi ve plan tarihini beklemeyen ödeme; en çok 5.000,00 EUR, sırayla GMY ve Muhasebe ve Finans Müdürü. |
| POST | `/api/firma-odemeleri/:id/odendi` | Oturum | YG-830, YG-827, V-131: banka referansıyla kayıt; başarısız ödeme borcu kapatmaz, kayıt yalnız gerçekleşince girilir. |
| POST | `/api/dosya/:id/mahsup` | Oturum | YG-840, YG-1418, YG-353: belgeli mahsup önerisi; onaydan sonra firmanın sonraki ödemesinden düşülür. |
| POST | `/api/is-emri/:id/malzeme-avansi` | Oturum | YG-842: firmaya malzeme avansı yalnız müşteriden tahsil edilen tutar kadar; onay TİD (YG-1613). |

### odeme_takvimi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/odeme-takvimi` | Oturum | — |
| POST | `/api/odeme-takvimi/kalem` | Oturum | Vergi, SGK ve diğer dönemsel ödemeler vadesiyle elle girilir; vade iş günü değilse sonraki iş gününe kayar. |
| POST | `/api/odeme-takvimi/kalem/:id/odendi` | Oturum | — |

### on_degerlendirme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/on-degerlendirme` | Oturum | — |
| POST | `/api/dosya/:id/on-degerlendirme` | Oturum | — |
| POST | `/api/dosya/:id/on-degerlendirme/:surum/kalite-kontrol` | Oturum | YG-038: kalite kontrolü olumlu ise rapor Onaylı olur; olumsuzsa gerekçe zorunludur ve rapor Onaylı işaretlenemez (düzeltme yeni sürümle yapılır). |

### onay

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/onay/:belirtec` | Oturumsuz | YG-1433: uygulama kurmadan bağlantı + kodla. Bağlantıyı açan yalnız kendisine gönderilen ekranı görür. |
| POST | `/api/onay/:belirtec/kod` | Oturumsuz | — |
| POST | `/api/onay/:belirtec/karar` | Oturumsuz | YG-466, YG-1507: tek düğme + kod. Zorunlu kutu işaretlenmeden onay verilmez. Onay belgenin bu sürümüne bağlanır. |

### onay_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/hasar-no` | Oturum | YG-450: hasar dosya numarası ihbarla veya sonradan girilir. |
| POST | `/api/teklif/:id/otomatik-kabul-geri` | Oturum | YG-062: süre dolumuyla verilen kabulü yetkili geri alır; iş emri açılmışsa geri alınmaz. |
| POST | `/api/teklif/:id/ret-secenegi` | Oturum | YG-150, K-172: sigortanın onaylamaması yalnız ödeme kararıdır; yat sahibine devam, kapanış veya devir sorulur. |
| POST | `/api/teklif/:id/onaylanmayan-teklif` | Oturum | YG-206, K-172: sigortanın onaylamadığı kalemlerden yat sahibine ayrı teklif; kalemler silinmez, ana teklif değişmez. |
| POST | `/api/teklif/:id/kosul` | Oturum | YG-157: koşul eylem, sorumlu, süre ve gerçekleşmezse sonuçla kaydedilir. |
| GET | `/api/dosya/:id/kosullar` | Oturum | — |
| POST | `/api/teklif-kosulu/:id/kapat` | Oturum | — |
| POST | `/api/teklif-kosulu/:id/risk-kabulu` | Oturum | — |
| POST | `/api/dosya/:id/kesin-teslim` | Oturum | YG-215: kesin teslim tarihi ve gecikme bedeli GMY onayıyla iş emrine yansır. |
| POST | `/api/dosya/:id/degisiklik` | Oturum | YG-225, YG-226: her değişiklik ayrı kayıt; YATONET onayı, e-imza veya ıslak imza; sigorta onayı alanı. |
| GET | `/api/dosya/:id/degisiklikler` | Oturum | — |
| POST | `/api/dosya/:id/yurt-disi` | Oturum | YG-1461: yurt dışı işareti Hukuk ve Uyum izin kontrolü görevini açar. |
| GET | `/api/yurt-disi-uygunluk/bekleyen` | Oturum | — |
| POST | `/api/dosya/:id/yurt-disi-uygunluk` | Oturum | — |
| POST | `/api/bulgu/:id/sigorta-bildirimi` | Oturum | YG-454: bildirim yapıldığında zaman kaydedilir. |
| GET | `/api/mutabakat` | Oturum | YG-456: rapor listesi, gönderim ve satır itirazı. E-posta metni onaylanana kadar gönderim yalnız kayda geçer. |
| GET | `/api/sigorta/mutabakat` | Oturum | YG-1571: sigorta şirketi kendi şirketine gönderilmiş aylık mutabakat raporlarını görür (firma adı içermez). |
| POST | `/api/mutabakat/:id/gonder` | Oturum | — |
| POST | `/api/mutabakat-satiri/:id/itiraz` | Oturum | — |
| GET | `/api/firma-teklif/:id/kalemler` | Oturum | YG-189: firma kaynaklı hatada kalem firmaya iade; LGM kaynaklı hatada firma belgesine dayalı düzeltme, Müdür onayı. |
| POST | `/api/firma-kalem/:id/iade` | Oturum | — |
| POST | `/api/firma-portal/fiyat-kalem/:id/duzelt` | Oturum | — |
| POST | `/api/firma-kalem/:id/lgm-duzeltme` | Oturum | — |
| POST | `/api/teklif/:id/kurumsal-eposta-onay` | Oturum | YG-208: kurumsal müşteride Ek-2 kurumsal e-postadan gelen onay; gönderen kurumun Onaylayan kullanıcısı olmalı, sınır aşılmamalı. |

### onay_kaydi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/onay-kayitlari` | Oturum | — |

### oz_denetim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/oz-denetim` | Oturum | — |
| POST | `/api/oz-denetim` | Oturum | Sürüm öncesi ve kural/parametre değişikliği sonrası çalışma elle başlatılır; çalışma arka planda sürer. |

### ozel_gun

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ozel-gunler` | Oturum | — |
| POST | `/api/haber-duyurusu` | Oturum | YG-946: evlilik, doğum ve vefat haberi yalnız çalışanın kendi talebiyle, yalnız LGM personeline 7 gün duyurulur; yaş ve özel ayrıntı istenmez. |
| POST | `/api/ozel-gunler/dogum-gunu` | Oturum | Doğum günü yalnız gün ve ay olarak, yalnız rıza veren personelin kendisince girilir. |

### personel_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/personel-ek` | Oturum | — |
| POST | `/api/zimmet` | Oturum | YG-974: imza yok; personelin beyanı zimmet kaydıdır. |
| POST | `/api/zimmet/islak-imza` | Oturum | YG-223: sistem erişimi yoksa ıslak imza istisnası; taranmış belge personel kaydına bağlıdır, kaydeden ayrıca tutulur. |
| POST | `/api/zimmet/:id/iade` | Oturum | — |
| POST | `/api/nobet-serbest-zaman` | Oturum (ilk giriş adımlarında da) | YG-956: nöbet ek ücret doğurmaz; gece fiilen çalışılmışsa ertesi düzeni birim amiri belirler. |
| POST | `/api/personel-ozel-gun` | Oturum | YG-947: rıza geri alınınca evlilik tarihi silinir. |

### personel_karne

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/personel-karne` | Oturum | — |
| GET | `/api/personel-karne/bagli` | Oturum | — |
| POST | `/api/personel-karne/yonetici-puani` | Oturum | YG-960: doğrudan üst makam dönem kapanmadan yönetici puanını girer. |
| POST | `/api/personel-karne/donem-kapat` | Oturum | — |
| POST | `/api/personel-karne/degerlendirme` | Oturum | YG-962, YG-971: üç aylık görüşme ve yıllık değerlendirme doğrudan üst makamca kaydedilir; yıllıkta eğitim ve gelişim ihtiyacı zorunludur. |
| POST | `/api/personel-karne/itiraz` | Oturum | YG-967, YG-968: yalnız karnenin sahibi, kapanıştan itibaren 10 iş günü içinde itiraz eder; bir üst makam karar verir. |
| GET | `/api/personel-karne/itiraz-bekleyen` | Oturum | — |
| POST | `/api/personel-karne/itiraz/:id/karar` | Oturum | — |
| POST | `/api/personel-karne/agirlik` | Oturum | YG-963: ağırlık değişikliğini rolün üst makamı (Süreç Sahibi) önerir, CEO onaylar; rol toplamı 100 olmalıdır. |

### portal

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/belge-listesi` | Oturum | YG-1439 |
| POST | `/api/kayit/kod` | Oturumsuz | Y1: telefon → kod → bilgiler. Var olan numarada yanıt aynıdır; hesap açma son adımda reddedilir. |
| POST | `/api/kayit/tamamla` | Oturumsuz | — |
| POST | `/api/kimlik/telefon` | Oturumsuz | YG-463: parolası olmayan yat sahibi telefon ve SMS koduyla girer. Yanıt hesabın varlığını açık etmez. |
| POST | `/api/dosya/:id/muvafakat` | Oturum | YG-1449: muvafakati yat sahibi değil Dosya Sorumlusu girer; ONY-13 durumu yat sahibine görünür. |
| GET | `/api/portal/ara` | Oturum | YG-1565: Onayınızı Bekleyenler, Dosyalarım. YG-459: firma, maliyet ve iç yazışma yoktur. YG-1374: yat sahibi, temsilci ve kurumsal kullanıcı yalnız kendi dosyalarında dosya no ve yat adıyla arar. |
| GET | `/api/portal/ana` | Oturum | — |
| GET | `/api/portal/dosya/:id/ilerleme-raporu` | Oturum | YG-460: RP-RAP-001 İlerleme Raporu (PDF) yat sahibinin kendi dosyası için. |
| GET | `/api/portal/belgelerim` | Oturum | YG-1566, YG-1565: Belgelerim; kullanıcının (yetkilide yetki kapsamındaki) dosyalarının yürürlükteki belgeleri, Kritik sınıf hariç. |
| GET | `/api/portal/dosya/:id` | Oturum | — |
| POST | `/api/portal/onay/:id/ac` | Oturum | Portal kullanıcısının bekleyen onayı: bağlantıyı kaybetse de hesabından açar (YG-465). |
| POST | `/api/portal/ihbar` | Oturum | YG-011, YG-1553, YG-1562: portal kısa formu; hasar içerikli talep Operasyona düşer. YG-485: aydınlatma ilk girişte onaylandı. |

### portallar

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/tesis-talebi` | Oturum | YG-1447: tesis işlemini Dosya Sorumlusu açar. İlk talepte BLD-23 teslim ve taşıma kısıtı tesise gider. |
| GET | `/api/dosya/:id/tesis-talepleri` | Oturum | — |
| POST | `/api/tesis-talebi/:id/yazisma` | Oturum | YG-1447: firmadan veya tesisten gelen yazışmanın hızlı girişi; durum ve hedef tarih değişir, yazışma kaydı tutulur. |
| GET | `/api/tesis-talebi/:id/firmaya-sor` | Oturum | MTN-8 (CEO 26.11.2026): "Firmaya sor" hazır mesajı (BLD-107); dosyadaki açık iş emri firmasının kurumsal telefonuna Dosya Sorumlusunun WhatsApp'ından gönderilir. |
| GET | `/api/tesis-talebi/:id/yazismalar` | Oturum | — |
| GET | `/api/dosya/:id/firma-belge-uyarilari` | Oturum | YG-1447: dosyada açık iş emri olan firmanın son sicil belgesi süresi dolmuş veya 30 gün içinde doluyorsa uyarı. |
| GET | `/api/tesis-listesi` | Oturum | — |
| GET | `/api/tesis-portal/ana` | Oturum | YG-297, YG-1575: firma unvanı, müşteri fiyatı, firma maliyeti ve teknik dosya görünmez. Onaylı işler "Onaylı" yazar. |
| POST | `/api/tesis-portal/talep/:id/yanit` | Oturum | — |
| POST | `/api/tesis-portal/dosya/:id/teslim-talebi` | Oturum | YG-417: Teslim Talebi düğmesi; karar Dosya Sorumlusundadır. |
| POST | `/api/tesis-portal/kayit` | Oturum | — |
| POST | `/api/tesis-portal/fatura` | Oturum | — |
| POST | `/api/dosya/:id/teklif-talebi` | Oturum | Teklif talebi Tedarik Sorumlusundan; dosya kimliği ve müşteri tedarikçiye görünmez (YG-298). |
| GET | `/api/dosya/:id/tedarik-satirlari` | Oturum | — |
| GET | `/api/dosya/:id/teklif-talepleri` | Oturum | — |
| GET | `/api/tedarikci-portal/ana` | Oturum | YG-298, YG-1088, YG-1577: yalnız kendi kayıtları; müşteri ve dosya içeriği yoktur. |
| POST | `/api/tedarikci-portal/talep/:id/yanit` | Oturum | — |
| POST | `/api/tedarikci-portal/siparis/:id/yanit` | Oturum | YG-1577: kabul teslim tarihi ve onay koduyla (V-68: firma ile aynı doğrulama kodu). |
| POST | `/api/tedarikci-portal/siparis/:id/sevk` | Oturum | — |
| POST | `/api/tedarikci-portal/siparis/:id/fatura` | Oturum | — |

### problem

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/problem-kayitlari` | Oturum | — |
| POST | `/api/problem-kaydi` | Oturum | YG-1286: olay kapanışı problemi kapatmaz; problem ayrı kapanır. |
| POST | `/api/problem-kaydi/:id/kapat` | Oturum | — |
| POST | `/api/sistem-bulgusu` | Oturum | YG-1293: aynı kök nedenli bulgular ilişkilidir; kapanış bağımsız doğrulama ister; istisna süreli, kalan risk kayıtlıdır. |
| POST | `/api/sistem-bulgusu/:id/istisna` | Oturum | — |
| POST | `/api/sistem-bulgusu/:id/kapat` | Oturum | — |

### proses

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-portal/is-emri/:id/proses` | Oturum | — |
| GET | `/api/is-emri/:id/proses` | Oturum | — |
| POST | `/api/is-emri/:id/proses-siniri` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/proses` | Oturum | — |
| POST | `/api/proses-seansi/:id/karar` | Oturum | — |
| POST | `/api/proses-seansi/:id/sonuc` | Oturum | YG-282, YG-408: Uygun → onaylayan ve zaman; Uygun Değil → uygunsuzluk bağı zorunlu. Islak imza yerine rol bazlı onay. |

### randevu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/randevu-teyit/:b` | Oturumsuz | — |
| POST | `/api/randevu-teyit/:b` | Oturumsuz | — |
| GET | `/api/dosya/:id/randevu` | Oturum | — |
| POST | `/api/dosya/:id/randevu` | Oturum | Keşif bildirimi keşif planlamasıyla kendiliğinden gider; diğer randevular buradan bildirilir. |

### rapor

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/firma-portal/is-emri/:id/teknik-rapor` | Oturum | YG-1518, YG-428, YG-429: fiyat içermez; Firma Değerlendirmesi zorunlu; son zaman portalda görünür. |
| POST | `/api/firma-portal/is-emri/:id/teknik-rapor` | Oturum | — |
| GET | `/api/dosya/:id/rapor-onerileri` | Oturum | YG-200, YG-280, YG-427: firma girdisi rapora kendiliğinden gelir; LGM yalnız düzeltir, düzeltme kayda geçer. Firma raporu dışa giden rapora yazılmaz. YG-280: firma raporundan aktarılıp LGM'ce düzeltilen öneriler cetvel satırı taslağı olarak döner (firma raporu dışa gitmez). |
| GET | `/api/dosya/:id/teknik-rapor` | Oturum | — |
| POST | `/api/dosya/:id/teknik-rapor` | Oturum | — |
| POST | `/api/dosya/:id/kart-onerisi` | Oturum | YG-188: kartelada kodu olmayan kalem için Teknik Uzman öneri hazırlar; Ticari İşler Direktörü onaylayınca kartelaya eklenir. |
| GET | `/api/katalog-gelistirme` | Oturum | — |
| GET | `/api/dosya/:id/katalog-gelistirme` | Oturum | — |
| POST | `/api/katalog-gelistirme/:id/alinmadi` | Oturum | — |

### rapor_belge

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/teklif-statu-gecisleri` | Oturum | YG-227: Teklif Statü Geçişi ekranı; dönemdeki tüm statü ve karar geçişleri, son geçiş en üstte. |
| GET | `/api/beklemede-eskalasyonlari` | Oturum | YG-227, YG-068: Beklemede Eskalasyonu ekranı; açık işaretler, 10. gün yükseltmesi ve 45. gün karar noktası. |
| GET | `/api/teklif-performans` | Oturum | YG-227: Teklif Performans Verisi; dönemde oluşturulan teklifler üzerinden sayılar ve süreler. |
| GET | `/api/yonetim-raporu/belge` | Oturum | — |
| GET | `/api/ceo-raporu/belge` | Oturum | — |
| GET | `/api/kurumsal-rapor/:id/belge` | Oturum | — |
| GET | `/api/kurumsal/rapor/:id/belge` | Oturum | — |

### rapor_katalogu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/rapor-katalogu` | Oturum | — |
| POST | `/api/rapor-tanimi` | Oturum | YG-739, 740, 751, 752: yeni sürüm; test kanıtı, değişiklik notu, karşılaştırma etkisi ve yürürlük tarihi zorunlu; aynı ad başka hesapla kullanılamaz. |
| POST | `/api/rapor-dagitim` | Oturum | YG-753: dağıtım; hassas rapor yalnız yönetim rollerine, amaç ve süreyle. |
| POST | `/api/rapor-dagitim/:id/cikar` | Oturum | — |
| POST | `/api/rapor-yayini` | Oturum | YG-754: yayın kaydı ve geri çağırma; dağıtım listesine duyurulur, doğru sürüm ve etkilenen kararlar kayıtlıdır. |
| POST | `/api/rapor-yayini/:id/geri-cagir` | Oturum | — |

### resmi_onay

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/teklif/:id/resmi-onay` | Oturum | — |
| POST | `/api/teklif-kalemi/:id/resmi-onay` | Oturum | Dosya ekibindeki Teknik Uzman / Koordinatör her etiketli satır için Gerekli / Gerekmez işaretler; tümü işaretlenince görev kapanır. |
| GET | `/api/dosya/:id/resmi-onay` | Oturum | — |
| GET | `/api/kartela/resmi-onay` | Oturum | — |
| POST | `/api/kartela/:kod/resmi-onay` | Oturum | Etiket bakımı Teknik Müdürde; etiket aynı kodun tüm kartela sürümlerinde güncellenir. |

### risk_kalite

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/uygunsuzluk/:id/kapsamli-kok-neden` | Oturum | — |
| GET | `/api/kalite/olay-izleme` | Oturum | YG-1693 (¶634): Olay İzleme · Günlük: açık Kritik/emniyet işaretli uygunsuzluk, çalışması durdurulmuş dosya, son 30 gün çevresel olay. |
| GET | `/api/kalite/yonetim-gozden-gecirme` | Oturum | YG-1693 (¶648, FR-UYG-006): Kalite ve İSG Yönetim Gözden Geçirmesi · Yıllık; girdiler, kararlar, eylemler. |
| POST | `/api/kalite/yonetim-gozden-gecirme` | Oturum | — |

### risk_rezervi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/risk-rezervi` | Oturum | Tutarlar yalnız maliyet görebilen rollere; rezerv maliyetin oranı olduğu için Dosya Sorumlusu yalnız kendi talebinin durumunu görür. |
| POST | `/api/dosya/:id/risk-rezervi` | Oturum | — |

### sablon_surum

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sablon-metni` | Oturum | — |
| POST | `/api/sablon-metni/:kod/:dil` | Oturum | Anlamı etkileyen değişiklik yeni sürüm olarak Onayda açılır ve CEO'ya gider; yazım düzeltmesi de yeni sürümdür, sahip onayıyla doğrudan yürürlüğe girer. |

### saha

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/kesif-izinli-islemler` | Oturum | YG-056: keşif görevi onarımdan ayrı kayıt ve kapıdır. YG-049: Teknik Uzman atanmadan keşif başlamaz. |
| POST | `/api/dosya/:id/kesif` | Oturum | — |
| POST | `/api/kesif/:id/plan-onay` | Oturum | YG-055: keşif planını dosyanın Teknik Yöneticisi (yoksa Teknik Yönetici rolü) onaylar; planı hazırlayan onaylayamaz. |
| POST | `/api/kesif/:id/tamamla` | Oturum | YG-056, YG-111, YG-1529, YG-1452: tamamlanırken erişilemeyen alan açık konu olur; asbest/TBT şüphesi işi durdurur; katalog değeri teyit edilir; zorunlu fotoğraf eksiksizdir. |
| POST | `/api/bulgu/:id/teyit` | Oturum | YG-037, YG-130: önem bulguya verilir; dosya önceliği en ağır bulgudan önerilir. Konum bağlamsız olamaz. YG-128: teyit bekleyen bulgu Teknik Uzman veya Dosya Sorumlusunca ayrıştırılır; yeni bilgi türü ve gerekçe izde kalır. |
| POST | `/api/dosya/:id/bulgu` | Oturum | — |
| POST | `/api/dosya/:id/gorsel` | Oturum | YG-503, YG-1452: yönlendirmeli fotoğraf. Numara Dosya no-Gnnnn; çekilemeyen kare neden ister, hasar bölgesi karesi geçilemez. |
| GET | `/api/dosya/:id/is-kalemleri` | Oturum | YG-381: fotoğrafın bağlanacağı iş kalemleri |
| POST | `/api/dosya/:id/numune-devri` | Oturum | YG-134: numune devir zinciri. İlk devirde numune numarası (Dosya no-NMnnn) verilir; sonraki el değiştirmeler önceki devre bağlanır. Kayıt silinmez. |
| GET | `/api/dosya/:id/numune-devri` | Oturum | — |
| POST | `/api/dosya/:id/olcum` | Oturum | YG-134: ham veri korunur; kalibrasyonu uygun olmayan cihaz kesin değer sayılmaz; sınır dışı sonuçta ikinci doğrulayan zorunlu. |
| POST | `/api/dosya/:id/bolge` | Oturum | YG-132: hasar bölgesi; altlık çizim ve yeni sürüm. Önceki sınır silinmez (YG-131). |
| POST | `/api/dosya/:id/kontrol-listesi` | Oturum | YG-135: Uygun değilse açıklama; kritik maddede kanıt. Onayın hazırlayan dışında bir kişi tarafından verilmesini rica ederiz. |
| POST | `/api/kontrol-listesi/:id/madde` | Oturum | — |
| POST | `/api/kontrol-listesi/:id/tamamla` | Oturum | — |
| GET | `/api/dosya/:id/saha` | Oturum | — |
| POST | `/api/dosya/:id/islem` | Oturum | YG-075, YG-1436: askı, iptal, fesih ve devir tutanağı; Operasyon Müdürünün onayına düşer, imzasız iç onaydır. |
| POST | `/api/dosya/:id/kapanis` | Oturum | YG-148, YG-014: her Hayır eksiklik işareti üretir; zorunlu kayıt eksikken Kapalı olmaz. Aktarılmamış yazışma beyanı istenir. Onay Operasyon Müdüründe. |
| POST | `/api/dosya/:id/yeniden-ac` | Oturum | YG-080: yeni bilgi, hata veya müşteri bildirimiyle ve Operasyon Müdürü onayıyla. Yeni çevrim; önceki kayıtlar korunur. YG-081: garanti dosyayı yeniden açmaz. |
| POST | `/api/dosya/:id/alt-dosya` | Oturum + izin: dosya.ata.operasyon | YG-024: mükerrer dosya silinmez; Birleştirildi nedeniyle kapanır, eski numara ana dosyaya yönlendirir, açık sayaç ve bekleyen onaylar ana dosyaya geçer. YG-003: ayrı yetki veya bütçe gerektiren iş alt dosyada yürür; yatın geçmişi tek dosyada toplanmaz. Alt dosya ana talepten türetilen yeni talep numarasını alır. |
| POST | `/api/dosya/:id/birlestir` | Oturum + izin: dosya.ata.operasyon | — |
| POST | `/api/dosya/:id/vefat` | Oturum | YG-1477: vefat işareti otomatik mesajı ve onay bağlantılarını durdurur; DS'ye sıralı görevler açılır. Kurumsal müşteride tetiklenmez. |
| POST | `/api/dosya/:id/itiraz` | Oturum | YG-1497: sigortalı dosyada yat sahibi itirazı çalışmaları geçici durdurur, onaylı bildirim gider, Dosya Sorumlusuna arama görevi açılır. |
| POST | `/api/dosya/:id/garanti-sikayet` | Oturum | YG-081, YG-085, YG-1423, YG-1424, YG-1425: garanti ve şikâyet ayrı kayıt; numara GKnn / SKnn; kapalı dosyayı açmaz. Şikâyette 10 iş günü nihai yanıt. |
| POST | `/api/garanti-sikayet/:id/yeniden-dogrulama` | Oturum | YG-1685: Garanti Yeniden Doğrulama sonucu (Kalite Kontrolör veya Kalite Uzmanı); garanti kaydına bağlanır, Dosya Sorumlusu bilgilendirilir. |
| POST | `/api/garanti-sikayet/:id/kok-neden` | Oturum | YG-1416, YG-1420: kapsam kararı Teknik Yönetici; kök neden olmadan kapanmaz. Düzeltme maliyeti 5.000,00 EUR üstünde Teknik Müdür onayına gider. YG-1425: şikâyet sonucu listesi. YG-1420: FR-UYG-004 tek form iki seviye. Tekrarlayan işaretli olayda Ayrıntılı, diğerlerinde Kısa seviye istenir. |
| POST | `/api/garanti-sikayet/:id/karar` | Oturum | — |

### saha_kayit

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/firma-portal/is-emri/:id/gecikme` | Oturum | YG-420: firma, aktif iş emrinde öngördüğü gecikmeyi nedeni ve yeni tahmini bitiş tarihiyle bildirir; Dosya ve Saha Sorumlusuna gider. |
| POST | `/api/firma-portal/is-emri/:id/gunluk` | Oturum | YG-1574, YG-381: gün başına bir kayıt; zorunlu alanlar dolmadan gün kapanmaz; aynı görsel başka kayıtta kanıt olmaz. |
| GET | `/api/firma-portal/gunluk` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/parca` | Oturum | YG-1430, YG-404: firma tedariki parça lot ve belgeyle girilir; kabulü firma veremez (YG-386). |
| GET | `/api/firma-portal/is-emri/:id/parca` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/teslim-talebi` | Oturum | YG-417: Teslim Talebi; kararı Dosya Sorumlusu verir. Firma engelin nedenini görmez, yalnız onay durumunu görür. |
| GET | `/api/firma-portal/is-emri/:id/teslim-durumu` | Oturum | — |
| GET | `/api/is-emri/:id/saha-kayitlari` | Oturum | LGM tarafı: günlükleri, parçaları, sapma ve denetim kayıtlarını görür. |
| POST | `/api/parca-girisi/:id/karar` | Oturum | — |
| POST | `/api/is-emri/:id/sapma` | Oturum | YG-379, YG-380: sapma türü ve kararı yetkili rolde; kayıt silinmez; düzeltme Dosya Sorumlusuna görev açar; karneye yansır. |
| POST | `/api/sapma/:id/kapat` | Oturum | YG-380: kapanış kanıtla olur; kayıt silinmez. Girenden başka bir yetkili kapatır. |
| POST | `/api/is-emri/:id/yeniden-baslat` | Oturum | YG-262, YG-1588: durdurulan iş emrini yalnız Teknik Müdür, güvenli koşul doğrulamasıyla yeniden başlatır; işi durduran açık uygunsuzluk varken başlatılmaz. |
| POST | `/api/is-emri/:id/baslangic-toplantisi` | Oturum | YG-329, YG-580, YG-425: TPL-07 kaydını Dosya Sorumlusu girer; firma görür. |
| GET | `/api/firma-portal/is-emri/:id/baslangic-toplantisi` | Oturum | — |
| GET | `/api/firma/:id/sapma-ozeti` | Oturum | YG-380: tekrar eden sapmalar firma ve tür bazında izlenir. |
| POST | `/api/is-emri/:id/denetim-bulgusu` | Oturum | YG-786: denetim bulgusu sınıf, kanıt ve hedef tarihle; firma karnesine işlenir. |
| POST | `/api/is-emri/:id/teshisi-belirsiz` | Oturum | Ek I §7.5: gizli hasar ve arıza tespiti gibi işlerde +%5 tolerans; işareti Teknik Uzman koyar. |

### sahiplik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sahiplik` | Oturum | — |
| POST | `/api/sahiplik/modul` | Oturum | — |
| POST | `/api/sahiplik/devir` | Oturum | — |

### sigorta

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta/ara` | Oturum | YG-438, YG-1571: yalnız taraf olunan dosyalar; hasar dosya no ve LGM no ayrı. Firma adı hiçbir yerde görünmez (YG-296). YG-1374: sigorta/eksper kullanıcısı yalnız kendi dosyalarında dosya no, hasar dosya no ve yat adıyla arar. |
| GET | `/api/sigorta/kartela` | Oturum | YG-854: kartela sigorta şirketlerine menüdür; yürürlükteki sürümün birim fiyatı (maliyet x fiyat katsayısı) görünür, maliyet görünmez. |
| GET | `/api/sigorta/ana` | Oturum | — |
| GET | `/api/sigorta/dosya/:id/ilerleme-raporu` | Oturum | YG-440: onaylı teknik rapor PDF'i yalnız dosyası görünen sigorta kullanıcısına ve eksperine; indirme denetim izine yazılır. YG-460: RP-RAP-001 İlerleme Raporu (PDF) sigorta şirketinin dosyası için. |
| GET | `/api/sigorta/rapor/:id` | Oturum | — |
| GET | `/api/sigorta/teklif/:id` | Oturum | — |
| GET | `/api/sigorta/dosya/:id` | Oturum | YG-438: dosyanın salt okunur ayrıntısı. Aşama tarihleri, sigortaya gönderilmiş teklifler (yalnız satış tutarı), onaylı raporlar ve ilerleme; firma adı ve maliyet yoktur (YG-296). |
| POST | `/api/sigorta/teklif/:id/karar` | Oturum | YG-1568: seçilen kalemler onaylanır; seçilmeyen onaylanmamış sayılır; ret düğmesi yok. Sürüme bağlıdır (YG-455). |
| POST | `/api/sigorta/dosya/:id/talimat-degisikligi` | Oturum | YG-446: talimat değişikliği portaldan Talimat ve Karar Kayıtlarına yetkili kaynak olarak düşer; Dosya Sorumlusu bilgilendirilir. |
| GET | `/api/sigorta/kullanicilarim` | Oturum | — |
| POST | `/api/sigorta/kullanici-kapatma-talebi` | Oturum | YG-446: şirket kullanıcısı, aynı şirketteki bir kullanıcının hesabının kapatılmasını talep eder; Müşteri ve Paydaş İlişkileri Müdürü değerlendirir. |
| POST | `/api/sigorta/gorevlendirme` | Oturum | YG-446, YG-448: Sigorta Görevlendirmesi; hasar dosya no zorunlu, poliçe isteğe bağlı. İhbar dosya numarasıyla izlenir, ayrıca yazı gitmez. |

### sigorta_ek2

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-ek2` | Oturum | — |
| POST | `/api/sigorta-ek2` | Oturum | YG-1522: değişiklik kayıtlı kurumsal temsilcinin kayıtlı adresinden gelen bildirimle yeni sürüm olur; önceki sürüm korunur, sözleşme değişikliği akışı açılmaz. |
| POST | `/api/dosya/:id/ek3-onay-yetkilisi` | Oturum | YG-1522: Ek-3'te dosyaya özel onay yetkilisi; boş bırakılırsa Ek-2 geçerli olur. |

### sigorta_fark

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/sigorta-fark` | Oturum | — |
| POST | `/api/teklif/:id/sigorta-odenecek` | Oturum | — |
| POST | `/api/teklif/:id/odeme-farki` | Oturum | — |

### sigorta_gonderim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-gonderim` | Oturum | — |
| GET | `/api/sigorta-gonderim/:id/onizleme` | Oturum | Gönderimden önce teklif PDF'i görülür; önizleme dosyaya kaydedilmez, doğrulama kodu taşımaz. |
| POST | `/api/dosya/:id/sigorta-eposta` | Oturum | YG-443: sigorta şirketinin e-posta adresini dosya sorumlusu girer; bekleyen gönderimler yeni adrese yeniden teyit ister. |
| POST | `/api/sigorta-gonderim/:id/teyit` | Oturum | K-241: birinci teyit göndermez; ikinci teyit aynı kişiden, ayrı istekle ve bekleme süresinden sonra gelir. |
| POST | `/api/sigorta-gonderim/:id/iptal` | Oturum | — |

### sigorta_kurum

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-kurum` | Oturum | YG-441: sigorta şirketi kartında kanal, portal adresi ve paket biçimi. |
| POST | `/api/sigorta-kurum` | Oturum | — |
| GET | `/api/dosya/:id/sigorta-portal-paketi` | Oturum | YG-442: kendi portalını kullanan şirkete yüklenecek paket (teklif, onaylı teknik raporlar, portala açılmış fotoğraflar) şirketin biçimiyle tek ZIP olarak hazırlanır. |
| GET | `/api/is/:id/sigorta-portal` | Oturum | YG-442: görev kartından paket ve yükleme kaydına geçiş; kart sahibine teklif ve dosya bilgisi verilir. |
| POST | `/api/dosya/:id/sigorta-portal-yukleme` | Oturum | — |
| GET | `/api/portal/pazarlama-sorusu` | Oturum | — |
| POST | `/api/portal/pazarlama-sorusu` | Oturum | — |

### sigorta_panel

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-panel` | Oturum | — |
| POST | `/api/sigorta-panel/basvuru` | Oturum | Panel başvurusu: dosya içeriği tamamlanmadan "Başvuruyu Gönder" yapılmaz; gönderim sigorta şirketine yalnız e-postayladır (K-185), kayıt gönderimi işler. |
| POST | `/api/sigorta-panel/basvuru/:id` | Oturum | — |
| POST | `/api/sigorta-denetim-talebi` | Oturum | Sigorta şirketi denetim talebi: Direktör kaydeder (yanıt son tarihi Süre Uyarısı), "Hukuk ve Uyum Görüşü İste", "Yanıtı Gönder" (¶855, A51-S9). |
| POST | `/api/sigorta-denetim-talebi/:id` | Oturum | — |
| POST | `/api/kurumsal-itibar-riski` | Oturum | Kurumsal İtibar Riski · Müşteri Uyuşmazlığı: Direktöre acil kart (sayaçsız); "CEO'ya İlet" (¶858, Cilt I §7.2). |
| POST | `/api/kurumsal-itibar-riski/:id/ceoya-ilet` | Oturum | — |

### sigorta_performans

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-performans` | Oturum | — |
| POST | `/api/sigorta-performans/:id/veri` | Oturum | — |
| POST | `/api/sigorta-performans/:id/onaya` | Oturum | — |

### sigorta_sirketi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-sirketleri` | Oturum | — |
| GET | `/api/yer-listesi` | Oturum | YG-1558: yer listesi ana veriden "Yer Adı (İlçe, İl)" etiketiyle; birleştirilen mükerrer noktalar listelenmez. |
| POST | `/api/sigorta-kullanici` | Oturum | YG-453: sigorta şirketinin yazılı olarak yetkilendirdiği kişiye (yetkili veya eksper) sigorta portalı hesabı açılır; kişi yalnız o şirketin dosyalarını görür. |
| GET | `/api/sigorta-kullanicilar` | Oturum | YG-453: Müşteri ve Paydaş İlişkileri Müdürü açtığı sigorta portalı hesaplarını görür; kapatma ayrılış bildirimiyle (/dis-kullanici/:id/ayrilis-bildirimi) yapılır. |
| POST | `/api/sigorta-kullanici/:id/bagla` | Oturum | YG-1758: siciline bağlanmamış (veya yanlış bağlı) kullanıcı, Müşteri ve Paydaş İlişkileri Müdürünce şirket kaydına bağlanır; unvan sicilden alınır. |
| POST | `/api/sigorta-sirketi` | Oturum | Kayıt açılışında ve yıllık güncellemede MERSİS unvanıyla teyit edilir. |

### sigorta_tutar

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ticari/kontrol-bekleyenler` | Oturum | — |
| POST | `/api/sigorta-onayi/:id/tutar-kontrol` | Oturum | — |

### sistem_izleme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sistem-izleme` | Oturum | — |

### sosyal_medya

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/sosyal-medya` | Oturum | — |
| GET | `/api/sosyal-medya` | Oturum | — |
| POST | `/api/sosyal-medya/:id/dosya` | Oturum | YG-1466: Müşteri ve Paydaş İlişkileri Müdürü paylaşımı dosyayla eşleştirir; Dosya Sorumlusu bilgilendirilir. |
| GET | `/api/sosyal-medya/:id/yanit-metni` | Oturum | — |
| POST | `/api/sosyal-medya/:id/yanitlandi` | Oturum | — |
| POST | `/api/sosyal-medya/:id/sikayet` | Oturum | YG-1466: dosyayla eşleşen paylaşım şikâyetse SKnn kaydı kendiliğinden açılır (kanal Sosyal Medya; 10 iş günü yanıt; Şikâyet Takibi). Yanıt platformda sözcünün onaylı şablonuyla verilir. |
| POST | `/api/sosyal-medya/:id/degerlendir` | Oturum | — |

### sozlesme_takip

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sozlesme-turleri` | Oturum | — |
| GET | `/api/sozlesme-takip` | Oturum | — |
| POST | `/api/sozlesme-takip` | Oturum | — |
| POST | `/api/sozlesme-takip/:id/yururluk` | Oturum | İmzalı nüsha (güvenli elektronik veya ıslak imzalı) yüklenmeden sözleşme Yürürlükte olmaz. |
| POST | `/api/sozlesme-takip/:id/karar` | Oturum | — |

### sunucu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/saglik` | Oturumsuz | — |
| GET | `/api/api/kurulum-rehberi` | Oturumsuz | YG-491 (RHB-01, CEO 17.11.2026): oturumsuz kurulum rehberi; [web adresi] uygulamanın adresiyle doldurulur, yardım satırı destek bilgisi gelene kadar çıkmaz. |

### sureklilik_ortam

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sureklilik-ortam` | Oturum | — |
| POST | `/api/sureklilik-testi` | Oturum | YG-1287: ölçütler testten önce; plan tarihi bugün veya ileride olmalı. |
| POST | `/api/sureklilik-testi/:id/sonuc` | Oturum | — |
| POST | `/api/alt-ortam-kopyasi` | Oturum | YG-1119, YG-1280: talep; maskeleme geri döndürülemez, dış bağlantı kapalı, erişim süresi en çok 30 gün. |
| POST | `/api/alt-ortam-kopyasi/:id/karar` | Oturum | Veri sahibi ve güvenlik (Bilgi İşlem Müdürü / BT ve FY Direktörü) ayrı ayrı onaylar; talep eden onaylayamaz. |
| POST | `/api/alt-ortam-kopyasi/:id/imha` | Oturum | — |

### surum_hizmet

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/surum-hizmet` | Oturum | — |
| GET | `/api/yayin-seti/izle` | Oturum | YG-1134: bir değişiklik biletinin hangi sürümde ve ortamda olduğu. |
| POST | `/api/yayin-seti` | Oturum | — |
| POST | `/api/yayin-seti/:id/test-edildi` | Oturum | — |
| POST | `/api/yayin-seti/:id/uretime-al` | Oturum | Hazırlayan kendi setini üretime onaylayamaz; onay sonrası izleme görevi açılır (YG-1137). |
| POST | `/api/yayin-seti/:id/geri-al` | Oturum | — |
| POST | `/api/yayin-seti/:id/izleme` | Oturum | YG-1137: beklenmeyen sonuç problem kaydı açar ve izlemeye bağlanır. |
| POST | `/api/test-senaryosu` | Oturum | — |
| POST | `/api/test-senaryosu/:id/kosu` | Oturum | — |
| POST | `/api/test-hatasi` | Oturum | — |
| POST | `/api/test-hatasi/:id/duzeltildi` | Oturum | — |
| POST | `/api/test-hatasi/:id/kapat` | Oturum | YG-1139: geliştirici beyanı yetmez; düzeltmeden sonra başka bir kişinin koştuğu geçen test aranır. |
| POST | `/api/hizmet-hesabi` | Oturum | — |
| POST | `/api/hizmet-hesabi/:id/onay` | Oturum | — |
| POST | `/api/hizmet-hesabi/:id/olcum` | Oturum | — |
| POST | `/api/dis-erisim` | Oturum | YG-1002: olay bazlı, süreli erişim; üretim verisi gerekçe ister. |
| POST | `/api/dis-erisim/:id/karar` | Oturum | — |
| POST | `/api/dis-erisim/:id/kapat` | Oturum | — |
| POST | `/api/hizmet-hesabi/:id/cikis` | Oturum | YG-1305: çıkış kontrol listesi; her madde kanıtla işaretlenir, tamamlanınca hesap ve erişimler kapanır. |

### tedarik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/siparis` | Oturum | YG-823, YG-906: Tedarik Sorumlusu hazırlar; Tedarik Müdürü → T&O Direktörü uygun görüş → limite göre son makam. |
| GET | `/api/is/:id/siparis-kontrolleri` | Oturum | YG-1592, YG-1593: sipariş onay kartında sistem kontrolleri; kartın sıradaki makamı veya Tedarik Müdürlüğü görür. Kontroller karar vermez, makama bilgi verir. |
| GET | `/api/dosya/:id/teklif-karsilastirma` | Oturum | YG-1590: yanıtlanmış tedarikçi teklifleri aynı şartla yan yana; KDV hariç toplam ve onay makamı (aynı tedarikçiye önceki siparişlerle kümülatif) sistemce. Satış fiyatı gösterilmez. |
| GET | `/api/dosya/:id/siparisler` | Oturum | — |
| POST | `/api/siparis/:id/giris` | Oturum | YG-404, YG-405, YG-1589: lotsuz kabul yok; bekletme yeri firma veya tedarikçi (LGM deposu yok); kontrol Saha Sorumlusu, yoksa Teknik Uzman. |
| POST | `/api/malzeme-giris/:id/karar` | Oturum | — |
| POST | `/api/siparis/:id/eslestirme` | Oturum | Üçlü eşleştirme: sipariş, teslim, fatura; fark varsa ödeme planlanmaz. Aynı fatura no + tutar + cari mükerrer. |

### tedarik_dagitim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/tedarik-pano` | Oturum | YG-1592, YG-1593: Dağıtım Bekleyen Talepler (öncelik → kalan süre → geliş) ve Ekip Uyarıları (48 saati aşan tedarikçi kabulü, geciken teslim). |
| GET | `/api/tedarik/geri-cagirma` | Oturum | YG-1593: geri çağırma taraması; üretici parça no, ürün tanımı veya lot ile etkilenen giriş kayıtları, siparişler ve dosyalar (en az 3 karakter). |
| POST | `/api/malzeme-giris/:id/supheli` | Oturum | YG-1594: kabul edilmiş üründe şüphe (sahte, hasarlı, geri çağrılmış olabilir) dosyaya erişimi olan LGM personelince gerekçeyle bildirilir; Tedarik Yönetimi Müdürüne Kritik kart açılır. |
| POST | `/api/malzeme-giris/:id/kullanimi-durdur` | Oturum | Tedarik Yönetimi Müdürü (veya Müdür Yardımcısı) kullanımı durdurur: kayıt karantinaya alınır, teslim alınan miktar geri düşülür, 10 günlük karantina kararı görevi açılır, dosya ekibine bildirim gider. |
| GET | `/api/tedarik-sorumlusu-pano` | Oturum | YG-1590: Tedarik Sorumlusunun kendi talepleri, siparişleri ve uyarıları. |
| POST | `/api/tedarik/dagitim/:id/cikar-catismasi` | Oturum | YG-1592: atanan Tedarik Sorumlusu çıkar çatışmasını gerekçeyle bildirir; görevi kapanır, Tedarik Yöneticisine yeniden atama görevi açılır. |
| POST | `/api/tedarik/dagitim/:id` | Oturum | — |

### tedarik_gosterge

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/tedarik/mudurluk-gostergeleri` | Oturum | — |
| GET | `/api/tedarik/kaynak-risk` | Oturum | YG-1594: Kaynak ve Risk. |
| POST | `/api/tedarik/kaynak-risk/plan` | Oturum | — |
| POST | `/api/tedarik/muadil-gozden-gecirme` | Oturum | — |

### teklif

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/kartela/es-anlam` | Oturum | YG-293: arama; firma portalı fiyatsız kullanır, LGM de satış fiyatını buradan görmez. |
| GET | `/api/olcu-birimleri` | Oturum | YG-1257 (KS-2): ortak ölçü birimi listesi (kartela, metraj, Fiyat Teklifi). |
| GET | `/api/kartela/ara` | Oturum | — |
| GET | `/api/kartela/branslar` | Oturum | — |
| GET | `/api/kartela/maliyet` | Oturum | — |
| POST | `/api/kartela/taslak` | Oturum | — |
| POST | `/api/kartela/fiyat-onerisi` | Oturum | YG-856: fiyat güncellemesini Tedarik veya Teknik birim önerir (mevcut maliyet gösterilmez, YG-1081); Ticari İşler Direktörü onaylar. |
| POST | `/api/kartela/taslak/maliyet` | Oturum | — |
| POST | `/api/kartela/taslak/maliyet-toplu` | Oturum | YG-856: Excel'den toplu güncelleme; sütunlar Kod, Maliyet (EUR), Maliyet Tarihi, Kaynak Norm. Hatalı satır varsa hiçbiri işlenmez. |
| POST | `/api/kartela/taslak/kaldir` | Oturum | YG-661: kalemi kullanımdan kaldırma yalnız taslak sürümde, gerekçeyle; CEO sürümü onaylayınca yürürlükten çıkar. |
| POST | `/api/kartela/taslak/onaya-gonder` | Oturum | — |
| POST | `/api/dosya/:id/cetvel` | Oturum | YG-195, YG-198: cetveli Teknik Uzman hazırlar, Teknik Yönetici onaylar; bedel türü ve nitelik satırda seçilir. |
| POST | `/api/dosya/:id/teklif` | Oturum | YG-1599: teklif cetvelden ve firma fiyatlarından oluşur. YG-178: LGM teklifi tek belge. |
| GET | `/api/teklif/:id` | Oturum | LGM içi: firma maliyeti yalnız yetkili rollere (YG-296 dışa yansımaz). |
| GET | `/api/dosya/:id/teklifler` | Oturum | — |
| POST | `/api/teklif/:id/indirim-talebi` | Oturum | YG-174: Ticari Sorumlu gerekçeli indirim talebi açar; talep tutardan bağımsız GMY'ye çıkar, %5 üzeri GMY görüşüyle CEO'ya gider. |
| POST | `/api/teklif/:id/indirim` | Oturum | YG-174: indirim yalnız GMY ve CEO ekranında; %1–%10 tam sayı; tutara bakmadan GMY'ye çıkar, %5 üstü GMY görüşüyle CEO. |
| POST | `/api/teklif/:id/bant-onayi` | Oturum | YG-187: bant dışı kalem varsa önce TİD'in gerekçeli onayı. |
| POST | `/api/teklif/:id/masraf-kalemi` | Oturum | MSR-1, YG-182, YG-183, YG-331: tesisin kendi tarifesiyle fiyatladığı bedel kartelada yoktur; teklife belgesiyle, gerçek tutarıyla Masraf kalemi olarak yazılır. Fiyat kuralı uygulanmaz. |
| GET | `/api/teklif/:id/ek-ozet` | Oturum | YG-212: ek teklif önceki onaylı toplam, bu ek ve yeni toplamı gösterir. |
| POST | `/api/teklif/:id/onaya-gonder` | Oturum | YG-194, YG-1552, YG-214: kontroller tamamlanmadan onaya gönderilmez; son makam KDV hariç kümülatif toplama göre (YG-173). |
| POST | `/api/teklif/:id/gonder` | Oturum | YG-191: geçerlilik 15 gün, gönderimden başlar. Sigortalıda BLD-71 + BLD-37; bireyselde ONY-23 (YG-466), muvafakat kilidi (YG-103). |
| POST | `/api/teklif/:id/sigorta-karar` | Oturum | YG-205, YG-219, YG-1464: sigorta kararı; kanal yalnız tanımlı kanallar. Kısmi onayda kalem silinmez, işaretlenir; onaylanmayanlardan yat sahibine ayrı teklif. Sonuç BLD-38 / BLD-39. |
| POST | `/api/teklif/:id/islak-imza` | Oturum | YG-154: Koşullu Onayın şartını Dosya Sorumlusu kanıtla doğrular; dosya Uygulama aşamasına geçer ve yat sahibi tam onay bildirimini (BLD-38) alır. YG-220: yat sahibinin sistem erişimi yoksa karar ıslak imzalı taranmış teklifle kaydedilir; telefonla verilen onay seçeneği yoktur. |
| POST | `/api/teklif/:id/sart-dogrula` | Oturum | — |
| GET | `/api/teklif/:id/eksper-karsilastirma` | Oturum | YG-203: eksper raporu dosyaya yüklenir, tutarları Dosya Sorumlusu kalem kalem girer; maliyet görünmez. |
| POST | `/api/teklif/:id/eksper-karsilastirma` | Oturum | — |
| POST | `/api/teklif/:id/yeniden-degerlendirme` | Oturum | YG-204: teknik gerekçesi olan onaylanmayan kalem için bir kez; K-241 ikili teyidiyle gider. Dışa giden metne teminat yazılmaz. |
| POST | `/api/yeniden-degerlendirme/:id/sonuc` | Oturum | — |
| POST | `/api/teklif/:id/revizyon` | Oturum | YG-193: revizyon yeni sürüm, önceki Yerine Geçti; toplam değişmesi tek başına gerekçe değildir. |
| POST | `/api/teklif/:id/cayma` | Oturum | YG-1450, YG-152: bireysel müşteri cayma; iade 14 gün içinde (BLD-47 Ticari modülünde). |

### teklif_madde

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/teklif/:id/madde` | Oturum | — |
| POST | `/api/teklif/:id/madde` | Oturum | — |

### teknik_cizim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/teknik-cizim` | Oturum | — |
| POST | `/api/dosya/:id/teknik-cizim` | Oturum | — |
| POST | `/api/teknik-cizim/:id/onaya-gonder` | Oturum | — |
| POST | `/api/teknik-cizim/:id/revizyon` | Oturum | Onaylı çizimde değişiklik yeni revizyonla yapılır; önceki revizyonlar tabloda kalır. |
| GET | `/api/teknik-cizim/:id/pdf` | Oturum | — |

### teslim_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/onay-iste` | Oturum | YG-471, YG-474, YG-1500: ONY-03, 06, 07, 08, 09, 10; onay PDF'i onay akışından e-postayla gider. |
| POST | `/api/acil/:dosya/ilk-tedbir-talebi` | Oturum | YG-472: bireysel ve sigortasız dosyada Acil İlk Tedbir talebi; sigortalıda varyant yoktur. Firma adı yazılmaz. |
| GET | `/api/dosya/:id/teslim-alicilari` | Oturum | YG-415: teslim bildiriminden önce yetkili alıcı (aktif Yat Sahibi veya yetki kaydı olan Yetkili Temsilci) ayrı adımda doğrulanır. |
| POST | `/api/dosya/:id/teslim-alici-dogrula` | Oturum | — |
| POST | `/api/dosya/:id/barinma-gideri` | Oturum | YG-481: hazır bildirimi BLD-12; 7 takvim günü sayılır. YG-1867: teslim alınmayan yatın barınma gideri tutarını Ticari Sorumlu elle girer; Barınma Gideri görevi kapanır. |
| POST | `/api/dosya/:id/belge-talebi` | Oturum | — |
| POST | `/api/dosya/:id/ilerleme-ozeti` | Oturum | YG-555, YG-787 (BLD-93, CEO 17.11.2026): Müşteri İlerleme Özeti; yalnız fiziksel ilerleme; firma, fiyat ve finansal oran yazılmaz; sigortaya e-postayla gitmez (MT-6). |
| POST | `/api/dosya/:id/teslime-hazir` | Oturum | — |
| POST | `/api/dosya/:id/teslim-hatirlat` | Oturum | YG-1435: tek hatırlatma; onay gelmezse "Teslim edildi - onay verilmedi". Yat sahibi yoksa temsilci veya tesis, fotoğraf zorunlu. |
| POST | `/api/dosya/:id/teslim-islak-imza` | Oturum | YG-1433: teslim alan YATONET 360 onayı veremiyorsa (sistem erişimi yok) ıslak imzalı tutanak taranıp yüklenir; teslim onaylı sayılır, kayıt belge sürümüyle tutulur. |
| POST | `/api/dosya/:id/teslim-onaysiz` | Oturum | — |
| POST | `/api/dosya/:id/yat-kabul` | Oturum | YG-088: yat LGM'ye veya görevli firmaya teslim edildiğinde kabul tutanağı. |
| POST | `/api/dosya/:id/sokulen-parca` | Oturum | YG-482: sökülen parça listesi; sigortalıda seçim önce sigorta talimatıyla (30 gün). |
| GET | `/api/dosya/:id/sokulen-parca` | Oturum | — |
| POST | `/api/sokulen-parca/:id/sonuc` | Oturum | YG-730: teslim veya imha fotoğrafla kayda alınır, imza alınmaz; sigortalı dosyada imha sigorta şirketinin onay belgesiyle yapılır. |
| POST | `/api/sokulen-parca/:id/secim` | Oturum | — |
| POST | `/api/sigorta/dosya/:id/ariza-bildirimi` | Oturum | — |
| POST | `/api/broker/dosya/:id/ariza-bildirimi` | Oturum | — |
| POST | `/api/portal/dosya/:id/garanti-talebi` | Oturum | — |
| GET | `/api/portal/dosya/:id/bilgi-paylasim` | Oturum | — |
| POST | `/api/portal/dosya/:id/bilgi-paylasim` | Oturum | — |
| POST | `/api/portal/dosya/:id/iptal-devir-talebi` | Oturum | — |
| POST | `/api/dosya/:id/ilerleme-fotografi` | Oturum | — |
| POST | `/api/ilerleme-fotografi/:id/kaldir` | Oturum | — |
| GET | `/api/portal/fotograf/:id` | Oturum | Portal yalnız onaylı fotoğrafı verir; dosya adı yerine sıra numarası kullanılır (firma adı sızmaz). |
| POST | `/api/dosya/:id/tam-ziya-teslim` | Oturum | YG-079: tam ziyada onarım teslimi olmaz; yat, teslim alan kişi ve kapanış hesabı görülerek ayrı adımla bırakılır. |
| GET | `/api/dosya/:id/kapanis-hesabi` | Oturum | YG-079: kapanış hesabı (tam ziya dahil): onaylı, faturalı, tahsil edilen ve firma alacağı. |

### teslim_sure

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/teslim-sure` | Oturum | — |
| POST | `/api/dosya/:id/teslim-sure` | Oturum | SRE-1: uzamada gerekçe ve ek iş günü zorunlu; yeni tarih takvimden hesaplanır; BLD-03 yat sahibine ve sigortaya gider. |

### teyit

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/dis-talep` | Oturum | YG-1272: dışarıdan gelen değişiklik talebi kaydedilir; teyit edilene kadar uygulanamaz, Dosya Sorumlusuna görev açılır. |
| POST | `/api/dis-talep/:id/teyit` | Oturum | Teyit yalnız dosyada önceden kayıtlı bir numarayla verilir; talebi kaydeden kişi teyit veremez. |
| GET | `/api/dosya/:id/dis-talepler` | Oturum | — |

### ticari

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/teklif/:id/odeme-talebi` | Oturum | YG-906, YG-907, YG-1474, YG-1493: ödeme talebini Ticari Sorumlu hazırlar; MF Müdürü kontrol → limite göre son makam. Bireyselde avans erken ifa onayından sonra. |
| POST | `/api/dosya/:id/ticari-bekletme` | Oturum | — |
| POST | `/api/teklif/:id/proforma` | Oturum | — |
| POST | `/api/fatura/:id/muhasebeye` | Oturum | — |
| GET | `/api/muhasebe/tevkifatli` | Oturum | YG-875, YG-884, YG-900, K-193: fatura no, tarih ve kuru muhasebeden gelince Ticari Sorumlu girer; kur önceki iş günü TCMB satış; TL tutar nihai; vade sigortada 30 gün. YG-1025: Muhasebe Hizmeti muhasebeye iletilen proformaları ve faturalandırdıklarını görür (maliyet ve firma bilgisi yok). YG-882: KDV tevkifatlı faturalar ayrı listelenir; aylık KDV iade dosyası için CSV dökümü alınır (Muhasebe Hizmeti, Muhasebe ve Finans Müdürü/Müdür Yardımcısı, Ticari Sorumlu). |
| POST | `/api/dosya/:id/odeme-yat-sahibine` | Oturum | YG-892: sigorta şirketi ödemeyi yat sahibine yapacağını bildirince dosya ticari olarak sigortasız işlenir; sonraki proforma, ödeme talebi ve teklif yat sahibine düzenlenir. |
| GET | `/api/masraf/belge-kontrol` | Oturum | YG-1610: ekip süre uyarıları; nihai kabulden 48 saat içinde proforma, muhasebeye iletilen proformada 48 saat içinde fatura bilgisi. YG-1610: belge kontrolü kademesinde bekleyen masraf fişleri; fiş ayrıntısıyla tek listede (karar /is/:id/karar ile verilir). |
| GET | `/api/muhasebe-ekip-sureleri` | Oturum | — |
| GET | `/api/tahsilat-izleme` | Oturum | YG-1608: vadesi geçen faturalar; gecikme günü, son takip basamağı ve yazılı ihtar (15. gün basamağı) zamanı. |
| GET | `/api/mali-erken-uyarilar` | Oturum | YG-1613: Mali Erken Uyarılar; brüt katkı 5 puan düşüşü, bütçe %10 aşımı, müşteri kredi limiti %80 (açık uyarı kartlarından) ve vadesini 15 günden fazla geçen alacak. |
| GET | `/api/muhasebe/proformalar` | Oturum | — |
| POST | `/api/fatura/:id/bilgi` | Oturum | — |
| POST | `/api/is-emri/:id/banka-mektubu` | Oturum | YG-903, YG-904, YG-1460: havale, POS, ödeme bağlantısı; çek/senet yok; kısmi tahsilat; kart üst sınırı 20.000,00 EUR. YG-838: banka mektubu (iş emri veya firma belgesi) Ticari Sorumluca iş emrine bağlanır; sonraki hakedişlerde güvence kesintisi yapılmaz. |
| POST | `/api/dosya/:id/odeme-taahhudu` | Oturum | YG-851: ödemeyi üstlenen taraf yazılı dayanakla taahhüt kaydı olarak girilir; sigorta şirketi yalnız yazılı taahhüdüyle ödeme yükümlüsü olur. |
| GET | `/api/dosya/:id/odeme-yukumlulugu` | Oturum | — |
| POST | `/api/tahsilat` | Oturum | — |
| GET | `/api/dosya/:id/teslim-durumu` | Oturum | YG-087, YG-216, YG-1434: teslim kilidi; istisna GMY. Bireyselde tüm bakiye. ONY-27 yat sahibine. |
| POST | `/api/dosya/:id/teslim-istisnasi` | Oturum | — |
| POST | `/api/dosya/:id/teslim` | Oturum | — |
| POST | `/api/firma-portal/is-emri/:id/hakedis` | Oturum | YG-835, YG-836, YG-838: firma hakediş girer; kanıt zorunlu ve tek; kümülatif iş emri bedelini aşamaz; kesinti sistemce. |
| POST | `/api/firma-portal/hakedis/:id/fatura` | Oturum | YG-846, K-193: firma, fatura düzenleme bildiriminden sonra fatura no, tarih ve kuru girer. |
| POST | `/api/hakedis/:id/fatura-iade` | Oturum | YG-420: Ticari Sorumlu, ödeme talimatı açılmamış hakedişte firma faturasını gerekçeyle iade eder; fatura bilgileri silinir, firma yeniden girer. |
| POST | `/api/hakedis/:id/dogrula` | Oturum | YG-834: Saha Sorumlusu, atanmamışsa Dosya Sorumlusu doğrular. |
| POST | `/api/hakedis/:id/odeme-talimati` | Oturum | YG-829, YG-831, YG-839, YG-843, YG-1428: Ticari Sorumlu hazırlar; MF Müdürü + TİD onaylar. Üçlü eşleştirme, belge ve IBAN kapısı. |
| POST | `/api/firma/:id/iban` | Oturum + izin: firma.kayit | YG-928: IBAN karantinada başlar; talep kanalından farklı kanalla geri aranarak teyit ve iki farklı kişi. |
| GET | `/api/banka-hesabi/bekleyen` | Oturum | — |
| POST | `/api/banka-hesabi/:id/teyit` | Oturum | — |
| POST | `/api/masraf/:id/belge` | Oturum | YG-948, YG-950, YG-951, YG-1614: izin; gün sistemce; bakiye negatif olamaz; açık dosyası olanda vekil zorunlu; İK sonra birim amiri. YG-920: fiş görseli masraf kaydına bağlanır. |
| POST | `/api/izin/:id/belge` | Oturum | YG-952 |
| GET | `/api/izin/bakiye` | Oturum | YG-948: talep ekranında yıllık izin hakkı ve kalan bakiye önceden görünür. |
| POST | `/api/izin` | Oturum | — |
| POST | `/api/on-muhasebe/genel-gider` | Oturum | — |
| POST | `/api/on-muhasebe/hesap-hareketi` | Oturum | — |
| GET | `/api/on-muhasebe/hesaplar` | Oturum | — |
| GET | `/api/on-muhasebe/cari` | Oturum | Cari hareket: müşteri ve sigortada fatura borç, tahsilat alacak; Çözüm Ortağında doğrulanmış hakediş alacak, ödeme borç; elle girilen banka/kasa hareketleri cariye eklenir. |
| GET | `/api/mali-hareket` | Oturum | YG-850: gelir, maliyet ve nakit hareketleri ayrı satırlar; dosya ve tür süzgeci, satır başına kaynak kayıt. |
| POST | `/api/ozel-arac-onayi` | Oturum | YG-920, YG-921: masraf; limit EUR, form TL; 30 gün sınırı; aşan ödenmez; belgesiz ve mükerrer kabul edilmez; 250 EUR üstü TİD. YG-922: Saha Sorumlusu dışındaki personel özel araç kullanımını yolculuktan önce birim amirinin onayına sunar. |
| GET | `/api/masraf/taslaklarim` | Oturum | YG-920: taslak masraf fişleri ve onaya gönderme. |
| POST | `/api/masraf/:id/gonder` | Oturum | — |
| POST | `/api/masraf` | Oturum | — |
| GET | `/api/fatura/:id/takip-formu` | Oturum | YG-640: FR-TIC-010 tek form; proforma bu formun içindedir. |
| GET | `/api/dosya/:id/mali` | Oturum | — |

### ticari_atama

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ticari-atama` | Oturum | — |
| POST | `/api/dosya/:id/ticari-sorumlu` | Oturum | — |

### toplanti

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/toplanti/secenek` | Oturum | — |
| GET | `/api/portal/toplantilarim` | Oturum | YG-1408: dış katılımcı portalda kendi toplantılarını görür; gündem ve kararlar iç kayıttır, gösterilmez. |
| GET | `/api/toplanti` | Oturum | — |
| POST | `/api/toplanti/cakisma` | Oturum | YG-583: takvim çakışması gösterilir, engellemez. |
| POST | `/api/toplanti` | Oturum | YG-576, YG-579, YG-582, YG-583: katalogdaki roller otomatik eklenir, davet oluşturma anında gider (YG-581). |
| GET | `/api/toplanti/:id` | Oturum | — |
| POST | `/api/toplanti/:id/karar` | Oturum | YG-576, YG-584: karar sorumlu ve tarihle işlenir, sorumlunun Bugün listesine görev düşer. |
| GET | `/api/dosya/:id/toplanti-kararlari` | Oturum | YG-1408: dosyaya bağlı toplantı kararları dosya ekranında görünür. |
| POST | `/api/toplanti/:id/tutanak` | Oturum | Ek II §1.8: tutanağı düzenleyen tutar; YG-584: toplantıyı yöneten onaylayınca kapanır. |
| POST | `/api/toplanti/:id/kapat` | Oturum | — |
| POST | `/api/toplanti/:id/iptal` | Oturum | — |
| GET | `/api/periyodik-isler` | Oturum | — |
| POST | `/api/periyodik-is` | Oturum | — |
| GET | `/api/periyodik-is/:id/paket` | Oturum | YG-534, YG-804: derlenmiş gözden geçirme paketi; yoksa o an derlenir. |
| GET | `/api/periyodik-is/:id/kontrol-listesi` | Oturum | — |
| GET | `/api/gozden-gecirme-sorulari` | Oturum | — |
| POST | `/api/gozden-gecirme-sorulari` | Oturum | — |
| POST | `/api/periyodik-is/:id/sonuc` | Oturum | — |
| POST | `/api/periyodik-is/:id/olay` | Oturum | YG-969: olaya bağlı periyodik iş, olay gerçekleşince sahibi rol veya tanımlama yetkilisi tarafından kaydedilir ve görev açılır. |
| POST | `/api/periyodik-is/:id/durum` | Oturum | — |
| POST | `/api/toplanti/:id/vekil` | Oturum | — |

### toplu_duzeltme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/toplu-duzeltme` | Oturum | — |
| POST | `/api/toplu-duzeltme` | Oturum | — |
| POST | `/api/toplu-duzeltme/:id/uygulandi` | Oturum | — |
| POST | `/api/toplu-duzeltme/:id/kapat` | Oturum | — |

### toplu_odeme

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-toplu-odeme` | Oturum | — |
| POST | `/api/sigorta-toplu-odeme` | Oturum | — |

### tutanak_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/tutanak/:tur/:id/ek` | Oturum | — |
| POST | `/api/tutanak/:tur/:id/ek` | Oturum | — |

### ucret_bandi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ucret-bandi` | Oturum | — |
| POST | `/api/ucret-bandi` | Oturum | — |
| POST | `/api/ucret-bandi/yetki` | Oturum | — |
| POST | `/api/ucret-teklifi` | Oturum | İK teklif hazırlar; bant görmeyen hazırlayana yalnız sonuç söylenir, sınırlar gösterilmez. |
| GET | `/api/ucret-teklifi/roller` | Oturum | — |
| GET | `/api/ucret-teklifi` | Oturum | — |

### uyum

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/verbis-esik` | Oturum | YG-1545: kural kodu ve olay adı kullanıcıya gösterilmez. YG-1544: önceki yılın ortalama çalışan sayısı ve bilanço toplamı eşiklerle gösterilir; bilanço muhasebe hizmetinden gelen değerle Muhasebe ve Finans Müdürünce girilir. |
| POST | `/api/yillik-bilanco` | Oturum | — |
| GET | `/api/uyum-gorevleri` | Oturum | — |
| POST | `/api/uyum-gorevi/:id/kanit` | Oturum | YG-1547 |
| POST | `/api/uyum-gorevi/:id/dogrula` | Oturum | — |
| POST | `/api/bt-varligi` | Oturum | — |

### uyum_tarama

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/resmi-gazete` | Oturum | — |
| POST | `/api/uyum-kurali/:mum/bag` | Oturum | YG-807: kurala yapısal bağ (şablon metni ve eğitim kayıtlı kayda bağlanır; sözleşme türü, belge türü ve iş emri adımı adıyla). |
| POST | `/api/uyum-kurali-bagi/:id/kaldir` | Oturum | — |
| POST | `/api/resmi-gazete/:id` | Oturum | Değişiklik işlenen her kural için bağlı belge, kayıt ve doğrulama adımları "gözden geçirilecekler" olarak kuralın sorumlusuna görev olur. |

### varlik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/varlik` | Oturum | — |
| POST | `/api/varlik` | Oturum | — |
| POST | `/api/varlik/:id/teslim` | Oturum | — |
| POST | `/api/varlik/:id/iade` | Oturum | — |

### vekalet

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/vekalet/tablo` | Oturum | YG-1057: genel vekâlet tablosu; yürürlükteki rol vekâletleri ve izindeki personelin dosya/görev vekilleri. Neden (izin türü, hastalık) gösterilmez. |
| GET | `/api/vekalet` | Oturum | — |
| POST | `/api/vekalet` | Oturum | — |
| POST | `/api/vekalet/:id/bitir` | Oturum | — |

### vergi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/sigorta-vergi-profili` | Oturum | YG-879: profil o şirketin faturalarına kendiliğinden uygulanır; değişiklik yalnız yürürlük tarihinden sonrakilere; eski profil silinmez. |
| POST | `/api/sigorta-vergi-profili` | Oturum | — |
| POST | `/api/taraf-kdv-istisna` | Oturum | YG-881: istisna yazısı ve bitiş tarihi; süre dolunca kdvBelirle istisnayı uygulamaz. |
| POST | `/api/dosya/:id/kesif-teklifi` | Oturum | YG-211, YG-1487: sigortasız dosyada Keşif Teklifi (tarife + bölge dışı, KDV dahil) yat sahibine ONY-24 ile SMS kodlu onaya gider. |
| POST | `/api/dosya/:id/kesif-ucreti` | Oturum | YG-864, YG-1487: sigortasız dosyada keşif ücreti Ödeme Talebi; bölge dışında ulaşım ve konaklama gerçek tutarla eklenir. |
| POST | `/api/dosya/:id/kesif-faturasi` | Oturum | YG-865: sigortanın yaptırdığı keşfin bedeli, teklif reddedilse de proformayla sigortaya faturalanır; tutar Ek-1 mutabakatındandır. |
| POST | `/api/dosya/:id/ayri-kalem` | Oturum | YG-894, YG-896: acil tedbir, keşif söküm-montaj ve bekleme bedelleri ayrı tutulur; sigorta ödemezse yat sahibine kendiliğinden aktarılır (BLD-30, FR-TIC-013). |
| POST | `/api/ayri-kalem/:id/karar` | Oturum | — |

### veri_kalitesi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/veri-kalitesi` | Oturum | — |
| POST | `/api/kalite-kurali/:kod` | Oturum | Kuralın eşik, istisna ve sahibi yeni sürümle değişir; eski sürüm saklanır (YG-1254). |
| POST | `/api/veri-hatasi/:id/istisna` | Oturum | — |

### veri_sozlugu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/veri-sozlugu` | Oturum | — |
| GET | `/api/veri-sozlugu/celiskiler` | Oturum | Çelişki raporu alan adlarını (maliyet alanları dahil) listeler; yalnız veri sözlüğünü yöneten Hukuk ve Bilgi İşlem görür. |
| GET | `/api/veri-envanteri` | Oturum | — |
| POST | `/api/veri-envanteri` | Oturum | — |

### yardim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yardim` | Oturum (ilk giriş adımlarında da) | Yardım ve Akademi içeriği: kullanıcının hedef kitlesine göre; arama başlık ve metinde. Yönetici tümünü (Pasif dahil) görür. |
| POST | `/api/yardim-icerigi` | Oturum | — |
| POST | `/api/yardim-icerigi/:id` | Oturum | Başlık, metin, sıra veya yayın durumu güncellenir; kayıt silinmez, Pasif olur. |
| GET | `/api/yardim-icerigi/:id/dosya` | Oturum (ilk giriş adımlarında da) | Video veya kılavuz dosyası tarayıcıda oynatılır/açılır (indirme zorunlu değil). |

### yat

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yat/marka` | Oturum | YG-1527: yazdıkça daralan liste. |
| GET | `/api/yat/model` | Oturum | — |
| GET | `/api/yat/ara` | Oturum | YG-090: aynı adlı yat uyarısı için arama. |
| GET | `/api/yat/:id/sahip-gecmisi` | Oturumsuz | YG-091: yat satışında sahip devri. Yeni sahip kayıtlı taraf olmalıdır; önceki sahip geçmişte kalır. Açık dosyalar mevcut taraflarıyla sürer, Dosya Sorumlusuna gözden geçirme görevi düşer. |
| POST | `/api/yat/:id/sahip-devri` | Oturumsuz | — |
| POST | `/api/yat/:id/duzelt` | Oturumsuz | — |
| GET | `/api/taraf/ara` | Oturum | — |
| GET | `/api/taraf/:no/iletisim-gecmisi` | Oturum | YG-518: taraf ana kaydının telefon ve e-posta geçmişi; güncel değer bildirim hedefidir, eski değerler kanıt olarak kalır. |
| GET | `/api/taraf/:no/ana-kayit` | Oturum | YG-106: Müşteri Ana Kaydı; kimlik, vergi/MERSİS, KEP, sözleşmeler, sistemce hesaplanan açık alacak, yetki belgeleri, yatlar ve dosyalar. |
| POST | `/api/taraf/:no/pasif` | Oturum | YG-926: taraf pasife alınır (gerekçeyle); pasif yat sahibiyle yeni dosya açılmaz. Operasyon Müdürü veya Müşteri ve Paydaş İlişkileri Müdürü. |
| POST | `/api/taraf` | Oturum | — |

### yat_degeri

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/ekonomik-karar` | Oturum | YG-1458: sigortanın yazılı kararını Dosya Sorumlusu tanımlı kanalla girer; oran ve değer ekrana gelmez. |
| GET | `/api/dosya/:id/yat-degeri` | Oturum | YG-985, YG-1172: yalnız dosyaya atanmış iki rol ve yetkili üst roller görür; diğerine kaydın varlığı da söylenmez. |
| POST | `/api/dosya/:id/yat-degeri` | Oturum | K-240: atanmış Operasyon Yöneticisi ve Teknik Yönetici görüşünü yazar; değerler aynı olunca karar kesinleşir. Biri değiştirirse karar yeniden açılır. |
| POST | `/api/dosya/:id/ek-police` | Oturum | YG-336: ek poliçe yüklenince iş emri kapısı açılır. Bedel teklife yansımaz (YG-238). |

### yat_ekipman

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/ekipman` | Oturum | — |
| POST | `/api/dosya/:id/ekipman` | Oturum | — |
| GET | `/api/ekipman/:id/iz` | Oturum | Ekipmanın izi: hangi dosyada hangi bulgu, sökülen parça ve iş emri kalemi. |

### yat_gecmis

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/yat-gecmisi` | Oturum | — |

### yat_takvim

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yat/:id/kullanim-takvimi` | Oturumsuz | — |
| POST | `/api/yat/:id/kullanim-donemi` | Oturumsuz | — |

### yazili_ihtar

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/fatura/:id/yazili-ihtar` | Oturum | — |
| GET | `/api/fatura/:id/yazili-ihtarlar` | Oturum | — |

### yedek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yedekler` | Oturum | — |
| POST | `/api/yedek/:id/olay-bagla` | Oturum | YG-1642: başarısız yedek işi 8 saat içinde OLY-YYYY-NNNN olay kaydına bağlanır; kart tamamlanır. |
| POST | `/api/yedek/:id/islem-talebi` | Oturum | YG-1277: ayrıcalıklı yedek işlemi talebi; talep eden karar veremez, onay zinciri Bilgi İşlem Müdürü → Direktör. |
| GET | `/api/yedek/islem-talepleri` | Oturum | — |
| POST | `/api/geri-yukleme-testi` | Oturum | YG-1279: hedeflerle karşılaştırma; kritik süreçler 24 saat kesinti, 4 saat veri kaybı. |

### yediemin

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/yediemin` | Oturum | — |
| POST | `/api/dosya/:id/yediemin` | Oturum | — |

### yetki

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/ben` | Oturum (ilk giriş adımlarında da) | — |
| GET | `/api/yetki/roller` | Oturum + izin: rol_katalogu.goruntule | — |
| POST | `/api/yetki/rol/:id/tanim` | Oturum + izin: rol_katalogu.duzenle | YG-1007: rolün iş amacı, sahip rolü ve gözden geçirme dönemi. |
| GET | `/api/denetim/izler` | Oturum + izin: denetim_izi.goruntule | YG-1187: izi görüntüleme de kayda geçer. |

### yetki_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/firma-kimlik-aciklama` | Oturum | YG-296, YG-1168: firma kimliği yalnız mahkeme veya resmî makam talebiyle, Hukuk ve Uyum Direktörü onayıyla. |
| GET | `/api/belge/:id/erisim-grubu` | Oturum | YG-1160: Kritik belgede erişim grubu kişi adlarıyla. |
| POST | `/api/belge/:id/erisim-grubu` | Oturum | — |
| POST | `/api/degisiklik-bileti` | Oturum | YG-1001: veri tabanına doğrudan müdahale bileti. |
| GET | `/api/erisim-kapatma` | Oturum | YG-1055: Erişim Kapatma; son 90 günde ayrılan veya ayrılışı süren personelin hesap, açık oturum, aktif rol, mobil cihaz ve sistem dışı erişim (Hesap Kapanış Kontrolü) durumu. |
| GET | `/api/degisiklik-biletleri` | Oturum | YG-1642, YG-1646: bilet listesi (Sistem Yöneticisi kendi biletlerini, Bilgi İşlem Müdürü tümünü görür). |
| POST | `/api/degisiklik-bileti/:id/kapat` | Oturum | — |
| POST | `/api/dosya/:id/hasar-paylasim` | Oturum | YG-1171: hasar bilgisi paylaşımı hiyerarşik, isteğe bağlı çift onay. |
| GET | `/api/firma-portal/ara` | Oturum | YG-1624: firma ve tedarikçi yalnız Dosya No, İş Emri No veya Yat Adı ile arar; sigorta hasar numarası ölçüt ve sonuç değildir. |
| GET | `/api/tedarikci-portal/ara` | Oturum | — |
| GET | `/api/riza-kayitlari` | Oturum | YG-1027: rıza kayıtları; veri sahibi Müşteri ve Paydaş İlişkileri Müdürü, süreç kontrolü Hukuk ve Uyum Uzmanı. |
| GET | `/api/yat-yetkilisi/bekleyen` | Oturum | YG-1566: bekleyen yetki belgeleri. |

### yetki_matrisi

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yetki-matrisi` | Oturum | — |
| POST | `/api/yetki-matrisi/talep` | Oturum | — |

### yetkili_malik

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| POST | `/api/dosya/:id/yetkili-malik-beyani` | Oturum | Dosya Sorumlusu malik kayıtlarını tamamlayınca beyan ekranını bütün maliklere SMS koduyla açar. |

### yonetim_ek

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yonetim-ekleri` | Oturum | — |
| GET | `/api/ic-denetim/orneklem` | Oturum | — |
| GET | `/api/ic-denetim/denetciler` | Oturum | YG-1672: örneklemdeki dosya İç Denetim Müdürünce İç Denetçiye atanır; denetçiye görev açılır, dönemin tüm dosyaları atanınca örneklem görevi kapanır. |
| POST | `/api/ic-denetim/orneklem/ata` | Oturum | — |

### yonetim_panosu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yonetim-panosu` | Oturum | — |

### yonetim_raporu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/yonetim-raporu` | Oturum | — |

### yonetim_takip

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/on-muhasebe/kdv-ozeti` | Oturum | — |
| GET | `/api/on-muhasebe/butce-gerceklesme` | Oturum | — |
| GET | `/api/gozden-gecirmeler` | Oturum | — |
| GET | `/api/yonetim-degerlendirmesi` | Oturum | — |
| GET | `/api/satis-gorusmeleri` | Oturum | YG-771: satış planındaki aylık görüşme hedefleri ve gerçekleşen görüşmeler. |
| POST | `/api/satis-hedefi` | Oturum | — |
| POST | `/api/satis-gorusmesi` | Oturum | — |

### yontem_raporu

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/yontem-raporu` | Oturum | — |
| GET | `/api/firma-portal/is-emri/:id/yontem-raporu` | Oturum | K-192: firmaya ON iş emrinin bağlayıcı eki olarak görünür; yalnız onaylı son sürüm. |
| POST | `/api/dosya/:id/yontem-raporu` | Oturum | — |

### zamanlayici

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/iliski/:id` | Oturum | YG-1146: kullanıcının bildirdiği ilişki kimliğiyle istek, değişiklik, gönderim, entegrasyon, görev ve arka plan işi birlikte izlenir. |
| GET | `/api/bildirim-kurali` | Oturum | YG-510: role göre bildirim kuralı; Sistem Yöneticisi ve Bilgi İşlem tanımlar, değişiklik izlenir. |
| POST | `/api/bildirim-kurali` | Oturum | — |
| GET | `/api/gorev-esigi` | Oturum | — |
| POST | `/api/gorev-esigi` | Oturum | — |
| GET | `/api/hizmet-hesabi-envanteri` | Oturum | YG-1000: hizmet hesabı envanteri; Bilgi İşlem kaydeder, envantere girmeyen hizmet hesabı veri kalitesi kontrolünde hata olur. |
| POST | `/api/hizmet-hesabi-envanteri` | Oturum | — |
| GET | `/api/gonderim/basarisiz` | Oturum | YG-1309: başarısız gönderimler görünür kuyrukta; dosyası, kök nedeni ve önceki yeniden çalıştırmalarıyla. |
| POST | `/api/gonderim/:id/yeniden` | Oturum | YG-1309: operatör hedefi düzeltip yeniden çalıştırır; eski ve yeni hedef, eski hata, kök neden ve gerekçe kaydedilir. |
| GET | `/api/zamanlanmis-isler` | Oturum | — |
| GET | `/api/arka-plan-isleri` | Oturum | YG-1354: son arka plan işleri (sürenler önce). |

### zorluk

| Yöntem | Yol | Erişim | Açıklama |
|---|---|---|---|
| GET | `/api/dosya/:id/zorluk` | Oturum | — |
| POST | `/api/dosya/:id/zorluk` | Oturum | — |
