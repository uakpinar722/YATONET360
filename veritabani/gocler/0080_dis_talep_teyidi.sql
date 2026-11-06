-- YG-1272: dışarıdan gelen banka, fiyat, kapsam veya teslim değişikliği talebi kayıtlı numaradan ikinci kanal teyidi olmadan uygulanamaz; benzer alan adlı gönderen bilgi güvenliği göstergesi olarak yükseltilir.
ALTER TABLE olay_kaydi DROP CONSTRAINT IF EXISTS olay_kaydi_olay_turu_check;
ALTER TABLE olay_kaydi ADD CONSTRAINT olay_kaydi_olay_turu_check CHECK (olay_turu IN ('Saha veya Deniz Acili', 'İş Kazası', 'BT Kesintisi veya Veri İhlali', 'Kurumsal Kriz', 'Bilgi Güvenliği Göstergesi'));
CREATE TABLE IF NOT EXISTS dis_degisiklik_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Banka', 'Fiyat', 'Kapsam', 'Teslim')),
  gelis_kanali text NOT NULL CHECK (gelis_kanali IN ('E-posta', 'WhatsApp', 'Telefon', 'Diğer')), gonderen text NOT NULL, ozet text NOT NULL, belge_ref uuid REFERENCES belge (kimlik),
  durum text NOT NULL DEFAULT 'Teyit Bekliyor' CHECK (durum IN ('Teyit Bekliyor', 'Teyit Edildi', 'Teyit Edilmedi')), guvenlik_uyarisi text,
  teyit_numarasi text, teyit_notu text, teyit_eden_ref text REFERENCES kullanici_hesabi (kimlik), teyit_zamani timestamptz,
  kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON dis_degisiklik_talebi TO yatonet_uygulama;
