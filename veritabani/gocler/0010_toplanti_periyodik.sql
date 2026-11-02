-- Toplantı kataloğu ve kaydı (Ek II §1.8; YG-576…YG-584), periyodik gözden geçirme takvimi (YG-534).
CREATE TABLE toplanti_katalogu (
  kod            text PRIMARY KEY,
  ad             text NOT NULL,
  siklik         text NOT NULL,
  baskan_rol     text,            -- Boşsa en üst kademedeki LGM katılımcısı başkandır (YG-579).
  duzenleyen_rol text,            -- Boşsa talep eden düzenler (TPL-10).
  katilimcilar   text NOT NULL,
  oto_roller     text[] NOT NULL DEFAULT '{}',
  oto_kademeler  text[] NOT NULL DEFAULT '{}',
  dosyaya_bagli  boolean NOT NULL DEFAULT false
);
INSERT INTO toplanti_katalogu VALUES
  ('TPL-01', 'Günlük Saha Koordinasyonu', 'Sahada iş olan her gün', 'Saha Sorumlusu', 'Saha Sorumlusu', 'Dosya Sorumlusu, Firma Yetkilisi', '{}', '{}', true),
  ('TPL-02', 'Haftalık Operasyon', 'Haftalık', 'Teknik ve Operasyon Direktörü', 'Operasyon Müdürü', 'Teknik Müdür, Dosya Sorumluları, kalite, ticari ve firma yönetimi temsilcileri', '{Teknik ve Operasyon Direktörü,Teknik Müdür,Dosya Sorumlusu}', '{}', false),
  ('TPL-03', 'Aylık Yönetim', 'Aylık', 'CEO', 'CEO Asistanı', 'GMY, direktörler, Operasyon Müdürü, Teknik Müdür', '{CEO,Genel Müdür Yardımcısı,Operasyon Müdürü,Teknik Müdür}', '{Direktör}', false),
  ('TPL-04', 'Üç Aylık Stratejik Gözden Geçirme', 'Üç aylık', 'CEO', 'CEO Asistanı', 'GMY, direktörler', '{CEO,Genel Müdür Yardımcısı}', '{Direktör}', false),
  ('TPL-05', 'Yıllık Gözden Geçirme', 'Yıllık', 'CEO', 'CEO Asistanı', 'GMY, direktörler, müdürler', '{CEO,Genel Müdür Yardımcısı}', '{Direktör,Müdür}', false),
  ('TPL-06', 'Kapsam Hazırlık', 'Her dosyada teklif öncesi', 'Teknik Yönetici', 'Dosya Sorumlusu', 'Teknik Uzman', '{}', '{}', true),
  ('TPL-07', 'Başlangıç', 'Her mobilizasyonda; basit işte kısa form', NULL, 'Dosya Sorumlusu', 'Saha Sorumlusu, Firma Yetkilisi, Kalite Kontrolör', '{}', '{}', true),
  ('TPL-08', 'Kabul ve Teslim', 'Kabulde', NULL, 'Dosya Sorumlusu', 'Teknik Uzman, Kalite Kontrolör, yat sahibi veya yetkilisi', '{}', '{}', true),
  ('TPL-09', 'Dosya Kapanış', 'Kapanışta', NULL, 'Dosya Sorumlusu', 'Dosya ekibi, Ticari Sorumlu', '{}', '{}', true),
  ('TPL-10', 'Olağanüstü Toplantı', 'Gerektiğinde', NULL, NULL, 'Davet edilenler', '{}', '{}', false);

CREATE TABLE toplanti (
  kimlik       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tpl_kod      text NOT NULL REFERENCES toplanti_katalogu (kod),
  konu         text NOT NULL CHECK (length(trim(konu)) > 0),
  gundem       text,
  baslangic    timestamptz NOT NULL,
  sure_dk      integer NOT NULL CHECK (sure_dk BETWEEN 5 AND 600),
  oncelik      text NOT NULL DEFAULT 'Normal' CHECK (oncelik IN ('Kritik', 'Normal')),
  duzenleyen_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  baskan_ref   text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  gorusme_baglantisi text,
  durum        text NOT NULL DEFAULT 'Planlandı' CHECK (durum IN ('Planlandı', 'Tamamlandı', 'İptal')),
  tutanak      text,
  kapanis_zamani timestamptz,
  olusturma_zamani timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX toplanti_zaman ON toplanti (baslangic) WHERE durum = 'Planlandı';

CREATE TABLE toplanti_katilimci (
  kimlik       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toplanti_ref uuid NOT NULL REFERENCES toplanti (kimlik),
  kullanici_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  katilim      text NOT NULL DEFAULT 'Zorunlu' CHECK (katilim IN ('Zorunlu', 'İsteğe Bağlı', 'Yalnız Bilgi')),
  vekil_ref    text REFERENCES kullanici_hesabi (kimlik),
  -- Ek II §1.8: vekil, üst makamın en geç 1 saat önceki onayıyla geçerlidir; onay yoksa katılımcı mazeretlidir.
  vekil_durumu text CHECK (vekil_durumu IN ('Onay Bekliyor', 'Onaylandı', 'Mazeretli')),
  UNIQUE (toplanti_ref, kullanici_ref)
);
CREATE INDEX toplanti_katilimci_kisi ON toplanti_katilimci (kullanici_ref);

CREATE TABLE toplanti_karar (
  kimlik       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toplanti_ref uuid NOT NULL REFERENCES toplanti (kimlik),
  metin        text NOT NULL CHECK (length(trim(metin)) > 0),
  sorumlu_ref  text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  hedef_tarih  date NOT NULL,
  is_karti_ref uuid REFERENCES is_karti (kimlik),
  yazan_ref    text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  zaman        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE periyodik_is (
  kimlik        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad            text NOT NULL UNIQUE,
  sahip_rol_ref text NOT NULL REFERENCES rol (kimlik),
  periyot_ay    integer NOT NULL CHECK (periyot_ay > 0),
  sonraki_tarih date NOT NULL,
  aktif         boolean NOT NULL DEFAULT true
);

GRANT SELECT ON toplanti_katalogu TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON toplanti, toplanti_katilimci, periyodik_is TO yatonet_uygulama;
-- Kararlar silinmez, metni değiştirilmez.
GRANT SELECT, INSERT ON toplanti_karar TO yatonet_uygulama;
GRANT UPDATE (is_karti_ref) ON toplanti_karar TO yatonet_uygulama;
