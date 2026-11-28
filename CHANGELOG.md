# Changelog

## 2.3.1

- Fixed A to B loop so clicking AB repeats the full clip by default.
- A to B can now be enabled before audio starts and automatically covers the loaded clip.
- The ended event now restarts a full range loop instead of finishing playback.

## 2.3.0

- Added Follow mode, which highlights the sentence currently being read without changing page DOM.
- Added A to B loop markers that can be dragged anywhere on the timeline.
- Added smart text cleanup for links, citations, markdown, emoji symbols, and extra spaces.
- Added gapless long reading by prefetching the next chunk while the current one plays.
- Added Read from here and Article actions for long pages.
- Added Download audio for the current clip.
- Added local Recent reads history with one click replay.
- Added Study mode, which repeats each sentence twice.
- Added Dialogue mode, which alternates accents for a conversational feel.
- Added a sleep timer with 5, 15, 30, and 60 minute options.
- Added keyboard shortcuts for play, pause, seek, modes, and tools.
- Added optional official Gemini API mode with named voices such as Kore, Puck, and Charon.
- All advanced actions live behind one small Tools button, not a settings panel.

## 2.2.1

- The player now stays open when playback finishes.
- Playback completion restores the Listen button and keeps the text ready for replay.
- Clicking inside the player no longer counts as an outside click.
- The toolbar still hides when you click outside with no selected text, or when you press X.

## 2.2.0

- Added draggable widget with saved position and double click reset.
- Added loop control and single word looping by selecting a word first.
- Added 0.5x speed and the full speed row.
- Added per second seeking with a wide timeline and live timer.
- Added voice accent selector for US, UK, AU, and IN English.
- Added automatic chunking for selections over 4096 characters.
- Replaced the data URI audio source with a Blob URL so seeking works.
- Added tab relay fallback for browser cookie restrictions.
