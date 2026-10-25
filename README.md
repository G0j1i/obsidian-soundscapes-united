# Obsidian Soundscapes

A plugin for Obsidian.MD that adds a music/ambiance player to the status bar to play Lofi beats, nature sounds, ambiance, relaxing music, and more.

![Screenshot of Obsidian Soundscapes player](screenshot1.png)

![Screenshot of Obsidian Soundscapes player](screenshot2.png)

## How to Install

Plugin can be [installed via the official community plugins](https://obsidian.md/plugins?id=soundscapes).

## How to Use

In the settings screen you can select which Soundscape you would like to play and whether or not it should play on launch of Obsidian. As pictured above, the player and it's controls are displayed in the status bar. Volume can be set and is remembered between launches of Obsidian.

![Settings screen](settings.png)

### Custom Soundscapes

A custom soundscape is a playlist of youtube links that you can customize to create your own ambiance. These are created within the settings screen. You can create as many custom soundscapes as you want and each custom soundscape can have as many tracks as you want.

Additionally, when listening to a custom soundscape, you can use the new "next" and "previous" buttons to switch tracks.

![Screenshot of custom soundscapes list](screenshot3.png)
![Screenshot of editing a custom soundscape](screenshot4.png)
![Screenshot of soundscapes player while playing a custom soundscape](image2.png)

### My Music - Local Music Library

The "My Music" soundscape allows you to have a full music player experience right within Obsidian using your local MP3 music files. Upon selecting your local music folder, the plugin will index your music and occasionally re-index it in the background.

My Music supports playing with the mini-player in the status bar as well as a new dedicated My Music view with a new icon on the Ribbon sidebar once the "My Music" soundscape is selected. You can close this view and the music will continue playing.

Within the My Music view, you can play, pause, next, previous, seek, shuffle, and search.

![Settings view with My Music selected](screenshot6.png)

## Requesting New Soundscapes

Have an idea for a new Soundscape? [Open an issue](https://github.com/andrewmcgivery/obsidian-soundscapes/issues/new) and link a Youtube video and why we should add it!

## External Resources

This plugin makes use of the Youtube IFrame API and includes that script as a result. Youtube videos are loaded in the background.

Additionally, the plugin makes a call to this github repository occasionally to check if there is a new version.

## Credits

-   [Lofi beats](https://www.youtube.com/watch?v=jfKfPfyJRdk)
-   [Spa atmosphere](https://www.youtube.com/watch?v=luxiL4SQVVE)
-   [The Sims complete soundtrack](https://www.youtube.com/watch?v=wKnkQdsITUE)
-   [Thunderstorm](https://www.youtube.com/watch?v=nDq6TstdEi8)
-   [Cozy fireplace](https://www.youtube.com/watch?v=rCYzRXLWcIg)
-   [Birds chirping](https://www.youtube.com/watch?v=mFjU4JuJgnM)
-   [Ocean waves](https://www.youtube.com/watch?v=bn9F19Hi1Lk)
-   [Relaxing jazz](https://www.youtube.com/watch?v=tNvh2w8lTes)
-   [Coffee shop ambience](https://www.youtube.com/watch?v=uiMXGIG_DQo)
-   [Animal Crossing New Horizons](https://www.youtube.com/watch?v=zru-TLye9jo)
-   [Calm Nintendo music](https://www.youtube.com/watch?v=sA0qrPOMy2Y)
-   [Yakuza/Like a Dragon bar ambience](https://www.youtube.com/watch?v=Q0GtyZbHJDM)
-   [Sky: Children of the Light soundtrack](https://www.youtube.com/watch?v=87etrUp83Yc)
-   [Vampire: The Masquerade – Bloodlines Ambient Playlist](https://www.youtube.com/watch?v=pCZxb43L_Ag)
-   [ChillSynth FM - lofi synthwave radio for retro dreaming](https://www.youtube.com/watch?v=UedTcufyrHc)
-   [peaceful piano radio 🎹 - music to focus/study to](https://www.youtube.com/watch?v=vMxYL4Cj85Y)
-   [synthwave radio 🌌 - beats to chill/game to](https://www.youtube.com/watch?v=4xDzrJKXOOY)

## Reporting Issues

If you run into any issues with this plugin, please [open an issue](https://github.com/andrewmcgivery/obsidian-soundscapes/issues/new) and include as much detail as possible, including screenshots.

# Leave a Tip

<a href="https://www.buymeacoffee.com/andrewmcgivery" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## ⚠️ Beta Notice (v1.1.0-beta.1)

This plugin is in **beta**. The core playback engine and UI are highly stable, but we are still refining specific edge cases.

### What works reliably
- **Local Music Library:** Fast indexing, smooth playback, and shuffle/repeat support.
- **Ambient Streams (mostly):** Live YouTube radio stations; some may be unnavailable.
- **YouTube Playlists:** Static imports and Native Mixes (`RD...`) playback via IFrame.
- **In-App Management:** Right-click context menus to rename, delete, or edit playlists and tracks (including URL re-fetching).
- **Overhaul Visuals:** Glassmorphism UI, animated aurora backdrop, orbital particles, and a customizable resizable layout (header and sidebar).
- **Search:** Global search and in-playlist filtering.

### What's experimental
- **`yt-dlp` fallback:** For embedding-blocked videos (like some major-label tracks).
  - Requires [yt-dlp](https://github.com/yt-dlp/yt-dlp) to be installed and on your system PATH.
  - **Note:** While `yt-dlp` works mostly flawlessly for Native Mixes (`RD...`), *some static playlists with blocked videos may still require a manual fallback click* (using the headphones icon) to trigger audio playback. 

If `yt-dlp` is not installed, blocked videos will be skipped with a notice. Everything else works normally.

---

## ✨ Visual Overhaul (v1.1.0)

This fork introduces a complete UI redesign inspired by modern desktop music players. 

**Before:**

![My Music view within Obsidian](screenshot7.png)
![Screenshot of Obsidian Soundscapes player](screenshot1.png)

**After:**

![Soundscape React view within Obsidian](image.png)
![Soundscape status bar mini-player within Obsidian](image1.png)


- **Animated Aurora & Particle Grid:** A dynamic, reactive canvas background that breathes with your music.
- **Custom Inertial Cursor:** A smooth dot-and-ring cursor scoped only to the Soundscapes view.
- **Resizable Workspace:** Drag the bottom of the player header or the right edge of the sidebar to fit your screen. Collapse the sidebar to an icon-only view for maximum focus.
- **In-App Playlist Editor:** Right-click any playlist or track to manage your library without opening the plugin settings.

---

### 🕉️ Accessibility
The animated aurora, particle grid, and custom cursor automatically disable if your system has **"Reduce Motion"** enabled in your OS settings. 

***

### Next Steps for you:
1. Paste this into your README.
2. Add your screenshots in the "Visual Overhaul" section.
3. Run `npm run build`.
4. Commit and push (`git add .`, `git commit -m "docs: update README for v1.1.0-beta.1"`, `git push`).