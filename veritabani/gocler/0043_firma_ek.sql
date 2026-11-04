-- İP-7: YG-306 görevlendirme kontrolü; YG-332 yetkili servis; YG-338 kaptan; YG-368 ön koşul; YG-409 hiza; YG-411 alt yüklenici; YG-423 garanti ve rücu itirazı; YG-141 geçici onarım; YG-142 kaldırma taşıma; YG-867 onaylı parça; YG-335 ayıp bağı.
ALTER TABLE kurulus ADD COLUMN kapasite_is integer CHECK (kapasite_is > 0);
CREATE TABLE gorevlendirme_kontrolu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid REFERENCES is_emri (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), gorev_sinifi text CHECK (gorev_sinifi IN ('G1', 'G2', 'G3', 'G4')), sonuc text NOT NULL CHECK (sonuc IN ('Kabul', 'Koşullu Kabul', 'Ret')), engeller text[] NOT NULL DEFAULT '{}', uyarilar text[] NOT NULL DEFAULT '{}', yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE yetkili_servis (kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), marka text NOT NULL, PRIMARY KEY (kurulus_ref, marka));
CREATE TABLE cikar_beyani (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), taraf_ref uuid NOT NULL REFERENCES taraf (kimlik), aciklama text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, taraf_ref));
CREATE TABLE kaptan_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), ad_soyad text NOT NULL, yeterlilik_belgesi text NOT NULL, yeterlilik_bitis date NOT NULL, police_no text NOT NULL, police_bitis date NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kaptan_gorevlendirme (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kaptan_ref uuid NOT NULL REFERENCES kaptan_kaydi (kimlik), yapan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
ALTER TABLE is_emri ADD COLUMN eksik_on_kosullar text[] NOT NULL DEFAULT '{}', ADD COLUMN on_kosul_gerekcesi text;
ALTER TABLE dosya ADD COLUMN hiza_kontrol_zamani timestamptz, ADD COLUMN hiza_kontrol_belge uuid REFERENCES belge (kimlik);
CREATE TABLE alt_yuklenici_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL REFERENCES is_emri (kimlik), alt_yuklenici text NOT NULL, kapsam text NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garanti_sikayet ADD COLUMN kurulus_ref uuid REFERENCES kurulus (kimlik), ADD COLUMN firma_itiraz text, ADD COLUMN firma_itiraz_zamani timestamptz, ADD COLUMN karar_zamani timestamptz;
ALTER TABLE hakedis_mahsubu ADD COLUMN firma_itiraz text, ADD COLUMN firma_itiraz_zamani timestamptz, ADD COLUMN onay_zamani timestamptz;
CREATE TABLE gecici_onarim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), islem text NOT NULL, uygulama_tarihi date NOT NULL, izinli_kullanim text NOT NULL, su_alma_riski boolean NOT NULL DEFAULT false, son_gecerlilik date NOT NULL, uzatma_sayisi integer NOT NULL DEFAULT 0, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı')), sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), uzatma_onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kaldirma_tasima (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), tur text NOT NULL CHECK (tur IN ('Kaldırma', 'Taşıma', 'Tesis Değişikliği')), ekipman text NOT NULL, kapasite_ton numeric(8,2), yat_agirlik_ton numeric(8,2), yeni_hasar boolean NOT NULL DEFAULT false, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE onayli_parca (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), orijinal_parca_no text NOT NULL, muadil_parca_no text NOT NULL, dayanak text NOT NULL, belge_ref uuid REFERENCES belge (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (orijinal_parca_no, muadil_parca_no)
);
ALTER TABLE tedarik_siparisi_kalemi ADD COLUMN muadil_orijinal_no text;
GRANT SELECT, INSERT, UPDATE ON gorevlendirme_kontrolu, yetkili_servis, cikar_beyani, kaptan_kaydi, kaptan_gorevlendirme, alt_yuklenici_talebi, gecici_onarim, kaldirma_tasima, onayli_parca TO yatonet_uygulama;
