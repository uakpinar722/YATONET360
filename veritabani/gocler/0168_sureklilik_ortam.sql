-- YG-1287: süreklilik testi ölçütleri testten önce tanımlanır; sapmalar sorumlu ve hedef tarihle izlenir, yeniden sınanır.
CREATE TABLE sureklilik_testi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ad text NOT NULL, senaryo text NOT NULL, plan_tarihi date NOT NULL, olcutler jsonb NOT NULL, olcut_zamani timestamptz NOT NULL DEFAULT now(),
  sonuclar jsonb, durum text NOT NULL DEFAULT 'Planlandı' CHECK (durum IN ('Planlandı', 'Tamamlandı')), yeniden_sinanan_ref uuid REFERENCES sureklilik_testi (kimlik), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), sonuc_zamani timestamptz
);
CREATE TABLE sureklilik_sapmasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_ref uuid NOT NULL REFERENCES sureklilik_testi (kimlik), olcut text NOT NULL, hedef text NOT NULL, gerceklesen text NOT NULL, sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), hedef_tarih date,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı')), kapatan_test_ref uuid REFERENCES sureklilik_testi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
-- YG-1119, YG-1280: üretim verisinin alt ortama kopyası yalnız veri sahibi ve güvenlik onayıyla, geri döndürülemez maskeleme, süreli erişim, kapalı dış bağlantı ve güvenli imhayla.
CREATE TABLE alt_ortam_kopyasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ortam text NOT NULL CHECK (ortam IN ('Test', 'Eğitim', 'Geliştirme')), amac text NOT NULL, veri_kapsami text NOT NULL, veri_sahibi_rol text NOT NULL,
  maskeleme text NOT NULL CHECK (maskeleme = 'Geri Döndürülemez'), maskeleme_yontemi text NOT NULL, dis_baglanti_kapali boolean NOT NULL CHECK (dis_baglanti_kapali), erisim_bitis date NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Aktif', 'Reddedildi', 'İmha Edildi')), veri_sahibi_onay_ref text REFERENCES kullanici_hesabi (kimlik), guvenlik_onay_ref text REFERENCES kullanici_hesabi (kimlik),
  imha_zamani timestamptz, imha_kaniti text, talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
-- YG-1355: yanıt süresi hedefini aşan istek sayısı (uç gecikme).
ALTER TABLE istek_olcumu ADD COLUMN yavas integer NOT NULL DEFAULT 0;
GRANT SELECT, INSERT, UPDATE ON sureklilik_testi, sureklilik_sapmasi, alt_ortam_kopyasi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('sureklilik_testi', 'Planlandı', 'İş için tarih ve sorumlu belirlendi; henüz başlamadı.', 'Test ve başarı ölçütleri testten önce tanımlanınca', 'Sonuçlar girilince Tamamlandı', 'Sistem Yöneticisi', ARRAY['Tamamlandı']::text[], false, false, NULL, NULL),
 ('sureklilik_testi', 'Tamamlandı', 'Kayıttaki iş bitti; gerekli kayıtlar oluştu.', 'Ölçüt sonuçları girilince; sapmalar ayrıca açılır', 'Son durum', 'Sistem Yöneticisi', '{}'::text[], false, false, 'Sapma varsa sorumluya bildirim', NULL),
 ('sureklilik_sapmasi', 'Açık', 'Kayıt üzerinde çalışma sürüyor; kapanış koşulları henüz sağlanmadı.', 'Ölçüt hedefi tutmayınca', 'Aynı ölçüt yeniden sınanıp hedefi tutunca Kapalı', 'Bilgi İşlem Müdürü', ARRAY['Kapalı']::text[], false, false, 'Sorumluya hedef tarihli görev', NULL),
 ('sureklilik_sapmasi', 'Kapalı', 'Kayıt kapanış koşulları sağlanarak sonuçlandırıldı; yeni işlem yapılmaz.', 'Yeniden sınamada ölçüt tutunca', 'Son durum', 'Sistem', '{}'::text[], false, false, NULL, NULL),
 ('alt_ortam_kopyasi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Talep maskeleme, süre ve kapalı dış bağlantıyla açılınca', 'Veri sahibi ve güvenlik onayıyla Aktif; retle Reddedildi', 'Bilgi İşlem Müdürü', ARRAY['Aktif', 'Reddedildi']::text[], false, false, 'Veri sahibine ve Bilgi İşlem Müdürüne onay görevi', NULL),
 ('alt_ortam_kopyasi', 'Aktif', 'Kayıt yürürlükte ve kullanılıyor.', 'İki onay tamamlanınca', 'Erişim süresi bitince imha görevi; imha kanıtıyla İmha Edildi', 'Sistem Yöneticisi', ARRAY['İmha Edildi']::text[], false, false, 'Süre bitiminde Sistem Yöneticisine imha görevi', NULL),
 ('alt_ortam_kopyasi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Veri sahibi veya güvenlik reddedince', 'Son durum', 'Bilgi İşlem Müdürü', '{}'::text[], true, false, NULL, NULL),
 ('alt_ortam_kopyasi', 'İmha Edildi', 'Kayıt imha yöntemine göre imha edildi ve kayda geçti.', 'İmha kanıtı girilince', 'Son durum', 'Sistem Yöneticisi', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
