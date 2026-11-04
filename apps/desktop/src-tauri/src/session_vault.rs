//! M0.6 storage boundary. Not exposed over IPC or connected to login until the next slice.
#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::{ffi::c_void, fs::{self, OpenOptions}, io::{Read, Write}, os::windows::ffi::OsStrExt,
    path::{Path, PathBuf}, ptr, sync::atomic::{AtomicU64, Ordering}};

const MAX_SECRET: usize = 8192;
const MAX_FILE: usize = 32768;
const MAGIC: &[u8] = b"METIS-SESSION-1\0";
static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, PartialEq)]
pub enum VaultError { InvalidInput, Unavailable, InvalidData }

// Deliberately has no Debug, Serialize, Clone or Display implementation.
pub struct Secret(Vec<u8>);
impl Secret { pub fn bytes(&self) -> &[u8] { &self.0 } }
impl Drop for Secret { fn drop(&mut self) { wipe(&mut self.0); } }
fn wipe(bytes: &mut [u8]) {
    for byte in bytes { unsafe { ptr::write_volatile(byte, 0); } }
    std::sync::atomic::compiler_fence(Ordering::SeqCst);
}

#[repr(C)]
struct Blob { len: u32, data: *mut u8 }
#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob,
        reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
    fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob,
        reserved: *mut c_void, prompt: *mut c_void, flags: u32, output: *mut Blob) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
    fn MoveFileExW(source: *const u16, target: *const u16, flags: u32) -> i32;
}
struct OwnedBlob(Blob);
impl Drop for OwnedBlob {
    fn drop(&mut self) {
        if !self.0.data.is_null() {
            // DPAPI allocates this buffer; clear before returning it to the Windows allocator.
            unsafe {
                wipe(std::slice::from_raw_parts_mut(self.0.data, self.0.len as usize));
                LocalFree(self.0.data.cast());
            }
        }
    }
}
fn crypt(input: &[u8], context: &[u8], encrypt: bool) -> Result<Secret, VaultError> {
    let input = Blob { len: input.len() as u32, data: input.as_ptr() as *mut u8 };
    let entropy = Blob { len: context.len() as u32, data: context.as_ptr() as *mut u8 };
    let mut output = OwnedBlob(Blob { len: 0, data: ptr::null_mut() });
    // UI_FORBIDDEN only: LOCAL_MACHINE is intentionally absent (current Windows user scope).
    let ok = unsafe {
        if encrypt { CryptProtectData(&input, ptr::null(), &entropy, ptr::null_mut(), ptr::null_mut(), 1, &mut output.0) }
        else { CryptUnprotectData(&input, ptr::null_mut(), &entropy, ptr::null_mut(), ptr::null_mut(), 1, &mut output.0) }
    };
    if ok == 0 || output.0.data.is_null() || output.0.len as usize > MAX_FILE {
        return Err(if encrypt { VaultError::Unavailable } else { VaultError::InvalidData });
    }
    Ok(Secret(unsafe { std::slice::from_raw_parts(output.0.data, output.0.len as usize) }.to_vec()))
}

pub struct SessionVault { directory: PathBuf, file: PathBuf, context: Vec<u8> }
impl SessionVault {
    /// The native host selects the absolute root; never accept an arbitrary frontend path.
    pub fn new(directory: &Path, project_ref: &str) -> Result<Self, VaultError> {
        if !directory.is_absolute() || project_ref.is_empty() || project_ref.len() > 63
            || !project_ref.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
            return Err(VaultError::InvalidInput);
        }
        let context = format!("metis.session.v1:{project_ref}").into_bytes();
        let name = format!("{:x}.bin", Sha256::digest(&context));
        Ok(Self { directory: directory.to_owned(), file: directory.join(name), context })
    }
    pub fn save(&self, secret: &[u8]) -> Result<(), VaultError> {
        if secret.is_empty() || secret.len() > MAX_SECRET { return Err(VaultError::InvalidInput); }
        let mut plaintext = Secret(Vec::with_capacity(MAGIC.len() + secret.len()));
        plaintext.0.extend_from_slice(MAGIC);
        plaintext.0.extend_from_slice(secret);
        let encrypted = crypt(plaintext.bytes(), &self.context, true)?;
        fs::create_dir_all(&self.directory).map_err(|_| VaultError::Unavailable)?;
        // Only ciphertext reaches disk. Exclusive temporary creation plus same-directory replace
        // leaves the previous record intact if writing/flushing/commit fails.
        let temp = self.directory.join(format!(".session-{}-{}.tmp", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        let mut writer = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| VaultError::Unavailable)?;
        let result = writer.write_all(encrypted.bytes()).and_then(|_| writer.sync_all());
        drop(writer);
        let result = result.map_err(|_| VaultError::Unavailable).and_then(|_| {
            let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let target: Vec<u16> = self.file.as_os_str().encode_wide().chain(Some(0)).collect();
            // REPLACE_EXISTING | WRITE_THROUGH, no cross-volume copy fallback.
            if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 1 | 8) } == 0 { Err(VaultError::Unavailable) } else { Ok(()) }
        });
        if result.is_err() { let _ = fs::remove_file(&temp); }
        result
    }
    pub fn load(&self) -> Result<Option<Secret>, VaultError> {
        let file = match fs::File::open(&self.file) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(VaultError::Unavailable),
        };
        let mut encrypted = Vec::new();
        file.take((MAX_FILE + 1) as u64).read_to_end(&mut encrypted).map_err(|_| VaultError::Unavailable)?;
        if encrypted.is_empty() || encrypted.len() > MAX_FILE { return Err(VaultError::InvalidData); }
        let plaintext = crypt(&encrypted, &self.context, false)?;
        if !plaintext.bytes().starts_with(MAGIC) || plaintext.0.len() <= MAGIC.len()
            || plaintext.0.len() > MAGIC.len() + MAX_SECRET { return Err(VaultError::InvalidData); }
        Ok(Some(Secret(plaintext.bytes()[MAGIC.len()..].to_vec())))
    }
    pub fn clear(&self) -> Result<(), VaultError> {
        match fs::remove_file(&self.file) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(VaultError::Unavailable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("metis-vault-test-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&root).unwrap(); Self(root)
        }
        fn vault(&self) -> SessionVault { SessionVault::new(&self.0, "test-project").unwrap() }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test] fn real_dpapi_round_trip_and_reopen() {
        let fixture = Fixture::new(); let vault = fixture.vault();
        vault.save(b"synthetic-refresh-value").unwrap();
        let reopened = fixture.vault();
        assert_eq!(reopened.load().unwrap().unwrap().bytes(), b"synthetic-refresh-value");
        let disk = fs::read(&vault.file).unwrap();
        assert!(!disk.windows(23).any(|v| v == b"synthetic-refresh-value"));
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test] fn replacement_and_idempotent_clear() {
        let fixture = Fixture::new(); let vault = fixture.vault();
        assert!(vault.load().unwrap().is_none()); vault.clear().unwrap();
        vault.save(b"first").unwrap(); vault.save(b"second").unwrap();
        assert_eq!(vault.load().unwrap().unwrap().bytes(), b"second");
        vault.clear().unwrap(); vault.clear().unwrap(); assert!(vault.load().unwrap().is_none());
    }
    #[test] fn projects_are_separate_and_ciphertext_is_bound_to_project() {
        let fixture = Fixture::new(); let one = fixture.vault();
        let two = SessionVault::new(&fixture.0, "other-project").unwrap();
        one.save(b"synthetic-secret").unwrap(); assert!(two.load().unwrap().is_none());
        fs::copy(&one.file, &two.file).unwrap();
        assert!(matches!(two.load(), Err(VaultError::InvalidData)));
    }
    #[test] fn corruption_is_reported_without_deletion() {
        let fixture = Fixture::new(); let vault = fixture.vault(); vault.save(b"synthetic").unwrap();
        let mut bytes = fs::read(&vault.file).unwrap(); bytes.truncate(bytes.len() / 2);
        fs::write(&vault.file, &bytes).unwrap();
        assert!(matches!(vault.load(), Err(VaultError::InvalidData)));
        assert_eq!(fs::read(&vault.file).unwrap(), bytes);
    }
    #[test] fn invalid_sizes_and_context_are_rejected() {
        let fixture = Fixture::new(); let vault = fixture.vault();
        assert_eq!(vault.save(b""), Err(VaultError::InvalidInput));
        assert_eq!(vault.save(&vec![1; MAX_SECRET + 1]), Err(VaultError::InvalidInput));
        for context in ["", "../escape", "UPPER", "a/b"] { assert!(SessionVault::new(&fixture.0, context).is_err()); }
        assert!(SessionVault::new(Path::new("relative"), "project").is_err());
        fs::write(&vault.file, vec![0; MAX_FILE + 1]).unwrap();
        assert!(matches!(vault.load(), Err(VaultError::InvalidData)));
    }
    #[test] fn rejected_save_preserves_previous_record() {
        let fixture = Fixture::new(); let vault = fixture.vault(); vault.save(b"previous").unwrap();
        assert!(vault.save(&vec![1; MAX_SECRET + 1]).is_err());
        assert_eq!(vault.load().unwrap().unwrap().bytes(), b"previous");
    }
    #[test] fn failed_replace_preserves_target_and_removes_temporary_file() {
        let fixture = Fixture::new(); let vault = fixture.vault(); fs::create_dir(&vault.file).unwrap();
        assert_eq!(vault.save(b"synthetic"), Err(VaultError::Unavailable));
        assert!(vault.file.is_dir()); assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[test] fn cannot_write_through_a_file_as_directory() {
        let fixture = Fixture::new(); let path = fixture.0.join("file"); fs::write(&path, b"keep").unwrap();
        let vault = SessionVault::new(&path, "project").unwrap();
        assert_eq!(vault.save(b"synthetic"), Err(VaultError::Unavailable)); assert_eq!(fs::read(path).unwrap(), b"keep");
    }
    #[test] fn valid_encryption_with_unknown_payload_version_is_rejected() {
        let fixture = Fixture::new(); let vault = fixture.vault();
        let encrypted = crypt(b"future-format", &vault.context, true).unwrap();
        fs::write(&vault.file, encrypted.bytes()).unwrap();
        assert!(matches!(vault.load(), Err(VaultError::InvalidData)));
    }
    #[test] fn separate_process_can_reopen_under_same_windows_account() {
        let fixture = Fixture::new(); fixture.vault().save(b"process-test-value").unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "session_vault::tests::child_process_read", "--nocapture"])
            .env("METIS_VAULT_TEST_ROOT", &fixture.0).status().unwrap();
        assert!(status.success());
    }
    #[test] fn child_process_read() {
        if let Some(root) = std::env::var_os("METIS_VAULT_TEST_ROOT") {
            let vault = SessionVault::new(Path::new(&root), "test-project").unwrap();
            assert_eq!(vault.load().unwrap().unwrap().bytes(), b"process-test-value");
        }
    }
}
