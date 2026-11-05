-- YG-1223, YG-1228: sicilde saklama süresi ilişkinin sona ermesinden başlar.
CREATE FUNCTION kurulus_iliski_bitis() RETURNS trigger AS $$ BEGIN IF NEW.ag_statusu = 'Çıkarıldı' AND OLD.ag_statusu <> 'Çıkarıldı' THEN NEW.iliski_bitis := current_date; ELSIF NEW.ag_statusu <> 'Çıkarıldı' THEN NEW.iliski_bitis := NULL; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER kurulus_iliski BEFORE UPDATE OF ag_statusu ON kurulus FOR EACH ROW EXECUTE FUNCTION kurulus_iliski_bitis();
