-- YG-976: personelin sistemden istifa bildirimi.
CREATE TABLE istifa_bildirimi (
  kimlik uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personel_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik),
  bildirim_zamani timestamptz NOT NULL DEFAULT now(),
  istenen_son_gun date,
  aciklama text,
  durum text NOT NULL DEFAULT 'Açık' CHECK (durum IN ('Açık', 'Ayrılışa Aktarıldı', 'Geri Alındı'))
);
GRANT SELECT, INSERT, UPDATE ON istifa_bildirimi TO yatonet_uygulama;
