-- YG-1697 (A51-S8): Sabit Hukuki Metinler; yeni sürüm Hukuk ve Uyumca hazırlanır, CEO onayıyla yürürlüğe girer.
ALTER TABLE hukuki_metin ADD COLUMN durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Taslak', 'Onayda', 'Yürürlükte', 'Yerine Geçti')),
  ADD COLUMN hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN degisiklik_gerekcesi text;
GRANT INSERT, UPDATE ON hukuki_metin TO yatonet_uygulama;
