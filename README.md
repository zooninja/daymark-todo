# Daymark

A single-page, local-first to-do app with due dates, filters, editable task groups, and a stealth-dark theme. The app runs without a server or dependencies; its installable version is hosted on GitHub Pages.

## Install on Android

1. Open [Daymark](https://zooninja.github.io/daymark-todo/) in Chrome on your Android device. The first Pages deployment may take a few minutes to become available.
2. Tap **Install app** if it appears, or open Chrome's **⋮** menu and choose **Install app** (or **Add to Home screen**).
3. Confirm the install, then launch Daymark from your home screen or app drawer.

Open the site once while online so its app files can be cached for offline use. Your tasks and groups are stored in that browser on that device; they do not sync between devices. Clearing the browser's site data will remove them.

## Run locally

Open `index.html` in a browser. Local mode supports task management and browser storage; service-worker offline caching and Android installation require the HTTPS GitHub Pages site.

## Project files

- `index.html` — app markup, styles, and task management
- `manifest.webmanifest` — install name, display mode, and icons
- `sw.js` — offline app-shell cache
- `icons/` — Android and browser app icons
