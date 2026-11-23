-- ONY-22 (D-067): firma kullanıcısının portal rehberini okuma zamanı.
ALTER TABLE kurulus_kullanici ADD COLUMN rehber_okuma_zamani timestamptz;
