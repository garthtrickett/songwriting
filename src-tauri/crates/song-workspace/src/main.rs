//! Development fixture runner only; this is not the Tauri host or an agent server.
use serde_json::json;
use song_core::{Error, Mutation, Song};
use song_workspace::Workspace;
use std::io::{self, BufRead, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .ok_or("Usage: song-workspace <disposable.sqlite> [--exit-after-commit]")?;
    let fault = match args.next().as_deref() {
        None => false,
        Some("--exit-after-commit") => true,
        _ => return Err("Unknown fixture runner option".into()),
    };
    if args.next().is_some() {
        return Err("Too many arguments".into());
    }
    let fixture: Song =
        serde_json::from_str(include_str!("../../../../tests/desktop/fixture.json"))?;
    let mut workspace = Workspace::open(path)?;
    let state = workspace.initialize_fixture(fixture)?;
    println!("{}", json!({"ready": state}));
    io::stdout().flush()?;
    // Bound even malformed input before allocation; a line protocol is enough
    // for this disposable harness. Production IPC framing remains a D1 task.
    let mut input = io::stdin().lock();
    loop {
        let mut bytes = Vec::new();
        let length = std::io::Read::take(&mut input, 65537).read_until(b'\n', &mut bytes)?;
        if length == 0 {
            break;
        }
        if bytes.len() > 65536 {
            return Err("Action exceeds fixture runner input limit".into());
        }
        let result = serde_json::from_slice::<Mutation>(&bytes)
            .map_err(|e| Error::new("invalid", e.to_string()))
            .and_then(|m| workspace.dispatch(&m));
        if fault && result.is_ok() {
            std::process::exit(73);
        }
        let reply = match result {
            Ok(state) => json!({"ok": true, "state": state}),
            Err(error) => json!({"ok": false, "error": error}),
        };
        println!("{reply}");
        io::stdout().flush()?;
    }
    Ok(())
}
