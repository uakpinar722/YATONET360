-- YG-038 (V-1116): ön değerlendirme raporunun kalite kontrolü; olumsuz kontrolde rapor Onaylı olamaz, yeni bilgi yeni sürümle gelir.
ALTER TABLE on_degerlendirme ADD COLUMN kalite_kontrol_sonucu text CHECK (kalite_kontrol_sonucu IN ('Uygun', 'Uygun Değil')), ADD COLUMN kalite_kontrol_notu text,
  ADD COLUMN kalite_kontrol_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN kalite_kontrol_zamani timestamptz, ADD COLUMN onayli boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT on_degerlendirme_onayli_kontrol CHECK (NOT onayli OR kalite_kontrol_sonucu = 'Uygun');
