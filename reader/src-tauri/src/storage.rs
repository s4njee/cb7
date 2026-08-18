//! Transactional SQLite persistence for the local catalog.
//!
//! The serde payload is kept intact for compatibility while each book lives
//! in its own row. This makes progress and metadata writes proportional to the
//! changed record rather than the size of the whole library.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::local::{Catalog, LinkedFolder, LocalBook};

/// Path of the catalog database. Shared with the search index, which lives in
/// the same file so a book and everything derived from it commit together.
pub fn db_path(library_dir: &Path) -> PathBuf {
    library_dir.join("catalog.sqlite3")
}

/// Cheap to clone (it is just a path): background workers take their own handle
/// rather than borrowing `AppState`.
#[derive(Clone)]
pub struct CatalogStore {
    path: PathBuf,
}

impl CatalogStore {
    pub fn open(library_dir: &Path) -> Result<(Self, Catalog), Box<dyn std::error::Error>> {
        let store = Self {
            path: db_path(library_dir),
        };
        let conn = store.connection()?;
        store.create_schema(&conn)?;
        let migrated = conn
            .query_row("SELECT value FROM catalog_meta WHERE key = 'migrated'", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()?
            .is_some();
        let has_rows: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM books LIMIT 1)", [], |row| row.get(0))?;

        if !migrated && !has_rows {
            let legacy = library_dir.join("catalog.json");
            let catalog = std::fs::read(&legacy)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Catalog>(&bytes).ok())
                .unwrap_or_default();
            store.persist(&Catalog::default(), &catalog)?;
            let conn = store.connection()?;
            conn.execute(
                "INSERT OR REPLACE INTO catalog_meta(key, value) VALUES ('migrated', '1')",
                [],
            )?;
            log::info!("migrated local catalog {} → {}", legacy.display(), store.path.display());
            Ok((store, catalog))
        } else {
            let catalog = store.load()?;
            Ok((store, catalog))
        }
    }

    fn connection(&self) -> rusqlite::Result<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")?;
        Ok(conn)
    }

    fn create_schema(&self, conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS linked_folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL);",
        )
    }

    pub fn load(&self) -> Result<Catalog, Box<dyn std::error::Error>> {
        let conn = self.connection()?;
        let version = self.meta_i64(&conn, "version").unwrap_or(1) as u32;
        let next_id = self.meta_i64(&conn, "next_id").unwrap_or(1);
        let mut stmt = conn.prepare("SELECT payload FROM books ORDER BY id")?;
        let books = stmt
            .query_map([], |row| {
                let payload: String = row.get(0)?;
                serde_json::from_str::<LocalBook>(&payload).map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(payload.len(), rusqlite::types::Type::Text, Box::new(err))
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut stmt = conn.prepare("SELECT id, path FROM linked_folders ORDER BY id")?;
        let linked_folders = stmt
            .query_map([], |row| {
                Ok(LinkedFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Catalog {
            version,
            books,
            next_id,
            linked_folders,
        })
    }

    fn meta_i64(&self, conn: &Connection, key: &str) -> Option<i64> {
        conn.query_row("SELECT value FROM catalog_meta WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|value| value.parse().ok())
    }

    pub fn persist(&self, before: &Catalog, after: &Catalog) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO catalog_meta(key, value) VALUES ('version', ?1)",
            params![after.version.to_string()],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO catalog_meta(key, value) VALUES ('next_id', ?1)",
            params![after.next_id.to_string()],
        )?;
        for old in &before.books {
            if !after.books.iter().any(|book| book.id == old.id) {
                tx.execute("DELETE FROM books WHERE id = ?1", params![old.id])?;
            }
        }
        for book in &after.books {
            let changed = before.books.iter().find(|old| old.id == book.id) != Some(book);
            if changed {
                tx.execute(
                    "INSERT OR REPLACE INTO books(id, payload) VALUES (?1, ?2)",
                    params![book.id, serde_json::to_string(book)?],
                )?;
            }
        }
        tx.execute("DELETE FROM linked_folders", [])?;
        for folder in &after.linked_folders {
            tx.execute(
                "INSERT INTO linked_folders(id, path) VALUES (?1, ?2)",
                params![folder.id, folder.path],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cb8-storage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrates_legacy_json_once_and_preserves_the_record() {
        let dir = temp_dir("migration");
        std::fs::write(
            dir.join("catalog.json"),
            r#"{"version":1,"next_id":2,"books":[{"id":1,"title":"Legacy","file":"books/a.epub","ext":"epub","mediaType":"book","bytes":12,"addedAt":1}]}"#,
        )
        .unwrap();

        let (store, catalog) = CatalogStore::open(&dir).unwrap();
        assert_eq!(catalog.books[0].title, "Legacy");
        assert!(dir.join("catalog.sqlite3").is_file());
        let (_, reopened) = CatalogStore::open(&dir).unwrap();
        assert_eq!(reopened.books[0].title, "Legacy");
        assert_eq!(store.load().unwrap().next_id, 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn persists_changed_rows_and_removes_deleted_rows() {
        let dir = temp_dir("rows");
        let (store, mut before) = CatalogStore::open(&dir).unwrap();
        before.books.push(serde_json::from_str(
            r#"{"id":1,"title":"Before","file":"books/a.epub","ext":"epub","mediaType":"book","bytes":12,"addedAt":1}"#,
        ).unwrap());
        before.next_id = 2;
        store.persist(&Catalog::default(), &before).unwrap();
        let mut after = before.clone();
        after.books[0].title = "After".into();
        store.persist(&before, &after).unwrap();
        assert_eq!(store.load().unwrap().books[0].title, "After");
        store.persist(&after, &Catalog::default()).unwrap();
        assert!(store.load().unwrap().books.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
