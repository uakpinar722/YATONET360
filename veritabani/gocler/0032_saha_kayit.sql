-- YG-1574: Çözüm Ortağı günlük kaydı; YG-1430: Parça Girişi; YG-379, YG-380: sapma; YG-786: denetim bulgusu; Ek I §7.5 karne girdileri.
CREATE TABLE firma_gunluk_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), tarih date NOT NULL, faaliyet text, fotograflar uuid[] NOT NULL DEFAULT '{}', olcumler text, engel text, sonraki_plan text, sorumlu text, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapatıldı')), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), kapanis_zamani timestamptz, olusturma_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (is_emri_ref, tarih)
);
CREATE TABLE firma_parca_girisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), urun_tanimi text NOT NULL, parca_no text NOT NULL, miktar numeric(14,3) NOT NULL CHECK (miktar > 0), birim text NOT NULL, lot_no text NOT NULL, belge_ref uuid NOT NULL REFERENCES belge (kimlik), kabul_karari text CHECK (kabul_karari IN ('Kabul', 'Koşullu Kabul', 'Karantina', 'Ret')), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE TABLE sapma_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Kapsam', 'Yöntem', 'Süre', 'Maliyet', 'Kalite', 'Güvenlik', 'Belge')), aciklama text NOT NULL, karar text NOT NULL CHECK (karar IN ('İşi Durdur', 'Sınırlı Devam', 'Düzeltme', 'Değişiklik Talebi')), firma_kaynakli boolean NOT NULL DEFAULT true, isg_ihlali boolean NOT NULL DEFAULT false, onaysiz_ek_is boolean NOT NULL DEFAULT false, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE firma_denetim_bulgusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), sinif text NOT NULL CHECK (sinif IN ('Majör', 'Minör')), aciklama text NOT NULL, kanit_belge_ref uuid NOT NULL REFERENCES belge (kimlik), hedef_tarih date, giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE is_emri ADD COLUMN IF NOT EXISTS teshisi_belirsiz boolean NOT NULL DEFAULT false;
GRANT SELECT, INSERT, UPDATE ON firma_gunluk_kaydi, firma_parca_girisi, sapma_kaydi, firma_denetim_bulgusu TO yatonet_uygulama;
