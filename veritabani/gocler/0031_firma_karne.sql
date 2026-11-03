-- YG-351, YG-788–795, Ek I §7.5: Çözüm Ortağı performans karnesi. Puan elle girilmez; parametre sürümlü, geçmiş yeniden hesaplanmaz.
CREATE TABLE karne_parametresi (
  surum integer PRIMARY KEY, deger jsonb NOT NULL, yururluk_baslangic date NOT NULL, durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Onayda', 'Yürürlükte', 'Reddedildi')), gerekce text, oneren_ref text REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
INSERT INTO karne_parametresi (surum, yururluk_baslangic, deger) VALUES (1, DATE '2026-01-01', '{"kabul":100,"kosullu_kabul":70,"ret":0,"ilk_sefer":10,"majoer":15,"minoer":5,"basarisiz_test":10,"garanti":20,"tol_kritik":20,"tol_yuksek":15,"tol_normal":10,"tol_planli":5,"tol_belirsiz":5,"sure_asim":2,"maliyet_1":5,"maliyet_1_puan":70,"maliyet_2":15,"yanit_kritik":1,"yanit_yuksek":4,"yanit_normal":24,"yanit_planli":48,"isg":25,"prosedur":15,"denetim_majoer":15,"denetim_minoer":5,"eksik_belge":10,"kesinti_kritik":10,"kesinti_emniyet":5,"agirlik_kritik":2.0,"agirlik_yuksek":1.5,"agirlik_normal":1.0,"agirlik_planli":0.8,"esik_tercihli":85,"esik_standart":70,"asgari_dosya":3}');
ALTER TABLE is_emri ADD COLUMN IF NOT EXISTS firma_tamamlama_zamani timestamptz, ADD COLUMN IF NOT EXISTS teknik_ret_sayisi integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS kapanis_zamani timestamptz;
CREATE TABLE performans_olay_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_emri_ref uuid NOT NULL UNIQUE REFERENCES is_emri (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), oncelik text NOT NULL, parametre_surum integer NOT NULL REFERENCES karne_parametresi (surum), girdi jsonb NOT NULL, kalite_puani numeric(6,2), sure_puani numeric(6,2), maliyet_puani numeric(6,2), iletisim_puani numeric(6,2), uyum_puani numeric(6,2), dosya_puani numeric(6,2) NOT NULL, kapanis_zamani timestamptz NOT NULL, olusturma_zamani timestamptz NOT NULL DEFAULT now(), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX performans_olay_firma ON performans_olay_kaydi (kurulus_ref, kapanis_zamani);
-- Puan geçmişi silinmez; yeniden değerlendirmede önceki değer burada kalır.
CREATE TABLE performans_olay_gecmisi (kimlik bigserial PRIMARY KEY, olay_ref uuid NOT NULL REFERENCES performans_olay_kaydi (kimlik), onceki jsonb NOT NULL, neden text NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE performans_donem_puani (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), donem_sonu date NOT NULL, kapanan_dosya_sayisi integer NOT NULL, agirlikli_ortalama numeric(6,2), uygunsuzluk_kesintisi numeric(6,2) NOT NULL DEFAULT 0, donem_puani numeric(6,2), yetersiz_veri boolean NOT NULL, kalite_ortalamasi numeric(6,2), sure_ortalamasi numeric(6,2), maliyet_ortalamasi numeric(6,2), iletisim_ortalamasi numeric(6,2), uyum_ortalamasi numeric(6,2), acik_emniyet_uygunsuzlugu boolean NOT NULL DEFAULT false, risk_derecesi_onerisi text NOT NULL, parametre_surum integer NOT NULL REFERENCES karne_parametresi (surum), guncelleme_zamani timestamptz NOT NULL DEFAULT now(), UNIQUE (kurulus_ref, donem_sonu)
);
CREATE TABLE firma_karne_itirazi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), olay_ref uuid NOT NULL REFERENCES performans_olay_kaydi (kimlik), kurulus_ref uuid NOT NULL REFERENCES kurulus (kimlik), konu text NOT NULL, durum text NOT NULL DEFAULT 'İncelemede' CHECK (durum IN ('İncelemede', 'Kabul Edildi', 'Reddedildi')), itiraz_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);
CREATE UNIQUE INDEX firma_karne_itiraz_tek ON firma_karne_itirazi (olay_ref) WHERE durum = 'İncelemede';
GRANT SELECT, INSERT, UPDATE ON karne_parametresi, performans_olay_kaydi, performans_donem_puani, firma_karne_itirazi TO yatonet_uygulama;
GRANT SELECT, INSERT ON performans_olay_gecmisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE performans_olay_gecmisi_kimlik_seq TO yatonet_uygulama;
