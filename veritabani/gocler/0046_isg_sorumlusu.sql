-- ISG-2, V-190: LGM personelinin rol adı İSG Sorumlusu; yasal iş güvenliği uzmanı OSGB'dedir. Rol kimliği ve atamalar korunur.
UPDATE rol SET rol_adi = 'İSG Sorumlusu' WHERE rol_adi = 'İSG Uzmanı';
