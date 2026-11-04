"""Render the Working Drawings reel.

    uv run -q --with playwright --with numpy --with scipy python reel/render.py [--frames a,b,c]

Needs Chrome and ffmpeg. Serves the deck folder on a free local port, extracts the stretches of
the recorded demos the reel shows as JPEG frames (reel/.frames, not committed), renders the 600
frames of reel/index.html (20 s at 30 fps, 1920x1080, motion blur computed in the page),
synthesises the sound from the page's cue list (sound.py) and writes:

    reel/working-drawings-reel.mp4          picture and sound
    reel/working-drawings-reel-silent.mp4   picture only
    reel/working-drawings-reel-small.mp4    picture and sound, smaller file for sharing

With --frames, only those times (seconds) are rendered as PNGs into reel/.frames/probe.
"""
import asyncio
import functools
import http.server
import json
import pathlib
import shutil
import socketserver
import subprocess
import sys
import threading

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
REEL = ROOT / "reel"
FRAMES = REEL / ".frames"
FPS, DUR = 30, 20
# clip and start (s); keep in step with VIDEOS in index.html. 4 s of source per clip.
CLIPS = {"museum": ("museum-walk.mp4", 9.0), "liederenbank": ("liederenbank-demo.mp4", 20.5),
         "dwaallicht": ("dwaallicht-demo.mp4", 16.0), "vraag": ("vraag-demo.mp4", 12.5)}


def ff(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *map(str, args)], check=True)


def extract():
    for name, (clip, start) in CLIPS.items():
        d = FRAMES / name
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        ff("-ss", start, "-i", ROOT / "shots" / clip, "-t", 4, "-vf", f"fps={FPS},scale=1600:-2", "-q:v", 3, d / "%03d.jpg")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def render(port, times, out):
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome")
        pg = await b.new_page(viewport={"width": 1920, "height": 1080})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(f"http://127.0.0.1:{port}/reel/")
        await pg.evaluate("ready")
        events = await pg.evaluate("EVENTS")
        canvas = pg.locator("#c")
        for k, t in enumerate(times):
            await pg.evaluate(f"renderFrame({t})")
            name = f"{k:04d}.png" if len(times) == FPS * DUR else f"t{t:05.2f}.png"
            await canvas.screenshot(path=str(out / name))
            if len(times) == FPS * DUR and k % 60 == 0:
                print(f"frame {k}/{len(times)}", flush=True)
        await b.close()
    if errors:
        raise SystemExit("page errors: " + "; ".join(errors[:5]))
    return events


def main():
    probe = sys.argv[sys.argv.index("--frames") + 1] if "--frames" in sys.argv else None
    if not (FRAMES / "vraag" / "120.jpg").exists() or not probe:
        extract()
    httpd = serve()
    try:
        if probe:
            asyncio.run(render(httpd.server_address[1], [float(x) for x in probe.split(",")], FRAMES / "probe"))
            print("probes in", FRAMES / "probe")
            return
        frames = FRAMES / "out"
        events = asyncio.run(render(httpd.server_address[1], [f / FPS for f in range(FPS * DUR)], frames))
    finally:
        httpd.shutdown()
    (FRAMES / "events.json").write_text(json.dumps(events))
    sys.path.insert(0, str(REEL))
    import sound
    wav = sound.synth(events, str(FRAMES / "reel.wav"))
    silent = REEL / "working-drawings-reel-silent.mp4"
    ff("-framerate", FPS, "-i", frames / "%04d.png", "-c:v", "libx264", "-preset", "slow", "-crf", 16,
       "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent)
    ff("-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "224k", "-shortest", "-movflags", "+faststart",
       REEL / "working-drawings-reel.mp4")
    ff("-i", REEL / "working-drawings-reel.mp4", "-c:v", "libx264", "-preset", "slow", "-crf", 28,
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", REEL / "working-drawings-reel-small.mp4")
    print("wrote", REEL / "working-drawings-reel.mp4")


if __name__ == "__main__":
    main()
