# Gemini Voice Reader Everywhere

**Unofficial open source Gemini voice reader for Chrome and Brave.** Select text on any website and listen to it with the same web read aloud voice used by Gemini. No API key, no subscription, and no backend server.

This project is for people searching for a Gemini text to speech extension, a read aloud selected text tool, or a Brave Chrome TTS reader with a proper audio player.

> **v2.3.1:** A to B loop now repeats the full clip by default. Drag the markers inward only when you want a shorter phrase.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4.svg)](manifest.json)
[![Chrome and Brave](https://img.shields.io/badge/browsers-Chrome%20%7C%20Brave-4285F4.svg)](#install)
[![No API key](https://img.shields.io/badge/setup-No%20API%20Key-green.svg)](#faq)

---

## Why this extension

Most browser read aloud tools use the robotic built in browser voice. This extension calls Gemini's own read aloud endpoint, so the audio is the natural Gemini web voice you hear when you press Listen inside Gemini.

Unlike a simple play button, it gives you a full reading system:

- Follow along highlight on the page, sentence by sentence
- A to B loop markers you can drag over any phrase
- Study mode that repeats each sentence twice
- Dialogue mode that alternates accents for conversation
- Smart cleanup before sending text to Gemini
- Download the current clip and replay recent reads
- Sleep timer for hands free listening
- Optional named voices with an official API key

---

## Features

| Feature | Details |
|---|---|
| Gemini web voice | Uses the internal `XqA3Ic` read aloud RPC with your logged in Gemini session |
| Named voices | Optional official Gemini TTS API mode with Kore, Puck, Charon, and more |
| Works across the web | Highlight text on any normal `http(s)` page, not only on Gemini |
| Follow mode | Highlights the sentence being read without changing the page DOM |
| A to B loop | Drag two markers on the timeline to repeat any phrase |
| Study mode | Repeats each sentence twice with a short reset |
| Dialogue mode | Alternates accents for a more conversational read |
| Smart cleanup | Removes URLs, citations, markdown symbols, and extra spaces before reading |
| Draggable player | Drag the `⋮⋮` handle, double click it to reset the saved position |
| Per second seeking | Timeline value is seconds, with a live current and total timer |
| Speed control | 0.5x, 0.75x, 1x, 1.25x, 1.5x, and 2x |
| Loop | Repeats the current clip, select one word first to loop that word |
| Read from here | Reads from the selected text to the end of the page or article |
| Download audio | Saves the current clip as Ogg or WAV |
| Recent reads | Keeps the last 20 clips locally for one click replay |
| Sleep timer | Stops playback after 5, 15, 30, or 60 minutes |
| Gapless chunks | Prefetches the next 4096 character chunk while the current one plays |
| Voice accents | US English, UK English, AU English, and IN English |
| Fallback voice | Uses browser `speechSynthesis` if the Gemini request fails |
| Local settings | Speed, voice, loop, modes, history, and widget position persist locally |

---

## Install

### Brave or Chrome, manual install

1. Download the latest ZIP from [Releases](https://github.com/malikad778/gemini-voice-reader/releases), or clone this repository.
2. Extract it into a folder.
3. Open `brave://extensions/` or `chrome://extensions/`.
4. Turn on **Developer mode** in the top right.
5. Click **Load unpacked** and select the extracted folder.
6. Sign in to [gemini.google.com](https://gemini.google.com) once in the same browser profile.
7. Refresh every tab where you want to use the extension. Content scripts are injected on page load.
8. Highlight text and click **Listen**.

For the most reliable setup, keep one refreshed Gemini tab open. The extension can relay the request through that tab when Brave blocks third party cookies for the background worker.

### Reload after an update

Open `brave://extensions/` or `chrome://extensions/`, click the reload icon on the card, then refresh your open tabs.

---

## How to use

| Action | How |
|---|---|
| Start reading | Select text, then click **Listen** |
| Pause or resume | Click **Pause**, then **Resume** |
| Seek | Drag the timeline, or use the `-5s` and `+5s` buttons |
| Loop | Click the loop icon while audio is loaded |
| Loop one word | Double click a word to select it, click **Listen**, then click loop |
| Loop any phrase | Click **AB**, then drag the A and B markers on the timeline |
| Highlight the current sentence | Turn on **Follow** in the Tools menu |
| Repeat each sentence | Turn on **Study** in the Tools menu |
| Use two accents | Turn on **Dialogue** in the Tools menu, then play |
| Change accent | Use the voice dropdown |
| Change speed | Click a speed pill, including **0.5x** |
| Read a long section | Use **From here** or **Article** in the Tools menu |
| Save the audio | Click the download icon, or **Download** in the Tools menu |
| Replay a previous clip | Open **Recent** in the Tools menu |
| Stop later | Click **5**, **15**, **30**, or **60** in the Tools menu |
| Move the widget | Drag the `⋮⋮` handle |
| Reset position | Double click the `⋮⋮` handle |
| Close the player | Click outside when nothing is selected, or press X |

The toolbar stays visible while playing, paused, and after playback finishes.

### Tools menu

All advanced actions are behind one small icon. There is no separate settings page.

- **Follow:** highlights the sentence being read on the page
- **Clean:** removes links, citations, markdown, and extra spaces before reading
- **Study:** repeats each sentence twice
- **Dialogue:** alternates accents for a conversational feel
- **API:** uses an official key for named voices
- **From here / Article:** reads from the selection to the end of the page or main article
- **Download / Recent:** saves audio and replays previous clips
- **Sleep:** stops after 5, 15, 30, or 60 minutes

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt Shift L` | Play or pause |
| `Alt Shift Left` | Back 5 seconds |
| `Alt Shift Right` | Forward 5 seconds |
| `Alt Shift F` | Toggle Follow |
| `Alt Shift C` | Toggle Clean |
| `Alt Shift T` | Toggle Study |
| `Alt Shift D` | Toggle Dialogue |
| `Alt Shift A` | Toggle A to B loop |
| `Alt Shift S` | Set a 15 minute sleep timer |
| `Alt Shift O` | Open or close Tools |

---

## FAQ

### Does this need an API key?

No. It reuses your existing Gemini web session by default. There is no Google AI Studio key and no billing setup. If you want named voices, you can optionally add your own key in the Tools menu.

### Is this an official Google extension?

No. This is an independent open source project. It is not affiliated with or endorsed by Google.

### Does it work when the Gemini tab is closed?

Sometimes. The background worker tries a direct request first. If Brave or Chrome blocks Gemini cookies for that request, an open Gemini tab is needed as a first party relay.

### Can I pick a male or female voice?

In the free web mode, not reliably. That RPC does not expose a named voice ID. The voice dropdown changes the request locale, which can change the accent and perceived voice. For named voices such as Kore, Puck, or Charon, turn on API mode in Tools and add your own Gemini API key.

### Can it read PDFs?

Not in the built in Chrome or Brave PDF viewer. Content scripts do not run inside that viewer. Copy the text into a normal webpage, or use a PDF.js based viewer.

### Does it work on `file://` pages?

Only after enabling **Allow access to file URLs** for the extension.

### Does it store my selected text?

No. Selected text is sent directly to Google under your signed in session. Speed, voice accent, modes, recent clips, and widget position are stored locally. If you enable API mode, your API key is also stored locally. Session tokens are kept in memory only and are not written to disk.

---

## How it works

```text
content.js -> background service worker -> Gemini batchexecute (XqA3Ic)
     ^                    |
     +---- base64 audio --+
```

1. `content.js` detects a selection and renders the floating player.
2. By default, the extension asks Gemini's internal `XqA3Ic` RPC for audio. In API mode it calls the official Gemini TTS endpoint with your key.
3. Gemini returns base64 audio, usually Ogg Opus in web mode and WAV in API mode.
4. The content script converts it to a Blob URL, which makes seeking work in Chromium.
5. On `gemini.google.com`, the content script can call the RPC directly. On other sites, the worker tries a direct call, then falls back to an open Gemini tab relay.
6. While audio plays, the next chunk is fetched in the background so long text plays without a gap.

Full technical details are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

---

## Permissions and privacy

| Permission | Why it is used |
|---|---|
| `storage` | Saves speed, voice accent, loop state, and widget position |
| `gemini.google.com` host access | Reads session tokens and calls the read aloud RPC |
| `<all_urls>` content script | Shows the reader on any normal webpage |

There is no analytics, telemetry, tracking, or external server. Selected text goes only to Google's Gemini endpoint under your own session. If API mode is enabled, text goes to the official Gemini API with your key. Treat this extension like pasting text into Gemini.

Because this uses an undocumented internal endpoint, Google may change it at any time. Use this project for research and personal productivity, and review your own terms of service obligations before deploying it widely.

---

## Limitations

- Voice choice is locale and accent based, not named voice based.
- Word level looping works only when you select the word first. The RPC returns no word timestamps.
- Loop repeats the current 4096 character chunk, not the whole long selection.
- Cross origin iframes, text inputs, some shadow DOM selections, and `user-select: none` text may not trigger the widget.
- Built in PDF viewer, `chrome://`, Brave internal pages, and Chrome Web Store pages are not supported.
- Safari is not a target because Ogg Opus support is inconsistent.
- Cookie blocking can prevent the no tab path.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Session not found | Open `gemini.google.com`, sign in, refresh that tab, then retry |
| No widget after install | Reload the extension and refresh the page |
| Audio blocked by browser | Click **Resume** after a user gesture |
| Accent change did nothing | Some locales may map to the same voice for your account |
| No audio on other sites | Keep a Gemini tab open so the relay can run with first party cookies |
| Audio will not seek | Reload the extension and retry, the player uses Blob URLs for seeking |

---

## Development

The extension is plain JavaScript, CSS, and a Manifest V3 service worker. There is no build step.

```text
manifest.json    extension metadata and permissions
background.js    token extraction, RPC call, tab relay
content.js       selection UI, audio player, seeking, loop, drag
styles.css       scoped widget styles
docs/PROTOCOL.md reverse engineering notes
```

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Author

**Adnan Haider**

GitHub: [malikad778](https://github.com/malikad778)  
Website: [codebyadnan.tech](https://codebyadnan.tech)

---

## License

[MIT](LICENSE). Use it, fork it, and improve it.
