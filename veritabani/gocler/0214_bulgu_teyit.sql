-- YG-128: beyan ile gözlem ayrıştırılamayan bulgu teyit bekler.
ALTER TABLE bulgu ADD COLUMN teyit_bekliyor boolean NOT NULL DEFAULT false, ADD COLUMN teyit_eden_ref text, ADD COLUMN teyit_zamani timestamptz;
