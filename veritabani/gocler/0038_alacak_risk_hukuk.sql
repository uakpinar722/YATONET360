-- YG-820, YG-912, YG-914 hukuk kararı; YG-909, YG-1488, YG-1490 kredi limiti ve konkordato; YG-872 gecikme faizi; YG-887 fatura itirazı; YG-915 haciz ihbarı; YG-916 tarama ve üçüncü kişi ödemesi; YG-107 uyuşmazlık; YG-923 sözleşme kapısı; YG-826 boş parametre.
CREATE TABLE hukuk_karari (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), tur text NOT NULL CHECK (tur IN ('Alacak Yolu', 'Dava', 'İcra Takibi', 'Şüpheli Alacak', 'Alacak Silme', 'İhtiyati Haciz')), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), fatura_ref uuid REFERENCES musteri_faturasi (kimlik), tutar_eur numeric(14,2), oneri text NOT NULL, durum text NOT NULL DEFAULT 'Görüşte' CHECK (durum IN ('Görüşte', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE is_acma_onayi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Kredi Limiti', 'Konkordato')), gerekce text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE faiz_orani (
  tur text NOT NULL CHECK (tur IN ('Kanuni Faiz', 'Ticari Temerrüt Faizi')), oran numeric(6,2) NOT NULL CHECK (oran >= 0), yururluk date NOT NULL, dayanak text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tur, yururluk)
);
CREATE TABLE fatura_itirazi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), fatura_ref uuid NOT NULL REFERENCES musteri_faturasi (kimlik), kalem text NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), gerekce text NOT NULL, belge_ref uuid REFERENCES belge (kimlik), yanit_son timestamptz NOT NULL, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kabul', 'Ret')), yanit text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yanitlayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE kurulus ADD COLUMN cari_bloke boolean NOT NULL DEFAULT false;
CREATE TABLE haciz_ihbari (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ihbar_no text NOT NULL, teblig_zamani timestamptz NOT NULL, cevap_son date NOT NULL, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Cevaplandı')), cevap text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE taraf ADD COLUMN tarama_tarihi date;
CREATE TABLE ucuncu_kisi_odeme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), odeyen_adi text NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), gerekce text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi', 'Kullanıldı')), isteyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tahsilat ADD COLUMN ucuncu_kisi_ref uuid REFERENCES ucuncu_kisi_odeme (kimlik);
CREATE TABLE uyusmazlik_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), merci text NOT NULL, esas_no text, savunma_son date, karar text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sozlesme_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), sozlesme_turu text NOT NULL, yururluk date NOT NULL, bitis date, imzali_nusha_ref uuid REFERENCES belge (kimlik), birlikte_imza boolean NOT NULL DEFAULT false, durum text NOT NULL DEFAULT 'Taslak' CHECK (durum IN ('Taslak', 'Yürürlükte', 'Sona Erdi')), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), CHECK (bitis IS NULL OR bitis >= yururluk)
);
CREATE INDEX sozlesme_kaydi_kurulus ON sozlesme_kaydi (kurulus_ref);
ALTER TABLE sistem_parametresi ALTER COLUMN deger DROP NOT NULL;
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('sozlesme_kapisi', 1, 'İmzalı sözleşme olmadan iş emri ve sipariş açılmaz');
ALTER TABLE belge_uretim DROP CONSTRAINT belge_uretim_tur_check;
ALTER TABLE belge_uretim ADD CONSTRAINT belge_uretim_tur_check CHECK (tur IN ('Fiyat Teklifi', 'Teknik Rapor', 'Onay Belgesi', 'Proforma', 'Ödeme Talebi', 'İş Emri', 'Teslim Tutanağı', 'Ödeme Sorumluluğu', 'Uyuşmazlık Paketi'));
GRANT SELECT, INSERT, UPDATE ON hukuk_karari, is_acma_onayi, faiz_orani, fatura_itirazi, haciz_ihbari, ucuncu_kisi_odeme, uyusmazlik_kaydi, sozlesme_kaydi TO yatonet_uygulama;
