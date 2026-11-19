-- YG-513: bağlı iş kartı kararla kapanınca o karta ait gönderilmiş iletiler İşlem Yapıldı olur (alternatif kanal dahil).
CREATE INDEX IF NOT EXISTS bildirim_is_ref ON bildirim (is_ref) WHERE is_ref IS NOT NULL;
CREATE FUNCTION gonderim_islem_yapildi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kapanma_zamani IS NOT NULL AND OLD.kapanma_zamani IS NULL AND NEW.durum IN ('Onaylandı', 'Reddedildi', 'Tamamlandı') THEN
    UPDATE gonderim g SET durum = 'İşlem Yapıldı'
      FROM bildirim b
     WHERE b.is_ref = NEW.kimlik AND b.olay_anahtari IS NOT NULL AND g.kullanici_ref = b.kullanici_ref
       AND g.olay_anahtari IN (b.olay_anahtari, b.olay_anahtari || ':alternatif') AND g.durum IN ('Gönderildi', 'Teslim Edildi', 'Okundu');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER is_karti_gonderim_islem AFTER UPDATE OF kapanma_zamani ON is_karti FOR EACH ROW EXECUTE FUNCTION gonderim_islem_yapildi();
