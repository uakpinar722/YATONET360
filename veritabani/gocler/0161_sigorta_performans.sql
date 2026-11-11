-- YG-767: sigortacıya RP-TIC-001 ile birlikte aylık performans raporu; veri 3. iş günü 12:00, onaylı rapor 5. iş günü 12:00.
CREATE TABLE sigorta_performans_raporu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sigortaci_adi text NOT NULL, donem text NOT NULL CHECK (donem ~ '^[0-9]{4}-[0-9]{2}$'), veri jsonb, mudur_notu text,
  durum text NOT NULL DEFAULT 'Veri Bekleniyor' CHECK (durum IN ('Veri Bekleniyor', 'Hazırlanıyor', 'Onayda', 'Onaylandı')), veri_son timestamptz NOT NULL, hazir_son timestamptz NOT NULL,
  veri_giren_ref text REFERENCES kullanici_hesabi (kimlik), hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), onay_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (sigortaci_adi, donem)
);
GRANT SELECT, INSERT, UPDATE ON sigorta_performans_raporu TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('sigorta_performans_raporu', 'Veri Bekleniyor', 'Rapor dönemi açıldı; performans verisi bekleniyor.', 'Ay başında sigortacı başına kendiliğinden açılır', 'Müdür Yardımcısı veriyi kaydedince Hazırlanıyor', 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısı', ARRAY['Hazırlanıyor']::text[], false, false, 'Müşteri ve Paydaş İlişkileri Müdür Yardımcısına 3. iş günü 12:00 son süreli görev', NULL),
 ('sigorta_performans_raporu', 'Hazırlanıyor', 'Kayıt hazırlanma aşamasında.', 'Veri kaydedilince veya onaydan iade edilince', 'Müdür onaya gönderince Onayda', 'Müşteri ve Paydaş İlişkileri Müdürü', ARRAY['Onayda']::text[], false, false, 'Müşteri ve Paydaş İlişkileri Müdürüne 5. iş günü 12:00 son süreli görev', NULL),
 ('sigorta_performans_raporu', 'Onayda', 'Kayıt onay zincirinde, sıradaki makamın kararını bekliyor; içerik değiştirilemez.', 'Müdür onaya gönderince', 'Direktör onaylayınca Onaylandı; iade veya retle Hazırlanıyor', 'Strateji ve Kurumsal Gelişim Direktörü', ARRAY['Onaylandı', 'Hazırlanıyor']::text[], false, false, 'Strateji ve Kurumsal Gelişim Direktörüne onay kartı', NULL),
 ('sigorta_performans_raporu', 'Onaylandı', 'Kayıt son yetkili makam tarafından kabul edildi ve sonuç doğurur.', 'Strateji ve Kurumsal Gelişim Direktörü onaylayınca', 'Son durum; RP-TIC-001 mutabakat raporu içinde gönderilir', 'Strateji ve Kurumsal Gelişim Direktörü', '{}'::text[], false, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
