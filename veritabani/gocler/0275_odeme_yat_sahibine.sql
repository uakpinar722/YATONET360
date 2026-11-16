-- YG-892: sigorta şirketinin ödemeyi yat sahibine yapacağı bildirimi.
ALTER TABLE dosya ADD COLUMN odeme_yat_sahibine_zamani timestamptz, ADD COLUMN odeme_yat_sahibine_dayanak text;
