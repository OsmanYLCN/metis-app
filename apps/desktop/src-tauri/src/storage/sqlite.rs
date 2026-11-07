//! Small private RAII boundary for the Windows SDK SQLite C API.
//! No SQL, paths, handles or arbitrary execute command are exposed to the webview.
//! Connections/statements are intentionally neither Send nor Sync.

use super::StorageError;
use std::{
    ffi::{c_char, c_int, c_void, CString},
    marker::PhantomData,
    path::Path,
    ptr::{self, NonNull},
    rc::Rc,
};

#[link(name = "winsqlite3")]
extern "C" {
    fn sqlite3_open_v2(path: *const c_char, db: *mut *mut c_void, flags: c_int, vfs: *const c_char) -> c_int;
    fn sqlite3_close_v2(db: *mut c_void) -> c_int;
    fn sqlite3_busy_timeout(db: *mut c_void, milliseconds: c_int) -> c_int;
    fn sqlite3_exec(db: *mut c_void, sql: *const c_char,
        callback: Option<unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int>,
        data: *mut c_void, error: *mut *mut c_char) -> c_int;
    fn sqlite3_prepare_v2(db: *mut c_void, sql: *const c_char, bytes: c_int,
        statement: *mut *mut c_void, tail: *mut *const c_char) -> c_int;
    fn sqlite3_step(statement: *mut c_void) -> c_int;
    fn sqlite3_column_count(statement: *mut c_void) -> c_int;
    fn sqlite3_column_text(statement: *mut c_void, column: c_int) -> *const u8;
    fn sqlite3_column_bytes(statement: *mut c_void, column: c_int) -> c_int;
    fn sqlite3_finalize(statement: *mut c_void) -> c_int;
    fn sqlite3_bind_text(statement: *mut c_void, index: c_int, value: *const c_char,
        bytes: c_int, destructor: Option<unsafe extern "C" fn(*mut c_void)>) -> c_int;
}

fn checked(code: c_int) -> Result<(), StorageError> {
    match code & 0xff {
        0 => Ok(()),
        5 | 6 => Err(StorageError::Busy),
        11 | 26 => Err(StorageError::Corrupt),
        3 | 8 | 10 | 13 | 14 | 23 => Err(StorageError::Unavailable),
        _ => Err(StorageError::InvalidSchema),
    }
}

pub(super) struct Connection {
    handle: NonNull<c_void>,
    _single_thread: PhantomData<Rc<()>>,
}

impl Connection {
    /// All caller values are bound as text. Buffers outlive the statement (SQLITE_STATIC).
    pub(super) fn query(&self, sql: &str, values: &[&str]) -> Result<Vec<Vec<String>>, StorageError> {
        let buffers: Vec<CString> = values.iter().map(|value| CString::new(*value)
            .map_err(|_| StorageError::InvalidSchema)).collect::<Result<_, _>>()?;
        let sql = CString::new(sql).map_err(|_| StorageError::InvalidSchema)?;
        let mut raw = ptr::null_mut();
        // SAFETY: SQL, connection and out-pointer are valid for this call.
        let result = unsafe { sqlite3_prepare_v2(self.handle.as_ptr(), sql.as_ptr(), -1, &mut raw, ptr::null_mut()) };
        let statement = NonNull::new(raw).map(|handle| Statement { handle, _connection: PhantomData::<&Connection> });
        checked(result)?;
        let statement = statement.ok_or(StorageError::InvalidSchema)?;
        for (index, value) in buffers.iter().enumerate() {
            let length = c_int::try_from(value.as_bytes().len()).map_err(|_| StorageError::InvalidSchema)?;
            // SAFETY: buffers were declared before statement, so remain live until it is finalized.
            checked(unsafe { sqlite3_bind_text(statement.handle.as_ptr(), (index + 1) as c_int, value.as_ptr(), length, None) })?;
        }
        let mut rows = Vec::new();
        loop {
            // SAFETY: The statement is uniquely owned and live.
            let step = unsafe { sqlite3_step(statement.handle.as_ptr()) };
            if step == 101 { break; }
            if step != 100 { checked(step)?; return Err(StorageError::InvalidSchema); }
            let mut row = Vec::new();
            // SAFETY: Current row exists; each column is copied before the next step.
            for column in 0..unsafe { sqlite3_column_count(statement.handle.as_ptr()) } {
                let value = unsafe { sqlite3_column_text(statement.handle.as_ptr(), column) };
                let length = unsafe { sqlite3_column_bytes(statement.handle.as_ptr(), column) };
                if value.is_null() || length < 0 { return Err(StorageError::InvalidSchema); }
                let bytes = unsafe { std::slice::from_raw_parts(value, length as usize) };
                row.push(String::from_utf8(bytes.to_vec()).map_err(|_| StorageError::InvalidSchema)?);
            }
            rows.push(row);
        }
        Ok(rows)
    }

    pub(super) fn open(path: &Path) -> Result<Self, StorageError> {
        let path = CString::new(path.to_str().ok_or(StorageError::Unavailable)?)
            .map_err(|_| StorageError::Unavailable)?;
        let mut handle = ptr::null_mut();
        // SAFETY: UTF-8/NUL-terminated path and valid out-pointer. URI mode is not enabled.
        let result = unsafe { sqlite3_open_v2(path.as_ptr(), &mut handle, 0x2 | 0x4 | 0x10000, ptr::null()) };
        let Some(handle) = NonNull::new(handle) else { return Err(StorageError::Unavailable); };
        let db = Self { handle, _single_thread: PhantomData };
        checked(result)?; // Drop also closes a handle returned with an error.
        // SAFETY: The connection is live and owned exclusively by this thread.
        checked(unsafe { sqlite3_busy_timeout(db.handle.as_ptr(), 1500) })?;
        Ok(db)
    }

    pub(super) fn execute(&self, sql: &str) -> Result<(), StorageError> {
        let sql = CString::new(sql).map_err(|_| StorageError::InvalidSchema)?;
        // SAFETY: Both pointers live for the call; no callback or allocated error message.
        checked(unsafe { sqlite3_exec(self.handle.as_ptr(), sql.as_ptr(), None, ptr::null_mut(), ptr::null_mut()) })
    }

    pub(super) fn scalar(&self, sql: &str) -> Result<String, StorageError> {
        let sql = CString::new(sql).map_err(|_| StorageError::InvalidSchema)?;
        let mut handle = ptr::null_mut();
        // SAFETY: NUL-terminated SQL, valid out-pointer, and a live connection.
        let result = unsafe { sqlite3_prepare_v2(self.handle.as_ptr(), sql.as_ptr(), -1, &mut handle, ptr::null_mut()) };
        let statement = NonNull::new(handle).map(|handle| Statement { handle, _connection: PhantomData::<&Connection> });
        checked(result)?;
        let statement = statement.ok_or(StorageError::InvalidSchema)?;
        // SAFETY: Statement is live and is finalized only by its Drop implementation.
        let step = unsafe { sqlite3_step(statement.handle.as_ptr()) };
        if step != 100 { // SQLITE_ROW
            checked(step)?;
            return Err(StorageError::InvalidSchema);
        }
        // SAFETY: We have a current row. Validate the column before reading it.
        if unsafe { sqlite3_column_count(statement.handle.as_ptr()) } < 1 {
            return Err(StorageError::InvalidSchema);
        }
        // SAFETY: Column zero exists; SQLite keeps its bytes live until step/finalize.
        let value = unsafe { sqlite3_column_text(statement.handle.as_ptr(), 0) };
        let length = unsafe { sqlite3_column_bytes(statement.handle.as_ptr(), 0) };
        if value.is_null() || length < 0 { return Err(StorageError::InvalidSchema); }
        // Copy before the statement is finalized; no borrowed SQLite memory escapes.
        let bytes = unsafe { std::slice::from_raw_parts(value, length as usize) };
        String::from_utf8(bytes.to_vec()).map_err(|_| StorageError::InvalidSchema)
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: This is the unique owner; all borrowed statements have been finalized.
        unsafe { sqlite3_close_v2(self.handle.as_ptr()); }
    }
}

struct Statement<'a> {
    handle: NonNull<c_void>,
    _connection: PhantomData<&'a Connection>,
}

impl Drop for Statement<'_> {
    fn drop(&mut self) {
        // SAFETY: This is the unique owner of a prepared statement.
        unsafe { sqlite3_finalize(self.handle.as_ptr()); }
    }
}

pub(super) struct Transaction<'a> { connection: &'a Connection, committed: bool }

impl<'a> Transaction<'a> {
    pub(super) fn begin(connection: &'a Connection) -> Result<Self, StorageError> {
        connection.execute("BEGIN IMMEDIATE")?;
        Ok(Self { connection, committed: false })
    }

    pub(super) fn commit(mut self) -> Result<(), StorageError> {
        self.connection.execute("COMMIT")?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.committed { let _ = self.connection.execute("ROLLBACK"); }
    }
}
