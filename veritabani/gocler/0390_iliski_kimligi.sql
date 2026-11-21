-- YG-1146: istek veya arka plan işinin ilişki kimliği yazma sorgusunun başındaki yorumla veritabanına taşınır; değişiklik izi, gönderim,
-- entegrasyon kaydı, toplu aktarım, görev ve bildirim kayıtları bu kimliği kendiliğinden alır.
CREATE FUNCTION iliski_kimligi_al() RETURNS text LANGUAGE sql STABLE AS $$ SELECT substring(current_query() from '/\*iliski=([A-Za-z0-9:-]{1,80})\*/') $$;
GRANT EXECUTE ON FUNCTION iliski_kimligi_al() TO yatonet_uygulama;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['kayit_degisikligi', 'gonderim', 'entegrasyon_kaydi', 'toplu_aktarim', 'is_karti', 'bildirim', 'zamanlanmis_is_durumu'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN iliski_kimligi text', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN iliski_kimligi SET DEFAULT iliski_kimligi_al()', t);
      EXECUTE format('CREATE INDEX %I ON %I (iliski_kimligi) WHERE iliski_kimligi IS NOT NULL', t || '_iliski', t);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS denetim_izi_iliski ON denetim_izi (iliski_kimligi) WHERE iliski_kimligi IS NOT NULL;
