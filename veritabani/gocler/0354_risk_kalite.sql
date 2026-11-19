-- YG-1693: kapsamlı kök neden kararı ve Kalite ve İSG Yönetim Gözden Geçirmesi (FR-UYG-006).
CREATE TABLE kapsamli_kok_neden (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), uygunsuzluk_ref uuid NOT NULL REFERENCES uygunsuzluk (kimlik), sistem_etkisi text[] NOT NULL, oneri text NOT NULL, sorumlu_birim text NOT NULL, hedef_tarih date NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'İade Edildi', 'Karar Verildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kalite_yonetim_gozden_gecirme (
  yil integer PRIMARY KEY, girdiler text NOT NULL, kararlar text NOT NULL, eylemler text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON kapsamli_kok_neden, kalite_yonetim_gozden_gecirme TO yatonet_uygulama;
