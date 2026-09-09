"""Native CPAL capture against an isolated generated-tone input; no microphone.
Proves commit-boundary crash/recovery with real processes, not physical devices.
"""
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import time
import wave

binary = str(Path(sys.argv[1]).resolve())
artifacts = Path(sys.argv[2] if len(sys.argv) > 2 else '.agent/media-native').resolve()
artifacts.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='songwriter-media-') as directory:
    root = Path(directory)
    socket = root / 'pulse.sock'
    env = {**os.environ, 'PULSE_SERVER': f'unix:{socket}', 'PULSE_SOURCE': 'songwriter_media.monitor', 'PULSE_SINK': 'songwriter_media'}
    tone = root / 'tone.wav'
    with wave.open(str(tone), 'wb') as wav:
        wav.setparams((2, 2, 48000, 0, 'NONE', 'not compressed'))
        block = b''.join(struct.pack('<hh', *([int(8000 * math.sin(n * math.tau * 440 / 48000))] * 2)) for n in range(48000))
        for _ in range(30):
            wav.writeframesraw(block)
    with (artifacts / 'pulse.log').open('w') as log:
        pulse = subprocess.Popen(['pulseaudio', '-n', '--daemonize=no', '--use-pid-file=no', '--exit-idle-time=-1',
            f'--load=module-native-protocol-unix socket={socket} auth-anonymous=1',
            '--load=module-null-sink sink_name=songwriter_media rate=48000 channels=2', '--log-target=stderr'], env=env, stdout=log, stderr=log)
        player = None
        def run(*args, code=0):
            result = subprocess.run([binary, *map(str,args)], env=env, capture_output=True, text=True, timeout=20)
            assert result.returncode == code, (args, result.returncode, result.stdout, result.stderr)
            return json.loads(result.stdout) if result.stdout else None
        try:
            deadline = time.monotonic() + 10
            while not socket.exists():
                assert pulse.poll() is None and time.monotonic() < deadline, 'PulseAudio startup failed'
                time.sleep(.05)
            devices = run('inputs')
            assert devices and all(d['id'].startswith('pulseaudio:') for d in devices), devices
            selected = next(d['id'] for d in devices if 'songwriter_media' in d['id'])
            player = subprocess.Popen(['paplay', str(tone)], env=env, stdout=log, stderr=log)
            time.sleep(.5)
            profile = root / 'profile'
            take = run('capture', profile, 'normal', 2, selected)
            assert take['status'] == 'ready' and take['frames'] == 2 * take['sampleRate'], take
            decoded = run('decode', profile / 'assets' / take['assetId'])
            assert decoded['rms'] > .05 and decoded['peak'] < .4, decoded
            assert decoded['frames'] == take['frames'], decoded
            run('capture', profile, 'crashed', 2, selected, '--exit-after-checkpoint', code=73)
            rows = run('captures', profile)
            interrupted = next(c for c in rows if c['id'] == 'crashed')
            assert interrupted['status'] == 'interrupted' and interrupted['frames'] > 0, interrupted
            recovered = run('recover', profile, 'crashed')
            assert recovered['status'] == 'ready' and recovered['frames'] == interrupted['frames'], recovered
            assert run('recover', profile, 'crashed') == recovered, 'Recovery was not idempotent'
            recovered_audio = run('decode', profile / 'assets' / recovered['assetId'])
            assert recovered_audio['frames'] == recovered['frames'] and recovered_audio['rms'] > .05, recovered_audio
            stopped = run('capture', profile, 'stopped', 10, selected, '--stop-after-checkpoint')
            assert stopped['status'] == 'ready' and 0 < stopped['frames'] < 10 * stopped['sampleRate'], stopped
            run('capture', profile, 'normal', 1, selected, code=1)
            run('capture', profile, 'missing', 1, 'missing-device', code=1)
            assert len(run('captures', profile)) == 3
            evidence = {'inputDevices': devices, 'normal': take, 'decoded': decoded, 'interrupted': interrupted,
                'recovered': recovered, 'recoveredAudio': recovered_audio, 'source': 'CPAL / isolated PulseAudio null-sink monitor / generated 440 Hz tone',
                'stopped': stopped, 'physicalMicrophone': False}
            (artifacts / 'capture.json').write_text(json.dumps(evidence, indent=2) + '\n')
            print(json.dumps(evidence, indent=2))
        finally:
            for process in [player, pulse]:
                if process is not None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
