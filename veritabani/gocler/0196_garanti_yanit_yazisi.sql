-- YG-728: FR-KLT-016 Garanti ve Şikâyet Yanıt Yazısı (6 varyant), itiraz incelemesi ve takip kontrolü; hakem heyeti parasal sınırı parametresi.
INSERT INTO sistem_parametresi (kod, deger, aciklama, gecerlilik) VALUES ('hakem_heyeti_siniri_tl', 186000, 'Tüketici hakem heyeti parasal sınırı (TL); 2026: 23.12.2025 tarihli ve 33116 sayılı Resmî Gazete; her ocak güncellenir', '2026-01-01') ON CONFLICT (kod) DO NOTHING;

CREATE TABLE garanti_sikayet_yazisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES garanti_sikayet (kimlik), yazi_no text NOT NULL UNIQUE,
  varyant text NOT NULL CHECK (varyant IN ('Garanti Değerlendirme Sonucu', 'Şikâyet Yanıtı', 'İtiraz İnceleme Sonucu', 'Ara Bilgilendirme', 'Takip Kontrolü', 'Talep Yanıtı')),
  inceleme text, islemler jsonb NOT NULL DEFAULT '[]', duzeltme_tarihi date,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylı', 'Reddedildi')),
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON garanti_sikayet_yazisi TO yatonet_uygulama;
GRANT UPDATE (durum, onaylayan_ref, onay_zamani) ON garanti_sikayet_yazisi TO yatonet_uygulama;

ALTER TABLE garanti_sikayet ADD COLUMN itiraz_aciklamasi text, ADD COLUMN itiraz_makami text, ADD COLUMN itiraz_sonucu text CHECK (itiraz_sonucu IN ('Kabul', 'Kısmen Kabul', 'Ret')),
  ADD COLUMN itiraz_gerekcesi text, ADD COLUMN itiraz_karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN itiraz_karar_zamani timestamptz, ADD COLUMN takip_son timestamptz;

ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi', 'Mutabakat Raporu', 'Kurtarma Sözleşmesi', 'Ön Bilgilendirme Formu', 'Yöntem Bilgi Nüshası', 'Nihai Kapanış Özeti', 'Ön Değerlendirme Raporu', 'Kurtarma Sonuç Tutanağı', 'Hasar İhbar ve İlk Kayıt', 'Sigorta Onay Belgesi', 'Garanti Belgesi', 'Değişiklik Kaydı', 'Tedarik Siparişi', 'İhbar Alındı', 'Garanti Şikâyet Yanıtı'));

INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('garanti_sikayet_yazisi', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Dosya Sorumlusu veya Müşteri ve Paydaş İlişkileri Müdür Yardımcısı yazıyı hazırlayınca', 'Müşteri ve Paydaş İlişkileri Müdürü onaylarsa Onaylı, reddederse Reddedildi', 'Müşteri ve Paydaş İlişkileri Müdürü', ARRAY['Onaylı', 'Reddedildi']::text[], false, false, 'Müşteri ve Paydaş İlişkileri Müdürüne onay kartı', NULL),
  ('garanti_sikayet_yazisi', 'Onaylı', 'Kayıt yetkili makamca onaylanmış durumda.', 'Müşteri ve Paydaş İlişkileri Müdürü onaylayınca', 'Son durum; düzeltme yeni yazıyla yapılır', 'Müşteri ve Paydaş İlişkileri Müdürü', ARRAY[]::text[], false, false, 'Yazı PDF olarak yat sahibine gönderilir', NULL),
  ('garanti_sikayet_yazisi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Müşteri ve Paydaş İlişkileri Müdürü reddedince', 'Son durum; yeni yazı hazırlanır', 'Müşteri ve Paydaş İlişkileri Müdürü', ARRAY[]::text[], true, false, NULL, NULL)
ON CONFLICT DO NOTHING;
