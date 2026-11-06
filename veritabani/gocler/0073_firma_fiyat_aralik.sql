-- YG-234: firma teklifindeki birim maliyet kartela maliyetinin bant aralığı dışındaysa kalem işaretlenir.
ALTER TABLE firma_fiyat_kalemi ADD COLUMN IF NOT EXISTS aralik_disi boolean NOT NULL DEFAULT false;
