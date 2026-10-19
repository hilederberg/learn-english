"""Pre-records every English sentence the app speaks, so playback sounds natural on any phone.

Run after changing content:  python tools/make-audio.py   (needs: pip install edge-tts)
Writes audio/<hash>.mp3 and audio/index.json ({"f|text": "file.mp3", "fs|text": slow version}). Existing clips are kept,
clips no longer used are deleted. Then run npm run sw. Keep the text list in sync with
spokenTexts() in tests/core.test.mjs and the speak() calls in js/app.js.
"""
import asyncio, hashlib, json, re, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'audio'
VOICES = {'f': 'en-US-AvaNeural', 'm': 'en-US-AndrewNeural'}  # f: main voice, m: speaker A in dialogues
RATES = {'': '-5%', 's': '-30%'}  # normal, and a separate slow recording (slowing a clip down sounds worse)


def clean(t):
    return re.sub(r'\s+', ' ', t).strip()


def spoken_texts():
    meta = json.loads((ROOT / 'content/units.json').read_text(encoding='utf-8'))
    out = {('f', 'Hello, nice to meet you.')}  # settings: reading-speed preview
    for u in meta['units']:
        p = ROOT / 'content/units' / f"{u['id']}.json"
        if not u.get('open') or not p.exists():
            continue
        d = json.loads(p.read_text(encoding='utf-8'))
        for it in d['items']:
            out.add(('f', it['en']))
        for g in d.get('grammar', []):
            for e in g['examples']:
                out.add(('f', e['en']))
            for dr in g['drills']:
                out.add(('f', re.sub(r'_+', dr['answer'], dr['text']) if dr['type'] == 'fill' else dr['answer']))
        for dl in d.get('dialogues', []):
            for line in dl['lines']:
                out.add(('m' if line['speaker'] == 'A' else 'f', line['en']))
    return sorted((v, clean(t)) for v, t in out if clean(t))


def name_for(v, r, t):
    return hashlib.sha1(f'{VOICES[v]}|{RATES[r]}|{t}'.encode()).hexdigest()[:12] + '.mp3'


async def record(v, r, t, path, sem):
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(t, VOICES[v], rate=RATES[r]).save(str(path))
                if path.stat().st_size > 1000:
                    return
            except Exception as e:  # network hiccup: retry
                err = e
            await asyncio.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f'failed: {v} {t!r}')


async def main():
    OUT.mkdir(exist_ok=True)
    texts = spoken_texts()
    jobs = [(v, r, t) for v, t in texts for r in RATES]
    index = {f'{v}{r}|{t}': name_for(v, r, t) for v, r, t in jobs}
    todo = [(v, r, t, OUT / index[f'{v}{r}|{t}']) for v, r, t in jobs if not (OUT / index[f'{v}{r}|{t}']).exists()]
    print(f'{len(jobs)} clips, {len(todo)} to record')
    sem = asyncio.Semaphore(6)
    await asyncio.gather(*(record(v, r, t, p, sem) for v, r, t, p in todo))
    keep = set(index.values())
    for f in OUT.glob('*.mp3'):
        if f.name not in keep:
            f.unlink()
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=0, sort_keys=True), encoding='utf-8')
    print('done:', len(keep), 'files')


if __name__ == '__main__':
    asyncio.run(main())
