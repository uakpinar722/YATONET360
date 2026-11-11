-- YG-808: her ay kapanan dosyaların %10'u iç denetim örneklemi.
CREATE TABLE ic_denetim_orneklemi (donem text NOT NULL CHECK (donem ~ '^[0-9]{4}-[0-9]{2}$'), dosya_ref uuid NOT NULL REFERENCES dosya (kimlik), havuz integer NOT NULL, secim_zamani timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (donem, dosya_ref));
GRANT SELECT, INSERT ON ic_denetim_orneklemi TO yatonet_uygulama;
