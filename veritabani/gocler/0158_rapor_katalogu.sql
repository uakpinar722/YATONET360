-- YG-734, 737–740, 742, 744, 751–754, 757: rapor ve gösterge kataloğu; sürüm, çalışma, dağıtım, yayın ve geri çağırma.
CREATE TABLE rapor_tanimi (
  kod text NOT NULL, surum integer NOT NULL, ad text NOT NULL, tur text NOT NULL CHECK (tur IN ('Rapor', 'Gösterge')), sahip_rol text NOT NULL, amac text NOT NULL,
  kaynak text NOT NULL, pay text NOT NULL, payda text, dahil text, haric text, zaman_boyutu text NOT NULL CHECK (zaman_boyutu IN ('Kayıt', 'Fiilî Olay', 'Onay', 'Kapanış', 'Fatura')),
  kesim text NOT NULL DEFAULT 'Dönem sonu 24:00, Europe/Istanbul', birim text NOT NULL, yuvarlama text NOT NULL DEFAULT 'Ondalık bir basamak', siklik text NOT NULL CHECK (siklik IN ('Anlık', 'Günlük', 'Aylık')),
  hassasiyet text NOT NULL DEFAULT 'Genel' CHECK (hassasiyet IN ('Genel', 'Hassas')), beklenen_eylem text, test_kaniti text NOT NULL, yururluk date NOT NULL, degisiklik_notu text, karsilastirma_etkisi text,
  durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Planlandı', 'Yürürlükte', 'Yerine Geçti')), hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kod, surum)
);
CREATE UNIQUE INDEX rapor_tanimi_tek_yururluk ON rapor_tanimi (kod) WHERE durum = 'Yürürlükte';
CREATE TABLE rapor_calismasi (kimlik bigserial PRIMARY KEY, kod text NOT NULL, baslangic timestamptz NOT NULL, bitis timestamptz NOT NULL, sonuc text NOT NULL CHECK (sonuc IN ('Başarılı', 'Başarısız')), satir integer, filtre jsonb NOT NULL DEFAULT '{}', hata text);
CREATE INDEX rapor_calismasi_kod ON rapor_calismasi (kod, bitis DESC);
CREATE TABLE rapor_dagitim (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kod text NOT NULL, kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), amac text NOT NULL, bitis date NOT NULL,
  durum text NOT NULL DEFAULT 'Aktif' CHECK (durum IN ('Aktif', 'Çıkarıldı')), cikis_nedeni text, ekleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rapor_dagitim_tek ON rapor_dagitim (kod, kullanici_ref) WHERE durum = 'Aktif';
CREATE TABLE rapor_yayini (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kod text NOT NULL, surum integer NOT NULL, donem text NOT NULL, belge_ref uuid REFERENCES belge (kimlik), durum text NOT NULL DEFAULT 'Yayımlandı' CHECK (durum IN ('Yayımlandı', 'Geri Çağrıldı')),
  gerekce text, etkilenen_kararlar text, dogru_yayin_ref uuid REFERENCES rapor_yayini (kimlik), yayimlayan_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now(), geri_cagiran_ref text REFERENCES kullanici_hesabi (kimlik), geri_cagirma_zamani timestamptz
);
-- YG-742: hedef ve eşik değişikliği sessizce yapılamaz; her değişiklik geçmişte kalır ve gösterilir.
CREATE TABLE gosterge_hedefi_gecmisi (kimlik bigserial PRIMARY KEY, kod text NOT NULL, hedef numeric, uyari_esigi numeric, kritik_esik numeric, gerekce text NOT NULL, guncelleyen_ref text NOT NULL, zaman timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION gosterge_hedefi_izle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO gosterge_hedefi_gecmisi (kod, hedef, uyari_esigi, kritik_esik, gerekce, guncelleyen_ref) VALUES (NEW.kod, NEW.hedef, NEW.uyari_esigi, NEW.kritik_esik, NEW.gerekce, NEW.guncelleyen_ref); RETURN NEW; END $$;
CREATE TRIGGER gosterge_hedefi_izle AFTER INSERT OR UPDATE ON gosterge_hedefi FOR EACH ROW EXECUTE FUNCTION gosterge_hedefi_izle();
INSERT INTO gosterge_hedefi_gecmisi (kod, hedef, uyari_esigi, kritik_esik, gerekce, guncelleyen_ref, zaman) SELECT kod, hedef, uyari_esigi, kritik_esik, gerekce, guncelleyen_ref, zaman FROM gosterge_hedefi;
GRANT SELECT, INSERT, UPDATE ON rapor_tanimi, rapor_calismasi, rapor_dagitim, rapor_yayini TO yatonet_uygulama;
GRANT SELECT, INSERT ON gosterge_hedefi_gecmisi TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE rapor_calismasi_kimlik_seq, gosterge_hedefi_gecmisi_kimlik_seq TO yatonet_uygulama;
-- Mevcut raporların ilk tanımları (kod içindeki hesaplardan).
INSERT INTO rapor_tanimi (kod, surum, ad, tur, sahip_rol, amac, kaynak, pay, payda, dahil, haric, zaman_boyutu, birim, yuvarlama, siklik, hassasiyet, beklenen_eylem, test_kaniti, yururluk) VALUES
 ('RP-TIC-002', 1, 'Aylık Yönetim Raporu', 'Rapor', 'Ticari İşler Direktörü', 'Faturalanmamış iş, tahsil edilmemiş fatura ve tahsil edilip firmaya ödenmemiş tutarın izlenmesi', 'fiyat_teklifi, fiyat_teklifi_kalemi, musteri_faturasi, tahsilat, hakedis, is_emri', 'Onaylı satış − faturalanan (KDV hariç); kalan fatura tutarı; doğrulanmış ödenmemiş hakediş neti', NULL, 'İşe başlanmış dosyalar; Faturalandı, Kısmi Tahsil, Tahsil Edildi faturalar', 'İptal faturalar', 'Fatura', 'EUR', 'Kuruş (iki basamak)', 'Aylık', 'Hassas', 'Tahsilat ve faturalama aksiyonu; firma ödemesinin önceliklendirilmesi', 'Otomatik test: yonetim_raporu', '2026-11-01'),
 ('RP-CEO-001', 1, 'Aylık CEO Raporu', 'Rapor', 'Genel Müdür Yardımcısı', 'Üst yönetimin aylık özet görünümü', 'Yönetim panosu göstergeleri ve yönetim raporu', 'Gösterge tanımlarına göre', NULL, NULL, NULL, 'Kapanış', 'Karma', 'Gösterge tanımına göre', 'Aylık', 'Hassas', 'Aylık yönetim kararları', 'Otomatik test: rapor_belge', '2026-11-01'),
 ('RP-KUR-001', 1, 'Kurumsal Filo Raporu', 'Rapor', 'Müşteri ve Paydaş İlişkileri Müdürü', 'Kurumsal müşteriye filo bazında dosya ve maliyet görünümü', 'dosya, yat, fiyat_teklifi, musteri_faturasi', 'Kurumsal müşterinin yatlarına ait dosya ve tutarlar', NULL, 'Kurumsal müşterinin yatları', 'Diğer müşterilerin kayıtları', 'Onay', 'EUR', 'Kuruş (iki basamak)', 'Aylık', 'Hassas', 'Müşteri görüşmesi ve sözleşme değerlendirmesi', 'Otomatik test: kurumsal_rapor', '2026-11-01'),
 ('RP-YON-EK', 1, 'Yönetim Raporu Ekleri', 'Rapor', 'Ticari İşler Direktörü', 'Müşteri yoğunlaşması, teklif dönüşümü, mali kapanış süresi, kademe atlama, kaybedilen yat, marka/model hasar', 'musteri_faturasi, fiyat_teklifi, kapanis_kontrolu, dosya, is_karti_adim, yat, yat_marka_model', 'Bölüm tanımlarına göre (ilk 1/ilk 3 müşteri payı; onaylanan/karar verilen teklif; teknik→mali kapanış iş günü)', 'Bölüm tanımlarına göre', 'Gönderilmiş teklifler; onaylı teknik kapanışlar', 'Gönderilmemiş teklifler', 'Fatura', 'Karma', 'Ondalık bir basamak', 'Aylık', 'Hassas', 'Yoğunlaşma ve dönüşüm uyarısında ticari plan; 15 iş günü aşımında mali kapanış', 'Otomatik test: yonetim_ek', '2026-11-11');
