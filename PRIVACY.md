# Privacy

Gemini Voice Reader Everywhere has no analytics, telemetry, tracking, advertising, or external server.

## Data sent to Google

When you click Listen, the selected text is sent to Google's Gemini endpoint under your signed in Gemini web session. Only send text that you would be comfortable pasting into Gemini.

## Data stored locally

The extension stores these values in browser local storage:

- Playback speed
- Voice accent
- Loop state
- Widget position

Gemini session tokens are kept in memory only. They are not written to disk by this extension.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Saves the four local settings listed above |
| `gemini.google.com` host access | Reads session tokens and calls the read aloud RPC |
| `<all_urls>` content script | Shows the widget on any normal webpage |

## Audio handling

Gemini returns base64 audio. The extension converts it into a Blob URL in the current page, plays it, and revokes the URL when playback is stopped or replaced.

## Your responsibility

This is an unofficial project that uses an internal endpoint. Review your own terms of service obligations before using it in a work or managed environment.
