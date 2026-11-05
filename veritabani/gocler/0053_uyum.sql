-- İP-13: Mevzuat Uyum Matrisi kuralları, uyum görevleri, süre uyarıları (YG-531–533, YG-1545–1549).
CREATE TABLE uyum_kurali (
  mum_no text PRIMARY KEY, alan text, mevzuat text, madde text, yukumluluk text NOT NULL, tetikleyici text, sorumlu_rol text, sure_metni text, gerekli_kanit text, dogrulayan_rol text, kayit text, belge text, dogrulama text, not_metni text, engelleyici boolean NOT NULL DEFAULT false, olay_kodu text, sure_gun integer NOT NULL DEFAULT 30
);
CREATE INDEX uyum_kurali_olay ON uyum_kurali (olay_kodu);
CREATE TABLE uyum_gorevi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), mum_no text REFERENCES uyum_kurali (mum_no), ad text NOT NULL, nesne_turu text NOT NULL, nesne text NOT NULL, son_tarih date NOT NULL, sorumlu_rol text NOT NULL, dogrulayan_rol text NOT NULL, gerekli_kanit text NOT NULL, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kanıt Yüklendi', 'Kapalı')), kanit_belge_ref uuid REFERENCES belge (kimlik), kanit_bitis date, yukleyen_ref text REFERENCES kullanici_hesabi (kimlik), dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), kapanis_zamani timestamptz
);
CREATE UNIQUE INDEX uyum_gorevi_tek ON uyum_gorevi (coalesce(mum_no, ad), nesne_turu, nesne) WHERE durum <> 'Kapalı';
ALTER TABLE sozlesme_kaydi ADD COLUMN fesih_bildirim_son date;
CREATE TABLE bt_varligi (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ad text NOT NULL, tur text NOT NULL CHECK (tur IN ('Donanım', 'Lisans', 'Alan Adı', 'Sertifika', 'Diğer')), bitis date NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON uyum_gorevi, bt_varligi TO yatonet_uygulama;
GRANT SELECT ON uyum_kurali TO yatonet_uygulama;
