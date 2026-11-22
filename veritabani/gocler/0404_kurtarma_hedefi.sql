-- YG-1279: süreç sınıfına göre kurtarma hedefi (Cilt VIII ¶2535-2543; değer listesi LST_SUREC_SINIFI). İş günü 24 saat sayılır.
CREATE TABLE kurtarma_hedefi (
  surec_sinifi text PRIMARY KEY CHECK (surec_sinifi IN ('Kritik', 'Önemli', 'Destek')), ornek_surecler text NOT NULL,
  rto_dakika integer NOT NULL CHECK (rto_dakika > 0), rpo_dakika integer NOT NULL CHECK (rpo_dakika > 0), kaynak text NOT NULL,
  surec_sahibi_onay_ref text REFERENCES kullanici_hesabi (kimlik), veri_sahibi_onay_ref text REFERENCES kullanici_hesabi (kimlik), yururluk date NOT NULL DEFAULT current_date
);
INSERT INTO kurtarma_hedefi (surec_sinifi, ornek_surecler, rto_dakika, rpo_dakika, kaynak) VALUES
  ('Kritik', 'İhbar, acil görevlendirme, saha güvenliği kaydı, onaylar', 24 * 60, 4 * 60, 'Cilt VIII ¶2535-2537'),
  ('Önemli', 'Fiyat teklifi, iş emri, belge yükleme, fatura bilgisi', 2 * 24 * 60, 24 * 60, 'Cilt VIII ¶2538-2540'),
  ('Destek', 'Raporlar, Akademi, duyuru, harita', 5 * 24 * 60, 24 * 60, 'Cilt VIII ¶2541-2543');
GRANT SELECT ON kurtarma_hedefi TO yatonet_uygulama;
ALTER TABLE geri_yukleme_testi ADD COLUMN surec_sinifi text NOT NULL DEFAULT 'Kritik' REFERENCES kurtarma_hedefi (surec_sinifi),
  ADD COLUMN iliski_tutarli boolean, ADD COLUMN butunluk_tutarli boolean, ADD COLUMN entegrasyon_tutarli boolean, ADD COLUMN ornek_akis_basarili boolean;
