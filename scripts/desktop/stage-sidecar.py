"""Stage the pinned FFmpeg decoder beside the desktop app binary.
Copies the verified proof build (binary, LGPL notice, license, build.json)
next to the Tauri executable so the app resolves its sidecar without PATH.
Refuses to stage when the binary does not match build.json's recorded SHA-256.
Source archive, license files and build.json travel with any distributed binary.
Usage: python3 scripts/desktop/stage-sidecar.py [proof-dir] [app-dir]
Defaults: .agent/ffmpeg-proof and src-tauri/target/debug.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

APP_NAMES = ("songwriter-desktop", "songwriter-desktop.exe")


def size(path: Path) -> str:
    return f"{path.stat().st_size / 1024:.1f} KiB"


def main() -> None:
    proof = Path(sys.argv[1] if len(sys.argv) > 1 else ".agent/ffmpeg-proof")
    app_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "src-tauri/target/debug")
    record = json.loads((proof / "build.json").read_text())
    name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    binary = proof / name
    if not binary.is_file():
        raise RuntimeError(f"Proof decoder is missing: {binary}")
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    if digest != record["binarySha256"]:
        raise RuntimeError("Proof decoder does not match build.json; rebuild it first")
    app_dir.mkdir(parents=True, exist_ok=True)
    staged = []
    for filename in (name, "COPYING.LGPLv2.1", "LICENSE.md", "build.json"):
        source = proof / filename
        if not source.is_file():
            raise RuntimeError(f"Proof distribution file is missing: {source}")
        target = app_dir / (f"ffmpeg-{filename}" if filename != name else filename)
        shutil.copy2(source, target)  # copy2 preserves the decoder's executable bit
        staged.append(target)
    print("Staged decoder sidecar:")
    for target in staged:
        print(f"  {target} {size(target)}")
    for app in APP_NAMES:
        candidate = app_dir / app
        if candidate.is_file():
            print(f"  {candidate} {size(candidate)}")
            break
    print("Retain source archive, license files and build.json with any distributed binary.")


if __name__ == "__main__":
    main()
