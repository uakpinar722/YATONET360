-- Keşif, bulgu, görsel kanıt, ölçüm, kontrol listesi, hasar bölgesi; kapanış ve dosya işlemi; garanti ve şikâyet.
CREATE TABLE kesif (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik),
  amac_kapsam text NOT NULL, teknik_sorular text, izinli_islemler text[] NOT NULL DEFAULT '{}', erisim_kisitlari text, planlanan_baslangic timestamptz NOT NULL, planlanan_bitis timestamptz NOT NULL, bulusma_noktasi text,
  sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guvenlik_hazirligi text,
  durum text NOT NULL DEFAULT 'Planlandı' CHECK (durum IN ('Planlandı', 'Tamamlandı', 'Durduruldu')),
  kesif_tarihi timestamptz, katilimcilar text, baslangic_durumu text, izolasyon_durumu text, incelenen_alanlar text, erisilemeyen_alanlar text, durdurma_kaydi text, kanit_sayimi boolean, saha_cikis_zamani timestamptz,
  cikis_durumu text CHECK (cikis_durumu IN ('Hazır', 'Koşullu', 'Açık')), supheli_malzeme text CHECK (supheli_malzeme IN ('Hayır', 'Evet', 'Bilinmiyor')),
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK (planlanan_bitis > planlanan_baslangic)
);
CREATE INDEX kesif_dosya ON kesif (dosya_ref);

CREATE TABLE bulgu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), bulgu_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kesif_ref uuid REFERENCES kesif (kimlik),
  konum_referansi text NOT NULL, bolge_kodu text, ana_bulgu_ref uuid REFERENCES bulgu (kimlik), aciklama text NOT NULL, bulgu_etiketi text NOT NULL, bilgi_turu text NOT NULL, hasar_onem_derecesi text NOT NULL CHECK (hasar_onem_derecesi IN ('Kritik', 'Yüksek', 'Orta', 'Düşük', 'Gözlem')),
  islev_etkisi text, teknik_brans text, kanit_gucu text, yonlendirme text NOT NULL, yonlendirme_sorumlu_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yonlendirme_hedef_tarihi date NOT NULL,
  beyanla_celisen boolean NOT NULL DEFAULT false, tam_ziya_onerisi boolean NOT NULL DEFAULT false, sigortaciya_bildirim_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik)
);
CREATE INDEX bulgu_dosya ON bulgu (dosya_ref);

CREATE TABLE gorsel_kanit (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), gorsel_no text UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), belge_ref uuid REFERENCES belge (kimlik),
  cekim_zamani timestamptz, ceken_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), ceken_rol text, konum text, asama text NOT NULL, cekim_kalemi text NOT NULL, cekim_turu text, bolge_kodu text,
  cekilemedi_nedeni text, cekilemedi_aciklama text, olcek_referansi text, bulgu_ref uuid REFERENCES bulgu (kimlik), aciklama text,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  CHECK ((belge_ref IS NULL) = (gorsel_no IS NULL)), CHECK (belge_ref IS NOT NULL OR cekilemedi_nedeni IS NOT NULL)
);
CREATE INDEX gorsel_dosya ON gorsel_kanit (dosya_ref, asama);

CREATE TABLE olcum_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), olcum_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), bulgu_ref uuid REFERENCES bulgu (kimlik),
  olcum_noktasi text NOT NULL, olculen_buyukluk text NOT NULL, birim text NOT NULL, yontem text NOT NULL, cihaz text NOT NULL, kalibrasyon_durumu text NOT NULL, ham_veri text NOT NULL, ozet_deger numeric NOT NULL, nominal_deger numeric, tolerans numeric,
  gecerlilik text NOT NULL, sinir_disi boolean NOT NULL DEFAULT false, ikinci_dogrulayan_ref text REFERENCES kullanici_hesabi (kimlik), olcum_zamani timestamptz NOT NULL, olcen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onceki_ref uuid REFERENCES olcum_kaydi (kimlik), gecersizlik_gerekcesi text,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hasar_bolgesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), bolge_kodu text NOT NULL, gorunus text[] NOT NULL, cizim_isaret jsonb NOT NULL, referans_hat text NOT NULL, boyuna_konum_m text NOT NULL, enine_konum_cm text, alan_miktar numeric, birim text,
  surum integer NOT NULL DEFAULT 1, incelenmedi boolean NOT NULL DEFAULT false, olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dosya_ref, bolge_kodu, surum)
);

CREATE TABLE kontrol_listesi_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kontrol_listesi text NOT NULL, statu text NOT NULL DEFAULT 'Taslak' CHECK (statu IN ('Taslak', 'Tamamlandı')), eksikler text,
  hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), onay_zamani timestamptz
);
CREATE TABLE kontrol_listesi_maddesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_ref uuid NOT NULL REFERENCES kontrol_listesi_kaydi (kimlik), madde text NOT NULL, kritik boolean NOT NULL DEFAULT false, sonuc text, aciklama text, kanit_belge_ref uuid REFERENCES belge (kimlik), sorumlu_ref text REFERENCES kullanici_hesabi (kimlik), UNIQUE (kayit_ref, madde)
);

CREATE TABLE dosya_islem_tutanagi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), islem_turu text NOT NULL CHECK (islem_turu IN ('Askı', 'İptal', 'Fesih', 'Devir')), kapanis_nedeni text, gerekce text NOT NULL, talep_eden text NOT NULL, yat_durumu text NOT NULL, yapilan_isler text NOT NULL, yapilan_isler_bedeli numeric(14,2), acik_isler text NOT NULL, teslim_edilenler text NOT NULL, devralan_taraf text, mucbir_sebep boolean NOT NULL DEFAULT false,
  durum text NOT NULL DEFAULT 'Onayda' CHECK (durum IN ('Onayda', 'Onaylandı', 'Reddedildi')), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);

CREATE TABLE kapanis_kontrolu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  yetki_kapsam_kontrolu boolean NOT NULL, uygulama_kontrolu boolean NOT NULL, test_kabul_kontrolu boolean NOT NULL, acik_konu_kontrolu boolean NOT NULL, garanti_kontrolu boolean NOT NULL, arsiv_kontrolu boolean NOT NULL, yazisma_beyani boolean NOT NULL,
  eksiklik_isaretleri text[] NOT NULL DEFAULT '{}', cikis_statusu text NOT NULL, kapanma_nedeni text, onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'Hazırlandı' CHECK (durum IN ('Hazırlandı', 'Onaylandı', 'Reddedildi')), olusturma_zamani timestamptz NOT NULL DEFAULT now(), kapanis_zamani timestamptz
);

CREATE TABLE dosya_yeniden_acma (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), gerekce_turu text NOT NULL CHECK (gerekce_turu IN ('Yeni Bilgi', 'Hata', 'Müşteri Bildirimi')), gerekce text NOT NULL, onceki_nedeni text, durum text NOT NULL DEFAULT 'Onayda', talep_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz
);

CREATE TABLE garanti_sikayet (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kayit_no text NOT NULL UNIQUE, dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kayit_turu text[] NOT NULL, kanal text NOT NULL, bildirim_zamani timestamptz NOT NULL, konum text, belirti text, oncelik text NOT NULL, tekrarlayan boolean NOT NULL DEFAULT false, sikayet_konusu text,
  statu text NOT NULL DEFAULT 'Açık' CHECK (statu IN ('Açık', 'İncelemede', 'Karar', 'Uygulamada', 'Kapalı')), karar text, sikayet_sonucu text, karar_gerekcesi text, karar_veren_ref text REFERENCES kullanici_hesabi (kimlik), kok_neden_tamam boolean NOT NULL DEFAULT false, duzeltme_maliyeti numeric(14,2), yanit_son timestamptz, yanit_zamani timestamptz, itiraz_zamani timestamptz, itiraz_son timestamptz, kesif_son timestamptz,
  sikayet_takip_ref text REFERENCES kullanici_hesabi (kimlik), sikayet_sonuc_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now(), olusturan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik)
);
CREATE INDEX garanti_dosya ON garanti_sikayet (dosya_ref);

ALTER TABLE dosya ADD COLUMN IF NOT EXISTS teslim_tarihi date, ADD COLUMN IF NOT EXISTS kapanis_zamani timestamptz, ADD COLUMN IF NOT EXISTS calisma_durduruldu boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE ON kesif, bulgu, gorsel_kanit, olcum_kaydi, hasar_bolgesi, kontrol_listesi_kaydi, kontrol_listesi_maddesi, dosya_islem_tutanagi, kapanis_kontrolu, dosya_yeniden_acma, garanti_sikayet TO yatonet_uygulama;
