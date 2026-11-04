-- İP-8: personel kartı ve durum, eğitim kaydı, izin devri, puantaj, disiplin, ayrılış, iş kazası, yurt dışı görevlendirme.
CREATE TABLE personel_karti (
  kullanici_ref text PRIMARY KEY REFERENCES kullanici_hesabi (kimlik), ise_giris_tarihi date NOT NULL, ayrilis_tarihi date, personel_durumu text NOT NULL DEFAULT 'Görevde' CHECK (personel_durumu IN ('Görevde', 'İzinli', 'Raporlu', 'Görevlendirmede', 'Ayrılıyor', 'Ayrıldı')), brut_aylik_tl numeric(14,2) CHECK (brut_aylik_tl > 0), ek3_yil integer, ek3_serbest_zaman boolean NOT NULL DEFAULT false, guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ik_parametresi (kod text PRIMARY KEY CHECK (kod IN ('kidem_tavani_tl', 'harcirah_gunluk_eur')), deger numeric(14,2) NOT NULL CHECK (deger > 0), giren_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now());
CREATE TABLE egitim_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (tur IN ('İSG', 'Tesis Oryantasyonu', 'Mesleki Belge', 'Diğer')), ad text NOT NULL, saat numeric(6,2), tesis text, tamamlanma_tarihi date NOT NULL, gecerlilik_sonu date, sertifika_ref uuid REFERENCES belge (kimlik), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX egitim_personel ON egitim_kaydi (personel_ref, tur, ad);
ALTER TABLE izin_talebi ADD COLUMN bolunmus boolean NOT NULL DEFAULT false, ADD COLUMN devir_zamani timestamptz, ADD COLUMN geri_zamani timestamptz;
CREATE TABLE izin_devri (kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), izin_ref uuid NOT NULL REFERENCES izin_talebi (kimlik), tur text NOT NULL CHECK (tur IN ('Dosya', 'Görev')), nesne text NOT NULL);
CREATE TABLE puantaj_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tarih date NOT NULL, gun_turu text NOT NULL CHECK (gun_turu IN ('Çalışma', 'Hafta tatili', 'Resmî tatil', 'İzin', 'Rapor', 'Devamsızlık')), giris_saati time, cikis_saati time, net_dakika integer NOT NULL DEFAULT 0, nobet_fiili_dakika integer NOT NULL DEFAULT 0, fazla_dakika integer NOT NULL DEFAULT 0, izin_ref uuid REFERENCES izin_talebi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), bordro_aktarim_zamani timestamptz, UNIQUE (personel_ref, tarih), CHECK (cikis_saati IS NULL OR giris_saati IS NULL OR cikis_saati > giris_saati)
);
CREATE TABLE disiplin_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olay_tarihi date NOT NULL, ogrenme_tarihi date, hizli_yol boolean NOT NULL DEFAULT false, konu text NOT NULL, kademe text NOT NULL CHECK (kademe IN ('Sözlü Uyarı', 'Yazılı Uyarı', 'Ücret Kesme', 'Fesih')), savunma_son date, savunma text, savunma_zamani timestamptz, karar text, kesinti_gundelik numeric(3,1) CHECK (kesinti_gundelik > 0 AND kesinti_gundelik <= 2), karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), karar_tarihi date, itiraz text, itiraz_zamani timestamptz, itiraz_sonucu text, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE personel_ayrilisi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), tur text NOT NULL CHECK (tur IN ('İstifa', 'İşveren Feshi', 'Haklı Fesih (25/II)', 'Emeklilik', 'Askerlik', 'Evlilik', 'Ölüm', 'Mutabakat')), bildirim_tarihi date NOT NULL, son_is_gunu date NOT NULL, sure_mutabakati boolean NOT NULL DEFAULT false, dilekce_belge uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapandı')), cihaz_beyani text, cihaz_beyan_zamani timestamptz, cihaz_onay_ref text REFERENCES kullanici_hesabi (kimlik), gizlilik_okundu_zamani timestamptz, odeme_durumu text NOT NULL DEFAULT 'Bekliyor' CHECK (odeme_durumu IN ('Bekliyor', 'Onayda', 'Ödemeye Hazır')), kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ayrilis_tek ON personel_ayrilisi (personel_ref) WHERE durum = 'Açık';
CREATE TABLE ayrilis_devri (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), ayrilis_ref uuid NOT NULL REFERENCES personel_ayrilisi (kimlik), tur text NOT NULL CHECK (tur IN ('Dosya', 'Görev', 'Rol')), nesne text NOT NULL, aciklama text NOT NULL, devralan_ref text REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Devredildi', 'Birim Amirine Atandı')), zaman timestamptz
);
CREATE TABLE is_kazasi (
  olay_ref uuid PRIMARY KEY REFERENCES olay_kaydi (kimlik), isveren text NOT NULL CHECK (isveren IN ('LGM', 'Çözüm Ortağı')), kurulus_ref uuid REFERENCES kurulus (kimlik), saglik_kolluk text NOT NULL, sigortaci_ihbar text NOT NULL, saglik_verisi boolean NOT NULL DEFAULT false, bilgi_sinifi text NOT NULL DEFAULT 'Gizli' CHECK (bilgi_sinifi IN ('Gizli', 'Kritik')), son_zaman timestamptz, bilgi_gonderme_zamani timestamptz, sgk_bildirim_tarihi date, bildirim_belge uuid REFERENCES belge (kimlik), belge_isteme_zamani timestamptz, kaydeden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), CHECK (isveren = 'LGM' OR kurulus_ref IS NOT NULL)
);
CREATE TABLE yurtdisi_gorev (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), ulke text NOT NULL, baslangic date NOT NULL, bitis date NOT NULL, gun integer NOT NULL, gunluk_eur numeric(14,2) NOT NULL, harcirah_eur numeric(14,2) NOT NULL, durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), zaman timestamptz NOT NULL DEFAULT now(), CHECK (bitis >= baslangic)
);
GRANT SELECT, INSERT, UPDATE ON personel_karti, ik_parametresi, egitim_kaydi, izin_devri, puantaj_kaydi, disiplin_kaydi, personel_ayrilisi, ayrilis_devri, is_kazasi, yurtdisi_gorev TO yatonet_uygulama;
