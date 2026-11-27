# Gemini Web TTS Protocol Notes

Unofficial reverse engineering notes for the Gemini web read aloud RPC used by Gemini Voice Reader Everywhere.

> This project is not affiliated with Google. The endpoint below is internal and can change without notice. Review your own terms of service obligations before using it.

---

## 1. Endpoint

```http
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
  ?rpcids=XqA3Ic
  &source-path=%2Fapp
  &bl=<build label>
  &f.sid=<session id, may be empty>
  &hl=<UI language>
  &_reqid=<integer>
  &rt=c
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
X-Same-Domain: 1
Cookie: <gemini.google.com cookies>
```

`XqA3Ic` is the RPC used by the Listen or read aloud action in Gemini Web. It is different from the chat `StreamGenerate` RPC.

---

## 2. Request body

The URL encoded form has two fields:

```text
f.req = [[["XqA3Ic","<JSON string>",null,"generic"]]]
at    = <SNlM0e token>
```

The inner JSON string is a five element array:

```json
[null, "Text to read", "en-US", null, 2]
```

| Index | Meaning | Notes |
|---|---|---|
| 0 | `null` | Always null in public implementations |
| 1 | text | Trimmed, maximum 4096 characters per request |
| 2 | locale | BCP 47 value such as `en-US`, `en-GB`, `en-AU`, `en-IN` |
| 3 | `null` | Unknown. Possible voice ID slot, but no public implementation sets it |
| 4 | format | `1` = MP3, `2` = Ogg Opus used by the Gemini web player |

Slot 4 is the audio container, not the voice. Locale in slot 2 is the only verified way to influence the voice.

---

## 3. Session tokens

Fetch `https://gemini.google.com/app` with cookies and extract these values from the HTML:

| Token | Purpose | Typical key |
|---|---|---|
| `SNlM0e` | XSRF token sent as `at` | `"SNlM0e":"..."` |
| `cfb2h` | Build label sent as `bl` | `"cfb2h":"boq_assistant-bard-web-server_..."` |
| `FdrFJe` | Session id sent as `f.sid` | `"FdrFJe":"..."` |

Public clients use regexes that tolerate escaped JSON:

```js
const atMatch   = html.match(/SNlM0e\\?":\\?"([^"\\]+)/);
const blMatch   = html.match(/cfb2h\\?":\\?"([^"\\]+)/) ||
                  html.match(/boq_assistant-bard-web-server_[A-Za-z0-9_.-]+/);
const fsidMatch = html.match(/FdrFJe\\?":\\?"([\d-]+)/);
```

`f.sid` may be empty. The `at` token must match the signed in session.

---

## 4. Response

Google returns the batchexecute anti XSSI format:

```text
)]}'

[["wrb.fr","XqA3Ic","[\"<BASE64_AUDIO>\"]",null,null,null,"generic"]]
```

Parsing steps:

1. Strip the leading `)]}'` and whitespace.
2. Split by newline and find the first line that parses as a JSON array starting with `[[`.
3. Find the row where `row[0] === "wrb.fr"` and `row[1] === "XqA3Ic"`.
4. Parse `row[2]` to get `[base64Audio]`.
5. Decode the base64 string. It is usually Ogg Opus with the `OggS` magic bytes.

An HTML response or HTTP 401 or 403 means the session expired. Clear the token cache and retry once after the user signs in again.

---

## 5. Why a Blob URL is required

Chromium does not reliably seek on an audio source that uses a `data:` URI. The base64 payload is converted to bytes, wrapped in a `Blob` with type `audio/ogg`, and played through `URL.createObjectURL(blob)`. This makes the scrubber, the 5 second jumps, and pause or resume work.

---

## 6. Voice behavior

The RPC has no verified named voice ID parameter.

- Locale chooses the language and accent. Gemini chooses the actual voice.
- `en-US`, `en-GB`, `en-AU`, and `en-IN` may produce different accents or voices, depending on the account and rollout.
- Names such as Kore, Puck, or Charon cannot be requested reliably through this RPC.
- For named voices, use the official Gemini TTS API or Google Cloud TTS with an API key.
- Browser `speechSynthesis` is used only as a fallback and is not Gemini's voice.

---

## 7. Architecture

```text
content.js, every normal tab
  - selection detection
  - floating player UI
  - Blob audio and seeking
  - direct RPC on Gemini pages

background.js, MV3 service worker
  - token extraction
  - XqA3Ic RPC
  - tab relay fallback

Gemini tab content script
  - same origin token extraction
  - same origin fetch
  - base64 audio response
```

On `gemini.google.com`, `content.js` tries a direct fetch first. On other sites, the worker tries a direct fetch with cookies. If Brave blocks those cookies, the worker relays the request through an open Gemini tab, which uses first party cookies.

---

## 8. Known constraints

- 4096 characters per request, with automatic chunking in the extension.
- No word timestamps, so arbitrary word looping inside a long clip is not available.
- Loop repeats the current chunk.
- Built in PDF viewer, `chrome://`, Brave internal pages, and Chrome Web Store pages are not supported.
- Cross origin iframes, inputs, and some shadow DOM selections need separate handling.
- Cookie policy can disable the no tab path.
- Google can change token names, the build label, the response shape, or add attestation at any time.

---

## 9. Public references

These projects independently document or use the same `XqA3Ic` read aloud contract:

- [Mag1cFall/Gemini-Web2API](https://github.com/Mag1cFall/Gemini-Web2API)
- [xtekky/gpt4free](https://github.com/xtekky/gpt4free)
- [dsdanielpark/Bard-API](https://github.com/dsdanielpark/Bard-API)
- [yeahhe365/Gemini-Nexus](https://github.com/yeahhe365/Gemini-Nexus)

All references are external and unaffiliated with this project.
