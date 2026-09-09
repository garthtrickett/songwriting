"""Real packaged Tauri/WebKit smoke test. Run under Xvfb and a private D-Bus session.
No browser mock, Vite server, agent process, account, or production data is used.
"""
import base64
import json
import http.client
import os
from pathlib import Path
import socket
import signal
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BINARY = Path(sys.argv[1]).resolve()
ARTIFACTS = Path(sys.argv[2] if len(sys.argv) > 2 else ".agent/native-smoke").resolve()
ARTIFACTS.mkdir(parents=True, exist_ok=True)
ELEMENT = "element-6066-11e4-a52e-4f735466cecf"


def wait(fn, label, timeout=30):
    end = time.monotonic() + timeout
    last = None
    while time.monotonic() < end:
        try:
            value = fn()
            if value:
                return value
        except (urllib.error.URLError, http.client.HTTPException, RuntimeError) as error:
            last = error
        time.sleep(0.1)
    raise AssertionError(f"Timed out: {label}; {last}")


with tempfile.TemporaryDirectory(prefix="songwriter-native-") as profile:
    env = {**os.environ, "XDG_DATA_HOME": profile}
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        native_port = sock.getsockname()[1]
    driver_log = (ARTIFACTS / "driver.log").open("w")
    driver = subprocess.Popen(["tauri-driver", "--port", str(port), "--native-port", str(native_port)], env=env, stdout=driver_log, stderr=subprocess.STDOUT)
    session = None

    def request(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                value = json.load(response).get("value")
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(value, dict) and "error" in value:
            raise RuntimeError(value)
        return value

    def command(path, body=None, method="POST"):
        return request(method, f"/session/{session}{path}", body)

    def js(script, *args):
        # WebKit occasionally closes an idle proxy connection. Retry read-only
        # observations only; never repeat an input, click, drag or native edit.
        for attempt in range(3):
            try:
                return command("/execute/sync", {"script": script, "args": list(args)})
            except http.client.RemoteDisconnected:
                if not script.startswith("return ") or attempt == 2:
                    raise
                time.sleep(0.1)

    def invoke(name, args=None):
        result = command("/execute/async", {"script": "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(v=>done({ok:v}),e=>done({error:e}));", "args": [name, args or {}]})
        if "error" in result:
            raise RuntimeError(result["error"])
        return result["ok"]

    def click_text(text):
        wait(lambda: js("const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===arguments[0]); if(!b||b.disabled)return false;b.click();return true;", text), f"button {text}")

    def input_value(label, value):
        assert js("const e=document.querySelector('input[aria-label=\"'+arguments[0]+'\"]');if(!e)return false;e.value=arguments[1];e.dispatchEvent(new Event('input',{bubbles:true}));return true;", label, value), label

    def revision(n):
        return wait(lambda: js("return document.querySelector('.desktop-shell')?.dataset.revision") == str(n), f"revision {n}")

    def start():
        global session
        opened = request("POST", "/session", {"capabilities": {"alwaysMatch": {"tauri:options": {"application": str(BINARY)}}}})
        session = opened["sessionId"]
        command("/timeouts", {"script": 30000})
        wait(lambda: js("return document.querySelector('.desktop-status')?.textContent === 'Saved locally'"), "local workspace loaded")

    try:
        wait(lambda: request("GET", "/status"), "driver startup")
        start()
        initial = invoke("desktop_open")
        owner = subprocess.check_output(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.GetConnectionUnixProcessID", "com.songwriter.desktop.d1.SingleInstance"], text=True)
        app_pid = int(re.search(r"uint32 (\d+)", owner).group(1))
        assert Path(f"/proc/{app_pid}/exe").resolve() == BINARY
        print("Native window loaded from packaged assets", flush=True)
        assert js("return document.querySelector('[aria-label=\"Snap\"]').value") == "3"
        assert initial["revision"] == 0
        duplicate = subprocess.run([str(BINARY)], env=env, capture_output=True, timeout=15)
        assert duplicate.returncode == 0, duplicate.stderr.decode()
        assert invoke("desktop_open")["epoch"] == initial["epoch"]
        assert [b["label"] for b in initial["bars"]] == ["7/8", "5/4"]
        input_value("Song title", "Native offline sketch")
        click_text("Save title")
        revision(1)
        assert invoke("desktop_open")["title"] == "Native offline sketch"
        # Exact edit of an individual chord member preserves the other attacks.
        js("document.querySelector('[data-note-key=\"harmony/root\"]').click()")
        input_value("Note start", "1/3")
        click_text("Apply start")
        revision(2)
        saved = invoke("desktop_open")
        assert next(n for n in saved["notes"] if n["memberId"] == "root")["start"] == [1, 3]
        assert next(n for n in saved["notes"] if n["memberId"] == "third")["start"] == [1, 1]
        # Invalid data is rejected by Rust and the saved geometry remains unchanged.
        input_value("Note start", "-1")
        click_text("Apply start")
        wait(lambda: js("return document.querySelector('.desktop-feedback')?.textContent.includes('negative')"), "invalid move rejected")
        assert invoke("desktop_open")["revision"] == 2
        click_text("Use saved value")
        # A concurrent native edit must not silently rebase an in-progress draft.
        input_value("Song title", "My stale draft")
        invoke("desktop_dispatch", {"request": {"protocol": 1, "epoch": saved["epoch"], "operationId": "native-concurrent", "expectedRevision": 2, "label": "Concurrent rename", "action": {"kind": "rename", "title": "Concurrent saved title"}}})
        revision(3)
        assert js("return document.querySelector('[aria-label=\"Song title\"]').value") == "My stale draft"
        click_text("Save title")
        wait(lambda: js("return document.querySelector('.desktop-feedback')?.textContent.toLowerCase().includes('revision')"), "stale edit rejected")
        assert invoke("desktop_open")["title"] == "Concurrent saved title"
        click_text("Discard title draft")
        # Native pointer input: drag the standalone note right by 1/3 quarter.
        element = command("/element", {"using": "css selector", "value": '[data-note-key="note/"]'})
        command("/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
            {"type": "pointerMove", "duration": 0, "origin": element, "x": 0, "y": 0},
            {"type": "pointerDown", "button": 0}, {"type": "pointerMove", "duration": 200, "origin": "pointer", "x": 37, "y": 0},
            {"type": "pointerUp", "button": 0}]}]})
        revision(4)
        assert next(n for n in invoke("desktop_open")["notes"] if n["eventId"] == "note")["start"] == [2, 3]
        # Drag rejection must remove the preview and preserve the saved position.
        before_left = js("return document.querySelector('[data-note-key=\"note/\"]').style.left")
        command("/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
            {"type": "pointerMove", "duration": 0, "origin": element, "x": 0, "y": 0},
            {"type": "pointerDown", "button": 0}, {"type": "pointerMove", "duration": 200, "origin": "pointer", "x": -160, "y": 0},
            {"type": "pointerUp", "button": 0}]}]})
        wait(lambda: js("return document.querySelector('.desktop-feedback')?.textContent.includes('negative')"), "invalid drag rejected")
        assert invoke("desktop_open")["revision"] == 4
        assert js("return document.querySelector('[data-note-key=\"note/\"]').style.left") == before_left
        # Escape cancels a visible preview without creating another operation.
        command("/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
            {"type": "pointerMove", "duration": 0, "origin": element, "x": 0, "y": 0},
            {"type": "pointerDown", "button": 0}, {"type": "pointerMove", "duration": 200, "origin": "pointer", "x": 37, "y": 0}]}]})
        assert js("return document.querySelector('[data-note-key=\"note/\"]').style.left") != before_left
        command("/actions", {"actions": [{"type": "key", "id": "keyboard", "actions": [{"type": "keyDown", "value": "\ue00c"}, {"type": "keyUp", "value": "\ue00c"}]}]})
        command("/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [{"type": "pointerUp", "button": 0}]}]})
        assert invoke("desktop_open")["revision"] == 4
        assert js("return document.querySelector('[data-note-key=\"note/\"]').style.left") == before_left
        print("Native edits, conflicts and pointer drag passed", flush=True)
        # Reload reconnects the view. Ending WebDriver's session only detaches
        # automation on WebKit; explicitly crash this isolated app to test restart.
        command("/refresh", {})
        revision(4)
        request("DELETE", f"/session/{session}")
        session = None
        if Path(f"/proc/{app_pid}/exe").exists():
            assert Path(f"/proc/{app_pid}/exe").resolve() == BINARY
            os.kill(app_pid, signal.SIGKILL)
        wait(lambda: "false" in subprocess.check_output(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", "com.songwriter.desktop.d1.SingleInstance"], text=True), "old app released its session")
        start()
        restored = invoke("desktop_open")
        assert restored["revision"] == 4 and restored["epoch"] != saved["epoch"]
        note_label = next(n["label"] for n in initial["notes"] if n["eventId"] == "note")
        undo = next(u for u in restored["undoable"] if u["label"] == f"Move {note_label}")
        click_text(f"Undo · {undo['label']}")
        revision(5)
        assert next(n for n in invoke("desktop_open")["notes"] if n["eventId"] == "note")["start"] == [1, 3]
        screenshot = command("/screenshot", method="GET")
        (ARTIFACTS / "desktop.png").write_bytes(base64.b64decode(screenshot))
        assert list(Path(profile).rglob("workspace.sqlite")), "Database must be in the isolated local profile"
        print("PASS native Tauri: local launch, rename, exact chord move, invalid/stale rejection, draft preservation, pointer drag/rejection/Escape, reload, process restart and undo", flush=True)
    except Exception:
        if session:
            try:
                (ARTIFACTS / "failure.txt").write_text(js("return document.body.innerText"))
                (ARTIFACTS / "failure.png").write_bytes(base64.b64decode(command("/screenshot", method="GET")))
            except Exception:
                pass
        raise
    finally:
        if session:
            try:
                request("DELETE", f"/session/{session}")
            except Exception:
                pass
        driver.terminate()
        try:
            driver.wait(timeout=10)
        except subprocess.TimeoutExpired:
            driver.kill()
            driver.wait()
        driver_log.close()
