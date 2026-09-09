"""Generate supplemental AAC fixtures. These are NOT browser/Safari evidence.
Use a full FFmpeg encoder install; the shipped minimal decoder cannot encode AAC.
"""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path('tests/desktop/media')
manifest = json.loads((root / 'manifest.json').read_text())
manifest = [r for r in manifest if not r['file'].startswith('generated-')]
version = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
for name, flags in [('generated-aac.m4a', []), ('generated-fragmented-aac.mp4', ['-movflags', 'frag_keyframe+empty_moov'])]:
    args = ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.2', '-c:a', 'aac', '-b:a', '96000', *flags, '-y', str(root / name)]
    subprocess.run(['ffmpeg', *args], check=True)
    data = (root / name).read_bytes()
    manifest.append({'file': name, 'origin': 'Supplemental generated 440 Hz tone; not a browser recording', 'encoder': version,
        'commandArguments': args, 'mime': 'audio/mp4', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
