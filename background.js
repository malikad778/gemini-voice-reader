const TTS_RPC_ID = 'XqA3Ic';
const MAX_TTS_CHARS = 4096;
const TOKEN_TTL_MS = 30 * 60 * 1000;

let cachedTokens = null;
let cachedTokensAt = 0;
let inflightTokenFetch = null;

// ---------------------------------------------------------------------------
// 1. Read the logged-in Gemini web session
// ---------------------------------------------------------------------------

async function getGeminiTokens(forceRefresh = false) {
  if (!forceRefresh && cachedTokens && Date.now() - cachedTokensAt < TOKEN_TTL_MS) {
    return cachedTokens;
  }

  if (inflightTokenFetch) return inflightTokenFetch;

  inflightTokenFetch = (async () => {
    try {
      const response = await fetch('https://gemini.google.com/app', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load Gemini session (HTTP ${response.status})`);
      }

      const html = await response.text();

      // Works for both plain JSON and escaped JSON embedded in script tags.
      const atMatch = html.match(/SNlM0e\\?":\\?"([^"\\]+)/);
      const blMatch =
        html.match(/cfb2h\\?":\\?"([^"\\]+)/) ||
        html.match(/boq_assistant-bard-web-server_[A-Za-z0-9_.-]+/);
      const fsidMatch = html.match(/FdrFJe\\?":\\?"([\d-]+)/);
      const localeMatch = html.match(/<html[^>]*\slang="([^"]+)"/);

      if (!atMatch || !blMatch) {
        throw new Error(
          'Not signed in to gemini.google.com. Open Gemini and sign in once, then retry.'
        );
      }

      cachedTokens = {
        atValue: atMatch[1],
        blValue: blMatch[1] || blMatch[0],
        fSid: fsidMatch ? fsidMatch[1] : '',
        locale: localeMatch ? localeMatch[1] : 'en-US'
      };
      cachedTokensAt = Date.now();
      return cachedTokens;
    } finally {
      inflightTokenFetch = null;
    }
  })();

  return inflightTokenFetch;
}

// ---------------------------------------------------------------------------
// 2. Call Gemini's internal read-aloud RPC (XqA3Ic)
// ---------------------------------------------------------------------------

async function fetchGeminiTtsDirect(text, locale, retryOnAuthFail = true) {
  const tokens = await getGeminiTokens();
  const targetLocale = locale || tokens.locale || 'en-US';
  const hl = tokens.locale || 'en';

  const endpoint =
    `https://gemini.google.com/_/BardChatUi/data/batchexecute` +
    `?rpcids=${TTS_RPC_ID}&source-path=%2Fapp` +
    `&bl=${encodeURIComponent(tokens.blValue)}` +
    `&f.sid=${encodeURIComponent(tokens.fSid)}` +
    `&hl=${encodeURIComponent(hl)}` +
    `&_reqid=${Date.now() % 1000000}&rt=c`;

  // [null, text, language, unknown, format]
  // format: 1 = 24 kHz mono MP3, 2 = Ogg Opus (used by the Gemini web player).
  const requestMessage = [null, text.trim(), targetLocale, null, 2];
  const rpcPayload = [[[TTS_RPC_ID, JSON.stringify(requestMessage), null, 'generic']]];

  const body = new URLSearchParams({
    'f.req': JSON.stringify(rpcPayload),
    at: tokens.atValue
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Same-Domain': '1'
    },
    body: body.toString()
  });

  if (!response.ok) {
    if (retryOnAuthFail && (response.status === 401 || response.status === 403)) {
      cachedTokens = null;
      cachedTokensAt = 0;
      return fetchGeminiTtsDirect(text, locale, false);
    }
    throw new Error(`Gemini TTS returned HTTP ${response.status}`);
  }

  const responseText = await response.text();

  if (/^\s*<!DOCTYPE html>/i.test(responseText)) {
    if (retryOnAuthFail) {
      cachedTokens = null;
      cachedTokensAt = 0;
      return fetchGeminiTtsDirect(text, locale, false);
    }
    throw new Error('Gemini session expired. Open gemini.google.com and sign in again.');
  }

  const cleaned = responseText.replace(/^\)\]\}'\s*/, '');
  let rows = null;

  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        rows = parsed;
        break;
      }
    } catch (err) {
      /* keep looking for the JSON line */
    }
  }

  if (!rows) {
    throw new Error('Gemini TTS response did not contain a batch payload');
  }

  const ttsRow = rows.find((row) => row && row[0] === 'wrb.fr' && row[1] === TTS_RPC_ID);
  if (!ttsRow || typeof ttsRow[2] !== 'string') {
    throw new Error('Gemini TTS audio data not found in response');
  }

  const payload = JSON.parse(ttsRow[2]);
  const audioBase64 = payload && payload[0];
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new Error('Gemini TTS returned empty audio data');
  }

  return audioBase64;
}

// ---------------------------------------------------------------------------
// 3. Fallback: relay through an open Gemini tab
//
// Brave/Chrome can refuse to send third-party cookies from the service worker.
// An open Gemini tab is first-party, so asking its content script to perform
// the fetch is much more reliable. This is also why keeping a Gemini tab open
// is currently the most robust setup.
// ---------------------------------------------------------------------------

async function fetchViaGeminiTab(text, locale) {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') return null;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  } catch (err) {
    return null;
  }

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          tab.id,
          { action: 'GEMINI_TTS_IN_PAGE', text, locale },
          (message) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(message);
          }
        );
      });

      if (response && response.success && response.audioBase64) {
        return response.audioBase64;
      }
    } catch (err) {
      /* try the next Gemini tab */
    }
  }

  return null;
}

async function fetchGeminiTts(text, locale) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('No text to read');
  if (trimmed.length > MAX_TTS_CHARS) {
    throw new Error(`Text exceeds the ${MAX_TTS_CHARS}-character Gemini TTS limit`);
  }

  try {
    return await fetchGeminiTtsDirect(trimmed, locale);
  } catch (directError) {
    const relayed = await fetchViaGeminiTab(trimmed, locale);
    if (relayed) return relayed;
    throw directError;
  }
}

// ---------------------------------------------------------------------------
// 4. Message bridge for every content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.action !== 'GEMINI_TTS') return false;

  fetchGeminiTts(request.text, request.locale)
    .then((audioBase64) => {
      sendResponse({ success: true, audioBase64 });
    })
    .catch((error) => {
      sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
    });

  return true; // keep the message channel open for the async response
});
