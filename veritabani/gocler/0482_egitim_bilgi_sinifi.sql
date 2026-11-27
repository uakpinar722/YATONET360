-- YG-1177: eğitim başarı kaydı e-posta taşır; kişisel veri tablosu olarak Gizli sınıftadır, Kamuya Açık olamaz.
ALTER TABLE egitim_basarisi ADD COLUMN bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CONSTRAINT egitim_basarisi_bilgi_sinifi_kisisel CHECK (bilgi_sinifi IN ('Kurumsal', 'Gizli', 'Kritik'));
