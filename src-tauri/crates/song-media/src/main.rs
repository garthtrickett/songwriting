use song_media::{
    Result, capture, decode,
    store::{Store, read_bounded},
};
use std::{io::Write, path::Path, sync::atomic::AtomicBool};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn print(value: &impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("");
    match (command,args.len()) {
        ("inputs",1) => print(&capture::inputs()?),
        ("decode",2) => print(&decode::decode(&read_bounded(Path::new(&args[1]))?)?.summary),
        ("import",3) => print(&Store::open(Path::new(&args[1]))?.import(&read_bounded(Path::new(&args[2]))?)?),
        ("captures",2) => print(&Store::open(Path::new(&args[1]))?.captures()?),
        ("recover",3) => print(&Store::open(Path::new(&args[1]))?.recover(&args[2])?),
        ("export",4) => {
            let bytes = Store::open(Path::new(&args[1]))?.original(&args[2])?;
            // Do not overwrite an existing user file.
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&args[3])?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok(())
        }
        ("capture",4..=6) => {
            let seconds = args[3].parse::<u32>()?;
            let (selected, mode) = capture_options(&args[4..])?;
            let crash = mode == "--exit-after-checkpoint";
            let stop = mode == "--stop-after-checkpoint";
            let cancel = AtomicBool::new(false);
            let mut store = Store::open(Path::new(&args[1]))?;
            let result = capture::record(&mut store, &args[2], selected, seconds, &cancel, || {
                if crash { std::process::exit(73); }
                if stop { cancel.store(true,std::sync::atomic::Ordering::Release); }
            })?;
            print(&result)?;
            if result.status != "ready" { return Err("Capture incomplete; committed samples retained for recovery".into()); }
            Ok(())
        }
        _ => Err("Usage: song-media inputs | decode FILE | import PROFILE FILE | captures PROFILE | recover PROFILE ID | export PROFILE HASH NEW_FILE | capture PROFILE ID SECONDS [INPUT_ID] [--exit-after-checkpoint|--stop-after-checkpoint]".into()),
    }
}

fn capture_options(options: &[String]) -> Result<(Option<&str>, &str)> {
    let known = |s: &str| ["--exit-after-checkpoint", "--stop-after-checkpoint"].contains(&s);
    match options {
        [] => Ok((None, "")),
        [flag] if known(flag) => Ok((None, flag)),
        [device] if !device.starts_with("--") => Ok((Some(device), "")),
        [device, flag] if !device.starts_with("--") && known(flag) => Ok((Some(device), flag)),
        _ => Err("Unknown capture option; no input was opened".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_options_never_fall_back_to_default_microphone() {
        assert!(capture_options(&["--unknown".into()]).is_err());
        assert!(capture_options(&["input".into(), "--unknown".into()]).is_err());
        assert_eq!(
            capture_options(&["input".into(), "--stop-after-checkpoint".into()]).unwrap(),
            (Some("input"), "--stop-after-checkpoint")
        );
    }
}
