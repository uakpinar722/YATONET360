-- YG-1593: siparişte kalemin kritik sınıfı (K1–K4) ve K3/K4 için belge ve giriş kontrolü şartı.
ALTER TABLE tedarik_siparisi ADD COLUMN kritik_sinif text CHECK (kritik_sinif IN ('K1', 'K2', 'K3', 'K4')), ADD COLUMN belge_giris_sartlari text;
