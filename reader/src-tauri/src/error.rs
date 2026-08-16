use serde::Serialize;

/// Error surfaced to the frontend from invoke commands.
///
/// Mirrors the CB8 error envelope (`{ message | error, code }` + HTTP status)
/// so the UI can branch on `status` (401 → session expired, etc.).
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    /// HTTP status when the server answered; 0 for local/transport errors.
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub message: String,
}

impl ApiError {
    pub fn local(message: impl Into<String>) -> Self {
        Self {
            status: 0,
            code: None,
            message: message.into(),
        }
    }

    #[allow(dead_code)] // public constructor kept for symmetry with `local`
    pub fn status(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            code: None,
            message: message.into(),
        }
    }
}

impl From<reqwest::Error> for ApiError {
    fn from(err: reqwest::Error) -> Self {
        let status = err.status().map(|s| s.as_u16()).unwrap_or(0);
        let message = if err.is_connect() {
            format!("Could not reach the server ({err})")
        } else if err.is_timeout() {
            "The server took too long to respond".to_string()
        } else {
            err.to_string()
        };
        Self {
            status,
            code: None,
            message,
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        Self::local(format!("I/O error: {err}"))
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
