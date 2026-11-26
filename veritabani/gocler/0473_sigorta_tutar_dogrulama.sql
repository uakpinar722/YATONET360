-- YG-1608, TZ-6 (CEO 26.11.2026): sigorta onay tutarı onaylı teklifin KDV hariç toplamından 0,01 EUR'dan fazla farklıysa Ticari Sorumlu doğrular veya gerekçeyle iade eder.
ALTER TABLE sigorta_onayi ADD COLUMN tutar_kontrol_sonucu text CHECK (tutar_kontrol_sonucu IN ('Doğrulandı', 'İade Edildi')),
  ADD COLUMN tutar_kontrol_gerekcesi text, ADD COLUMN tutar_kontrol_eden_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN tutar_kontrol_zamani timestamptz;
