-- YG-776: Master Plan kart takip listesi. YG-1551: Mevzuat Uyum Matrisi program içinden yönetilir, her değişiklik sürüm geçmişindedir.
CREATE TABLE master_plan_karti (
  islem_no text PRIMARY KEY, faz text NOT NULL, is_akisi text, yapilacak text NOT NULL, muhatap text NOT NULL, on_kosul text, hedef_tarih date, siklik text, beklenen_cikti text, kapanis_kaniti text, kabul_makami text, baglanti text,
  durum text NOT NULL DEFAULT 'Verilecek' CHECK (durum IN ('Verilecek', 'Görev Verildi', 'Sürüyor', 'Bekliyor', 'Düzeltilecek', 'Tamamlandı')), verildigi_tarih date, tamamlanma_tarihi date, kayit_no text, ceo_notu text, eski_kart_no text,
  guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  CHECK (durum <> 'Tamamlandı' OR tamamlanma_tarihi IS NOT NULL)
);
CREATE TABLE master_plan_gecmisi (kimlik bigserial PRIMARY KEY, islem_no text NOT NULL, durum text NOT NULL, verildigi_tarih date, tamamlanma_tarihi date, kayit_no text, ceo_notu text, guncelleyen_ref text, zaman timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION master_plan_izle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO master_plan_gecmisi (islem_no, durum, verildigi_tarih, tamamlanma_tarihi, kayit_no, ceo_notu, guncelleyen_ref) VALUES (NEW.islem_no, NEW.durum, NEW.verildigi_tarih, NEW.tamamlanma_tarihi, NEW.kayit_no, NEW.ceo_notu, NEW.guncelleyen_ref); RETURN NEW; END $$;
CREATE TRIGGER master_plan_izle AFTER UPDATE ON master_plan_karti FOR EACH ROW EXECUTE FUNCTION master_plan_izle();
CREATE TABLE uyum_kurali_gecmisi (kimlik bigserial PRIMARY KEY, mum_no text NOT NULL, onceki jsonb, sonraki jsonb NOT NULL, degistiren_ref text, gerekce text, zaman timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON master_plan_karti TO yatonet_uygulama; GRANT SELECT, INSERT ON master_plan_gecmisi, uyum_kurali_gecmisi TO yatonet_uygulama; GRANT INSERT, UPDATE ON uyum_kurali TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE master_plan_gecmisi_kimlik_seq, uyum_kurali_gecmisi_kimlik_seq TO yatonet_uygulama;
-- YG-1365: yeni durumların sözlük tanımları; "Sürüyor" tüm kayıt türlerinde aynı genel anlamı taşır.
UPDATE durum_sozlugu SET is_anlami = 'İş başladı ve devam ediyor.' WHERE durum = 'Sürüyor';
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('master_plan_karti', 'Verilecek', 'Kart henüz muhataba verilmedi.', 'Kart Master Plandan aktarılınca', 'Kart muhataba verilince', 'Genel Müdür Yardımcısı', ARRAY['Görev Verildi', 'Bekliyor']::text[], false, false, NULL, NULL),
 ('master_plan_karti', 'Görev Verildi', 'Kart verildiği tarihle muhataba verildi; çalışma başlamadı.', 'Verildiği tarih girilerek', 'Çalışma başlayınca Sürüyor; ön koşul eksikse Bekliyor', 'Genel Müdür Yardımcısı', ARRAY['Sürüyor', 'Bekliyor', 'Tamamlandı']::text[], false, false, NULL, NULL),
 ('master_plan_karti', 'Sürüyor', 'İş başladı ve devam ediyor.', 'Muhatap çalışmaya başlayınca', 'Kapanış kanıtı ve kayıt numarasıyla Tamamlandı', 'Genel Müdür Yardımcısı', ARRAY['Bekliyor', 'Düzeltilecek', 'Tamamlandı']::text[], false, false, NULL, NULL),
 ('master_plan_karti', 'Bekliyor', 'Kayıt bir işlem veya karar için sırada bekliyor.', 'Ön koşul veya karar beklenince', 'Engel kalkınca Sürüyor', 'Genel Müdür Yardımcısı', ARRAY['Sürüyor', 'Görev Verildi']::text[], true, false, NULL, NULL),
 ('master_plan_karti', 'Düzeltilecek', 'Kabul makamı çıktıyı eksik buldu; düzeltme bekleniyor.', 'Kabul makamı eksik bulunca', 'Düzeltme yapılınca Sürüyor veya Tamamlandı', 'CEO', ARRAY['Sürüyor', 'Tamamlandı']::text[], true, false, NULL, NULL),
 ('master_plan_karti', 'Tamamlandı', 'Kayıttaki iş bitti; gerekli kayıtlar oluştu.', 'Tamamlanma tarihi ve kayıt numarasıyla', 'Son durum; gerekirse CEO yeniden açar', 'Genel Müdür Yardımcısı', ARRAY['Düzeltilecek']::text[], false, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
