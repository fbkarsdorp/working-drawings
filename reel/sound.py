"""The sound of the Working Drawings reel, synthesised from scratch.

A 120 bpm cue in D minor (pad, pumping bass, arpeggio, drums) and foley synced to the picture
through the cue list the page exports as window.EVENTS: whooshes for camera moves, a paper slap
when a print lands, a shutter click on hard cuts, pencil scratches while drawing, a riser into the
dive and a stamp. Stems are levelled by RMS (there is no ear in the loop), then summed, softly
limited and normalised.

    synth(events, "out.wav")
"""
import numpy as np
from scipy import signal as sg
from scipy.io import wavfile

SR = 48000
DUR = 20.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(20261106)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n):
    return np.arange(n) / SR


def noise(n):
    return rng.standard_normal(n)


def _sos(kind, f, order):
    nyq = SR / 2
    w = [f[0] / nyq, f[1] / nyq] if kind == "band" else f / nyq
    return sg.butter(order, w, btype=kind, output="sos")


def lp(x, f, o=2):
    return sg.sosfilt(_sos("low", f, o), x)


def hp(x, f, o=2):
    return sg.sosfilt(_sos("high", f, o), x)


def bp(x, lo, hi, o=2):
    return sg.sosfilt(_sos("band", (lo, hi), o), x)


def svf(x, fc, damp=0.6, mode="low"):
    """Chamberlin state-variable filter with a cutoff per sample."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    f = (2 * np.sin(np.pi * np.minimum(fc, SR / 6.5) / SR)).tolist()
    xs = x.tolist()
    out = [0.0] * len(xs)
    low = band = 0.0
    want_low = mode == "low"
    for i in range(len(xs)):
        low += f[i] * band
        high = xs[i] - low - damp * band
        band += f[i] * high
        out[i] = low if want_low else band
    return np.array(out)


def curve(points, t):
    """Piecewise-linear automation through (time, value) points."""
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)


def panned(sig, pan):
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.vstack([sig * np.cos(a) * np.sqrt(2), sig * np.sin(a) * np.sqrt(2)])


class Stem:
    def __init__(self):
        self.x = np.zeros((2, N))

    def add(self, sig, at, pan=0.0, gain=1.0):
        sig = np.asarray(sig, dtype=float)
        if sig.ndim == 1:
            sig = panned(sig, pan)
        i = int(round(at * SR))
        if i < 0:
            sig, i = sig[:, -i:], 0
        n = min(sig.shape[1], N - i)
        if n > 0:
            self.x[:, i:i + n] += sig[:, :n] * gain

    def level(self, db, by="rms"):
        mono = np.abs(self.x).max(axis=0)
        active = mono > 1e-4
        if not active.any():
            return self
        ref = np.sqrt(np.mean(self.x[:, active] ** 2)) if by == "rms" else mono.max()
        self.x *= 10 ** (db / 20) / ref
        return self


# ---------- instruments ----------
def kick(dur=0.45, f0=150, f1=46, k=28, decay=0.3, click=0.5):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * k)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    tick = hp(noise(n), 1800) * np.exp(-t / 0.004) * click
    return np.tanh((body + tick) * 1.7)


def clap():
    n = int(0.4 * SR); t = tt(n); env = np.zeros(n)
    for d in (0.0, 0.011, 0.023):
        env += (t >= d) * np.exp(-np.clip(t - d, 0, None) / 0.006)
    env += (t >= 0.03) * np.exp(-np.clip(t - 0.03, 0, None) / 0.11)
    return bp(noise(n), 950, 4200) * env


def hat(open_=False):
    n = int((0.3 if open_ else 0.08) * SR); t = tt(n)
    return hp(noise(n), 7200, 3) * np.exp(-t / (0.14 if open_ else 0.022))


def bass_note(m, dur=0.22):
    n = int(dur * SR); t = tt(n); f = mtof(m)
    saw = sg.sawtooth(2 * np.pi * f * t) * 0.6 + np.sin(2 * np.pi * f * t)
    env = np.minimum(1, t / 0.004) * np.exp(-t / 0.13)
    return lp(saw, 520) * env + np.sin(np.pi * f * t) * env * 0.5


def pluck(m, dur=0.2):
    n = int(dur * SR); t = tt(n); f = mtof(m)
    x = sg.sawtooth(2 * np.pi * f * t) * 0.6 + sg.square(2 * np.pi * f * t) * 0.4
    return lp(x, 3000) * np.minimum(1, t / 0.002) * np.exp(-t / 0.07)


def pad_chord(notes, dur):
    n = int(dur * SR); t = tt(n); x = np.zeros(n)
    for m in notes:
        for cents in (-9, 0, 8):
            x += sg.sawtooth(2 * np.pi * mtof(m) * 2 ** (cents / 1200) * t + rng.random() * 6.28)
    env = np.minimum(1, t / 0.12) * np.minimum(1, (dur - t) / 0.18)
    return x * env / (3 * len(notes))


def whoosh(dur, pan_from=-0.6, pan_to=0.6, peak=0.55, lo=240, hi=5600, amt=1.0):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    shape = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.3)
    x = svf(noise(n), lo * (hi / lo) ** shape, damp=0.45, mode="band") * shape
    x += lp(noise(n), 160) * shape * 0.35
    return panned(x * amt, np.linspace(pan_from, pan_to, n))


def scratch(dur, amt=1.0):
    n = int(dur * SR); t = tt(n)
    wob = lp(noise(n), 4); wob /= np.std(wob) + 1e-9
    rate = (12 + 6 * rng.random()) * (1 + 0.3 * wob)
    strokes = np.abs(np.sin(2 * np.pi * np.cumsum(rate) / SR)) ** 3
    rough = 1 + 0.7 * bp(noise(n), 25, 140) / 0.2
    env = np.minimum(1, t / 0.03) * np.clip((dur - t) / 0.08, 0, 1)
    return bp(noise(n), 2400, 7800) * strokes * np.clip(rough, 0, 3) * env * amt


def slap():
    n = int(0.3 * SR); t = tt(n)
    return lp(noise(n), 2600) * np.exp(-t / 0.022) + np.sin(2 * np.pi * 105 * t) * np.exp(-t / 0.07) * 0.7


def click():
    n = int(0.12 * SR); t = tt(n)
    return hp(noise(n), 2600) * np.exp(-t / 0.005) + np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.01) * 0.3


def crash(dur=1.8, decay=0.9):
    n = int(dur * SR); t = tt(n)
    return hp(noise(n), 3600, 2) * np.exp(-t / decay)


def riser(dur, lo=380, hi=7200):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    x = svf(noise(n), lo * (hi / lo) ** (u ** 1.5), damp=0.32, mode="band") * u ** 2.2
    tone = np.sin(2 * np.pi * np.cumsum(170 * 9 ** (u ** 1.7)) / SR) * u ** 3 * 0.15
    return x + tone


def reverb(x, length=2.4, decay=0.55):
    n = int(length * SR); t = tt(n); out = np.zeros_like(x)
    for ch in range(2):
        ir = lp(noise(n), 5200) * np.exp(-t / decay)
        ir[: int(0.015 * SR)] *= np.linspace(0, 1, int(0.015 * SR))
        ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = sg.fftconvolve(x[ch], ir)[:N]
    return out


# ---------- the cue ----------
CHORDS = [(0, 2, "Dm"), (2, 4, "Dm"), (4, 6, "Bb"), (6, 8, "F"), (8, 10, "C"), (10, 12, "Dm"), (12, 14, "Bb"),
          (14, 15, "F"), (15, 16.6, "Bb"), (16.6, 18, "A"), (18, 20, "Dm9")]
PAD = {"Dm": [62, 65, 69], "Bb": [62, 65, 70], "F": [60, 65, 69], "C": [60, 64, 67], "A": [61, 64, 69], "Dm9": [62, 65, 69, 76]}
ROOT = {"Dm": 38, "Bb": 34, "F": 41, "C": 36, "A": 33, "Dm9": 38}
ARP = {k: [n + 12 for n in v] + [v[0] + 24] for k, v in PAD.items()}


def chord_at(t):
    for a, b, name in CHORDS:
        if a <= t < b:
            return name
    return "Dm9"


def synth(events, out_path):
    st = {k: Stem() for k in ("kick", "clap", "hats", "bass", "pad", "arp", "whoosh", "foley", "hits", "risers")}
    kicks = []
    # drums from the drop at 2.0 to the break at 15.0
    for k in range(int(2.0 / BEAT), int(15.0 / BEAT)):
        t = k * BEAT
        kicks.append(t)
        st["kick"].add(kick(), t)
        burst = 10.0 <= t < 12.0
        if burst or k % 4 in (1, 3):
            st["clap"].add(clap(), t, 0.0, 1.0 if not burst else 0.8)
        open_ = 6.0 <= t < 10.0 and k % 2 == 1
        st["hats"].add(hat(open_), t + 0.25, 0.4, 1.0)
        if 6.0 <= t < 10.0 or 12.0 <= t < 15.0:
            for d in (0.125, 0.375):
                st["hats"].add(hat(), t + d, -0.45, 0.35)
        st["bass"].add(bass_note(ROOT[chord_at(t)]), t + 0.25)
        st["bass"].add(bass_note(ROOT[chord_at(t)] + 12, 0.12), t + 0.375, 0, 0.35)
    for j in range(8):  # a snare roll into the last stretch
        t = 11.5 + j * 0.0625
        st["clap"].add(clap(), t, 0, 0.35 + 0.08 * j)
    for t in (0.0, 0.5, 1.0, 1.5):  # heartbeat before the drop
        st["kick"].add(lp(kick(0.5, 90, 40, 20, 0.35, 0.0), 300), t, 0, 0.45)
    # pad, with a filter that opens over the reel
    for a, b, name in CHORDS:   # two independent voices, hard left and right: a wide pad
        st["pad"].add(pad_chord(PAD[name], b - a + 0.2), a, -0.85)
        st["pad"].add(pad_chord(PAD[name], b - a + 0.2), a, 0.85)
    tA = np.arange(N) / SR
    cutoff = curve([(0, 320), (2, 1500), (10, 2300), (12, 1500), (15, 1200), (17.95, 5600), (18.05, 3200), (20, 650)], tA)
    gain = curve([(0, 0.0), (0.6, 0.55), (2, 0.6), (15, 0.6), (16.5, 1.0), (18, 1.25), (18.3, 1.0), (20, 0.5)], tA)
    for ch in range(2):
        st["pad"].x[ch] = svf(st["pad"].x[ch], cutoff, damp=0.9) * gain
    # arpeggio in the busy stretches
    for k in range(int(6.0 / 0.125), int(15.0 / 0.125)):
        t = k * 0.125
        if 10.0 <= t < 12.0:
            continue
        notes = ARP[chord_at(t)]
        st["arp"].add(pluck(notes[k % len(notes)]), t, 0.6 if k % 2 else -0.6)
    # the drop and the stamp
    st["hits"].add(kick(1.6, 120, 38, 18, 0.7, 0.9), 2.0, 0, 0.8)
    st["hits"].add(crash(), 2.0, 0, 0.25)
    st["risers"].add(crash(0.6, 0.25)[::-1], 2.0 - 0.6, 0, 0.6)
    st["hits"].add(kick(2.4, 120, 34, 16, 0.95, 1.0), 18.0)
    st["hits"].add(bp(noise(int(0.4 * SR)), 380, 1500) * np.exp(-tt(int(0.4 * SR)) / 0.045) * 1.6, 18.0)
    st["hits"].add(crash(2.0, 1.1), 18.0, 0, 0.35)
    st["bass"].add(lp(np.sin(2 * np.pi * mtof(26) * tt(int(2 * SR))) * np.exp(-tt(int(2 * SR)) / 1.1), 200), 18.0, 0, 2.5)
    # foley from the picture
    for e in events:
        k = e["type"]
        if k == "whoosh":
            d = e["t1"] - e["t0"] + 0.25
            p = e.get("pan", 0) * 0.7
            st["whoosh"].add(whoosh(d, -p or -0.3, p or 0.3, amt=e.get("amt", 1)), e["t0"] - 0.08)
        elif k == "land":
            st["foley"].add(slap(), e["t"] - 0.01, 0, 1.0)
        elif k == "cut":
            st["foley"].add(click(), e["t"], 0, 1.0)
        elif k == "scratch":
            st["foley"].add(scratch(e["t1"] - e["t0"], e.get("amt", 1)) * 0.06, e["t0"], e.get("pan", 0))
        elif k == "pull":
            st["whoosh"].add(whoosh(e["t1"] - e["t0"] + 0.4, 0.2, -0.2, peak=0.3, lo=150, hi=2400, amt=0.8), e["t0"])
        elif k == "dive":
            st["risers"].add(riser(e["t1"] - e["t0"] + 0.9), e["t0"] - 0.9)
            st["risers"].add(crash(1.0, 0.4)[::-1], e["t1"] - 1.0, 0, 0.7)
            st["whoosh"].add(whoosh(e["t1"] - e["t0"] + 0.1, -0.2, 0.2, peak=0.8, lo=300, hi=7000, amt=1.3), e["t0"])
    # level the stems, duck the music under the kick, add a room, master
    targets = {"kick": -15, "clap": -23, "hats": -29, "bass": -19, "pad": -22, "arp": -29, "whoosh": -23, "foley": -31, "risers": -25}
    for name, db in targets.items():
        st[name].level(db)
    st["hits"].level(-2.5, by="peak")
    duck = np.ones(N)
    for t in kicks:
        i = int(t * SR); n = min(int(0.4 * SR), N - i)
        duck[i:i + n] = np.minimum(duck[i:i + n], 1 - 0.55 * np.exp(-tt(n) / 0.09))
    music = (st["bass"].x + st["pad"].x + st["arp"].x) * duck
    dry = st["kick"].x + st["clap"].x + st["hats"].x + st["whoosh"].x + st["foley"].x + st["hits"].x + st["risers"].x
    wet = reverb(st["clap"].x * 0.6 + st["pad"].x * 0.5 + st["hits"].x * 0.5 + st["whoosh"].x * 0.4 + st["arp"].x * 0.5)
    mix = music + dry + wet * 0.28
    mix = np.vstack([hp(mix[0], 28), hp(mix[1], 28)])
    mix = np.tanh(mix * 1.3) / np.tanh(1.3)
    mix *= 0.93 / np.abs(mix).max()
    fade = np.ones(N)
    fade[: int(0.01 * SR)] = np.linspace(0, 1, int(0.01 * SR))
    fade[-int(0.4 * SR):] = np.linspace(1, 0, int(0.4 * SR)) ** 1.5
    mix *= fade
    wavfile.write(out_path, SR, (mix.T * 32767).astype(np.int16))
    return out_path


if __name__ == "__main__":
    import json
    import sys
    synth(json.load(open(sys.argv[1])), sys.argv[2])
