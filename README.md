# Working Drawings

A presentation for the Scientific Committee of the Meertens Instituut: what eleven
experiments with Claude say about the Meertens collections. Drawn in pencil on a
drafting table.

Open `index.html` in Chrome (double-click works, no server or network needed), or run
`./serve.sh` and go to <http://localhost:5050/>. Press `F` for full screen.

## The story (eleven sheets)

1. **Cover**: the eleven drawings in a row.
2. **Two conversations**: the team leaders on AI for research, and the Data & Collections
   plan on access for a general audience. Our director suggested a cabinet of curiosities.
3. **The day after**: Museum Meertensianum, the director's metaphor built the next day. It
   is not the front door, but it started the conversation. The print frame loops a 36-second
   walk through the room in graphite. Press ↵ to lay it out as a large print on the page,
   with a pencil timeline. Press ↵ again (or use *Go in live*) to enter the real app, and
   Esc to put the print back.
4. **Experiments**: a contact sheet of eight explorations, each labelled with what kind of
   thing it shows (renew, new question, then and now, step inside, explain, play). Click one
   to open it live.
5. **Attempt 1 · Atlas van het Alledaagse**, compared with the cabinet, and 6. **Attempt 2 ·
   Wat bewaart het Meertens**, and why it beats the other routes in. Both are drawn firmer,
   in Meertens red.
7. **Hours, not years**: hours of conversation per app, from the Claude Code logs. Judge
   the apps by what they make visible, not by how hard they were to build. Spindle took
   six months in 2015.
8. **What is scarce**: Lincoln Mullen's two lines (*Behind, ahead*, March 2026), the shift
   from problem solving to problem setting, and three choices that took knowing the
   collection: which databank needs a new face, which question the data can't answer
   alone, which idea deserves a wider audience.
9. **Data is the interface**: given the data, anyone can now build their own perspective;
   the databank becomes the foundation others interpret from. Op 't Water was quick because
   the data had been collected by hand around 2019. People will scrape anyway, so
   better to hand the data over ourselves. The ring shows where each app got its data
   (solid line: dump, export or download; dashed: scraped or parsed).
10. **For the plan**: three proposals: databanks as foundations, FAIR data (starting with
    the catalogue), and an API rather than only rate limits.
11. **Thank you**: two questions for discussion: judging digital work, and extraction
    versus FAIR data.

After that comes an **appendix** (`A`): all eleven apps, with one plate each. Each plate
shows the data route and the build time.

## Sharing the deck

The deck is online at <https://www.karsdorp.io/working-drawings/> (GitHub Pages, repo
`fbkarsdorp/working-drawings`, served from `main`). To update it: commit and push; the page
follows within a minute or two. The cover and the last sheet carry a taped card with a
QR code for that address. If the address ever changes, update `share` in `js/content.js`,
including the QR rows (`segno.make(url, error="q")`).

The deck is made for a laptop. On a phone-sized screen it first shows a note with a
*Send me the link* button (the share sheet, so AirDrop or messages work; email where sharing
isn't available) and a *Show it here anyway* link.

Opened from a public address, the deck does not probe `localhost` (that would trigger the
browser's local-network prompt), so the three local apps play their demos. Opened from this
laptop, or with `?live` added to the URL, it checks and opens running apps live.


The deck is static and runs from any web server or from the file itself. Three apps stay
on the presenter's laptop: the Liederenbank and Dwaallicht hold full copies of their
databanks, and Wat bewaart het Meertens is built from those same local copies. Each has a
recorded demo in `shots/*-demo.mp4`. When one of them does not answer, its box plays the
demo with the note "the app runs on the presenter's laptop"; when it is running, it opens
live as before.

## Keys

A small legend at the bottom right of every sheet shows the main keys and can be clicked
(← → · L · A · H). For visitors it stays in view until they turn the first sheet; when
presenting from this laptop it fades after a few seconds and only returns when the mouse
moves. H opens a key card in the current language.

| | |
|---|---|
| → ␣ PgDn / ← PgUp | next / previous (clickers work) |
| ↵ | lay the app out live on the page, in a large pencil frame · ↵ again (or F) for full screen · ⇧↵ opens it in a new tab |
| *Back to the page* (under the frame) | put the app away. Once you click into an app, it has the keyboard, so use the buttons; in full screen, use *Back onto the page* at the top |
| A | appendix: all eleven; press again to go back |
| 1–9 · 0 | app 1–9 in the appendix · cover |
| L | English / Nederlands |
| H | key card, plus a live check of which apps are running |

The localhost apps must be running live: Liederenbank on 8100, Dwaallicht on 8765 and
Wat bewaart het Meertens on 5191. Check with `H`. Atlas and Kattenstaart & Pispot are online.

## About the numbers

The hours count conversation time in the Claude Code session logs. Pauses longer than
15 minutes are left out, and Claude often worked alone during the counted time.
Dwaallicht and Wat bewaart het Meertens are not in the logs. Nachtdienst also builds on
36.5 h spent on its 3D predecessor. The quotes on *What is scarce* are verbatim prompts
from those logs. The data routes were read from each project's README and pipeline.

## The walk-through clip

`shots/museum-walk.mp4` was recorded from the Museum's dev server (port 5191), using its
`__debug` hook and its own guided tour. It shows the intro, entering the depot, the
avenue, the listening wall with a recording, an open depot rack, the Familienamenbank
hologram, and the headset with the 1690 cabinet. To re-record after changes to the
Museum, ask Claude, or reuse the screencast approach: Chrome DevTools frames encoded
with ffmpeg.

## Editing

- All text, numbers, URLs and screenshots are in `js/content.js` (both languages).
- `objects.html?ink=paper` is a proof sheet of the drawn objects.
- The engine (`js/mesh.js`, `js/ink.js`, `js/type.js`) uses Meertens red (#C8223F) as its accent and for the grid; set `window.GRID = "blue"` before the scripts for a blue grid. It still supports the blueprint and
  hologram inks, but the deck uses paper only.
