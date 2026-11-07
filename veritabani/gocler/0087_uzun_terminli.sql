-- YG-868: teslim süresi 14 günü aşan sipariş uzun terminli işaretlenir ve GMY onayından geçer.
ALTER TABLE tedarik_siparisi ADD COLUMN IF NOT EXISTS uzun_terminli boolean NOT NULL DEFAULT false;
