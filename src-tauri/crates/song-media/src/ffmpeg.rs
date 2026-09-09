//! External decoder process, never an audio callback. No shell or user arguments.
//! The proof host selects the executable; packaged apps must supply a bundled,
//! verified path rather than rely on a user's PATH.
use crate::Result;
use std::{
    fs::File,
    io::{Read, Write},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub fn decode(bytes: &[u8]) -> Result<File> {
    let executable = std::env::var_os("SONGWRITER_FFMPEG").unwrap_or_else(|| "ffmpeg".into());
    decode_with(bytes, &executable, Duration::from_secs(15))
}
fn decode_with(bytes: &[u8], executable: &std::ffi::OsStr, timeout: Duration) -> Result<File> {
    let directory = tempfile::tempdir()?;
    let input = directory.path().join("original");
    let output = directory.path().join("decoded.wav");
    File::create(&input)?.write_all(bytes)?;
    let mut command = Command::new(executable);
    command
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-xerror",
            "-max_alloc",
            "67108864",
            "-threads",
            "1",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            "matroska,webm,ogg,mov,wav",
            "-i",
        ])
        .arg(&input)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-t",
            "61",
            "-fs",
            "94000000",
            "-threads",
            "1",
            "-c:a",
            "pcm_f32le",
            "-f",
            "wav",
        ])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut process = Process(command.spawn().map_err(|e| format!("Cannot start FFmpeg: {e}. Set SONGWRITER_FFMPEG to the proof decoder executable; original audio is retained."))?);
    let mut stderr = process
        .0
        .stderr
        .take()
        .ok_or("Missing decoder error stream")?;
    let log = std::thread::spawn(move || {
        let mut bounded = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let retain = count.min(8192usize.saturating_sub(bounded.len()));
            bounded.extend_from_slice(&buffer[..retain]);
        }
        String::from_utf8_lossy(&bounded).into_owned()
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = process.0.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            process.0.kill()?;
            process.0.wait()?;
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let detail = log
        .join()
        .unwrap_or_else(|_| "Could not read decoder diagnostics".into());
    if status.is_none() {
        return Err("FFmpeg exceeded the 15-second decode limit; original retained".into());
    }
    if !status.is_some_and(|s| s.success()) {
        return Err(format!("FFmpeg could not decode this recording: {}", detail.trim()).into());
    }
    let size = std::fs::metadata(&output)?.len();
    if size >= 94000000 {
        return Err("Decoded audio exceeded the proof byte limit".into());
    }
    // Copy into an anonymous temporary file before removing the named process
    // workspace. This also works on Windows, which cannot unlink an open file.
    let mut file = tempfile::tempfile()?;
    std::io::copy(&mut File::open(&output)?, &mut file)?;
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0))?;
    Ok(file)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn missing_failed_and_hung_decoders_return_without_hanging_the_host() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("decoder");
        assert!(
            decode_with(b"original", path.as_os_str(), Duration::from_millis(200))
                .unwrap_err()
                .to_string()
                .contains("Cannot start")
        );
        std::fs::write(
            &path,
            b"#!/bin/sh\nprintf 'decoder rejected input' >&2\nexit 2\n",
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(
            decode_with(b"original", path.as_os_str(), Duration::from_secs(2))
                .unwrap_err()
                .to_string()
                .contains("decoder rejected input")
        );
        std::fs::write(&path, b"#!/bin/sh\nexec sleep 20\n").unwrap();
        let start = Instant::now();
        let error =
            decode_with(b"original", path.as_os_str(), Duration::from_millis(200)).unwrap_err();
        assert!(error.to_string().contains("decode limit"));
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "Host waited for the unresponsive decoder"
        );
    }
}
