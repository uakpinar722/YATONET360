-- İP-10: FR-HUK-002 veri ihlali, ilgili kişi başvurusu, saklama planı, hukuki koruma, imha listesi ve tutanağı.
CREATE TABLE veri_ihlali (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), olay_no text NOT NULL UNIQUE, ozet text NOT NULL, olay_turu text NOT NULL CHECK (olay_turu IN ('Yanlış alıcıya e-posta', 'Açık paylaşım bağlantısı', 'Kayıp çıktı', 'Yetkisiz görüntüleme', 'Cihaz kaybı veya çalınması', 'Teknik güvenlik olayı', 'Diğer')),
  ogrenme_zamani timestamptz NOT NULL, fark_eden_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), ic_bildirim_zamani timestamptz NOT NULL DEFAULT now(), ust_yonetim_bilgi_zamani timestamptz, veri_isleyen_kaynakli boolean NOT NULL DEFAULT false, ozel_nitelikli_veri boolean NOT NULL DEFAULT false,
  veri_kategorileri text[] NOT NULL DEFAULT '{}', kisi_gruplari text[] NOT NULL DEFAULT '{}', etkilenen_kisi_sayisi integer, etkilenen_kayit_sayisi integer, ihlal_baslangic timestamptz, ihlal_bitis timestamptz, etkilenen_sistem_alici text, olasi_sonuclar text, sinirlama_tedbirleri text, bulgu_surumu integer NOT NULL DEFAULT 0,
  bildirim_karari text CHECK (bildirim_karari IN ('Bildirilecek', 'Bildirim Gerekmez')), bildirim_karari_gerekcesi text, bildirim_karari_veren_ref text REFERENCES kullanici_hesabi (kimlik), kurul_bildirim_zamani timestamptz, gecikme_gerekcesi text, ilgili_kisi_bildirim_zamani timestamptz, kok_neden_faaliyet text, kapanis_kaniti_ref uuid REFERENCES belge (kimlik), kapanis_zamani timestamptz, durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Kapalı', 'İmha')), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE veri_ihlali_surumu (ihlal_ref uuid NOT NULL REFERENCES veri_ihlali (kimlik), surum integer NOT NULL, veri jsonb NOT NULL, guncelleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (ihlal_ref, surum));
CREATE TABLE ilgili_kisi_basvurusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), basvuru_no text NOT NULL UNIQUE, basvuran_ad_soyad text NOT NULL, iletisim text NOT NULL, kimlik_dogrulandi boolean NOT NULL DEFAULT false, temsil_belgesi_ref uuid REFERENCES belge (kimlik), basvuru_kanali text NOT NULL CHECK (basvuru_kanali IN ('Yazılı başvuru (adres)', 'KEP', 'Sistemde kayıtlı e-posta')), yanit_kanali text NOT NULL, talep_turleri text[] NOT NULL CHECK (cardinality(talep_turleri) > 0), kapsam text, alinma_tarihi date NOT NULL, son_yanit_tarihi date NOT NULL, arama_kapsami text[] NOT NULL DEFAULT '{}', arama_sonucu jsonb, hazirlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), karar text CHECK (karar IN ('Kabul', 'Kısmi Kabul', 'Ret')), karar_gerekcesi text, onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), yanit_tarihi date, teslim_kaniti_ref uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'İncelemede' CHECK (durum IN ('İncelemede', 'Onayda', 'Onaylandı', 'Yanıtlandı')), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE saklama_plani (kod text PRIMARY KEY, grup text NOT NULL, sure_ay integer, baslangic_olayi text NOT NULL, sorumlu_unvan text, imha_yontemi text NOT NULL DEFAULT 'Silme', dayanak text NOT NULL, otomatik boolean NOT NULL DEFAULT false);
INSERT INTO saklama_plani (kod, grup, sure_ay, baslangic_olayi, sorumlu_unvan, imha_yontemi, dayanak, otomatik) VALUES
  ('LOG-2', 'İşlem güvenliği logları', 24, 'Kayıt anı', 'Bilgi İşlem Müdürü', 'Silme', 'KVKK-07 ¶65-68', true),
  ('OPS-5', 'Operasyon ve dosya kayıtları', 60, 'Dosyanın kapanması', 'Operasyon Müdürü', 'Silme', 'KVKK-07 ¶29-32, ¶37-40', false),
  ('ILS-5', 'Sicil, firma ve dış kullanıcı kayıtları', 60, 'İlişkinin sona ermesi', 'Firma Yönetimi Müdürü', 'Silme', 'KVKK-07 ¶33-36', false),
  ('MAL-10', 'Fatura, ödeme ve muhasebe kayıtları', 120, 'Takvim yılı sonu', 'Muhasebe ve Finans Müdürü', 'Silme', 'KVKK-07 ¶41-44', false),
  ('SOZ-10', 'Sözleşmeler', 120, 'Sona erme', 'Hukuk ve Uyum Direktörü', 'Silme', 'KVKK-07 ¶45-48', false),
  ('OZL-10', 'Özlük ve çalışan kayıtları', 120, 'İş ilişkisinin sona ermesi', 'İnsan Kaynakları Müdürü', 'Silme', 'KVKK-07 ¶49-52', false),
  ('ADY-6A', 'Olumsuz sonuçlanan aday başvuruları', 6, 'Sürecin tamamlanması', 'İnsan Kaynakları Müdürü', 'Silme', 'KVKK-07 ¶53-56', false),
  ('TIC-10', 'Teklif ve diğer ticari kayıtlar', 120, 'Kaydın kapanması', 'Muhasebe ve Finans Müdürü', 'Silme', 'KVKK-07 ¶97-100', false),
  ('RIZA', 'Rıza ve ticari ileti kayıtları', 60, 'Rıza tarihi veya geri alma', 'Müşteri ve Paydaş İlişkileri Müdürü', 'Silme', 'KVKK-02; KVKK-07 ¶57-60', false),
  ('IMH-3', 'İmha tutanakları', 36, 'İmha tarihi', 'Hukuk ve Uyum Direktörü', 'Silme', 'KVKK-07 ¶148', false),
  ('KON-1', 'Saha personeli konum kayıtları', 12, 'Kayıt anı', 'Bilgi İşlem Müdürü', 'Silme', 'KVKK-07 ¶93-96', true),
  ('SIC-OZ', 'Sicil kurum özeti', 120, 'İlişkinin sona ermesi', 'Firma Yönetimi Müdürü', 'Silme', 'KVKK-07 ¶85-88', false),
  ('ADY-1', 'Sicile başvurmamış aday kuruluş kayıtları', 12, 'Son temas', 'Firma Yönetimi Müdürü', 'Silme', 'KVKK-07 ¶89-92', false),
  ('HSP', 'Kapanmış kullanıcı hesapları', 60, 'Hesabın kapanması (LGM personelinde 120 ay)', 'Bilgi İşlem Müdürü', 'Silme', 'KVKK-07 ¶105-108', false),
  ('ERS-2', 'Erişim incelemesi ve bildirim teslim kayıtları', 24, 'Kayıt anı', 'Bilgi İşlem Müdürü', 'Silme', 'KVKK-07 ¶109-112', true),
  ('DST-5', 'Destek talebi, olay/kesinti, nöbet çizelgesi ve toplantı kayıtları', 60, 'Kaydın kapanması', 'Bilgi İşlem Müdürü', 'Silme', 'KVKK-07 ¶113-116', false),
  ('IHL-10', 'Veri ihlali kayıtları', 120, 'Olay kaydının kapanması', 'Hukuk ve Uyum Direktörü', 'Silme', 'KVKK-07 ¶117-120', false);
CREATE TABLE hukuki_koruma (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), gerekce_turu text NOT NULL CHECK (gerekce_turu IN ('Uyuşmazlık', 'Denetim', 'Soruşturma', 'Resmî Talep', 'Garanti veya Yasal Ayıp')), kapsam_konu text NOT NULL, kapsam_kisiler text, dosya_ref uuid REFERENCES dosya (kimlik), kurulus_ref uuid REFERENCES kurulus (kimlik), kullanici_ref text REFERENCES kullanici_hesabi (kimlik), kapsam_gruplari text[] NOT NULL DEFAULT '{}', karar_sahibi_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), baslangic_tarihi date NOT NULL DEFAULT current_date, gozden_gecirme_tarihi date NOT NULL, kaldirma_kosulu text, kaldirma_tarihi date, CHECK (dosya_ref IS NOT NULL OR kurulus_ref IS NOT NULL OR kullanici_ref IS NOT NULL)
);
CREATE TABLE imha_listesi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), yil integer NOT NULL, imha_donemi text NOT NULL CHECK (imha_donemi IN ('Ocak', 'Temmuz')), liste_olusturma_zamani timestamptz NOT NULL DEFAULT now(), durum text NOT NULL DEFAULT 'Hazırlanıyor' CHECK (durum IN ('Hazırlanıyor', 'Birim Kontrolünde', 'Onayda', 'Uygulandı', 'Reddedildi')), hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), onaylayan_ref text REFERENCES kullanici_hesabi (kimlik), islemi_yapan_ref text REFERENCES kullanici_hesabi (kimlik), imha_tarihi date, ortam text[] NOT NULL DEFAULT '{}', yedek_dizin_kapsandi boolean NOT NULL DEFAULT false, UNIQUE (yil, imha_donemi)
);
CREATE TABLE imha_kalemi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), liste_ref uuid NOT NULL REFERENCES imha_listesi (kimlik), grup_kod text NOT NULL REFERENCES saklama_plani (kod), nesne_turu text NOT NULL, nesne_kimligi text NOT NULL, ozet text NOT NULL, birim_kontrol_eden_ref text REFERENCES kullanici_hesabi (kimlik), durum text NOT NULL DEFAULT 'Listede' CHECK (durum IN ('Listede', 'Çıkarıldı', 'İmha Edildi')), cikarma_gerekcesi text, imha_zamani timestamptz, UNIQUE (liste_ref, grup_kod, nesne_kimligi)
);
CREATE INDEX imha_kalemi_nesne ON imha_kalemi (nesne_turu, nesne_kimligi) WHERE durum = 'İmha Edildi';
ALTER TABLE belge ADD COLUMN saklama_grubu text REFERENCES saklama_plani (kod), ADD COLUMN saklama_bitis date, ADD COLUMN imha_zamani timestamptz;
ALTER TABLE dosya ADD COLUMN imha_zamani timestamptz;
ALTER TABLE kurulus ADD COLUMN iliski_bitis date, ADD COLUMN imha_zamani timestamptz;
ALTER TABLE kullanici_hesabi ADD COLUMN kapanma_zamani timestamptz, ADD COLUMN imha_zamani timestamptz;
ALTER TABLE acik_riza ADD COLUMN onay_adimi text, ADD COLUMN imha_zamani timestamptz;
CREATE FUNCTION hesap_kapanma_damgasi() RETURNS trigger AS $$ BEGIN IF NEW.hesap_durumu = 'Kapalı' AND OLD.hesap_durumu <> 'Kapalı' THEN NEW.kapanma_zamani := now(); ELSIF NEW.hesap_durumu <> 'Kapalı' THEN NEW.kapanma_zamani := NULL; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER hesap_kapanma BEFORE UPDATE OF hesap_durumu ON kullanici_hesabi FOR EACH ROW EXECUTE FUNCTION hesap_kapanma_damgasi();
GRANT SELECT, INSERT, UPDATE ON veri_ihlali, veri_ihlali_surumu, ilgili_kisi_basvurusu, hukuki_koruma, imha_listesi, imha_kalemi TO yatonet_uygulama;
GRANT SELECT ON saklama_plani TO yatonet_uygulama;
GRANT UPDATE (saklama_grubu, saklama_bitis, imha_zamani) ON belge TO yatonet_uygulama;
GRANT DELETE ON bildirim TO yatonet_uygulama;
