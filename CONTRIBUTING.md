# Contributing

Thanks for helping improve Gemini Voice Reader Everywhere.

## Before you start

- Search existing issues first.
- Keep changes focused on one problem.
- Do not commit cookies, tokens, API keys, or live session data.
- Avoid adding analytics or network calls to third parties.

## Local setup

1. Fork the repository.
2. Clone your fork.
3. Create a branch from `main`.
4. Open `chrome://extensions/` or `brave://extensions/`.
5. Enable Developer mode.
6. Click Load unpacked and select the repository folder.
7. Reload the extension after each code change.
8. Refresh the tabs you are testing. There is no build step.

## Testing checklist

- Select text on a normal webpage and confirm the widget appears.
- Play, pause, and resume audio.
- Drag the timeline and confirm the time updates.
- Test `-5s` and `+5s`.
- Test loop on a single selected word.
- Test 0.5x and the other speed pills.
- Change voice accent and confirm the clip regenerates.
- Drag the widget, reload the page, and confirm the position persists.
- Double click the drag handle and confirm the position resets.
- Confirm the widget stays after playback ends and hides after an outside click.

## Pull requests

Explain what changed, why it changed, and how you tested it. Add screenshots for visible UI changes.

By contributing, you agree that your contribution is licensed under the MIT License.
