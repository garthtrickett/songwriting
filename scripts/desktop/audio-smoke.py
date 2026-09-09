"""Run native-window checks with an isolated, clocked PulseAudio null output.
This is virtual-device integration evidence, not a physical latency measurement.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

binary = sys.argv[1]
artifacts = Path(sys.argv[2] if len(sys.argv) > 2 else ".agent/audio-native").resolve()
artifacts.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="songwriter-audio-") as directory:
    root = Path(directory)
    socket = root / "pulse.sock"
    config = root / "alsa.conf"
    config.write_text(f'pcm.!default {{ type pulse server "unix:{socket}" }}\npcm.songwriter_proof {{ type pulse server "unix:{socket}" hint {{ show on description "Songwriter virtual proof" }} }}\n')
    env = {**os.environ, "PULSE_SERVER": f"unix:{socket}", "ALSA_CONFIG_PATH": str(config), "SONGWRITER_AUDIO_PROOF": "1"}
    with (artifacts / "pulse.log").open("w") as log:
        pulse = subprocess.Popen(["pulseaudio", "-n", "--daemonize=no", "--use-pid-file=no", "--exit-idle-time=-1",
            f"--load=module-native-protocol-unix socket={socket} auth-anonymous=1",
            "--load=module-null-sink sink_name=songwriter_proof rate=48000 channels=2", "--log-target=stderr"], stdout=log, stderr=log, env=env)
        try:
            deadline = time.monotonic() + 10
            while not socket.exists():
                if pulse.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("Virtual audio server failed; see pulse.log")
                time.sleep(0.05)
            subprocess.run([sys.executable, "scripts/desktop/native-smoke.py", binary, str(artifacts)], env=env, check=True)
        finally:
            pulse.terminate()
            try:
                pulse.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pulse.kill()
                pulse.wait()
