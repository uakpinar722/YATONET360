-- YG-622: yabancı sigortacının sörveyör raporu, onarım onayı ve ödeme yazısı yalnız bilgi belgesidir; onay veya muvafakat kanıtı olamaz.
ALTER TABLE belge_turu_kurali ADD COLUMN yalniz_bilgi boolean NOT NULL DEFAULT false;
INSERT INTO belge_turu_kurali (belge_turu, zorunlu_alanlar, yalniz_bilgi) VALUES
 ('Yabancı Sigortacı Sörveyör Raporu', ARRAY['belge_tarihi', 'kaynak_kisi'], true), ('Yabancı Sigortacı Onarım Onayı', ARRAY['belge_tarihi', 'kaynak_kisi'], true), ('Yabancı Sigortacı Ödeme Yazısı', ARRAY['belge_tarihi', 'kaynak_kisi'], true)
ON CONFLICT (belge_turu) DO UPDATE SET yalniz_bilgi = true;
