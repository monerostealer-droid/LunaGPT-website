# LunaGPT · Your own space to think

A responsive HTML, CSS and JavaScript client for LunaServer, with streamed replies, local conversation storage, six lunar themes and a mobile-friendly interface.

## Public source / local configuration

This repository contains only the website. It includes no model weights, native iPhone app, server implementation or server password. The owner's local copy has private auto-login configured; a fresh checkout does not.

To use this checkout, copy `private-config.example.js` to `private-config.js`. Leave its password empty to sign in through the interface, or configure your own password locally. The configured file is ignored by Git. Keep it out of public hosting and commits.

## Open the app

Double-click **index.html** on your PC. No CMD file, Python process or local web server is needed to open the interface. Keep the folder together: the page loads `luna.js`, `style.css`, `polish.css`, `assets/logo.png` and `private-config.js` alongside it.

When a private password is configured in `private-config.js`, the app connects automatically. Otherwise, it opens the sign-in screen. It discovers the tunnel address through the configured GitHub connection repository and uses LunaServer. LunaServer itself must still be running. The private configuration is excluded from Git and service-worker caching. Passwords are not included in conversation exports.

`Start_LunaGPT.cmd` is now only an optional HTTP preview. Direct file opening and `http://localhost:8788` use separate browser storage. Export and import conversations to move between them. Keep using the same file location and browser profile for consistent local storage.

## iPhone

The responsive interface works in modern Safari. iOS Files/Quick Look may treat a local HTML file as a document preview rather than a JavaScript-enabled browser app. Direct file opening is verified on desktop browsers, not guaranteed from Files on an iPhone. Use a Safari-accessible web address for the full iPhone experience. Microphone access and Home Screen/offline installation depend on browser support and a secure web context. Public hosting must use an empty private configuration and the sign-in screen, not a bundled server password.

## Same conversation protocol as the native app

The frontend sends the same JSON fields as `minigpt_app/lib/inference/engine.dart`: `cmd`, plain `text`, optional `turns`, `temperature`, `top_k` and `top_p`. Each history turn uses `role` and `text`.

Do not manually wrap messages in `<|user|>` and `<|assistant|>` in the frontend. LunaServer's `ContextWindow` already inserts the native tokenizer's BOS, USER, EOT and ASSISTANT IDs. A single prompt is encoded as BOS + USER + your text + EOT + ASSISTANT. This is exactly the path the phone app uses; adding literal tags in the frontend would wrap the message twice.

Short-term memory follows `shortTermMemoryTurns` in the phone app: trim and skip empty messages, remember the latest user message, pair it with the next nonempty assistant message, then append the new user message. Nonempty stopped replies are included, just as in the native helper. LunaServer fits complete rounds into the selected model's context budget.

Defaults:

- Short-term memory: **on**
- Temperature: **0.7**
- Top-p: **0.9**
- Top-k: **40**

The update applies these defaults once to existing installations. Later changes are saved and restored. Appearance, text size, motion, haptics, deletion confirmation, sampling and voice settings are persistent.

## Chats, code and motion

Conversations, drafts, current conversation and settings are saved in IndexedDB in this browser. Export backups before clearing browser data, moving the folder or switching addresses/devices. Existing iPhone chats are not automatically synced.

Fenced code blocks preserve whitespace and show the exact language label (`python`, `text`, `javascript`, or another name). Python syntax highlighting, copy buttons, headings, lists and inline formatting are supported. Streaming reuses existing code-block elements so their horizontal scroll position is not reset on each chunk.

Circular moon rings, orbiting light, breathing response indicators, message transitions and interactive controls use CSS animation. Motion pauses in background tabs and honours both Reduce motion and the system accessibility preference. Layouts adapt to mobile, desktop and on-screen keyboards.

Browser speech functions use device voices. They do not reproduce the native app's embedded voice model or Python runtime. Tool requests can accept a manually supplied result or be declined; declining stops the response, matching the server protocol.

## Development and tests

The editable modules are `core.js`, `storage.js`, `connection.js` and `app.js`. Run `python build.py` after changing them to rebuild the classic `luna.js` script used by `index.html`. No package installation is required.

If the server password changes, run `python build.py --configure-private` once to refresh the local private configuration from `luna_server/tilkobling.txt` without displaying the password.

- `npm test`: defaults, settings migration, native memory pairing, connection URLs, fenced code and backup validation.
- `python tests/browser_test.py`: local fixture integration tests with Chromium.
- `python tests/browser_test.py --browser webkit`: the same flow in WebKit. Offline navigation is checked in Chromium only because the Windows WebKit runner fails internally in simulated offline mode.
- `python tests/live_connection.py --file`: direct-file automatic login against the real server, default settings and persistence. Does not generate text or switch models. Also supports `--browser webkit`.

Playwright tests require the installed Playwright browsers. No physical iPhone testing has been performed.
