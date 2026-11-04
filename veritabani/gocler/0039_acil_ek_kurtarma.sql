-- YG-243 nöbet çağrısı; YG-261 olay komutası; YG-1459, YG-1489 olağanüstü dönem; YG-1481 temas kaydı; YG-273 acil yanıt; YG-210, YG-276, YG-486, YG-1515 kurtarma; YG-277 çevre bildirimi; YG-1658 konum.
CREATE TABLE sirket_bilgisi (anahtar text PRIMARY KEY, deger text NOT NULL);
CREATE TABLE nobet_cagrisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hat text NOT NULL CHECK (hat IN ('Operasyon', 'Teknik')), arayan text NOT NULL, telefon text, ozet text NOT NULL, kademe integer NOT NULL DEFAULT 0, sorumlu_rol text NOT NULL, sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), son_zaman timestamptz NOT NULL, donus_zamani timestamptz, donus_notu text, donen_ref text REFERENCES kullanici_hesabi (kimlik), acan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nobet_cagrisi_acik ON nobet_cagrisi (son_zaman) WHERE donus_zamani IS NULL;
CREATE TABLE olay_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), olay_turu text NOT NULL CHECK (olay_turu IN ('Saha veya Deniz Acili', 'İş Kazası', 'BT Kesintisi veya Veri İhlali', 'Kurumsal Kriz')), ozet text NOT NULL, dosya_ref uuid REFERENCES dosya (kimlik), acan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE olaganustu_donem ADD COLUMN bolge text, ADD COLUMN olay text;
CREATE TABLE olaganustu_onerisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), bolge text NOT NULL, olay text NOT NULL, durum text NOT NULL DEFAULT 'Görüşte' CHECK (durum IN ('Görüşte', 'İlan Edildi', 'Reddedildi')), oneren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE acil_temas_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('112 Arandı', 'Marina Teması', 'Operasyon Müdürü Arandı', 'Refakatli Giriş', 'Sahil Güvenlik', 'Liman Başkanlığı', 'İl Çevre Müdürlüğü')), ozet text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acil_temas_dosya ON acil_temas_kaydi (dosya_ref);
ALTER TABLE kurulus ADD COLUMN acil_yanit_dk integer CHECK (acil_yanit_dk > 0);
CREATE TABLE kurtarma_operasyonu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), hizmet_turu text NOT NULL CHECK (hizmet_turu IN ('Kurtarma', 'Çekme / Refakat', 'Dalgıçlık', 'Birden Fazla')), saglayici_ref uuid NOT NULL REFERENCES kurulus (kimlik), acil boolean NOT NULL DEFAULT false, onay_talebi_ref uuid REFERENCES onay_talebi (kimlik), yat_sahibi_onay_zamani timestamptz, firma_onay_zamani timestamptz, firma_onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), koordinator_onay_zamani timestamptz, koordinator_ref text REFERENCES kullanici_hesabi (kimlik), saglayici_aciklama_onayi boolean NOT NULL DEFAULT false, liman_izni_belge uuid REFERENCES belge (kimlik), dalis_plani_belge uuid REFERENCES belge (kimlik), enerji_izolasyon_belge uuid REFERENCES belge (kimlik), baslama_zamani timestamptz, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kurtarma_dosya ON kurtarma_operasyonu (dosya_ref);
CREATE TABLE acil_konum (
  talep_ref uuid PRIMARY KEY REFERENCES talep (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), aktif boolean NOT NULL DEFAULT true, durduran text, durma_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE konum_kaydi (
  kimlik bigserial PRIMARY KEY, talep_ref uuid NOT NULL REFERENCES talep (kimlik), enlem numeric(9,6), boylam numeric(9,6), kaynak text NOT NULL CHECK (kaynak IN ('Cihaz', 'Kayıtlı Konum')), metin text, zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX konum_kaydi_talep ON konum_kaydi (talep_ref, zaman DESC);
GRANT SELECT, INSERT, UPDATE ON nobet_cagrisi, olay_kaydi, olaganustu_onerisi, acil_temas_kaydi, kurtarma_operasyonu, acil_konum, konum_kaydi, sirket_bilgisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE konum_kaydi_kimlik_seq TO yatonet_uygulama;
GRANT INSERT, UPDATE ON olaganustu_donem TO yatonet_uygulama;
