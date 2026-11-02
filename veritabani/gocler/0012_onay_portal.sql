-- Yat Sahibi Onay Ekranı (ONY metinleri), YATONET 360 Onay Kaydı, Yat Sahibi kaydı (Y1) ve SMS ile giriş.
ALTER TABLE sablon_metni ADD COLUMN IF NOT EXISTS dugme text, ADD COLUMN IF NOT EXISTS dogan_gorev text;

CREATE TABLE onay_talebi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dosya_ref uuid REFERENCES dosya (kimlik),
  ony_kod text NOT NULL,
  baslik text NOT NULL, metin text NOT NULL, dugme text NOT NULL, dil text NOT NULL DEFAULT 'tr' CHECK (dil IN ('tr', 'en')),
  -- YG-1507: kutular; her biri {ad, zorunlu}. Varsayılanı boş; ön işaretli kutu yoktur (YG-468).
  kutular jsonb NOT NULL DEFAULT '[]',
  form_turu text,
  tutar_eur numeric(14,2),
  belge_surum_ref uuid REFERENCES belge_surum (kimlik), belge_adi text,
  alici_taraf_ref uuid REFERENCES dosya_tarafi (kimlik), alici_kullanici_ref text REFERENCES kullanici_hesabi (kimlik),
  alici_ad text NOT NULL, telefon text, eposta text,
  belirtec_ozeti text NOT NULL UNIQUE, portal_belirtec_ozeti text UNIQUE,
  durum text NOT NULL DEFAULT 'Bekliyor' CHECK (durum IN ('Bekliyor', 'Onaylandı', 'Reddedildi', 'Süresi Doldu', 'İptal', 'Durduruldu')),
  son_gecerlilik timestamptz NOT NULL,
  nesne_turu text, nesne_kimligi text,
  hazirlayan_ref text REFERENCES kullanici_hesabi (kimlik),
  kod_ozeti text, kod_son timestamptz, kod_gonderim timestamptz, kod_deneme integer NOT NULL DEFAULT 0, sms_gonderim_sayisi integer NOT NULL DEFAULT 0,
  olusturma_zamani timestamptz NOT NULL DEFAULT now(), karar_zamani timestamptz,
  CHECK (telefon IS NOT NULL OR eposta IS NOT NULL OR alici_kullanici_ref IS NOT NULL)
);
CREATE INDEX onay_talebi_dosya ON onay_talebi (dosya_ref);
CREATE INDEX onay_talebi_kisi ON onay_talebi (alici_kullanici_ref) WHERE durum = 'Bekliyor';
CREATE INDEX onay_talebi_taraf ON onay_talebi (alici_taraf_ref) WHERE durum = 'Bekliyor';

-- YG-1433: onay kimlik, tarih-saat ve belge sürümünü tutar. Silinmez, değişmez.
CREATE TABLE yatonet_onay_kaydi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onay_talebi_ref uuid NOT NULL UNIQUE REFERENCES onay_talebi (kimlik),
  karar text NOT NULL CHECK (karar IN ('Onaylandı', 'Reddedildi')),
  onaylanan_belge_surum_ref uuid REFERENCES belge_surum (kimlik),
  metin_ozeti text NOT NULL,
  kutu_cevaplari jsonb NOT NULL DEFAULT '{}',
  form_verisi jsonb,
  onaylayan_ad text NOT NULL, onaylayan_taraf_ref uuid REFERENCES dosya_tarafi (kimlik), onaylayan_kullanici_ref text REFERENCES kullanici_hesabi (kimlik),
  kanal text NOT NULL CHECK (kanal IN ('SMS Kodu', 'E-posta Kodu')),
  onay_kodu text NOT NULL UNIQUE,
  adres text,
  onay_zamani timestamptz NOT NULL DEFAULT now(),
  belge_ref uuid REFERENCES belge (kimlik)
);
GRANT SELECT, INSERT, UPDATE ON onay_talebi TO yatonet_uygulama;
GRANT SELECT, INSERT, UPDATE ON yatonet_onay_kaydi TO yatonet_uygulama;

-- Y1: telefonla kayıt; kod yalnız özet saklanır.
CREATE TABLE kayit_kodu (
  telefon text PRIMARY KEY, kod_ozeti text NOT NULL, son_gecerlilik timestamptz NOT NULL, gonderim_zamani timestamptz NOT NULL DEFAULT now(), deneme integer NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE, DELETE ON kayit_kodu TO yatonet_uygulama;

-- YG-1463: paylı yatta maliklerin beyanıyla atanan tek yetkili malik ve lehtar adı (muvafakat metni için).
ALTER TABLE yat ADD COLUMN IF NOT EXISTS yetkili_malik_ref uuid REFERENCES taraf (kimlik), ADD COLUMN IF NOT EXISTS lehtar_adi text;

-- Yat sahibinin yatı (YG-459): kullanıcı yalnız kendi tarafına bağlı yatları görür.
CREATE INDEX IF NOT EXISTS yat_sahip ON yat (yat_sahibi_ref);
CREATE INDEX IF NOT EXISTS taraf_kullanici ON taraf (kullanici_ref);
CREATE INDEX IF NOT EXISTS taraf_telefon ON taraf (telefon);
