export function instrumentSource(
  ctx: AudioContext,
  output: AudioNode,
  n: { kind: string; frequency: number; gain: number },
  at: number,
  duration: number,
) {
  const gain = ctx.createGain();
  let source: AudioScheduledSourceNode,
    filter: BiquadFilterNode | null = null;
  if (n.kind === "snare" || n.kind === "hat") {
    const buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * 0.5),
        ctx.sampleRate,
      ),
      data = buffer.getChannelData(0);
    let seed = 123456789;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    source = noise;
    filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = n.kind === "hat" ? 6500 : 900;
    source.connect(filter).connect(gain);
  } else {
    const osc = ctx.createOscillator();
    source = osc;
    if (n.kind === "guitar" || n.kind === "bass" || n.kind === "voice") {
      const partials =
        n.kind === "guitar"
          ? [0, 1, 0.5, 0.28, 0.16, 0.09]
          : n.kind === "bass"
            ? [0, 1, 0.3, 0.12]
            : [0, 1, 0.35, 0.2, 0.1];
      osc.setPeriodicWave(
        ctx.createPeriodicWave(
          new Float32Array(partials.length),
          Float32Array.from(partials),
        ),
      );
    } else osc.type = "sine";
    osc.frequency.setValueAtTime(n.frequency, at);
    if (n.kind === "kick")
      osc.frequency.exponentialRampToValueAtTime(
        35,
        at + Math.min(duration, 0.12),
      );
    osc.connect(gain);
  }
  const end = at + Math.max(duration, 0.005),
    attack = Math.min(0.005, duration / 3),
    release = Math.min(0.015, duration / 3);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(n.gain, at + attack);
  const decay =
    n.kind === "guitar"
      ? 0.18
      : n.kind === "snare" || n.kind === "hat"
        ? 0.002
        : 0.8;
  if (n.gain > 0)
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.000001, n.gain * decay),
      Math.max(at + attack, end - release),
    );
  gain.gain.linearRampToValueAtTime(0, end);
  gain.connect(output);
  source.start(at);
  source.stop(end + 0.01);
  return {
    source,
    disconnect: () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    },
  };
}
