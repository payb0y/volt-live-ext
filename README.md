# Volt Live

A tiny browser extension that lets the Volt web app (`voltstreaming.xyz`) play its
live TV channels. Channels come from an HTTP-only IPTV panel; an HTTPS page can't
fetch HTTP media (mixed content). This extension streams the feed in its own
background context and hands the bytes to the page, which plays them with mpegts.js.
The page never makes an HTTP request.

## Does / does not

- **Does:** stream the video the Volt page asks for, over your own connection, and
  relay the bytes back.
- **Does not:** store credentials, run on any site other than Volt, read other tabs,
  or talk to any server other than the panel the page points it at.

## Permissions

`host_permissions: http://*/*, https://*/*` — the panel redirects live streams to
rotating CDN IPs, so a fixed host can't be listed. The extension only fetches URLs
the Volt page hands it, and the content-script bridge is origin-locked to Volt.

## No credentials

The extension contains no username/password and no panel address. The Volt app
supplies stream URLs at runtime. This source is exactly what ships.

MIT licensed.
