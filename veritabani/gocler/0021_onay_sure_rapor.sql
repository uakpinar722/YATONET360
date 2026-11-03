-- Onay bekleme süreleri, kademe atlama, geri çekme; firma ve LGM teknik raporu; kart önerisi; teklif hatırlatması.
ALTER TABLE is_karti ADD COLUMN IF NOT EXISTS kademe_zamani timestamptz NOT NULL DEFAULT now();
ALTER TABLE is_karti DROP CONSTRAINT IF EXISTS is_karti_durum_check;
ALTER TABLE is_karti ADD CONSTRAINT is_karti_durum_check CHECK (durum IN ('Bekliyor', 'İade Edildi', 'Onaylandı', 'Reddedildi', 'Tamamlandı', 'Geri Çekildi'));
ALTER TABLE is_karti_adim ALTER COLUMN yapan_ref DROP NOT NULL;
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('onay_sure_dk_kritik', 30, 'Onay kademesi bekleme süresi, Kritik'), ('onay_sure_dk_yuksek', 120, 'Yüksek'), ('onay_sure_dk_normal', 240, 'Normal'), ('onay_sure_dk_planli', 480, 'Planlı'),
  ('rapor_sure_saat_kritik', 8, 'Firma raporu ve fiyatı, Kritik'), ('rapor_sure_saat_yuksek', 48, 'Yüksek'), ('rapor_sure_saat_normal', 72, 'Normal'), ('rapor_sure_saat_planli', 120, 'Planlı')
ON CONFLICT (kod) DO NOTHING;
CREATE TABLE kart_sure_kaydi (is_ref uuid NOT NULL REFERENCES is_karti (kimlik), kademe integer NOT NULL, adim text NOT NULL CHECK (adim IN ('Uyarı', 'Süre Doldu', 'Üst Kademeye Geçti', 'Yeniden Uyarı')), rol_ref text REFERENCES rol (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (is_ref, kademe, adim));
CREATE TABLE firma_teknik_raporu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), rapor_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), inceleme_tarihi date NOT NULL, bulgular text NOT NULL, onerilen_islemler text NOT NULL, malzeme_ihtiyaci text, tahmini_sure_gun integer NOT NULL CHECK (tahmini_sure_gun > 0), firma_degerlendirmesi text NOT NULL, firma_onayi timestamptz NOT NULL DEFAULT now(), lgm_inceleyen_ref text REFERENCES kullanici_hesabi (kimlik), lgm_inceleme_zamani timestamptz, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), UNIQUE (is_emri_ref)
);
CREATE TABLE teknik_rapor (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), rapor_no text NOT NULL UNIQUE, surum integer NOT NULL DEFAULT 1, rapor_turu text NOT NULL CHECK (rapor_turu IN ('İlk Rapor', 'Ek Teknik Rapor', 'Garanti İnceleme Raporu')), ana_rapor_ref uuid REFERENCES teknik_rapor (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), dayanak_firma_raporu_ref uuid REFERENCES firma_teknik_raporu (kimlik), kapsam text NOT NULL, incelenen_alan text NOT NULL, saha_kosullari text NOT NULL, yontem_olcut text NOT NULL, bulgular text NOT NULL, acik_sorular text NOT NULL, analiz_risk text NOT NULL, oneriler text NOT NULL, uzmanlik_siniri text NOT NULL, rapor_dili text NOT NULL DEFAULT 'Türkçe', durum text NOT NULL DEFAULT 'Kontrolde' CHECK (durum IN ('Kontrolde', 'İade Edildi', 'Onaylı', 'Reddedildi', 'Geri Çekildi')), son_zaman timestamptz, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teknik_rapor_dosya ON teknik_rapor (dosya_ref);
CREATE TABLE kart_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), ana_brans text NOT NULL, alt_brans text NOT NULL, tali_brans text NOT NULL, islem text NOT NULL, birim text NOT NULL, maliyet_eur numeric(12,2) NOT NULL CHECK (maliyet_eur >= 0), gerekce text NOT NULL, kod text, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Eklendi', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fiyat_teklifi ADD COLUMN IF NOT EXISTS gecerlilik_hatirlatma boolean NOT NULL DEFAULT false;
GRANT SELECT, INSERT, UPDATE ON kart_sure_kaydi, firma_teknik_raporu, teknik_rapor, kart_onerisi TO yatonet_uygulama;
GRANT INSERT ON kartela_kalemi TO yatonet_uygulama;
