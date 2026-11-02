-- Ödeme talebi, proforma ve fatura, tahsilat, alacak takibi, teslim kilidi, hakediş, firma ödeme talimatı, izin, masraf.
INSERT INTO sistem_parametresi (kod, deger, aciklama) VALUES
  ('avans_orani', 50, 'Avans oranı (%)'),
  ('sigorta_avans_esik_eur', 20000, 'Sigorta işlerinde avans eşiği'),
  ('kesif_ucreti_eur', 150, 'Yat sahibi talebiyle bölge içi keşif sabit tarifesi'),
  ('hakedis_kesinti_esik_eur', 10000, 'Güvence kesintisi eşiği'),
  ('hakedis_kesinti_orani', 5, 'Güvence kesintisi (%)'),
  ('kurumsal_kredi_limiti_eur', 20000, 'Kurumsal kredi limiti'),
  ('sigorta_vade_gun', 30, 'Sigorta tahsilat vadesi'),
  ('firma_odeme_gun', 45, 'Firma ödemesi tahsilat sonrası gün'),
  ('firma_odeme_azami_gun', 120, 'Firma ödemesi azami gün'),
  ('masraf_km_eur', 0.20, 'Km bedeli'),
  ('masraf_yemek_eur', 25, 'Günlük yemek'),
  ('masraf_konaklama_eur', 90, 'Gecelik konaklama'),
  ('masraf_tid_esik_eur', 250, 'TİD onay eşiği');

CREATE TABLE odeme_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teklif_ref uuid REFERENCES fiyat_teklifi (kimlik), tur text NOT NULL CHECK (tur IN ('Avans', 'Keşif Ücreti', 'Ara Ödeme', 'Acil Tedbir Bedeli', 'Nihai', 'Parça')), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), muhatap text NOT NULL, son_tarih date NOT NULL, durum text NOT NULL DEFAULT 'İç Onayda' CHECK (durum IN ('İç Onayda', 'Gönderildi', 'Ödendi', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE musteri_faturasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), proforma_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), teklif_ref uuid NOT NULL REFERENCES fiyat_teklifi (kimlik), muhatap text NOT NULL, kdv_haric_eur numeric(14,2) NOT NULL, kdv_eur numeric(14,2) NOT NULL, toplam_eur numeric(14,2) NOT NULL,
  durum text NOT NULL DEFAULT 'İç Onayda' CHECK (durum IN ('İç Onayda', 'Proforma', 'Muhasebeye İletildi', 'Faturalandı', 'Kısmi Tahsil', 'Tahsil Edildi', 'Reddedildi')), fatura_no text UNIQUE, fatura_tarihi date, kur numeric(10,4), kur_tarihi date, toplam_tl numeric(16,2), vade date, tahsil_edilen_eur numeric(14,2) NOT NULL DEFAULT 0, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fatura_dosya ON musteri_faturasi (dosya_ref);
CREATE TABLE tahsilat (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), fatura_ref uuid REFERENCES musteri_faturasi (kimlik), odeme_talebi_ref uuid REFERENCES odeme_talebi (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), tarih date NOT NULL, kanal text NOT NULL CHECK (kanal IN ('Havale', 'POS', 'Ödeme Bağlantısı')), referans text, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), CHECK (fatura_ref IS NOT NULL OR odeme_talebi_ref IS NOT NULL)
);
CREATE TABLE alacak_takip_adimi (kimlik bigserial PRIMARY KEY, fatura_ref uuid NOT NULL REFERENCES musteri_faturasi (kimlik), basamak text NOT NULL, sorumlu_rol text NOT NULL, zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (fatura_ref, basamak));
CREATE TABLE teslim_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), durum text NOT NULL DEFAULT 'Onay Bekliyor' CHECK (durum IN ('Onay Bekliyor', 'Teslim Edildi', 'Teslim Edildi - Onay Verilmedi', 'İptal')), teslim_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), teslim_alan text, istisna_gerekcesi text, olusturma_zamani timestamptz NOT NULL DEFAULT now(), teslim_zamani timestamptz
);
ALTER TABLE dosya ADD COLUMN IF NOT EXISTS teslim_istisnasi boolean NOT NULL DEFAULT false;

CREATE TABLE hakedis (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hakedis_no text NOT NULL UNIQUE, is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), sira_no integer NOT NULL, bu_donem_brut numeric(14,2) NOT NULL CHECK (bu_donem_brut > 0), kumulatif numeric(14,2) NOT NULL, kesinti numeric(14,2) NOT NULL DEFAULT 0, net numeric(14,2) NOT NULL, kanit_belge_ref uuid REFERENCES belge (kimlik), statu text NOT NULL DEFAULT 'Doğrulama Bekliyor' CHECK (statu IN ('Doğrulama Bekliyor', 'Doğrulandı', 'Reddedildi', 'Ödeme Talimatında', 'Ödendi')), firma_fatura_no text, dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (is_emri_ref, sira_no)
);
CREATE UNIQUE INDEX hakedis_kanit_tek ON hakedis (kanit_belge_ref) WHERE kanit_belge_ref IS NOT NULL;
CREATE TABLE odeme_talimati (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), hakedis_ref uuid NOT NULL UNIQUE REFERENCES hakedis (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tutar_eur numeric(14,2) NOT NULL, planlanan_tarih date NOT NULL, tahsilata_bagli boolean NOT NULL DEFAULT true, durum text NOT NULL DEFAULT 'İç Onayda' CHECK (durum IN ('İç Onayda', 'Onaylandı', 'Reddedildi', 'Ödendi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE banka_hesabi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), iban text NOT NULL, durum text NOT NULL DEFAULT 'Karantina' CHECK (durum IN ('Karantina', 'Geçerli', 'İptal')), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), teyit_eden_ref text REFERENCES kullanici_hesabi (kimlik), teyit_kanali text, onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, iban)
);
CREATE TABLE izin_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), izin_turu text NOT NULL, baslangic date NOT NULL, bitis date NOT NULL, gun integer NOT NULL, vekil_ref text REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'İK Kontrolünde' CHECK (durum IN ('İK Kontrolünde', 'Birim Amirinde', 'Onaylandı', 'Reddedildi', 'İptal')), olusturma_zamani timestamptz NOT NULL DEFAULT now(), CHECK (bitis >= baslangic)
);
CREATE TABLE izin_bakiyesi (personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yil integer NOT NULL, hak integer NOT NULL, kullanilan integer NOT NULL DEFAULT 0, PRIMARY KEY (personel_ref, yil), CHECK (kullanilan <= hak));
CREATE TABLE personel_masraf_fisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), masraf_turu text NOT NULL, fis_tarihi date NOT NULL, tutar_tl numeric(14,2) NOT NULL CHECK (tutar_tl > 0), kur numeric(10,4) NOT NULL, tutar_eur numeric(14,2) NOT NULL, odenecek_eur numeric(14,2) NOT NULL, miktar numeric(10,2) NOT NULL DEFAULT 1, belge_ref uuid REFERENCES belge (kimlik), belge_ozeti text, durum text NOT NULL DEFAULT 'Onayda', olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (personel_ref, belge_ozeti)
);
GRANT SELECT, INSERT, UPDATE ON odeme_talebi, musteri_faturasi, tahsilat, alacak_takip_adimi, teslim_kaydi, hakedis, odeme_talimati, banka_hesabi, izin_talebi, izin_bakiyesi, personel_masraf_fisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE alacak_takip_adimi_kimlik_seq TO yatonet_uygulama;
