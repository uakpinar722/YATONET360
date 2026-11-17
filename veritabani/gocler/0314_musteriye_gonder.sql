-- YG-1601: teklif Gönderildi olunca Dosya Sorumlusunun "Müşteriye Gönder" görevi tamamlanır.
CREATE FUNCTION musteriye_gonder_kapat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statu = 'Gönderildi' AND OLD.statu IS DISTINCT FROM 'Gönderildi' THEN
    UPDATE is_karti SET durum = 'Tamamlandı', kapanma_zamani = now() WHERE tur = 'Müşteriye Gönder' AND nesne_kimligi = NEW.kimlik::text AND durum = 'Bekliyor';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER musteriye_gonder_kapat AFTER UPDATE OF statu ON fiyat_teklifi FOR EACH ROW EXECUTE FUNCTION musteriye_gonder_kapat();
