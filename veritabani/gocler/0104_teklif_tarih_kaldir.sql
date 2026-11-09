-- SRE-2: teklifte teslim tarihi yazılmaz; tarih onay sonrası dosyada tutulur.
ALTER TABLE fiyat_teklifi DROP COLUMN IF EXISTS tahmini_teslim_tarihi;
