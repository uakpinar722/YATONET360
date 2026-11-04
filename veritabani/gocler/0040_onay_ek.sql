-- YG-157 koşullu onay; YG-161, YG-222 onay kaydı ve kod; YG-215 kesin teslim; YG-225 değişiklik protokolü; YG-1461 yurt dışı; YG-456 mutabakat; YG-189 firma fiyatı düzeltme; YG-027 6502.
CREATE TABLE teklif_kosulu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), eylem text NOT NULL, sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), son_tarih date NOT NULL, gerceklesmezse text NOT NULL, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı', 'Risk Kabulü')), kanit_belge_ref uuid REFERENCES belge (kimlik), risk_kabul_eden_ref text REFERENCES kullanici_hesabi (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teklif_kosulu_dosya ON teklif_kosulu (dosya_ref) WHERE durum = 'Açık';
ALTER TABLE is_karti ADD COLUMN tutar_eur numeric(14,2), ADD COLUMN belge_surumu text;
ALTER TABLE is_karti_adim ADD COLUMN kanal text NOT NULL DEFAULT 'YATONET 360', ADD COLUMN kod_dogrulandi boolean NOT NULL DEFAULT false;
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('onay_kod_esik_eur', 5000, 'Bu tutarın üzerindeki son onayda doğrulama kodu yeniden istenir');
ALTER TABLE dosya ADD COLUMN kesin_teslim_tarihi date, ADD COLUMN gecikme_bedeli_eur numeric(14,2), ADD COLUMN kesin_teslim_durumu text CHECK (kesin_teslim_durumu IN ('Onayda', 'Onaylandı', 'Reddedildi')), ADD COLUMN yurt_disi boolean NOT NULL DEFAULT false, ADD COLUMN kapsam_6502 boolean NOT NULL DEFAULT false;
CREATE TABLE degisiklik_protokolu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), degisiklik_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Değişiklik', 'İlave İş', 'Süre Uzatımı')), mevcut text NOT NULL, onerilen text NOT NULL, bedel_farki_eur numeric(14,2) NOT NULL DEFAULT 0, yeni_toplam_eur numeric(14,2), ek_sure_gun integer NOT NULL DEFAULT 0, kanal text NOT NULL CHECK (kanal IN ('YATONET 360', 'E-imza', 'Islak İmza')), belge_ref uuid REFERENCES belge (kimlik), onay_talebi_ref uuid REFERENCES onay_talebi (kimlik), sigorta_onayi text NOT NULL DEFAULT 'Gerekli Değil' CHECK (sigorta_onayi IN ('Gerekli Değil', 'Alındı')), sigorta_onay_tarihi date, durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sigorta_mutabakat_raporu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), sigortaci_adi text NOT NULL, donem text NOT NULL, kesim_tarihi date NOT NULL, gonderim_son timestamptz NOT NULL, gonderim_zamani timestamptz, itiraz_son date, durum text NOT NULL DEFAULT 'Hazır' CHECK (durum IN ('Hazır', 'Gönderildi', 'Sonuçlandı')), gonderen_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (sigortaci_adi, donem)
);
CREATE TABLE sigorta_mutabakat_satiri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), rapor_ref uuid NOT NULL REFERENCES sigorta_mutabakat_raporu (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), fatura_ref uuid NOT NULL REFERENCES musteri_faturasi (kimlik), onayli_tutar numeric(14,2) NOT NULL, odenen_tutar numeric(14,2) NOT NULL, acik_bakiye numeric(14,2) NOT NULL, itiraz_edildi boolean NOT NULL DEFAULT false, itiraz_notu text, mutabik boolean NOT NULL DEFAULT false
);
ALTER TABLE firma_fiyat_kalemi ADD COLUMN iade_gerekcesi text;
CREATE TABLE firma_fiyat_duzeltme (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kalem_ref uuid NOT NULL REFERENCES firma_fiyat_kalemi (kimlik), yeni_fiyat_eur numeric(12,2) NOT NULL CHECK (yeni_fiyat_eur >= 0), gerekce text NOT NULL, belge_ref uuid NOT NULL REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON teklif_kosulu, degisiklik_protokolu, sigorta_mutabakat_raporu, sigorta_mutabakat_satiri, firma_fiyat_duzeltme TO yatonet_uygulama;
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES ('mutabakat_itiraz_gun', 8, 'Sigorta mutabakat raporu itiraz süresi');
