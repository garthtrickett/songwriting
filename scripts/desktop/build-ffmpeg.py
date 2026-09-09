"""Build the bounded media proof's minimal FFmpeg 9.0.1 executable.
POSIX shell + make + C compiler required (MSYS2 UCRT64 on Windows).
No automatic downloads/execution happen from the Songwriter application.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request

spec = json.loads(Path('scripts/desktop/ffmpeg.json').read_text())
VERSION, SHA256 = spec['version'], spec['sourceSha256']
root = Path(sys.argv[1] if len(sys.argv) > 1 else '.agent/ffmpeg-proof').resolve()
root.mkdir(parents=True, exist_ok=True)
archive = root / f'ffmpeg-{VERSION}.tar.xz'
if not archive.exists():
    with urllib.request.urlopen(f'https://ffmpeg.org/releases/ffmpeg-{VERSION}.tar.xz', timeout=60) as response:
        data = response.read(20 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError('FFmpeg source checksum mismatch')
    archive.write_bytes(data)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == SHA256, 'Cached FFmpeg source checksum mismatch'
source = root / f'ffmpeg-{VERSION}'
if not source.exists():
    with tarfile.open(archive) as tar:
        tar.extractall(root, filter='data')
flags = spec['flags']
subprocess.run(['sh', 'configure', *flags], cwd=source, check=True)
target = 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'
subprocess.run(['make', '-j2', target], cwd=source, check=True)
name = 'ffmpeg.exe' if os.name == 'nt' or (source / 'ffmpeg.exe').exists() else 'ffmpeg'
binary = root / name
shutil.copy2(source / name, binary)
shutil.copy2(source / 'COPYING.LGPLv2.1', root / 'COPYING.LGPLv2.1')
shutil.copy2(source / 'LICENSE.md', root / 'LICENSE.md')
version = subprocess.check_output([str(binary), '-version'], text=True)
(root / 'build.json').write_text(json.dumps({'version': VERSION, 'sourceSha256': SHA256, 'flags': flags,
    'binaryBytes': binary.stat().st_size, 'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'versionOutput': version}, indent=2) + '\n')
print(f'Decoder: {binary}')
print('Retain source archive, license files and build.json with any distributed binary.')
