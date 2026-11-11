-- YG-1249, 1252, 1254, 1255: veri kümesi sahipliği, veri yaşı, kalite kural kataloğu ve veri hataları.
CREATE TABLE veri_kumesi (
  kod text PRIMARY KEY, ad text NOT NULL, sahip_rol text NOT NULL, yetkili_kaynak text NOT NULL, kalite_boyutlari text[] NOT NULL, esik_yuzde numeric(5,2) NOT NULL, olcum_donemi text NOT NULL, duzeltme_sorumlusu text NOT NULL,
  guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE veri_yasi_kurali (kod text PRIMARY KEY, kume_ref text NOT NULL REFERENCES veri_kumesi (kod), alan text NOT NULL, azami_gun integer NOT NULL CHECK (azami_gun > 0), yeniden_dogrulama_gun integer NOT NULL CHECK (yeniden_dogrulama_gun > 0), aciklama text NOT NULL);
CREATE TABLE kalite_kurali (
  kod text NOT NULL, surum integer NOT NULL, ad text NOT NULL, amac text NOT NULL, kume_ref text NOT NULL REFERENCES veri_kumesi (kod), kaynak text NOT NULL, kontrol_zamani text NOT NULL,
  boyut text NOT NULL CHECK (boyut IN ('Doğruluk', 'Tamlık', 'Tutarlılık', 'Güncellik', 'Tekillik', 'Geçerlilik')), etki text NOT NULL CHECK (etki IN ('Ödeme', 'Güvenlik', 'Teslim', 'Müşteri', 'Diğer')),
  esik integer NOT NULL DEFAULT 0, istisna text, sahip_rol text NOT NULL, yururluk date NOT NULL DEFAULT current_date, durum text NOT NULL DEFAULT 'Yürürlükte' CHECK (durum IN ('Yürürlükte', 'Yerine Geçti')),
  guncelleyen_ref text REFERENCES kullanici_hesabi (kimlik), PRIMARY KEY (kod, surum)
);
CREATE UNIQUE INDEX kalite_kurali_tek ON kalite_kurali (kod) WHERE durum = 'Yürürlükte';
CREATE TABLE veri_hatasi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kural_kod text NOT NULL, kayit_kimligi text NOT NULL, aciklama text NOT NULL, boyut text NOT NULL, etki text NOT NULL, oncelik text NOT NULL CHECK (oncelik IN ('Yüksek', 'Orta', 'Düşük')),
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Giderildi', 'İstisna')), ilk_gorulme timestamptz NOT NULL DEFAULT now(), son_gorulme timestamptz NOT NULL DEFAULT now(), giderilme timestamptz, istisna_gerekcesi text
);
CREATE UNIQUE INDEX veri_hatasi_acik ON veri_hatasi (kural_kod, kayit_kimligi) WHERE durum <> 'Giderildi';
GRANT SELECT, INSERT, UPDATE ON veri_kumesi, veri_yasi_kurali, kalite_kurali, veri_hatasi TO yatonet_uygulama;
INSERT INTO veri_kumesi (kod, ad, sahip_rol, yetkili_kaynak, kalite_boyutlari, esik_yuzde, olcum_donemi, duzeltme_sorumlusu) VALUES
 ('DOSYA', 'Dosya', 'Operasyon Müdürü', 'YATONET 360 dosya kaydı', '{Tamlık,Tutarlılık,Güncellik}', 98, 'Günlük', 'Dosya Sorumlusu'),
 ('YAT', 'Yat ve Ana Veri', 'Operasyon Müdürü', 'Yat kaydı ve Yat Marka-Model Ana Verisi', '{Tekillik,Doğruluk,Tamlık}', 97, 'Haftalık', 'Dosya Sorumlusu'),
 ('FIRMA', 'Firma Sicili', 'Firma Yönetimi Müdürü', 'Firma sicili ve sicil belgeleri', '{Doğruluk,Güncellik,Tekillik}', 98, 'Aylık', 'Sicil Sorumlusu'),
 ('TARAF', 'Taraf ve İletişim', 'Müşteri ve Paydaş İlişkileri Müdürü', 'Doğrulanmış iletişim kaydı', '{Geçerlilik,Güncellik}', 97, 'Aylık', 'Müşteri ve Paydaş İlişkileri Uzmanı'),
 ('FATURA', 'Fatura ve Tahsilat', 'Muhasebe ve Finans Müdürü', 'Muhasebe hizmetinden dönen fatura bilgisi ve banka hareketi', '{Doğruluk,Tutarlılık}', 99.5, 'Günlük', 'Muhasebe ve Finans Sorumlusu (Ticari Sorumlu)');
INSERT INTO veri_yasi_kurali (kod, kume_ref, alan, azami_gun, yeniden_dogrulama_gun, aciklama) VALUES
 ('VY-01', 'TARAF', 'iletisim_bilgisi.dogrulama_zamani', 365, 365, 'Doğrulanmış telefon ve e-posta yılda bir yeniden doğrulanır'),
 ('VY-02', 'FIRMA', 'firma_tesisi.kapasite_teyit_tarihi', 365, 365, 'Tesis kapasitesi yılda bir teyit edilir'),
 ('VY-03', 'FIRMA', 'kurulus.guncelleme_zamani', 365, 365, 'Firma sicil bilgileri yılda bir gözden geçirilir');
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
 ('kalite_kurali', 'Yürürlükte', 'Kayıt onaylanmış ve geçerlilik süresi içinde uygulanıyor.', 'Kural tanımlanınca veya yeni sürümü kaydedilince', 'Yeni sürüm kaydedilince Yerine Geçti', 'Bilgi İşlem Müdürü', ARRAY['Yerine Geçti']::text[], false, false, NULL, NULL),
 ('kalite_kurali', 'Yerine Geçti', 'Kaydın yeni sürümü yürürlüğe girdi; bu sürüm yalnız geçmiş için saklanır.', 'Aynı kuralın yeni sürümü kaydedilince', 'Son durum; değişmez', 'Sistem', '{}'::text[], false, false, NULL, NULL),
 ('veri_hatasi', 'Açık', 'Kayıt üzerinde çalışma sürüyor; kapanış koşulları henüz sağlanmadı.', 'Kalite kontrolü kuralı ihlal eden kaydı bulunca', 'Kayıt düzeltilince sonraki kontrolde Giderildi; veri sahibi gerekçeyle İstisna', 'Sistem', ARRAY['Giderildi', 'İstisna']::text[], false, false, 'Eşik aşılınca düzeltme sorumlusuna bildirim', NULL),
 ('veri_hatasi', 'Giderildi', 'Veri hatası düzeltildi; sonraki kontrolde tekrar görülmedi.', 'Kural ihlali sonraki kontrolde bulunmayınca', 'Son durum; tekrar görülürse yeni kayıt açılır', 'Sistem', '{}'::text[], false, false, NULL, NULL),
 ('veri_hatasi', 'İstisna', 'Veri sahibi hatayı gerekçesiyle istisna kabul etti.', 'Veri kümesi sahibi gerekçe yazınca', 'Son durum', 'Operasyon Müdürü', '{}'::text[], true, false, NULL, NULL)
ON CONFLICT (kayit_turu, durum) DO NOTHING;
