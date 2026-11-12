-- YG-614: sözleşme takip; taraf, Sözleşme Sahibi, otomatik yenileme, fesih bildirim süresi, imza türü, ekler, kurumsal kanal, yetkili kişiler, karar.
ALTER TABLE sozlesme_kaydi ALTER COLUMN kurulus_ref DROP NOT NULL,
  ADD COLUMN taraf_ref uuid REFERENCES taraf (kimlik), ADD COLUMN taraf_adi text, ADD COLUMN sozlesme_sahibi_rolu text, ADD COLUMN sozlesme_sahibi_ref text REFERENCES kullanici_hesabi (kimlik),
  ADD COLUMN otomatik_yenileme boolean NOT NULL DEFAULT false, ADD COLUMN yenileme_suresi_ay integer CHECK (yenileme_suresi_ay > 0), ADD COLUMN fesih_bildirim_gun integer CHECK (fesih_bildirim_gun > 0),
  ADD COLUMN imza_turu text CHECK (imza_turu IN ('Güvenli Elektronik İmza', 'Islak İmza')), ADD COLUMN ekler uuid[] NOT NULL DEFAULT '{}', ADD COLUMN kurumsal_kanal text, ADD COLUMN yetkili_kisiler text,
  ADD COLUMN yenileme_karari text CHECK (yenileme_karari IN ('Yenileme', 'Fesih', 'Yeniden Görüşme')), ADD COLUMN karar_tarihi date, ADD COLUMN karar_gerekcesi text,
  ADD COLUMN kendiliginden_yenilendi boolean NOT NULL DEFAULT false, ADD COLUMN devam_eden_yukumlulukler text, ADD COLUMN bilgi_sinifi text NOT NULL DEFAULT 'Gizli';
ALTER TABLE sozlesme_kaydi ADD CONSTRAINT sozlesme_kaydi_taraf CHECK (num_nonnulls(kurulus_ref, taraf_ref, taraf_adi) = 1);
-- Firma sözleşmelerinde sahip, türden önerilen roldür.
UPDATE sozlesme_kaydi s SET sozlesme_sahibi_rolu = trim(substring(d.aciklama FROM 'Sözleşme Sahibi:\s*(.+)$')) FROM deger_listesi d WHERE d.liste_kodu = 'LST_SOZLESME_TURU' AND d.deger = s.sozlesme_turu AND s.sozlesme_sahibi_rolu IS NULL;
GRANT SELECT, INSERT, UPDATE ON sozlesme_kaydi TO yatonet_uygulama;
