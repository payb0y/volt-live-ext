# Privacy Policy — Volt Live

_Last updated: 2026-07-01_

Volt Live is a companion extension for the Volt web app (`voltstreaming.xyz`). It
exists to fetch live TV streams that the Volt page asks for and hand the bytes back
to the page for playback.

## What data the extension handles

- **Stream URLs** supplied by the Volt page at runtime, and the **video bytes** it
  fetches from them. These are held only in memory for the duration of playback and
  streamed straight to the page. Nothing is written to disk.
- **Per-tab status** (current channel name, byte count, last HTTP status) kept only
  in memory, only to render the extension's popup. It is discarded when the tab
  closes or the extension's background worker sleeps.

## What the extension does NOT do

- It does **not** collect, store, or transmit any personal information.
- It does **not** contain or store any credentials, usernames, passwords, or panel
  addresses. The Volt app supplies stream URLs at request time.
- It does **not** send any data to the developer or any third party. The only network
  requests it makes are to the stream URLs the Volt page provides.
- It does **not** read the content of any web page, run on any site other than the
  Volt app, or track your browsing.
- It uses **no** analytics, telemetry, cookies, or advertising.

## Permissions

Broad host access is requested as an **optional** permission that you grant from the
extension's popup on first use. It is used solely to fetch the stream URLs the Volt
page hands the extension (the panel redirects live streams to rotating CDN hosts, so
a fixed list can't be used). You can revoke it at any time from
`chrome://extensions` → Volt Live → Details → Site access.

## Source

The extension is open source and MIT licensed. The published code is exactly what is
distributed: https://github.com/payb0y/volt-live-ext

## Contact

Questions: othmanegat@gmail.com
