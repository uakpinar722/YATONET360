# Kod Varsayımları

Katalogda veya kararlarda cevabı olmayan konularda kodda alınan varsayımlar. Modül adımı sonunda CEO'ya toplu sunulur; onaylanan veya değiştirilen satır kataloğa işlenir.

| No | Adım | Konu | Varsayım | Yer | Durum |
|---|---|---|---|---|---|
| V-1 | 1 | Rol Kataloğunu görenler | Sistem Yöneticisi, Bilgi İşlem Müdürü, Bilgi Teknolojileri ve Firma Yönetimi Direktörü | `kurulum.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-2 | 1 | İşlem İzini görenler | İç Denetçi, İç Denetim Müdürü, Bilgi İşlem Müdürü; CEO görmez | `kurulum.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-3 | 1 | Erişim talebini kim açar | Tüm LGM personeli | `erisim.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-4 | 1 | Bireysel yat sahibinde kurtarma | SMS kullandığı için hesap kurtarma gerekmez | `hesap_kurtarma.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-5 | 1 | Hesap kurtarma kapsamı | Yalnız ikinci faktör sıfırlanır, parola değişmez; kullanıcı parolasını Parolamı Unuttum ile yeniler | `hesap_kurtarma.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-6 | 1 | İç Denetim Müdürü erişim talebi | Risk ve Kalite Direktörü onaylar (idari bağlılık) | `erisim.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-7 | 1 | Vekil uygunluğu | Aynı rol; aynı birim ve kademe; Müdür ve Müdür Yardımcısı birbirine; yoksa onay makamı rolü. CEO'ya GMY veya T&O Direktörü (YG-1058). Direktör vekilleri Cilt II listesi bağlanınca daralır | `vekalet.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-8 | 1 | Vekâlet kapsamı | Vekil, asıl rolün kartlarını ve izinlerini alır; asıl da görmeye devam eder. Parasal limit kontrolü Adım 5'te | `yetki.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-9 | 1 | Kayıtlı cihaz | Doğrulama kurulumundaki cihaz kaydolur; yeni cihaz için kod doğru olsa da oturum açılmaz, rolün onay makamına kart düşer | `cihaz.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-10 | 1 | Çakışan rol listesi | Şimdilik yalnız Teknik Uzman × Kalite Uzmanı (YG-1037); uyarı verir, engellemez. Rol birleştirme tablosu kadro planıyla genişler | `kurulum.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-11 | 1 | Kendi kaydı | Makamda hazırlayandan başka kimse yoksa kayıt açılışta üst makama düşer | `makam.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-12 | 3 | Sabah özeti ve toplu gönderim | CEO kararı BLD-1a: YG-521 ve YG-527 geçerli, YG-522 pasif | `bildirim.ts` | Karara bağlandı |
| V-13 | 3 | Müdür Yardımcısı duyurusu | Dış kapsamlı duyuruyu hazırlayıp onaya gönderebilir; LGM içi duyuruyu yayımlayamaz | `iletisim.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-14 | 3 | Dış kanal sağlayıcıları | E-posta, SMS, WhatsApp hesapları açılana kadar deneme kutusuna yazılır; gerçek kişiye gitmez | `bildirim.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-15 | 3 | Resmî tatil | Mesai hesabı şimdilik Pzt–Cum 09–18, Cmt 09–15; resmî tatil takvimi eklenince daralır | `bildirim.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-16 | 3 | Virüs taraması | Gerçek antivirüs bağlanana kadar deneme tarayıcısı yalnız EICAR sınama imzasını yakalar; kayıtta kaynağı Deneme yazar. Üretim ayarıyla sunucu tarayıcı olmadan açılmaz | `depo.ts`, `belge.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-17 | 3 | Belge bağı | Şimdilik Görev ve Onay kayıtlarına bağlanır; Yat, Taraf, Dosya, İş Emri, Ödeme kendi modülleriyle eklenir. Belge ekranı Adım 4 Dosya Ayrıntısıyla gelir | `belge.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-18 | 3 | Kritik belge | Yalnız yükleyen görür, bağlantıyla paylaşılamaz; isim bazlı erişim listesi Adım 4'te eklenir | `belge.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-19 | 3 | Belge onay makamı | Belgeyi yükleyenin ilk aktif rolünün onay makamı. Türe göre özel onay silsileleri (Teknik Rapor vb.) ilgili modülde | `belge.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-20 | 3 | Paylaşım kodu metni | "Belge erişim kodunuz [kod]. Kodu kimseyle paylaşmayınız; LİMİT GLOBAL MARINE kodunuzu hiçbir zaman sormaz." ONY-20'den türetildi, katalogda yok. Bağlantıyı personel iletir; kod alıcının e-postasına gider, 5 hatalı denemede bağlantı kapanır | `belge.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-21 | 3 | PDF yazı tipi | Cambria ve Calibri (YG-669) kuruluysa kullanılır; Linux sunucuda ölçüleri aynı olan açık lisanslı Caladea ve Carlito devreye girer | `pdf.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-22 | 3 | PDF alt bilgisi | Yalnız resmî unvan. Web, telefon ve sicil NUM-1 gereği yazılmaz; şirket bilgileri (ŞB) kesinleşince parametreden gelir. Logo olarak onaylı taslaktaki gibi YATONET 360 | `pdf.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-23 | 3 | PDF üretim aracı | Üretim sunucusuna Chromium kurulur; geliştirmede Edge kullanılır | `pdf.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-24 | 3 | Toplantı başkanı | Katalogda başkan rolü varsa o rolün katılımcısı (TPL-01…06); yoksa en üst kademedeki LGM katılımcısı. Eşitlikte düzenleyen, sonra alfabetik ilk kişi | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-25 | 3 | TPL-02 temsilcileri | Kalite, ticari ve firma yönetimi temsilcilerini düzenleyen kişi olarak seçer; rolü belli olanlar otomatik eklenir | `0010` | Kabul (VAR-1, CEO 02.11.2026) |
| V-26 | 3 | Dosyaya bağlı toplantılar | TPL-01, 06, 07, 08, 09 Adım 4 Dosya modülüyle açılır; şimdilik planlanamaz | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-27 | 3 | Görüntülü toplantı | YG-588 otomatik bağlantı, sağlayıcı seçilince bağlanır; şimdilik alan var, form göstermiyor | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-28 | 3 | Gündem | Şimdilik yalnız Süresi Aşan Onay sayısı otomatik dolar; dosya, uygunsuzluk ve KPI kaynakları modülleriyle gelir | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-29 | 3 | Periyodik takvim | Motor hazır, liste boş: YG-806 kalemlerinin sahibi ve tarihi ilgili modüllerle eklenir | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-30 | 3 | Yalnız Bilgi katılımcısı | Davet alır, hatırlatma almaz | `toplanti.ts` | Kabul (VAR-1, CEO 02.11.2026) |
| V-31 | 4 | Metin kaynağı | BLD ve ONY metinleri ŞABLONLAR klasöründeki iki resmî Excel'den aktarılır (93 ve 29 satır); depodaki eski 40 satırlık liste kaldırıldı | `bildirim_metinlerini_aktar.py` | Kabul (VAR-2, CEO 02.11.2026) |
| V-32 | 4 | Açılış kararı adı | YG-030 "Koşullu Açılış" esas alındı; Alan Sözlüğü listesi eski adı ("Koşullu Kabul") taşıyor | `dosya.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-33 | 4 | Planlı ilk yanıt | YG-040/YG-144 "8 saat takvim" esas alındı; sözlük "1 iş günü" diyor | `sure.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-34 | 4 | Hiç risk yoksa öneri | Tüm öncelik soruları hayırsa önerilen öncelik Normal | `ihbar.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-35 | 4 | Talep statüsü | Listeye "Birleştirildi", "Dosyaya Dönüştü", "Bekletme" eklendi (YG-007, YG-030 gereği) | `0011` | Kabul (VAR-2, CEO 02.11.2026) |
| V-36 | 4 | Zorluk katsayısı | Teklif onayına kadar 1,00; kapasite bununla hesaplanır (YG-964 teklif onayında girer) | `0011` | Kabul (VAR-2, CEO 02.11.2026) |
| V-37 | 4 | Süre rengi | Kalan süre toplamın dörtte birine inince sarı; katalogda oran yok | `sure.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-38 | 4 | Dosya görüntüleme | dosya.tum: CEO, GMY, T&O, Ticari, Hukuk, Risk-Kalite Direktörleri, Operasyon ve Teknik Müdür ve yardımcıları, MPİ Müdürü, İç Denetim, Muhasebe kadrosu. Diğerleri yalnız ekibinde olduğu dosyayı görür | `kurulum.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-39 | 4 | Parolasız yat sahibi | Y1 ile açılan hesap telefon ve SMS koduyla girer (YG-463); parola belirlemiş hesapta bu yol kapalı | `portal.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-40 | 4 | Mülkiyet "Paylı" | Sözlük listesinde yok, YG-476 ve YG-1463 istediği için eklendi | `portal.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-41 | 5 | Kartela sürümü | 2026.2 Taslak olarak yüklendi; KRT-8 sonrası Yürürlükte olur. CEO'nun Excel'i bitince yeniden aktarılır | `kurulum.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-42 | 5 | Teklif tutarı | Son makam için kümülatif KDV hariç, reddedilmemiş tekliflerin toplamı (YG-173) | `teklif.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-43 | 5 | Ek kalem kartela dışı | Kartela kodu olmayan satır otomatik Kartela Dışı; Kart Öner akışı henüz yok (YG-188) | `teklif.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-44 | 5 | İş emri ara kademe | Operasyon Müdür Yardımcısı → Operasyon Müdürü → limite göre son makam | `firma.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-45 | 5 | Firma onay kodu | Firma kullanıcısının doğrulama uygulaması kodu (TOTP) kabul onayı sayılır (YG-224) | `firma.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-46 | 6 | Sigorta kullanıcısı | Şirket adıyla eşleşir; sigorta sicili açılınca şirket kimliğine bağlanır | `0015` | Kabul (VAR-2, CEO 02.11.2026) |
| V-47 | 6 | Mesai dışı dosya ekibi | Acil dosyada DS ve TU nöbetten atanır; OY ve TY Operasyon/Teknik Müdür atamasını bekler | `acil.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-48 | 7 | İzin günü | Cumartesi mesai günü olsa da YG-948 "hafta sonu düşülür" gereği Cumartesi sayılmaz | `ticari.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-49 | 7 | Avans matrahı | Avans onaylı teklifin KDV dahil genel toplamı üzerinden | `ticari.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-50 | 7 | Firma ödeme tahsilat tarihi | Dosyadaki son tahsilat tarihi esas; oransal bölüşüm (tahsil edilen oranda) henüz yok | `ticari.ts` | Kabul (VAR-2, CEO 02.11.2026) |
| V-51 | 5 | Kalite planı kapısı | YG-288 onarım, ek iş, garanti ve planlı hizmette uygulanır; keşif ve acil iş plandan önce başlar | `kalite.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-52 | 5 | Dosya görüntüleme ek | V-38 listesine Kalite Müdürü ve Yardımcısı, Tedarik Yönetimi Müdürü ve Yardımcısı eklendi; son karar ve sipariş onayı bunu gerektirir. Kalite Kontrolör ve Tedarik Sorumlusu dosyayı ekip ataması ile görür | `kurulum.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-53 | 5 | Kontrol noktası türleri | YG-383 adları esas alındı; Alan Sözlüğü listesi farklı adlar taşıyor | `kalite.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-54 | 5 | Uygunsuzluk kapanışı | YG-284 esas alındı (Kalite Kontrolör, Kritik ve Emniyette Kalite Müdürü); sözlük Teknik Uzman yazıyor | `kalite.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-55 | 5 | Numara önekleri | NCR, DF, TS, KP, SP, MG; katalogda yalnız KP tanımlı | `kalite.ts`, `tedarik.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-56 | 5 | Tekrarlayan uygunsuzluk | Aynı firma ve aynı dayanak ölçütte önceki kayıt varsa tekrarlayan sayılır | `kalite.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-57 | 5 | Bütünleşik test | Dosyada iki veya daha çok test grubu varsa nihai kabul bütünleşik test ister (YG-400) | `kalite.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-58 | 5 | Parça bedeli kapısı | Avans alınmayan dosyada aranmaz; diğerlerinde Parça veya Avans ödemesi tamamlanmış olmalı (YG-906) | `tedarik.ts` | Kabul (VAR-3, CEO 03.11.2026) |
| V-59 | 4 | Yat değerinde görüş ayrılığı | İki değer farklıysa teklif ve iş emri kapalı kalır; Teknik ve Operasyon Direktörüne görev açılır; Direktör değer girmez | `yat_degeri.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-60 | 4 | Ortak karar biçimi | İki kişi ayrı ayrı değer ve dayanak girer; değerler kuruşuna kadar aynıysa kesinleşir; biri değiştirirse yeniden açılır | `yat_degeri.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-61 | 4 | Ek poliçe kaydı | Ek poliçeyi Hukuk ve Uyum Direktörü belgeyle kaydeder; katalogda sahip yok | `yat_degeri.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-62 | 4 | Poliçe limiti tanımsız | Olay başı limit girilene kadar her hasar dosyasında ek poliçe gerekli sayılır ve onarım iş emri kapalıdır | `yat_degeri.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-63 | 4 | Keşif iş emri | YG-126 yalnız acil ilk tedbiri ayırdığı için keşif iş emri de ortak karardan sonra verilir | `firma.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-64 | 4 | Ekonomik oran matrahı | Oran, dosyadaki kümülatif KDV hariç teklif tutarı üzerinden; iç onaya gönderilirken ölçülür | `teklif.ts` | Kabul (VAR-4, CEO 03.11.2026) |
| V-65 | 6 | Otomatik sigorta iletileri | BLD-45 ve BLD-72 gibi kendiliğinden üretilen iletilerde son gönderen Dosya Sorumlusu veya Yedek Sorumlu sayılır; teyit gelene kadar ileti gitmez | `sigorta_gonderim.ts` | Kabul (VAR-5, CEO 03.11.2026) |
| V-66 | 6 | Teyit arası süre | İki teyit arasında en az 2 saniye (parametre); ikinci düğme bu sürede kapalı | `0019` | Kabul (VAR-5, CEO 03.11.2026) |
| V-67 | 6 | Sigorta tarafı tanımı | Adres dosyanın sigorta tarafı kaydından tanınır; eksper ve sigorta portal kullanıcısının sistem içi bildirimi kapsam dışı | `bildirim.ts` | Kabul (VAR-5, CEO 03.11.2026) |
| V-68 | 7 | Tedarikçi sipariş kabul kodu | YG-1577 SMS kodu diyor; YG-1150 kurumsal dış kullanıcıya doğrulama uygulaması diyor. Firma ile aynı doğrulama uygulaması kodu kullanıldı (V-45); SMS yalnız uygulamayı kullanamayan için ileride | `portallar.ts` | Kabul (VAR-6, CEO 03.11.2026) |
| V-69 | 7 | Portalsız tedarikçi | Portal kullanıcısı olan tedarikçide malzeme girişi sipariş kabulünden sonra yapılır; kullanıcısı olmayanda Tedarik Sorumlusu kabulsüz giriş açabilir | `tedarik.ts` | Kabul (VAR-6, CEO 03.11.2026) |
| V-70 | 7 | BLD-23 zamanı | Teslim ve taşıma kısıtı bildirimi, dosya için o tesise açılan ilk talepte gider | `portallar.ts` | Kabul (VAR-6, CEO 03.11.2026) |
| V-71 | 7 | Nazik metin kapsamı | YG-1576 sistem hata ve yönlendirme metinlerine uygulandı; onaylı BLD ve ONY metinlerine dokunulmadı | `api/src` | Kabul (VAR-6, CEO 03.11.2026) |
| V-72 | 5 | Teklif ve rapor bağı | Hasar dosyasında teklif iç onaya, Teknik Yönetici kontrolünden geçmiş Teknik Rapor olmadan gitmez (YG-200 yorumu); acil tedbir teklifi hariç | `rapor.ts` | Kabul (VAR-7, CEO 03.11.2026) |
| V-73 | 5 | Süre aşımında son makam | Son makamda 1 saat aşımda iş bir üst makama geçer; CEO son makamsa yalnız uyarı ve CEO Asistanına bilgi | `onay_sure.ts` | Kabul (VAR-7, CEO 03.11.2026) |
| V-74 | 5 | Kademe atlama kapsamı | Direktör yalnız silsilesindeki işi, GMY CEO son makam olmayan her işi, CEO her işi öne alır; mesleki kararlar (kalite planı, kapsam cetveli, teknik rapor) hariç | `is_motoru.ts` | Kabul (VAR-7, CEO 03.11.2026) |
| V-75 | 5 | Kart önerisi kodu | Kartelaya öneriyle eklenen kalem KO-nnnnn kodu alır; Teknik Uzman maliyeti önerir, Ticari İşler Direktörü onaylar | `rapor.ts` | Kabul (VAR-7, CEO 03.11.2026) |
| V-76 | 5 | Ek teklif Açık İşi | Yanıtsız ek teklif düşünce Dosya Sorumlusuna 7 gün hedefli Açık İş açılır | `teklif.ts` | Kabul (VAR-7, CEO 03.11.2026) |
| V-77 | 5 | Masraf kalemi | Tesis bedeli teklife Ticari Sorumlu tarafından, belge zorunlu, miktar 1 adet, KDV teklif oranıyla eklenir; firma bedeline ve iş emrine girmez | `teklif.ts` | Kabul (VAR-8, CEO 03.11.2026) |
| V-78 | 5 | PDF kuyruğu | Belge işlem içinde kuyruğa yazılır, en geç 1 dakikada üretilir; 3 başarısız denemede Dosya Sorumlusuna görev açılır | `belge_uret.ts` | Kabul (VAR-9, CEO 03.11.2026) |
| V-79 | 5 | PDF hatasında ileti | Üretim 3 kez başarısız olursa yat tarafı iletisi eksiz gider (onay kodu kaybolmaz); sigorta iletisi eksiz gitmez, görevde belirtilir | `belge_uret.ts` | Kabul (VAR-9, CEO 03.11.2026) |
| V-80 | 5 | Sigortaya ek | BLD-71 ekinde teklif PDF'i ve varsa onaylı Teknik Rapor gider; ek listesi teyit ekranında henüz gösterilmez | `teklif.ts` | Kabul (VAR-9, CEO 03.11.2026) |
| V-81 | 5 | Numara uyumu | Kodda RP ve PF yerine şablondaki TR ve OT kullanılır; proforma ve ödeme talebi aynı OT sayacını paylaşır | `rapor.ts`, `ticari.ts` | Kabul (VAR-9, CEO 03.11.2026) |
| V-82 | 5 | Şablondan eksik bölümler | Teknik Raporda konum şeması, risk ve klas bölümleri; proformada TL karşılığı ve ödeme yolları; tüm belgelerde 7/24 Destek Hattı satırı, veri sisteme girilene kadar yazılmaz | `belge_uret.ts` | Kabul (VAR-9, CEO 03.11.2026) |
| V-83 | 5 | İş Emri PDF | Her zaman Türkçe; fiyat içermez; yayımda firmanın kurumsal e-postasına ekli gider, kabulde onay kaydıyla yeni sürüm olur; Kritik sınıfta | `belge_uret.ts`, `firma.ts` | Kabul (VAR-10, CEO 03.11.2026) |
| V-84 | 5 | Teslim Tutanağı PDF | Yat sahibi onayında üretilir; garanti teslimden 12 ay, kalem bazında; anahtar/evrak/eşya iadesi ve FR-KLT-010 eki verisi sistemde olmadığından yazılmaz | `belge_uret.ts` | Kabul (VAR-10, CEO 03.11.2026) |
| V-85 | 5 | Sigorta adresi | Dosya Sorumlusu veya yedeği girer; adres değişirse bekleyen gönderim birinci teyide döner; e-posta da portal kullanıcısı da yoksa teklif hazırlanmaz | `sigorta_gonderim.ts`, `teklif.ts` | Kabul (VAR-10, CEO 03.11.2026) |
| V-86 | 5 | Teyit önizlemesi | Teklif PDF'i teyit ekranında önizlenir; önizleme dosyaya kaydedilmez, kodu geçerli değildir | `sigorta_gonderim.ts` | Kabul (VAR-10, CEO 03.11.2026) |
| V-87 | 5 | İyi niyet makamı | Oran fatura tutarlarının KDV hariç toplamına göre; fatura yoksa CEO; oran %5 içinde olsa da tutar 10.000,00 EUR üstündeyse CEO (GMY parasal sınırı) | `saha.ts` | Kabul (VAR-11, CEO 03.11.2026) |
| V-88 | 5 | Eksper karşılaştırması | Tutarları Dosya Sorumlusu veya yedeği, rapor dosyaya yüklendikten sonra girer; dosyaya erişen LGM rolleri görür; maliyet gösterilmez | `teklif.ts` | Kabul (VAR-11, CEO 03.11.2026) |
| V-89 | 5 | Yeniden değerlendirme | Kalem başına bir kez; iptal edilen talep hak tüketmez; yanıtı Dosya Sorumlusu tanımlı kanalla girer; yanıt görevi 5 iş günü; yanıt yoksa kendiliğinden onay sayılmaz; sürerken yat sahibine teklif gönderilmez | `teklif.ts` | Kabul (VAR-11, CEO 03.11.2026) |
| V-90 | 5 | Teknik gerekçe filtresi | Yeniden değerlendirme gerekçesinde teminat, muafiyet, sigorta/poliçe kapsamı geçerse kabul edilmez (SGT-1) | `teklif.ts` | Kabul (VAR-11, CEO 03.11.2026) |
| V-91 | 5 | Sigorta adresi görevi | BLD-45 ve BLD-72 adres yoksa atlanmaz, Dosya Sorumlusuna tek görev açılır, adres girilince kapanır; ileti o an yeniden üretilmez | `sigorta_gonderim.ts` | Kabul (VAR-11, CEO 03.11.2026) |
| V-92 | 5 | Ek-2 sahibi | Sigorta Ek-2 listesini Müşteri ve Paydaş İlişkileri Müdürü kaydeder; Ek-3 onay yetkilisini Dosya Sorumlusu veya yedeği girer | `sigorta_ek2.ts` | Kabul (VAR-12, CEO 03.11.2026) |
| V-93 | 5 | Ek-2 denetimi | Yalnız kurumsal e-posta kanalında uygulanır; KEP ve e-imzada adres denetimi yapılmaz, belge zorunludur; Ek-2 kaydı olmayan şirkette e-posta kanalı kabul edilmez; adres büyük/küçük harf duyarsız | `sigorta_ek2.ts` | Kabul (VAR-12, CEO 03.11.2026) |
| V-94 | 5 | Tek işlem sınırı | Onaylanan tutar KDV hariç, kalem toplamıyla karşılaştırılır; sınır boşsa uygulanmaz | `sigorta_ek2.ts` | Kabul (VAR-12, CEO 03.11.2026) |
| V-95 | 5 | Ekonomik kilit kapsamı | %80 eşiğinde sigortalı dosyada yeni teklif, masraf kalemi ve ek iş emri beklemeye alınır; o an onayda olan teklif durmaz; Devam kararından sonra aynı dosyada yeniden kilitlenmez | `yat_degeri.ts` | Kabul (VAR-13, CEO 03.11.2026) |
| V-96 | 5 | Ekonomik karar kaydı | Sigorta kararını Dosya Sorumlusu veya yedeği tanımlı kanalla girer; Onarım Yapılmayacak kararında kilit kalır, Hükmi Tam Ziya kapanışı için görev açılır, dosya kendiliğinden kapanmaz | `yat_degeri.ts` | Kabul (VAR-13, CEO 03.11.2026) |
| V-97 | 5 | Kurum kullanıcısı | Kurumdaki her kullanıcı yeni kullanıcı talebi açabilir; LGM teyidini Sicil Sorumlusu verir; rol kurum türünden gelir (Firma Yetkilisi, Tedarikçi Kullanıcısı, Tesis Yetkilisi) | `kurum_hesap.ts` | Kabul (VAR-14, CEO 03.11.2026) |
| V-98 | 5 | Hesap kapatma | Kurum bildirince hesap hemen kapanır, oturum biter; Sicil Sorumlusuna 24 saat içinde gözden geçirme görevi düşer; kişi kendi hesabını kapatamaz | `kurum_hesap.ts` | Kabul (VAR-14, CEO 03.11.2026) |
| V-99 | 5 | Tedarikçi ödeme durumu | Kontrol Bekleniyor, Fark İnceleniyor, Ödeme Planlandı, Ödendi; vade fatura tarihinden 60 gün; ödemeyi muhasebe kadrosu kaydeder, üçlü eşleşme ve teyitli banka hesabı şart | `kurum_hesap.ts`, `portallar.ts` | Kabul (VAR-14, CEO 03.11.2026) |
| V-100 | 5 | Tedarikçi ana sayfası | Ana Sayfa yalnız yanıt bekleyen teklif ve kabul bekleyen siparişi gösterir; sevk ve fatura girişi Siparişler menüsündedir | `Portallar.tsx` | Kabul (VAR-14, CEO 03.11.2026) |
| V-101 | 5 | Firma bilgi değişikliği | E-posta, telefon, il ve ilçe Sicil Sorumlusu teyidiyle işlenir; unvan ve vergi no portaldan değişmez | `kurum_hesap.ts` | Kabul (VAR-15, CEO 03.11.2026) |
| V-102 | 5 | Portaldan IBAN | Kurum IBAN bildirir, karantinada başlar, firmaya maskeli görünür; teyit mevcut Muhasebe ve Finans Müdürü akışıyla | `kurum_hesap.ts` | Kabul (VAR-15, CEO 03.11.2026) |
| V-103 | 5 | Kabul itirazı | Ret veya Koşullu Onaylı karardan 15 gün içinde bir kez; kabul edilirse başvuru İncelemede'ye döner, Direktör ayrıca karar vermez | `kurum_hesap.ts` | Kabul (VAR-15, CEO 03.11.2026) |
| V-104 | 5 | Cari ekstrede tahsilat | Tahsilat tarihi dosyadaki son tahsilat; müşteri adı yazılmaz; açık net, ödenmemiş ve reddedilmemiş hakedişlerin toplamı | `kurum_hesap.ts` | Kabul (VAR-15, CEO 03.11.2026) |
| V-105 | 5 | Tedarik süresi | Sipariş tarihinden ilk kabul edilen malzeme girişine; parça no bazında ortalama; marka alanı siparişte olmadığından marka kırılımı yok | `kurum_hesap.ts` | Kabul (VAR-15, CEO 03.11.2026) |
| V-106 | 5 | Firma ana sayfası | Ana Sayfa acil çağrı, uygunsuzluk ve kabul bekleyen iş emirlerini; İş Emirleri menüsü tümünü gösterir | `Ticari.tsx` | Kabul (VAR-15, CEO 03.11.2026) |
| V-107 | 5 | Banka hesabı onay zinciri | Firma Yönetimi Müdür Yardımcısı kontrol, Firma Yönetimi Müdürü birinci, Muhasebe ve Finans Müdürü ikinci onay; geri aramayı Muhasebe ve Finans Müdür Yardımcısı istediği anda yapar, son onaydan önce şarttır | `ticari.ts` | Kabul (VAR-16, CEO) |
| V-108 | 5 | Yeni banka hesabı | Onayda önceki geçerli hesap İptal durumuna geçer, silinmez; aynı anda tek geçerli hesap vardır | `ticari.ts` | Kabul (VAR-16, CEO) |
| V-109 | 5 | Hukuk görüşü kullanımı | Görüş bağlayıcı değildir, "Uygun Görülmedi" olsa da karar verilebilir; her olumsuz karar için ayrı görüş gerekir; görüşü Hukuk ve Uyum Direktörü onay kartından verir | `firma.ts` | Kabul (VAR-16, CEO) |
| V-110 | 5 | Ölçülemeyen boyut | Verisi olmayan boyut sıfır sayılmaz (YG-743); ağırlığı ölçülen boyutlara orantılı dağılır; iletişimde de aynı | `karne.ts` | Kabul (VAR-17, CEO) |
| V-111 | 5 | Kaynağı henüz olmayan girdiler | Rapor zamanındalığı ve önceden bildirim ölçülmüyor; İSG ihlali, prosedür sapması, denetim bulguları, onaysız ek iş ve teşhisi belirsiz iş kaydı henüz yok, 0 veya Hayır sayılır; bu yüzden Uyum puanı olduğundan yüksek çıkabilir | `karne.ts` | Kabul (VAR-17, CEO) |
| V-112 | 5 | Atıflar | Başarısız test ve garanti kararı dosya düzeyinde olduğundan dosyadaki kapanan iş emirlerinin hepsine yazılır; uygunsuzluk iş emrine veya sorumlu firmaya göre | `karne.ts` | Kabul (VAR-17, CEO) |
| V-113 | 5 | Gecikme hesabı | Firma tamamlama bildirimi ile hedef bitiş farkı; dosyadaki tüm beklemede günleri düşülür; yanıt uyumu iş emri kabulünün hedef süre içinde olmasıdır | `karne.ts` | Kabul (VAR-17, CEO) |
| V-114 | 5 | Dönem sayımı | Yetersiz veri için farklı dosya sayılır; ortalama iş emri kayıtları üzerinden alınır; karne yalnız Çözüm Ortağı içindir | `karne.ts` | Kabul (VAR-17, CEO) |
| V-115 | 5 | Karne itirazı | İş emri puanı başına; incelemede tek itiraz; kabulde kayıtlardan yeniden hesaplanır, önceki puan geçmişte kalır; süre sınırı konmadı, karar hedefi 10 iş günü | `karne.ts` | Kabul (VAR-17, CEO) |
| V-116 | 5 | Karne girdileri eşlemesi | İSG ihlali sapma işaretinden; prosedür sapması Yöntem, Güvenlik veya Belge türü firma kaynaklı sapmadan; onaysız ek iş sapma işaretinden; rapor zamanındalığı Keşif iş emrinde firma kabulünden itibaren süreyle | `karne.ts` | Kabul (VAR-18, CEO) |
| V-117 | 5 | Önceden bildirim | Gecikme varsa hedef bitişten önce günlük kayda engel yazılmışsa 100, yazılmamışsa 0; gecikme yoksa ölçülmez | `karne.ts` | Kabul (VAR-18, CEO) |
| V-118 | 5 | Sapma ve bulgu yetkisi | Sapmayı Saha Sorumlusu, Teknik Uzman, Teknik Yönetici, Kalite Kontrolör, Kalite Müdürü; denetim bulgusunu Kalite Kontrolör, Kalite Müdürü, Firma Yönetimi Müdürü; teşhisi belirsiz işaretini Teknik Uzman veya Teknik Yönetici girer | `saha_kayit.ts` | Kabul (VAR-18, CEO) |
| V-119 | 5 | Parça kabulü | Firma tedariki parçada kararı Teknik Uzman, Kalite Kontrolör veya Tedarik Sorumlusu verir; lot ve belge zorunlu; kontrol görevi Dosya Sorumlusuna düşer | `saha_kayit.ts` | Kabul (VAR-18, CEO) |
| V-120 | 5 | Teslim görünümü | Firma engelin nedenini görmez, yalnız onay durumunu görür; talep Dosya Sorumlusuna gider | `saha_kayit.ts` | Kabul (VAR-18, CEO) |
| V-121 | 5 | Günlük kayıt | İş emri başına günde bir kayıt, aktif iş emrinde; zorunlu alanlar faaliyet, fotoğraf, sonraki plan, sorumlu; kapanan kayıt değişmez; çevrimdışı saklama ve konum mobil uygulamayla gelir | `saha_kayit.ts` | Kabul (VAR-18, CEO) |
| V-122 | 5 | Sapma düzeltmesi | Düzeltme ve Sınırlı Devam kararında hedef tarih zorunlu; sorumlu Dosya Sorumlusu; kapanış kanıtla ve girenden başka yetkiliyle; tekrar izleme firma ve tür bazında 12 ay | `saha_kayit.ts` | Bekliyor (VAR-19) |
| V-123 | 5 | Yeniden başlatma | Tek iş emrini Teknik Müdür güvenli koşul yazarak başlatır; işi durduran açık uygunsuzluk varken başlamaz; Güvenlik türü veya İSG işaretli durdurma emniyet alıcılarına SMS ile gider | `saha_kayit.ts` | Bekliyor (VAR-19) |
| V-124 | 5 | Başlangıç toplantısı kapısı | Onarım, ek iş, garanti ve planlı hizmet TPL-07 kaydı olmadan başlamaz; keşif ve acil muaf; kaydı Dosya Sorumlusu girer; takvim daveti değil kayıttır | `saha_kayit.ts`, `firma.ts` | Bekliyor (VAR-19) |
| V-125 | 5 | Teslim uyuşmazlığı | Süre kaynakta yok: Teslim Talebi 24 saatte sonuçlanmazsa Operasyon Müdürüne görev açılır | `saha_kayit.ts` | Bekliyor (VAR-19) |
| V-126 | 5 | Yeniden değerlendirme | Tarih kabul kararından; statü, aşama veya risk kararı verilince yenilenir; karne özeti çeyrekte bir A39 Firma Yönetimi Müdürüne bildirim | `saha_kayit.ts` | Bekliyor (VAR-19) |
| V-127 | 5 | Uygunsuzluk kapanışında başlama | Uygunsuzluk kapanınca duran iş kendiliğinden başlar; emniyet işaretli ise başlamaz, Teknik Müdür başlatır | `kalite.ts` | Bekliyor (VAR-19) |
