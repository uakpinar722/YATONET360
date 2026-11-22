-- YG-1607: gün olarak verilen sürede bitiş son gün 12:00; pazar veya tatile düşen bitişin kaydırma notu.
ALTER TABLE is_karti ADD COLUMN sure_notu text;
