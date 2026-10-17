# Ginkgo pitch film, step 0: transcribe the recordings with word timestamps.
#   python demo/pitch/transcribe.py            (cached: skips parts already transcribed)
# Reads demo/pitch/work/{A,B,C}.wav (48 kHz mono, extracted from recordings/PART x.mp4)
# and writes work/{A,B,C}.json (segments with words) and work/{A,B,C}.srt.

import json
import os
import subprocess
import sys

from faster_whisper import WhisperModel

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
MODEL = os.environ.get('WHISPER_MODEL', 'medium.en')
# names Whisper would otherwise mishear (Selangor → "Sri Lanka")
HINT = ('Ginkgo, Selangor, Taman Sri Muda, Shah Alam, Klang, UiTM, Malaysia, ASEAN, Tokyo, Singapore, Japan, '
        'flood drill, evacuation centre, Level 2 to Level 5.')


def stamp(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def main():
    os.makedirs(WORK, exist_ok=True)
    model = None
    for part in 'ABC':
        wav, out = os.path.join(WORK, f'{part}.wav'), os.path.join(WORK, f'{part}.json')
        if not os.path.exists(wav):
            src = os.path.join(HERE, 'recordings', f'PART {part}.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '48000', wav], check=True)
        if os.path.exists(out) and '--force' not in sys.argv:
            continue
        model = model or WhisperModel(MODEL, device='cpu', compute_type='int8')
        segs, _ = model.transcribe(wav, language='en', word_timestamps=True, vad_filter=True,
                                   vad_parameters={'min_silence_duration_ms': 300}, beam_size=5,
                                   condition_on_previous_text=False, initial_prompt=HINT)
        segs = [{'start': s.start, 'end': s.end, 'text': s.text.strip(),
                 'words': [{'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3), 'p': round(w.probability, 3)}
                           for w in s.words]} for s in segs]
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(segs, f, indent=1)
        with open(os.path.join(WORK, f'{part}.srt'), 'w', encoding='utf-8') as f:
            for i, s in enumerate(segs, 1):
                f.write(f"{i}\n{stamp(s['start'])} --> {stamp(s['end'])}\n{s['text']}\n\n")
        print(part, len(segs), 'segments')


main()
