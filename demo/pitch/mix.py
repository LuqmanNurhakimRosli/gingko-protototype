# Ginkgo pitch film, step 3: the soundtrack.
#   python demo/pitch/mix.py
# Reads work/edl.json (clips, from edl.py) and work/cues.json (sound effects, written by render.mjs from
# the film's own timeline) and writes work/mix.wav: 48 kHz stereo, −14 LUFS, true peak ≤ −1.5 dBTP.
#
#   dialogue  the founder's recordings cut per the EDL (15 ms fades), gaps filled with his own room tone,
#             then ffmpeg: high-pass 80 Hz · afftdn · presence EQ · 3:1 compression · de-ess
#   music     original, composed here: 96 BPM, D major (D–A–Bm–G), pad · pluck arpeggio · bass · soft kick ·
#             shaker; sections follow the edit; ducked under the voice with sidechaincompress
#   effects   all synthesised here (clicks, keys, whooshes, pops, chimes, riser, impact, rain, rumble)
# Nothing is downloaded, so there is nothing to license.

import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
SR = 48000
rng = np.random.default_rng(7)


def secs(n):
    return np.arange(int(n * SR)) / SR


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'lowpass', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'highpass', fs=SR, output='sos'), x)


def db(g):
    return 10 ** (g / 20)


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def reverb(x, length=1.8, mix=0.25, seed=1):
    """Stereo reverb: convolution with decaying noise, a different tail per channel."""
    r = np.random.default_rng(seed)
    t = secs(length)
    out = np.empty((len(x), 2))
    mono = x if x.ndim == 1 else x.mean(1)
    for c in range(2):
        ir = r.standard_normal(len(t)) * np.exp(-t * 6.9 / length)
        ir = lp(ir, 6000)
        ir /= np.sqrt((ir ** 2).sum())
        wet = fftconvolve(mono, ir)[:len(x)]
        dry = x if x.ndim == 1 else x[:, c]
        out[:, c] = dry * (1 - mix) + wet * mix
    return out


def place(bus, sig, t, gain=1.0, pan=0.0):
    """Add a mono or stereo signal into a stereo bus at time t (equal-power pan for mono)."""
    i = int(round(t * SR))
    if i >= len(bus):
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1)
    j = min(len(bus), i + len(sig))
    if i < 0:
        sig, i = sig[-i:], 0
    bus[i:j] += sig[:j - i] * gain


# ── sound effects ──────────────────────────────────────────────────────────────────────────────────
def sweep_filter(x, f0, f1, q=0.7):
    """State-variable band-pass whose centre glides f0 → f1 (log), one sample at a time."""
    n = len(x)
    f = np.exp(np.linspace(np.log(f0), np.log(f1), n))
    g = 2 * np.sin(np.pi * np.minimum(f, SR / 6) / SR)
    low = band = 0.0
    out = np.empty(n)
    damp = 1 / q
    for k in range(n):
        high = x[k] - low - damp * band
        band += g[k] * high
        low += g[k] * band
        out[k] = band
    return out


def bell(freq, dur=1.6, bright=0.35):
    t = secs(dur)
    s = (np.sin(2 * np.pi * freq * t) + bright * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 6)
         + 0.2 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 12))
    return s * np.exp(-t * 3.2 / dur) * np.minimum(1, t / 0.004)


def sfx(name, dur=None):
    if name == 'click':  # mouse click: tiny transient + short tick
        t = secs(0.05)
        n = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 900)
        tone = np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 260)
        down = 0.6 * n + 0.5 * tone
        out = np.zeros(int(0.11 * SR))  # press, then a softer release 60 ms later
        out[:len(down)] += down
        k = int(0.06 * SR)
        out[k:k + len(n) // 2] += 0.35 * n[:len(n) // 2]
        return out
    if name == 'key':  # soft keyboard key, randomised
        t = secs(0.06)
        f = rng.uniform(1400, 2600)
        n = bp(rng.standard_normal(len(t)), f * 0.6, f * 1.6) * np.exp(-t * rng.uniform(110, 160))
        thock = np.sin(2 * np.pi * rng.uniform(150, 210) * t) * np.exp(-t * 90) * 0.5
        return (n * 1.4 + thock) * rng.uniform(0.6, 1.0)
    if name in ('whoosh', 'swish'):
        d = dur or (0.75 if name == 'whoosh' else 0.4)
        t = secs(d)
        env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
        s = sweep_filter(rng.standard_normal(len(t)), 250, 4200 if name == 'whoosh' else 6000, q=1.2) * env
        return s * 0.9
    if name == 'pop':
        t = secs(0.14)
        f = 950 * np.exp(-t * 14) + 380
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 34) * np.minimum(1, t / 0.002)
    if name == 'tick':
        t = secs(0.03)
        return np.sin(2 * np.pi * 3300 * t) * np.exp(-t * 220)
    if name == 'alert':  # gentle two-tone chime (not an emergency tone)
        out = np.zeros(int(1.9 * SR))
        a, b = bell(hz(81), 1.3), bell(hz(76), 1.4)  # A5 then E5
        out[:len(a)] += a
        out[int(0.32 * SR):int(0.32 * SR) + len(b)] += b
        return out * 0.5
    if name == 'success':  # D6 F#6 A6
        out = np.zeros(int(1.6 * SR))
        for i, m in enumerate((86, 90, 93)):
            b = bell(hz(m), 1.2, 0.25)
            k = int(i * 0.075 * SR)
            out[k:k + len(b)] += b * (0.8 + 0.1 * i)
        return out * 0.4
    if name == 'riser':
        d = dur or 2.2
        t = secs(d)
        env = (t / d) ** 2.2
        noise = sweep_filter(rng.standard_normal(len(t)), 300, 7000, q=2) * env
        f = 180 * 2 ** (2.2 * t / d)
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * env * 0.25
        return noise * 0.8 + tone
    if name == 'impact':
        t = secs(1.6)
        f = 70 * np.exp(-t * 3) + 34
        boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
        thud = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 24) * 0.8
        return (boom + thud) * np.minimum(1, t / 0.003)
    if name == 'sting':  # logo sting: bell chord with a soft swell under it
        out = np.zeros(int(3.6 * SR))
        for i, m in enumerate((62, 69, 74, 78, 81)):
            b = bell(hz(m), 3.2, 0.3)
            k = int(i * 0.06 * SR)
            out[k:k + len(b)] += b * (0.5 if m < 70 else 0.35)
        t = secs(len(out) / SR)
        swell = sum(np.sin(2 * np.pi * hz(m) * t) for m in (50, 57, 62)) * np.sin(np.pi * np.clip(t / 3.6, 0, 1)) * 0.12
        return (out + swell) * 0.5
    if name == 'rain':
        d = dur
        t = secs(d)
        bed = np.stack([bp(rng.standard_normal(len(t)), 500, 7000) for _ in range(2)], 1) * 0.35
        drops = np.zeros((len(t), 2))
        for k in rng.integers(0, len(t) - 2000, int(d * 55)):
            ln = 300
            dr = np.sin(2 * np.pi * rng.uniform(2500, 6000) * np.arange(ln) / SR) * np.exp(-np.arange(ln) / 40)
            drops[k:k + ln, rng.integers(0, 2)] += dr * rng.uniform(0.05, 0.25)
        fade = np.minimum(1, np.minimum(t / 1.2, (d - t) / 1.2))[:, None]
        return (bed + drops) * fade
    if name == 'rumble':
        d = dur
        t = secs(d)
        brown = np.cumsum(rng.standard_normal((len(t), 2)), 0)
        brown -= np.stack([lp(brown[:, c], 0.5) for c in range(2)], 1)  # remove drift
        s = np.stack([lp(brown[:, c], 160, 4) for c in range(2)], 1)
        s /= np.abs(s).max() + 1e-9
        lfo = 0.75 + 0.25 * np.sin(2 * np.pi * 0.23 * t)
        fade = np.minimum(1, np.minimum(t / 1.5, (d - t) / 1.5))
        return s * (lfo * fade)[:, None]
    raise ValueError(name)


SFX_GAIN = {'click': -14, 'key': -20, 'whoosh': -19, 'swish': -22, 'pop': -20, 'tick': -27, 'alert': -13,
            'success': -12, 'riser': -17, 'impact': -12, 'sting': -10, 'rain': -24, 'rumble': -16}


# ── music ──────────────────────────────────────────────────────────────────────────────────────────
CHORDS = {  # pad voicing, arpeggio notes, bass root (MIDI)
    'D': ([50, 57, 62, 66], [62, 66, 69, 74], 38),
    'A': ([52, 57, 61, 64], [61, 64, 69, 73], 33),
    'Bm': ([50, 54, 59, 62], [62, 66, 71, 74], 35),
    'G': ([50, 55, 59, 62], [62, 67, 71, 74], 31),
}
PROG = ['D', 'A', 'Bm', 'G']
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT


def pad_note(m, dur):
    t = secs(dur)
    s = np.zeros(len(t))
    for det in (-0.06, 0.0, 0.07):  # three slightly detuned voices
        f = hz(m + det)
        for h, amp in ((1, 1), (2, 0.45), (3, 0.22), (4, 0.1), (5, 0.05)):
            s += amp * np.sin(2 * np.pi * f * h * t + rng.uniform(0, 6.3))
    env = np.minimum(1, t / 0.9) * np.minimum(1, (dur - t) / 0.9)
    return s * env * (1 + 0.04 * np.sin(2 * np.pi * 0.3 * t))


def pluck(m, dur=0.6):
    t = secs(dur)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 9) + 0.1 * np.sin(6 * np.pi * f * t) * np.exp(-t * 16)
    return s * np.exp(-t * 7) * np.minimum(1, t / 0.003)


def bass_note(m, dur):
    t = secs(dur)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) + 0.18 * np.sin(6 * np.pi * f * t)
    return s * np.minimum(1, t / 0.02) * np.exp(-t * 1.4) * np.minimum(1, (dur - t) / 0.05)


def kick():
    t = secs(0.35)
    f = 110 * np.exp(-t * 22) + 48
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def shaker():
    t = secs(0.07)
    return hp(rng.standard_normal(len(t)), 6000) * np.exp(-t * 60)


def curve(keys, n):
    """Gain automation from (time, gain) keyframes."""
    ts, gs = zip(*keys)
    return np.interp(np.arange(n) / SR, ts, gs)


def compose(total, marks):
    n = int(total * SR)
    pad, arp, bass, drums = (np.zeros(n) for _ in range(4))
    grid0 = marks['impact'] % BAR  # a bar line lands exactly on the cut into the demo
    bars = [grid0 + k * BAR for k in range(-1, int(total / BAR) + 2)]
    for k, b0 in enumerate(bars):
        chord = CHORDS[PROG[k % 4]]
        if b0 + BAR < 0 or b0 > total:
            continue
        for m in chord[0]:
            place_mono(pad, pad_note(m, BAR + 0.9), b0)
        for i in range(8):  # eighth notes
            idx = [0, 1, 2, 3, 2, 1, 2, 3][i]
            place_mono(arp, pluck(chord[1][idx]) * (1 if i % 2 == 0 else 0.7), b0 + i * BEAT / 2)
        place_mono(bass, bass_note(chord[2] + 12, BEAT * 1.9), b0)
        place_mono(bass, bass_note(chord[2] + 12, BEAT * 1.9), b0 + 2 * BEAT)
        for i in range(4):
            place_mono(drums, kick() * (1 if i in (0, 2) else 0), b0 + i * BEAT)
        for i in range(8):
            place_mono(drums, shaker() * (0.18 if i % 2 else 0.1), b0 + i * BEAT / 2)
    # the last bar before the drop into the demo is left sparse for the riser
    pre = marks['impact'] - BAR
    a2, a3, a3b, c0, end = marks['A2'], marks['A3'], marks['A3b'], marks['C'], marks['end']
    g_pad = curve([(0, 0), (marks['sting'] - 0.2, 0), (a2, 0.55), (a3, 0.7), (pre, 0.8), (marks['impact'], 0.85),
                   (c0 - 1.5, 0.85), (c0, 0.6), (end - 0.5, 0.5), (end + 0.3, 0), (total, 0)], n)
    g_arp = curve([(0, 0), (a3, 0), (a3 + 2, 0.45), (pre - 0.3, 0.7), (pre, 0), (marks['impact'], 0), (marks['impact'] + 0.01, 1),
                   (c0 - 2.5, 1), (c0, 0), (total, 0)], n)
    g_bass = curve([(0, 0), (a3b - 1, 0), (a3b + 1, 0.6), (pre - 0.3, 0.6), (pre, 0), (marks['impact'], 0), (marks['impact'] + 0.01, 1),
                    (c0 - 2.5, 1), (c0, 0), (total, 0)], n)
    g_drm = curve([(0, 0), (marks['impact'], 0), (marks['impact'] + 0.01, 1), (c0 - 2.5, 1), (c0 - 1.0, 0), (total, 0)], n)
    mix = (lp(pad, 2200) * g_pad * 0.11 + arp * g_arp * 0.10 + lp(bass, 600) * g_bass * 0.16 + drums * g_drm * 0.16)
    out = reverb(mix, 2.2, 0.28)
    # resolve: a long D chord under the closing scene
    fin = sum(pad_note(m, 5.5) for m in (50, 57, 62, 66, 69)) * np.exp(-secs(5.5) * 0.3)
    place(out, np.stack([lp(fin, 2400)] * 2, 1) * 0.10, end - 0.2)
    return out


def place_mono(bus, sig, t):
    i = int(round(t * SR))
    if i >= len(bus) or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    j = min(len(bus), i + len(sig))
    bus[i:j] += sig[:j - i]


# ── dialogue ───────────────────────────────────────────────────────────────────────────────────────
def dialogue(edl, total):
    src = {p: wavfile.read(os.path.join(WORK, f'{p}.wav'))[1].astype(float) / 32768 for p in 'ABC'}
    # match the three recordings' speech levels (RMS of the loud half of 50 ms frames)
    def speech_rms(x):
        f = x[:len(x) // 2400 * 2400].reshape(-1, 2400)
        r = np.sqrt((f ** 2).mean(1))
        return np.sqrt((np.sort(r)[len(r) // 2:] ** 2).mean())
    ref = speech_rms(src['A'])
    gain = {p: ref / speech_rms(x) for p, x in src.items()}
    n = int(total * SR)
    out = np.zeros(n)
    fade = int(0.015 * SR)
    ramp = np.linspace(0, 1, fade)
    spans = []
    for c in edl['clips']:
        x = src[c['src']][int(c['in'] * SR):int(c['out'] * SR)].copy() * gain[c['src']]
        x[:fade] *= ramp
        x[-fade:] *= ramp[::-1]
        place_mono(out, x, c['t0'])
        spans.append((c['t0'], c['t1'], c['src']))
    # room tone in every gap (from the recording on the next clip, or the last one)
    tone = {p: np.concatenate([src[p][int(a * SR):int(b * SR)] for a, b in v]) * gain[p] for p, v in edl['roomTone'].items()}
    edges = [(0, spans[0][0], spans[0][2])] + [(spans[i][1], spans[i + 1][0], spans[i + 1][2]) for i in range(len(spans) - 1)] \
        + [(spans[-1][1], total, spans[-1][2])]
    for a, b, p in edges:
        if b - a < 0.02:
            continue
        ln = int((b - a) * SR)
        r = np.tile(tone[p], ln // len(tone[p]) + 1)[:ln].copy()
        k = min(fade, ln // 2)
        r[:k] *= ramp[:k]
        r[-k:] *= ramp[::-1][:k] if k else 1
        place_mono(out, r, a)
    return out


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def lufs(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True)
    return float(r.stderr.rsplit('I:', 1)[1].split('LUFS')[0])


# stem levels before the final loudnorm: music ~12 dB under the voice, then ducked ~8 dB more while he speaks
DLG_LUFS, MUSIC_LUFS = -17.0, -26.0


def main():
    edl = json.load(open(os.path.join(WORK, 'edl.json'), encoding='utf-8'))
    film = json.load(open(os.path.join(WORK, 'cues.json'), encoding='utf-8'))
    total = film['duration']
    clips = {c['id']: c for c in edl['clips']}
    marks = {'A2': clips['A2']['t0'], 'A3': clips['A3']['t0'], 'A3b': clips['A3b']['t0'], 'C': clips['C']['t0'],
             'impact': film['marks']['impact'], 'sting': film['marks']['sting'], 'end': film['marks']['end']}

    raw = os.path.join(WORK, 'dlg_raw.wav')
    wavfile.write(raw, SR, (dialogue(edl, total) * 32767).clip(-32768, 32767).astype(np.int16))
    dlg = os.path.join(WORK, 'dlg.wav')
    ffmpeg('-i', raw, '-af', 'highpass=f=80,afftdn=nf=-42:nr=10,equalizer=f=250:t=q:w=1.2:g=-2,'
           'equalizer=f=3500:t=q:w=1.4:g=2.5,acompressor=threshold=-24dB:ratio=3:attack=8:release=160:makeup=3dB,'
           'deesser=i=0.35', '-ar', str(SR), '-ac', '2', '-c:a', 'pcm_f32le', dlg)

    music = compose(total, marks)
    effects = np.zeros((int(total * SR), 2))
    for c in film['cues']:
        s = sfx(c['sfx'], c.get('dur'))
        if c['sfx'] in ('click', 'key', 'pop', 'tick', 'alert', 'success', 'sting'):
            s = reverb(s, 1.2 if c['sfx'] in ('alert', 'success', 'sting') else 0.5, 0.18, seed=3)
        place(effects, s, c['t'], db(SFX_GAIN[c['sfx']] + c.get('gain', 0)), c.get('pan', 0))
    for name, x in (('music', music), ('sfx', effects)):
        wavfile.write(os.path.join(WORK, f'{name}.wav'), SR, x.astype(np.float32))
    g_dlg = DLG_LUFS - lufs(dlg)
    g_mus = MUSIC_LUFS - lufs(os.path.join(WORK, 'music.wav'))

    pre = os.path.join(WORK, 'premix.wav')
    ffmpeg('-i', dlg, '-i', os.path.join(WORK, 'music.wav'), '-i', os.path.join(WORK, 'sfx.wav'), '-filter_complex',
           f'[0:a]volume={g_dlg:.2f}dB,asplit=2[d][key];[1:a]volume={g_mus:.2f}dB[m];'
           '[m][key]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=400:makeup=1[md];'
           '[d][md][2:a]amix=inputs=3:normalize=0:duration=first[out]', '-map', '[out]', '-ar', str(SR), '-c:a', 'pcm_f32le', pre)
    # two-pass loudnorm
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', pre, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
    ffmpeg('-i', pre, '-af', f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
           f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
           '-ar', str(SR), os.path.join(WORK, 'mix.wav'))
    print(f"mix.wav, {total:.1f} s, measured {m['input_i']} LUFS, normalised to -14")


main()
