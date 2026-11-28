-- YG-1570 (V-1148): bağımsız Sigorta Eksperi ayrı ekranla çalışır; tanıklık davetine katılım yanıtı verir, bekletilen parça için inceleme randevusu talep eder.
CREATE TABLE eksper_davet_yaniti (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), kontrol_noktasi_ref uuid NOT NULL REFERENCES kontrol_noktasi (kimlik),
  kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), yanit text NOT NULL CHECK (yanit IN ('Katılacağım', 'Katılmayacağım')),
  zaman timestamptz NOT NULL DEFAULT now(), UNIQUE (kontrol_noktasi_ref, kullanici_ref)
);
CREATE TABLE eksper_inceleme_randevusu (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  istenen_zaman timestamptz NOT NULL, not_metni text, durum text NOT NULL DEFAULT 'Talep Edildi' CHECK (durum IN ('Talep Edildi', 'Planlandı')),
  planlanan_zaman timestamptz, planlayan_ref text REFERENCES kullanici_hesabi (kimlik), olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX eksper_inceleme_randevusu_acik ON eksper_inceleme_randevusu (dosya_ref, kullanici_ref) WHERE durum = 'Talep Edildi';
GRANT SELECT, INSERT, UPDATE ON eksper_davet_yaniti, eksper_inceleme_randevusu TO yatonet_uygulama;
INSERT INTO durum_sozlugu (kayit_turu, durum, is_anlami, giris_kosulu, cikis_kosulu, yetkili_rol, izinli_gecisler, zorunlu_aciklama, sure_durur, otomatik_bildirim, musteri_adi) VALUES
  ('eksper_inceleme_randevusu', 'Talep Edildi', 'Randevu talebi iletildi; Dosya Sorumlusunun planlamasını bekliyor.', 'Sigorta Eksperi parça incelemesi için randevu talep edince', 'Dosya Sorumlusu randevu zamanını kaydedince Planlandı', 'Dosya Sorumlusu', ARRAY['Planlandı'], false, false, NULL, NULL),
  ('eksper_inceleme_randevusu', 'Planlandı', 'İş için tarih ve sorumlu belirlendi; henüz başlamadı.', 'Dosya Sorumlusu randevu zamanını kaydedince', 'Son durum; değişmez', 'Dosya Sorumlusu', '{}'::text[], false, true, NULL, NULL);
