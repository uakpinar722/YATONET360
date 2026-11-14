-- YG-097: kaptan hizmet alımı Lojistik branşında Kaptan rolüyle.
ALTER TABLE kaptan_gorevlendirme ADD COLUMN brans text NOT NULL DEFAULT 'LOJISTIK-01', ADD COLUMN hizmet_rolu text NOT NULL DEFAULT 'Kaptan', ADD COLUMN kurulus_ref uuid REFERENCES kurulus (kimlik);
