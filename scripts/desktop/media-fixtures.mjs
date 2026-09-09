// Explicit regeneration only. Originals are checked in; CI decodes those exact
// bytes. Fake microphones contain generated tones, never private speech.
import { chromium, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = resolve('tests/desktop/media');
mkdirSync(output, { recursive: true });
const manifest = [];
for (const [name, engine, options] of [
  ['chromium', chromium, { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }],
  ['firefox', firefox, { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } }],
]) {
  const browser = await engine.launch(options);
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5188');
    await page.waitForFunction(() => window.songwriting);
    const result = await page.evaluate(async () => {
      const { mediaSong } = await import('/tests/media.ts');
      await window.songwriting.tool('import', { text: JSON.stringify(mediaSong()), asCopy: false });
      const c = window.songwriting.controller;
      const song = (await window.songwriting.tool('read'));
      const part = Object.values(song.tables.parts)[0];
      await window.songwriting.tool('recording_start', { name: 'D1 generated microphone fixture', partId: part.id, sectionId: null, start: [0, 1] });
      const deadline = Date.now() + 8000;
      while (c.media.recorder.status !== 'recording') {
        if (Date.now() > deadline || c.media.recorder.status === 'failed') throw new Error(c.media.recorder.error || 'Recorder startup timeout');
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => setTimeout(r, 1200));
      await window.songwriting.tool('recording_stop');
      const raw = await window.songwriting.tool('capture_export', { id: c.media.recorder.captureId });
      const decoded = await new AudioContext().decodeAudioData(Uint8Array.from(atob(raw.base64), c => c.charCodeAt(0)).buffer);
      return { ...raw, decoded: { frames: decoded.length, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, duration: decoded.duration }, userAgent: navigator.userAgent };
    });
    const bytes = Buffer.from(result.base64, 'base64');
    const extension = result.mime.includes('ogg') ? 'ogg' : 'webm';
    const file = `${name}-recorder.${extension}`;
    writeFileSync(`${output}/${file}`, bytes);
    manifest.push({ file, origin: 'Existing Recorder → capture_export, fake getUserMedia microphone', browser: name, version: browser.version(), mime: result.mime, decoded: result.decoded, userAgent: result.userAgent, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    // Probe fallback formats separately from the application's preferred WebM.
    for (const [mime, suffix] of [['audio/ogg;codecs=opus', 'opus.ogg'], ['audio/mp4;codecs=mp4a.40.2', 'aac.mp4']]) {
    const alternate = await page.evaluate(async (mime) => {
      if (!MediaRecorder.isTypeSupported(mime)) return null;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = e => chunks.push(e.data);
        const stopped = new Promise(r => recorder.onstop = r);
        recorder.start(200);
        await new Promise(r => setTimeout(r, 1200));
        recorder.stop(); await stopped;
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        return { mime: recorder.mimeType, base64: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) };
      } finally { stream.getTracks().forEach(t => t.stop()); }
    }, mime);
    if (alternate) {
      const bytes = Buffer.from(alternate.base64, 'base64'), file = `${name}-${suffix}`;
      writeFileSync(`${output}/${file}`, bytes);
      manifest.push({ file, origin: 'MediaRecorder explicit fallback format request with 200 ms chunks, fake microphone', browser: name, version: browser.version(), mime: alternate.mime, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    }
  } finally { await browser.close(); }
}
writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
