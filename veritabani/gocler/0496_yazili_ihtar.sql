-- YG-546 (V-1127): 15. gün yazılı ihtar kaydı; metin CEO onaylı (27.11.2026), KEP gönderimi KEP kararı nedeniyle yok.
CREATE TABLE yazili_ihtar (
  kimlik bigserial PRIMARY KEY, fatura_ref uuid NOT NULL REFERENCES musteri_faturasi (kimlik), dil text NOT NULL CHECK (dil IN ('tr', 'en')),
  son_odeme_tarihi date NOT NULL, kanal text NOT NULL CHECK (kanal IN ('PDF (elden)', 'E-posta', 'Posta', 'Noter')), kalan_eur numeric(14,2) NOT NULL,
  ureten_ref text NOT NULL REFERENCES kullanici_hesabi (kimlik), zaman timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON yazili_ihtar TO yatonet_uygulama;
GRANT USAGE ON SEQUENCE yazili_ihtar_kimlik_seq TO yatonet_uygulama;
