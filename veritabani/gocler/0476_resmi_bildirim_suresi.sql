-- YG-277, TZ-3 (CEO 26.11.2026): çevresel olayda resmî bildirim süreleri parametredir; değeri Hukuk ve Uyum Direktörü girer, girilene kadar boştur (uydurulmaz).
CREATE TABLE resmi_bildirim_suresi (
  muhatap text PRIMARY KEY CHECK (muhatap IN ('Sahil Güvenlik', 'Liman Başkanlığı', 'İl Çevre Müdürlüğü')),
  sure_saat numeric CHECK (sure_saat > 0), dayanak text, giren_ref text REFERENCES kullanici_hesabi (kimlik), guncelleme_zamani timestamptz
);
INSERT INTO resmi_bildirim_suresi (muhatap) VALUES ('Sahil Güvenlik'), ('Liman Başkanlığı'), ('İl Çevre Müdürlüğü');
GRANT SELECT, UPDATE ON resmi_bildirim_suresi TO yatonet_uygulama;
