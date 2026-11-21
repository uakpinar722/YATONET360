-- YG-053: Saha Sorumlusu atanmamış dosyada Firma Yetkilisinin günlük saha düzeni beyanı.
ALTER TABLE firma_gunluk_kaydi ADD COLUMN IF NOT EXISTS saha_duzeni text;
