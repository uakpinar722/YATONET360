-- YG-1170: portala açılan görselde firma adı, logosu ve imzası kapatılır; kapatılmış kopya ayrı tutulur, asıl görsel portala gitmez.
ALTER TABLE portal_ilerleme_fotografi ADD COLUMN IF NOT EXISTS maske jsonb, ADD COLUMN IF NOT EXISTS maskeli_anahtar text, ADD COLUMN IF NOT EXISTS maske_teyidi boolean NOT NULL DEFAULT false;
