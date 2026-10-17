# Ginkgo pitch film, step 1: the edit decision list.
#   python demo/pitch/edl.py
# Reads the transcripts (work/{A,B,C}.json from transcribe.py) and writes
#   work/edl.json      clips on the output timeline + every caption word with its output time
#   work/edl.md        the same as a table, for review
# Each clip is a stretch of one recording; clips are laid end to end, `gap` seconds after the
# previous one (gaps are filled with room tone and music). Cuts sit in measured silence.

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')

# id, recording, source in, source out, gap before (s), picture, label
CLIPS = [
    ('A1', 'A', 1.30, 8.70, 1.5, '3d', 'Cold open (voice over 3D Sri Muda)'),
    ('A2', 'A', 8.92, 17.35, 1.0, 'face', 'Hello'),
    ('A3', 'A', 17.35, 42.95, 0, 'face', 'The problem: one, two'),
    ('A3b', 'A', 43.25, 57.75, 0, 'face', 'The problem: three (0.3 s pause trimmed)'),
    ('A4', 'A', 57.75, 67.95, 0, 'face', 'Why now'),
    ('A5', 'A', 67.95, 78.85, 0, 'face', 'The answer'),
    ('B1', 'B', 1.70, 11.50, 2.0, 's1', 'The map'),
    ('B2', 'B', 11.75, 23.25, 1.5, 's2', 'The drill'),
    ('B3', 'B', 23.60, 42.35, 2.0, 's3', 'The alert and the route'),
    ('B4', 'B', 42.45, 46.40, 2.0, 's4', 'The shelter'),
    ('B4b', 'B', 46.72, 49.15, 0, 's4', 'The shelter (0.3 s pause trimmed)'),
    ('B5', 'B', 50.25, 58.05, 2.5, 's5', 'On the ground (3D)'),
    ('B6', 'B', 58.65, 66.95, 4.5, 's6', 'Ask Ginkgo (question typed in the gap)'),
    ('C', 'C', 0.85, 12.30, 3.0, 'face', 'The ask'),
    ('Cb', 'C', 12.65, 15.95, 0, 'face', 'The ask (0.35 s pause trimmed)'),
]
END_CARD = 5.0  # closing logo scene after the last word
# room tone: quiet stretches measured in each recording
ROOM_TONE = {'A': [(0.3, 1.2), (79.0, 80.0)], 'B': [(0.0, 1.8), (67.0, 69.5)], 'C': [(15.8, 18.0)]}

# Whisper mishearings, fixed for the captions only (recording, word index) → caption text.
# These are recognition errors, not changes to what was said.
FIX = {
    ('A', 75): 'Selangor', ('A', 102): 'warnings', ('A', 148): None, ('A', 149): 'Selangor.',
    ('A', 156): 'warn', ('A', 179): None, ('A', 180): 'Selangor.', ('A', 191): 'risk,', ('A', 192): 'street',
    ('A', 194): 'street,', ('A', 197): 'flood,', ('A', 90): '1.9', ('A', 91): None, ('A', 140): '15,000',
    ('A', 141): None, ('A', 187): 'three', ('A', 97): 'Two.', ('A', 119): 'Three.',
    ('B', 32): '2021-style', ('B', 33): None, ('B', 34): None, ('B', 79): 'One', ('B', 105): 'by.',
    ('C', 3): 'risk,', ('C', 4): 'plan',
    ('A', 22): 'Luqman', ('A', 23): 'Nurhakim', ('A', 25): 'UiTM',
}
# to confirm with the founder (shown in edl.md)
CHECK = {('A', 121): '"system" or "centres"?'}


def main():
    words = {p: [w for s in json.load(open(os.path.join(WORK, f'{p}.json'), encoding='utf-8')) for w in s['words']]
             for p in 'ABC'}
    t, clips, caps = 0.0, [], []
    for cid, part, a, b, gap, pic, label in CLIPS:
        t += gap
        out = {'id': cid, 'src': part, 'in': a, 'out': b, 't0': round(t, 3), 't1': round(t + b - a, 3),
               'picture': pic, 'label': label, 'words': ''}
        said = []
        for i, w in enumerate(words[part]):
            mid = (w['s'] + w['e']) / 2
            if not a <= mid < b:
                continue
            said.append(w['w'])
            text = FIX.get((part, i), w['w'])
            if text is None:
                continue
            caps.append({'w': text, 's': round(t + max(w['s'], a) - a, 3), 'e': round(t + min(w['e'], b) - a, 3),
                         'clip': cid, 'check': CHECK.get((part, i))})
        out['words'] = ' '.join(said)
        clips.append(out)
        t += b - a
    total = round(t + END_CARD, 2)
    with open(os.path.join(WORK, 'edl.json'), 'w', encoding='utf-8') as f:
        json.dump({'fps': 30, 'total': total, 'endCard': END_CARD, 'roomTone': ROOM_TONE, 'clips': clips,
                   'captions': caps}, f, indent=1)

    mmss = lambda s: f'{int(s // 60)}:{s % 60:04.1f}'
    rows = [f"| {c['id']} | PART {c['src']} | {c['in']:.2f} | {c['out']:.2f} | {mmss(c['t0'])} | "
            f"{c['out'] - c['in']:.1f} s | {c['picture']} | {c['label']} | {c['words']} |" for c in clips]
    fixes = [f"- PART {p} word {i}: heard “{words[p][i]['w']}” → caption “{v or '(merged)'}”" for (p, i), v in FIX.items()]
    md = ['# Pitch video: edit decision list', '',
          f'**Total: {mmss(total)}** (voice {sum(c["out"] - c["in"] for c in clips):.1f} s, '
          f'gaps {sum(x[4] for x in CLIPS):.1f} s, end card {END_CARD} s)', '',
          '| Clip | Source | In | Out | Starts at | Length | Picture | Segment | Words (as transcribed) |',
          '|---|---|---|---|---|---|---|---|---|', *rows, '',
          '## Caption fixes (Whisper mishearings)', '', *fixes]
    with open(os.path.join(WORK, 'edl.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print('total', mmss(total), '·', len(clips), 'clips ·', len(caps), 'caption words')


main()
