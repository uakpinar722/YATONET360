-- YG-061: durum geçişi, önceki geçişten bu yana tamamlanan görev/onaylar (ön koşul) ve dosyaya eklenen belgelerle kaydedilir.
-- Tüm yazım yollarını kapsamak için tetikleyiciyle doldurulur.
ALTER TABLE dosya_statu_gecmisi ADD COLUMN tamamlanan_kosullar text[] NOT NULL DEFAULT '{}', ADD COLUMN belgeler uuid[] NOT NULL DEFAULT '{}';
CREATE FUNCTION statu_gecmisi_kosul() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE onceki timestamptz;
BEGIN
  SELECT max(olusturma_zamani) INTO onceki FROM dosya_statu_gecmisi WHERE dosya_ref = NEW.dosya_ref;
  onceki := coalesce(onceki, '-infinity'::timestamptz);
  NEW.tamamlanan_kosullar := coalesce((SELECT array_agg(k.tur ORDER BY k.kapanma_zamani) FROM (SELECT DISTINCT ON (tur) tur, kapanma_zamani FROM is_karti
    WHERE nesne_kimligi = NEW.dosya_ref::text AND durum IN ('Tamamlandı', 'Onaylandı') AND kapanma_zamani > onceki ORDER BY tur, kapanma_zamani) k), '{}');
  NEW.belgeler := coalesce((SELECT array_agg(kimlik ORDER BY olusturma_zamani) FROM belge WHERE bag_turu = 'Dosya' AND bag_kimligi = NEW.dosya_ref::text AND olusturma_zamani > onceki), '{}');
  RETURN NEW;
END $$;
CREATE TRIGGER statu_gecmisi_kosul BEFORE INSERT ON dosya_statu_gecmisi FOR EACH ROW EXECUTE FUNCTION statu_gecmisi_kosul();
