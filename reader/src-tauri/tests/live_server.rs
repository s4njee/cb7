//! Integration test against a live CB8 server — the same client construction
//! the app uses (reqwest + persisted cookie store), exercising login → session
//! → library → page bytes → epub bytes.
//!
//! Skipped unless `CB8_TEST_SERVER` (e.g. http://localhost:4218) and
//! `CB8_TEST_PASSWORD` are set, so `cargo test` stays hermetic by default.

use std::io::{BufReader, BufWriter};
use std::sync::Arc;

use reqwest_cookie_store::CookieStoreMutex;

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn build_client(cookies: Arc<CookieStoreMutex>) -> reqwest::Client {
    reqwest::Client::builder()
        .cookie_provider(cookies)
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("client")
}

#[tokio::test]
async fn login_session_library_and_media_roundtrip() {
    let (Some(server), Some(password)) = (env("CB8_TEST_SERVER"), env("CB8_TEST_PASSWORD")) else {
        eprintln!("CB8_TEST_SERVER / CB8_TEST_PASSWORD not set — skipping live test");
        return;
    };
    let username = env("CB8_TEST_USERNAME").unwrap_or_else(|| "admin".into());

    let cookies = Arc::new(CookieStoreMutex::new(Default::default()));
    let client = build_client(cookies.clone());

    // 1. Anonymous session probe (what `set_server` does).
    let session: serde_json::Value = client
        .get(format!("{server}/api/auth/session"))
        .send()
        .await
        .expect("probe reachable")
        .json()
        .await
        .expect("probe json");
    assert!(session.get("authenticated").is_some(), "not a CB8 server: {session}");

    // 2. Login via the wrapper endpoint (what the `login` command does).
    let login: serde_json::Value = client
        .post(format!("{server}/api/auth/login"))
        .header(reqwest::header::ORIGIN, server.clone())
        .json(&serde_json::json!({ "username": username, "password": password }))
        .send()
        .await
        .expect("login sent")
        .json()
        .await
        .expect("login json");
    assert_eq!(login.get("ok"), Some(&serde_json::Value::Bool(true)), "login failed: {login}");

    // 3. Cookie store now holds the session token; round-trip it through the
    //    same serde the app uses for cookies.json persistence.
    let serialized = {
        let store = cookies.lock().unwrap();
        let mut buf = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(
            &store,
            &mut BufWriter::new(&mut buf),
        )
        .expect("save cookies");
        buf
    };
    assert!(
        String::from_utf8_lossy(&serialized).contains("session_token"),
        "session cookie not captured"
    );
    let restored =
        cookie_store::serde::json::load_all(BufReader::new(serialized.as_slice())).expect("reload");
    let cookies2 = Arc::new(CookieStoreMutex::new(restored));
    let client2 = build_client(cookies2);

    // 4. The restored store must authenticate a *fresh* client (app restart).
    let me: serde_json::Value = client2
        .get(format!("{server}/api/auth/session"))
        .send()
        .await
        .expect("session sent")
        .json()
        .await
        .expect("session json");
    assert_eq!(
        me.get("authenticated"),
        Some(&serde_json::Value::Bool(true)),
        "restored cookies did not authenticate: {me}"
    );

    // 5. Library list + media bytes through the authenticated client — the
    //    exact requests the cb8:// proxy forwards.
    let list: serde_json::Value = client2
        .get(format!("{server}/api/comics?limit=200"))
        .send()
        .await
        .expect("comics sent")
        .json()
        .await
        .expect("comics json");
    let records = list.get("records").and_then(|r| r.as_array()).expect("records array");
    assert!(!records.is_empty(), "library is empty");

    let comic = records
        .iter()
        .find(|r| r.get("mediaType").and_then(|m| m.as_str()) == Some("comic"))
        .expect("a comic exists");
    let comic_id = comic.get("id").and_then(|v| v.as_i64()).expect("comic id");
    let page = client2
        .get(format!("{server}/api/comics/{comic_id}/pages/0"))
        .send()
        .await
        .expect("page sent");
    assert!(page.status().is_success());
    let ct = page
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    assert!(ct.starts_with("image/"), "page content-type: {ct}");
    assert!(page.bytes().await.expect("page bytes").len() > 1000);

    let book = records
        .iter()
        .find(|r| r.get("mediaType").and_then(|m| m.as_str()) == Some("book"))
        .expect("a book exists");
    let book_id = book.get("id").and_then(|v| v.as_i64()).expect("book id");
    let file = client2
        .get(format!("{server}/api/comics/{book_id}/file"))
        .send()
        .await
        .expect("file sent");
    assert!(file.status().is_success());
    let bytes = file.bytes().await.expect("file bytes");
    assert_eq!(&bytes[..2], b"PK", "epub should be a zip");
}
