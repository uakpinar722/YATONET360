-- YG-847, YG-848: kurtarma sağlayıcısının LGM'ye kestiği fatura ve LGM ödemesinin mahsup kaydı; yalnız LGM kullanıcılarına görünür.
CREATE TABLE kurtarma_saglayici_faturasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), operasyon_ref uuid NOT NULL REFERENCES kurtarma_operasyonu (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), saglayici_ref uuid NOT NULL REFERENCES kurulus (kimlik),
  fatura_no text NOT NULL, fatura_tarihi date NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), belge_ref uuid REFERENCES belge (kimlik),
  durum text NOT NULL DEFAULT 'Kontrolde' CHECK (durum IN ('Kontrolde', 'Ödendi', 'Reddedildi')),
  odeme_referansi text, odeme_tarihi date, odeyen_ref text REFERENCES kullanici_hesabi (kimlik), mahsup_lgm_fiyati_eur numeric(14,2),
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kurtarma_saglayici_faturasi_dosya ON kurtarma_saglayici_faturasi (dosya_ref);
GRANT SELECT, INSERT, UPDATE ON kurtarma_saglayici_faturasi TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('kurtarma_saglayici_faturasi', 'Kontrolde', 'Kayıt yetkili kişinin kontrolünde; sonuç bekleniyor.', 'Ticari Sorumlu sağlayıcının LGM''ye kestiği faturayı kaydedince', 'Muhasebe ve Finans Müdürü ödemeyi banka referansıyla kaydedince Ödendi; fatura reddedilince Reddedildi', 'Muhasebe ve Finans Müdürü', ARRAY['Ödendi','Reddedildi']::text[], false, false, NULL, NULL),
  ('kurtarma_saglayici_faturasi', 'Ödendi', 'Ödeme yapıldı ve kayda geçti.', 'Muhasebe ve Finans Müdürü ödemeyi banka referansıyla kaydedince; LGM kurtarma fiyatıyla mahsup kaydı tutulur', 'Son durum; değişmez', 'Muhasebe ve Finans Müdürü', '{}'::text[], false, false, NULL, NULL),
  ('kurtarma_saglayici_faturasi', 'Reddedildi', 'Kayıt yetkili makam tarafından kabul edilmedi; kayıt sonuç doğurmaz, gerekçe kayıtlıdır.', 'Fatura uygun bulunmayınca', 'Son durum; değişmez', 'Muhasebe ve Finans Müdürü', '{}'::text[], false, false, NULL, NULL);
