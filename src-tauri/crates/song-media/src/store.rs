use crate::{CAPTURE_SECONDS, MAX_BYTES, Result, check_format, decode};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub bytes: usize,
    pub audio: Option<decode::Summary>,
    pub error: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub status: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: usize,
    pub asset_id: Option<String>,
    pub error: Option<String>,
}
/// Owned by a non-callback worker. An OS lock excludes recovery by another host.
pub struct Store {
    root: PathBuf,
    db: Connection,
    _lock: File,
}
pub fn read_bounded(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Choose nonempty audio up to 25 MiB".into());
    }
    Ok(bytes)
}
fn identifier(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(
            "Expected a 1–64 character alphanumeric capture ID (dash/underscore allowed)".into(),
        );
    }
    Ok(())
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root.join("assets"))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("media-proof.lock"))?;
        lock.try_lock()
            .map_err(|_| "Media proof profile is already open; stop that host before recovery")?;
        let db = Connection::open(root.join("media-proof.sqlite"))?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > 1 {
            return Err(
                "This media proof profile needs a newer application; it was not changed".into(),
            );
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, bytes INTEGER NOT NULL, audio TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, status TEXT NOT NULL, rate INTEGER NOT NULL,
              channels INTEGER NOT NULL, frames INTEGER NOT NULL DEFAULT 0, asset TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS chunks(capture TEXT NOT NULL, sequence INTEGER NOT NULL, pcm BLOB NOT NULL,
              PRIMARY KEY(capture,sequence));
            UPDATE captures SET status='interrupted', error='Host stopped before finalization; recover committed samples explicitly'
              WHERE status='recording';
            PRAGMA user_version=1; COMMIT;")?;
        Ok(Self {
            root: root.into(),
            db,
            _lock: lock,
        })
    }
    pub fn import(&mut self, bytes: &[u8]) -> Result<Asset> {
        if bytes.is_empty() || bytes.len() > MAX_BYTES {
            return Err("Choose nonempty audio up to 25 MiB".into());
        }
        let id = format!("{:x}", Sha256::digest(bytes));
        let path = self.root.join("assets").join(&id);
        if path.exists() {
            if read_bounded(&path)? != bytes {
                return Err("Existing original is corrupt; it was not overwritten".into());
            }
        } else {
            // A crash may leave a staging file; the profile lock makes retry safe.
            let stage = self.root.join("assets").join(format!("{id}.stage"));
            let mut file = File::create(&stage)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&stage, &path)?;
            #[cfg(unix)]
            File::open(self.root.join("assets"))?.sync_all()?;
        }
        let (audio, error) = match decode::decode(bytes) {
            Ok(decoded) => (Some(decoded.summary), None),
            Err(error) => (None, Some(error.to_string())),
        };
        self.db.execute("INSERT INTO assets VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET audio=excluded.audio,error=excluded.error",
            params![id, bytes.len() as u32, audio.as_ref().map(serde_json::to_string).transpose()?, error])?;
        Ok(Asset {
            id,
            bytes: bytes.len(),
            audio,
            error,
        })
    }
    pub fn original(&self, id: &str) -> Result<Vec<u8>> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Expected an asset SHA-256 ID".into());
        }
        let bytes = read_bounded(&self.root.join("assets").join(id))?;
        if format!("{:x}", Sha256::digest(&bytes)) != id {
            return Err("Original asset checksum mismatch".into());
        }
        Ok(bytes)
    }
    pub fn begin(&mut self, id: &str, rate: u32, channels: u16) -> Result<()> {
        identifier(id)?;
        check_format(rate, channels as usize)?;
        self.db.execute(
            "INSERT INTO captures(id,status,rate,channels) VALUES(?1,'recording',?2,?3)",
            params![id, rate, channels],
        )?;
        Ok(())
    }
    pub fn capture(&self, id: &str) -> Result<Capture> {
        let capture = self
            .db
            .query_row(
                "SELECT id,status,rate,channels,frames,asset,error FROM captures WHERE id=?1",
                [id],
                |r| {
                    Ok(Capture {
                        id: r.get(0)?,
                        status: r.get(1)?,
                        sample_rate: r.get(2)?,
                        channels: r.get(3)?,
                        frames: r.get::<_, u32>(4)? as usize,
                        asset_id: r.get(5)?,
                        error: r.get(6)?,
                    })
                },
            )
            .optional()?
            .ok_or("Unknown capture")?;
        check_format(capture.sample_rate, capture.channels as usize)?;
        if capture.frames > capture.sample_rate as usize * CAPTURE_SECONDS as usize
            || !["recording", "interrupted", "ready"].contains(&capture.status.as_str())
        {
            return Err("Invalid durable capture metadata".into());
        }
        Ok(capture)
    }
    pub fn captures(&self) -> Result<Vec<Capture>> {
        let ids = self
            .db
            .prepare("SELECT id FROM captures ORDER BY rowid DESC LIMIT 100")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter().map(|id| self.capture(id)).collect()
    }
    /// Chunk bytes and durable frame count commit in one transaction.
    pub fn append(&mut self, id: &str, samples: &[f32]) -> Result<()> {
        let capture = self.capture(id)?;
        let channels = capture.channels as usize;
        if capture.status != "recording"
            || samples.is_empty()
            || samples.len() > 8192
            || !samples.len().is_multiple_of(channels)
            || !samples.iter().all(|s| s.is_finite())
            || capture.frames + samples.len() / channels
                > capture.sample_rate as usize * CAPTURE_SECONDS as usize
        {
            return Err("Invalid, oversized or inactive capture chunk".into());
        }
        let pcm: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let tx = self.db.transaction()?;
        tx.execute(
            "INSERT INTO chunks VALUES(?1,?2,?3)",
            params![id, capture.frames as u32, pcm],
        )?;
        tx.execute(
            "UPDATE captures SET frames=frames+?2 WHERE id=?1",
            params![id, (samples.len() / channels) as u32],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn interrupt(&mut self, id: &str, reason: &str) -> Result<Capture> {
        self.db.execute(
            "UPDATE captures SET status='interrupted',error=?2 WHERE id=?1 AND status='recording'",
            params![id, reason],
        )?;
        self.capture(id)
    }
    pub fn recover(&mut self, id: &str) -> Result<Capture> {
        let capture = self.capture(id)?;
        check_format(capture.sample_rate, capture.channels as usize)?;
        if capture.frames > capture.sample_rate as usize * CAPTURE_SECONDS as usize {
            return Err("Invalid durable capture frame count".into());
        }
        if let Some(asset) = &capture.asset_id {
            self.original(asset)?;
            return Ok(capture);
        }
        if capture.status == "recording" {
            return Err("Stop recording before recovery".into());
        }
        let mut samples = Vec::new();
        {
            let mut stmt = self
                .db
                .prepare("SELECT sequence,pcm FROM chunks WHERE capture=?1 ORDER BY sequence")?;
            let mut rows = stmt.query([id])?;
            while let Some(row) = rows.next()? {
                let sequence = row.get::<_, u32>(0)? as usize;
                let pcm: Vec<u8> = row.get(1)?;
                if sequence != samples.len() / capture.channels as usize
                    || !pcm.len().is_multiple_of(4 * capture.channels as usize)
                    || samples.len() + pcm.len() / 4
                        > capture.sample_rate as usize
                            * capture.channels as usize
                            * CAPTURE_SECONDS as usize
                {
                    return Err("Capture chunk continuity/size validation failed".into());
                }
                samples.extend(
                    pcm.chunks_exact(4)
                        .map(|b| f32::from_le_bytes(b.try_into().expect("Four-byte chunk"))),
                );
            }
        }
        if samples.len() / capture.channels as usize != capture.frames {
            return Err("Capture frame count mismatch".into());
        }
        let bytes = decode::wav(capture.sample_rate, capture.channels, &samples)?;
        let asset = self.import(&bytes)?;
        let audio = asset
            .audio
            .ok_or("Captured WAV failed decoding; chunks retained")?;
        if audio.frames != capture.frames
            || audio.sample_rate != capture.sample_rate
            || audio.channels != capture.channels as usize
        {
            return Err("Captured WAV format/count mismatch; chunks retained".into());
        }
        // Retain the raw chunks and interruption reason even after recovery.
        self.db.execute(
            "UPDATE captures SET status='ready',asset=?2 WHERE id=?1",
            params![id, asset.id],
        )?;
        self.capture(id)
    }
}

#[cfg(test)]
mod tests;
