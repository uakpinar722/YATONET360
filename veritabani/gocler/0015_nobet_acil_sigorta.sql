-- Nöbet çizelgesi ve devri, acil müdahale, acil görev çağrısı, sigorta portalı.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('acil_on_uyari_eur', 2000, 'Acil tedbir ön uyarı eşiği (yat sahibine yansıyacak KDV hariç)'),
  ('acil_sinir_eur', 2500, 'Yat sahibi onayı olmadan yapılabilecek yat koruma tedbiri sınırı'),
  ('acil_cagri_dk', 30, 'Sağlayıcı yanıt süresi'),
  ('nobet_donus_dk', 15, 'Nöbet telefonuna dönüş süresi'),
  ('sigorta_karar_is_gunu', 5, 'Sigorta kalem değerlendirme süresi');

CREATE TABLE nobet_cizelgesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), donem text NOT NULL CHECK (donem ~ '^[0-9]{4}-[0-9]{2}$'), surum integer NOT NULL DEFAULT 1, durum text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'Onayda', 'Yürürlükte', 'Yerine Geçti', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), yayim_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (donem, surum)
);
CREATE UNIQUE INDEX nobet_tek_yururluk ON nobet_cizelgesi (donem) WHERE durum = 'Yürürlükte';
CREATE TABLE nobet_vardiyasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), cizelge_ref uuid NOT NULL REFERENCES nobet_cizelgesi (kimlik), katman text NOT NULL CHECK (katman IN ('Dosya Sorumlusu', 'Teknik Uzman', 'Yönetici')), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), baslangic timestamptz NOT NULL, bitis timestamptz NOT NULL, brans text, CHECK (bitis > baslangic)
);
CREATE INDEX nobet_vardiya_zaman ON nobet_vardiyasi (katman, baslangic, bitis);
CREATE TABLE nobet_devri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), devreden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), devralan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kontrol_listesi jsonb NOT NULL, acik_olaylar text, zaman timestamptz NOT NULL DEFAULT now(), devralan_onay_zamani timestamptz, CHECK (devreden_ref <> devralan_ref)
);
GRANT SELECT, INSERT, UPDATE ON nobet_cizelgesi, nobet_vardiyasi, nobet_devri TO yatonet_uygulama;

CREATE TABLE acil_mudahale (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL UNIQUE REFERENCES dosya (kimlik), olay_turu text NOT NULL, can_cevre_riski boolean NOT NULL DEFAULT false, tehlike text NOT NULL, talimat_veren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olay_yoneticisi_ref text REFERENCES kullanici_hesabi (kimlik), hatirlatma_112 boolean NOT NULL DEFAULT false, tahmini_firma_eur numeric(14,2) NOT NULL DEFAULT 0, yansiyan_eur numeric(14,2) NOT NULL DEFAULT 0, sinir_durumu text NOT NULL DEFAULT 'Sınır Altında' CHECK (sinir_durumu IN ('Sınır Altında', 'Ön Uyarı', 'Onay Bekliyor', 'Onaylandı', 'Yükseltildi', 'Sınırsız')), sinir_onay_son timestamptz, sonuc text, risk_durumu text, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı')), baslangic timestamptz NOT NULL DEFAULT now(), bitis timestamptz
);
CREATE TABLE acil_gorev_cagrisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), cagri_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), durum text NOT NULL DEFAULT 'Gönderildi' CHECK (durum IN ('Gönderildi', 'Kabul', 'Müsait Değil', 'Yanıtsız', 'İptal')), gonderim timestamptz NOT NULL DEFAULT now(), son_zaman timestamptz NOT NULL, yanit_zamani timestamptz, is_emri_ref uuid REFERENCES is_emri (kimlik), elle_kayit jsonb
);
CREATE INDEX acil_cagri_acik ON acil_gorev_cagrisi (son_zaman) WHERE durum = 'Gönderildi';
CREATE UNIQUE INDEX acil_cagri_tek_acik ON acil_gorev_cagrisi (dosya_ref) WHERE durum = 'Gönderildi';
ALTER TABLE kurulus ADD COLUMN IF NOT EXISTS acil_musaitlik boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS acil_arama_sirasi integer, ADD COLUMN IF NOT EXISTS acil_musaitlik_zamani timestamptz;
GRANT SELECT, INSERT, UPDATE ON acil_mudahale, acil_gorev_cagrisi TO yatonet_uygulama;

-- Sigorta kullanıcısı şirket adıyla eşleşir; eksper dosya tarafı olarak bağlanır (YG-1570).
CREATE TABLE sigorta_kullanici (kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), sigortaci_adi text NOT NULL);
CREATE INDEX sigorta_kaydi_ad ON dosya_sigorta_kaydi (lower(sigortaci_adi));
ALTER TABLE fiyat_teklifi ADD COLUMN IF NOT EXISTS sigorta_karar_son timestamptz, ADD COLUMN IF NOT EXISTS sigorta_hatirlatma boolean NOT NULL DEFAULT false;
GRANT SELECT, INSERT ON sigorta_kullanici TO yatonet_uygulama;
