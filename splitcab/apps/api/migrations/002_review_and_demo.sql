-- Demo travellers exist only to show the store review account a complete match. They never match real people.
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
