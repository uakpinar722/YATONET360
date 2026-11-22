-- YG-1048: rol kaldırma sonrası erişim doğrulamasının sonucu inceleme kalemine yazılır.
ALTER TABLE erisim_inceleme_kalemi ADD COLUMN kaldirma_dogrulama jsonb;
