-- YG-1691: Ek II Değişiklik Talebi (FR-UYG-003); Ek II revizyonunda kurumsal kontrol onayı Risk ve Kalite Direktöründe.
CREATE TABLE ek2_degisiklik_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), arac_kodu text NOT NULL REFERENCES form_katalogu (kod), degisiklik text NOT NULL, gerekce text NOT NULL,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'İade Edildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON ek2_degisiklik_talebi TO yatonet_uygulama;
