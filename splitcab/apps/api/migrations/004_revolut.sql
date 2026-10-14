-- Travel partners pay the booker back person to person. With the booker's Revolut username (Revtag) the app
-- links straight to their Revolut page (revolut.me/<revtag>) and can show it as a QR code.
ALTER TABLE users ADD COLUMN revtag text CHECK (revtag ~ '^[a-z0-9]{3,16}$');
