-- YG-380: sapmanın düzeltici işlemi sorumlu, süre ve kapanış kanıtı üretir; asıl kayıt silinmez.
ALTER TABLE sapma_kaydi ADD COLUMN IF NOT EXISTS durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı')), ADD COLUMN IF NOT EXISTS sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN IF NOT EXISTS hedef_tarih date, ADD COLUMN IF NOT EXISTS kapanis_kaniti_ref uuid REFERENCES belge (kimlik), ADD COLUMN IF NOT EXISTS kapatan_ref text REFERENCES kullanici_hesabi (kimlik), ADD COLUMN IF NOT EXISTS kapanis_zamani timestamptz;
-- YG-329, YG-580, YG-425: TPL-07 başlangıç toplantısı kaydı; basit işte kısa form.
CREATE TABLE baslangic_toplantisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL UNIQUE REFERENCES is_emri (kimlik), tarih date NOT NULL, kisa_form boolean NOT NULL DEFAULT false, katilimcilar text NOT NULL, konusulanlar text NOT NULL, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
-- YG-350: aktif firma yılda bir, Koşullu Onaylı 3 ayda bir yeniden değerlendirilir.
ALTER TABLE kurulus ADD COLUMN IF NOT EXISTS sonraki_gozden_gecirme_tarihi date;
GRANT SELECT, INSERT, UPDATE ON baslangic_toplantisi TO yatonet_uygulama;
