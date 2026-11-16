-- PRM-3 (CEO 16.11.2026): tamamlanmamış taslak kayıtlar silinmez; liste sayfası 50 kayıt (PRM-2), toplu dışa aktarım V-395'te kalır.
DELETE FROM sistem_parametresi WHERE kod = 'taslak_silme_gun';
UPDATE sistem_parametresi SET aciklama = 'Liste ve filtre ekranlarında sayfa başına kayıt (fazlası sonraki sayfa)' WHERE kod = 'liste_azami';
