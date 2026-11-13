-- YG-382: kontrol noktası sonucunda incelenen kanıt sürümü ve kullanılan ölçüt.
ALTER TABLE kontrol_noktasi ADD COLUMN kanit_surum_ref uuid REFERENCES belge_surum (kimlik), ADD COLUMN kullanilan_olcut text;
