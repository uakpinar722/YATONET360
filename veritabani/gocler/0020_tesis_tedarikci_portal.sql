-- A8 Tesis ve A9 Tedarikçi portalları.
CREATE TABLE tesis_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tur text NOT NULL CHECK (tur IN ('Saha Girişi', 'Çalışma İzni', 'Çekek Randevusu', 'Kalış Uzatma')), hedef_tarih date NOT NULL, aciklama text, durum text NOT NULL DEFAULT 'Yanıt Bekliyor' CHECK (durum IN ('Yanıt Bekliyor', 'Onaylı', 'İzin Verilmedi')), tesis_izin_no text, red_gerekcesi text, yanit_veren_ref text REFERENCES kullanici_hesabi (kimlik), yanit_zamani timestamptz, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tesis_talebi_kurulus ON tesis_talebi (kurulus_ref, durum);
CREATE INDEX tesis_talebi_dosya ON tesis_talebi (dosya_ref);
CREATE TABLE tesis_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tur text NOT NULL CHECK (tur IN ('Tesis Kuralı', 'Tarife')), baslik text NOT NULL, belge_ref uuid REFERENCES belge (kimlik), yukleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tesis_faturasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), talep_ref uuid NOT NULL REFERENCES tesis_talebi (kimlik), fatura_no text NOT NULL, tarih date NOT NULL, kalem text NOT NULL CHECK (kalem IN ('Çekek', 'Barınma', 'Bekleme ve Muhafaza', 'Diğer')), gun integer, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), belge_ref uuid NOT NULL REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Kontrolde', giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, fatura_no)
);
ALTER TABLE teslim_kaydi ADD COLUMN IF NOT EXISTS serbest_birakma_kodu text;
CREATE TABLE tedarikci_teklif_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), son_zaman timestamptz NOT NULL, durum text NOT NULL DEFAULT 'Yanıt Bekliyor' CHECK (durum IN ('Yanıt Bekliyor', 'Yanıtlandı', 'Süresi Doldu')), gecerlilik date, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tedarikci_teklif_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), talep_ref uuid NOT NULL REFERENCES tedarikci_teklif_talebi (kimlik), urun_tanimi text NOT NULL, uretici_parca_no text, miktar numeric(14,3) NOT NULL CHECK (miktar > 0), birim text NOT NULL, birim_fiyat_eur numeric(14,2), teslim_suresi_gun integer
);
ALTER TABLE tedarik_siparisi ADD COLUMN IF NOT EXISTS tedarikci_kabul text CHECK (tedarikci_kabul IN ('Kabul', 'Ret')), ADD COLUMN IF NOT EXISTS tedarikci_teslim_tarihi date, ADD COLUMN IF NOT EXISTS tedarikci_red_gerekcesi text;
CREATE TABLE tedarik_sevki (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), siparis_ref uuid NOT NULL REFERENCES tedarik_siparisi (kimlik), sevk_tarihi date NOT NULL, irsaliye_no text NOT NULL, tasiyici text NOT NULL, lot_no text NOT NULL, belge_ref uuid NOT NULL REFERENCES belge (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tedarikci_faturasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), siparis_ref uuid NOT NULL REFERENCES tedarik_siparisi (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), fatura_no text NOT NULL, tarih date NOT NULL, tutar_eur numeric(14,2) NOT NULL CHECK (tutar_eur > 0), belge_ref uuid NOT NULL REFERENCES belge (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, fatura_no)
);
GRANT SELECT, INSERT, UPDATE ON tesis_talebi, tesis_kaydi, tesis_faturasi, tedarikci_teklif_talebi, tedarikci_teklif_kalemi, tedarik_sevki, tedarikci_faturasi TO yatonet_uygulama;
