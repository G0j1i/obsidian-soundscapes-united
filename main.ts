import {
    Plugin,
    debounce,
    setIcon,
    requestUrl,
    Notice,
    WorkspaceLeaf,
} from "obsidian";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import MusicMetadata from "music-metadata";
import Observable from "src/Utils/Observable";
import { ReactView, SOUNDSCAPES_REACT_VIEW } from "./React/Views/ReactView";
import getAllMusicFiles, { getMimeType } from "src/Utils/getAllMusicFiles";
import { LocalPlayerState, Player } from "src/Types/Interfaces";
import { PLAYER_STATE, SOUNDSCAPE_TYPE } from "src/Types/Enums";
import SOUNDSCAPES from "src/Soundscapes";
import {
    DEFAULT_SETTINGS,
    SoundscapesPluginSettings,
    SoundscapesSettingsTab,
} from "src/Settings/Settings";
import createShuffleQueue from "src/Utils/createShuffleQueue";

/**
 * This allows a "live-reload" of Obsidian when developing the plugin.
 * Any changes to the code will force reload Obsidian.
 */
if (process.env.NODE_ENV === "development") {
    new EventSource("http://127.0.0.1:8000/esbuild").addEventListener(
        "change",
        () => location.reload()
    );
}

export default class SoundscapesPlugin extends Plugin {
    settings: SoundscapesPluginSettings;
    settingsObservable: Observable;
    localPlayerStateObservable: Observable;
    player: Player;
    localPlayer: HTMLAudioElement;
    statusBarItem: HTMLElement;
    playButton: HTMLButtonElement;
    pauseButton: HTMLButtonElement;
    nextButton: HTMLButtonElement;
    previousButton: HTMLButtonElement;
    changeSoundscapeSelect: HTMLSelectElement;
    nowPlayingRoot: HTMLDivElement;
    nowPlaying: HTMLDivElement;
    volumeButton: HTMLButtonElement;
    volumePopup: HTMLDivElement;
    volumeSlider: HTMLInputElement;
    volumeIconSpan: HTMLSpanElement;
    repeatToggleButton: HTMLButtonElement;
    closeVolumePopupHandler: () => void;
    ribbonButton: HTMLElement;
    debouncedSaveSettings: Function;
    soundscapeType: SOUNDSCAPE_TYPE;
    currentTrackIndex: number = 0;
    reindexTimer: NodeJS.Timeout | null = null;
    shuffleQueue: number[] = [];
    shuffleQueueSpot: number = 0;

    async onload() {
        await this.loadSettings();

        this.currentTrackIndex = this.settings.currentTrackIndex;
        const activeCollection = this.getActiveMusicCollection();
        if (activeCollection && activeCollection.currentTrackIndex !== undefined) {
            this.currentTrackIndex = activeCollection.currentTrackIndex;
        }
        this.settingsObservable = new Observable(this.settings);
        this.localPlayerStateObservable = new Observable({});
        this.debouncedSaveSettings = debounce(this.saveSettings, 500, true);

        this.versionCheck();

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass("soundscapesroot");
        
        // FIX: Create the UI controls immediately so they are never undefined!
        this.createControls();
        this.createPlayer();
        
        // Trigger initial soundscape state (allows local music to work instantly)
        this.onSoundscapeChange(this.settings.autoplay);

        this.registerView(
            SOUNDSCAPES_REACT_VIEW,
            (leaf) =>
                new ReactView(
                    this,
                    this.settingsObservable,
                    this.localPlayerStateObservable,
                    leaf
                )
        );

        this.ribbonButton = this.addRibbonIcon(
            "music",
            "Soundscapes: My Music",
            () => {
                this.OpenMyMusicView();
            }
        );
        this.ribbonButton.hide();

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SoundscapesSettingsTab(this.app, this));

        if (this.isMusicCollectionActive()) {
            this.ribbonButton.show();

            // Delay this so startup isn't impacted
            setTimeout(() => {
                this.indexMusicLibrary();
            }, 1000);
        }

        // Adding commands to be run from command palette or bind a hotkey to them
        this.addCommand({
            id: "go-to-next-track",
            name: "Go to next track",
            callback: () => {
                this.next();
            },
        });

        this.addCommand({
            id: "go-to-previous-track",
            name: "Go to previous track",
            callback: () => {
                this.previous();
            },
        });

        this.addCommand({
            id: "Play/Pause",
            name: "Play/Pause current track",
            callback: () => {
                if (
                    this.localPlayerStateObservable.getValue().playerState ===
                    PLAYER_STATE.PLAYING
                ) {
                    this.pause();
                } else {
                    this.play();
                }
            },
        });
    }

    onunload() {
        if (this.reindexTimer) {
            clearTimeout(this.reindexTimer);
        }
        if (this.closeVolumePopupHandler) {
            document.removeEventListener("click", this.closeVolumePopupHandler);
        }
    }

    /**
     * Because we only have the id of the current soundscape, we need a helper function to get the soundscape itself when it's a custom one
     * @returns
     */
    getCurrentCustomSoundscape() {
        return this.settings.customSoundscapes.find(
            (soundscape) =>
                soundscape.id ===
                this.settings.soundscape.split(`${SOUNDSCAPE_TYPE.CUSTOM}_`)[1]
        );
    }

    getActiveMusicCollection() {
        if (this.settings.soundscape.startsWith("MUSIC_COLLECTION_")) {
            const id = this.settings.soundscape.split("MUSIC_COLLECTION_")[1];
            return this.settings.musicCollections.find((c) => c.id === id);
        }
        return undefined;
    }

    isMusicCollectionActive() {
        return this.settings.soundscape.startsWith("MUSIC_COLLECTION_");
    }

    /******************************************************************************************************************/
    //#region Startup
    /******************************************************************************************************************/

    /**
     * Check the local plugin version against github. If there is a new version, notify the user.
     */
    async versionCheck() {
        const localVersion = process.env.PLUGIN_VERSION;
        const stableVersion = await requestUrl(
            "https://raw.githubusercontent.com/andrewmcgivery/obsidian-soundscapes/main/package.json"
        ).then(async (res) => {
            if (res.status === 200) {
                const response = await res.json;
                return response.version;
            }
        });
        const betaVersion = await requestUrl(
            "https://raw.githubusercontent.com/andrewmcgivery/obsidian-soundscapes/beta/package.json"
        ).then(async (res) => {
            if (res.status === 200) {
                const response = await res.json;
                return response.version;
            }
        });

        if (localVersion?.indexOf("beta") !== -1) {
            if (localVersion !== betaVersion) {
                new Notice(
                    "There is a beta update available for the Soundscapes plugin. Please update to to the latest version to get the latest features!",
                    0
                );
            }
        } else if (localVersion !== stableVersion) {
            new Notice(
                "There is an update available for the Soundscapes plugin. Please update to to the latest version to get the latest features!",
                0
            );
        }
    }

    /**
     * Given a file path in settings, get all the music files in that folder.
     * Convert those music files to a index of their music metadata.
     * Finally, reschedule the next reindex based on settings.
     */
    async indexMusicLibrary() {
        console.time("MusicIndex");
        const collection = this.getActiveMusicCollection();

        // Clear any timers if they exist
        if (this.reindexTimer) {
            clearTimeout(this.reindexTimer);
        }

        if (!collection || collection.folderPath.trim() === "") {
            new Notice(
                "Please set music file path in settings to use this music collection.",
                0
            );
            return;
        }

        new Notice(
            `Soundscapes: Indexing music files for "${collection.name}"...`
        );

        const musicFilePaths = getAllMusicFiles(collection.folderPath);

        const musicPromises = musicFilePaths.map(async (filePath) => {
            const metadata = await MusicMetadata.parseFile(filePath, {
                skipCovers: true,
            });

            return {
                fileName: path.basename(filePath),
                fullPath: filePath,
                title:
                    metadata.common.title ||
                    path.basename(filePath).replace(/\.[^.]+$/gi, ""),
                artist: metadata.common.artist,
                album: metadata.common.album,
                duration: metadata.format.duration,
            };
        });

        const songs = await Promise.all(musicPromises);
        console.timeEnd("MusicIndex");

        // Update both the collection's stored index and the active settings
        collection.musicIndex = songs;
        this.settings.myMusicIndex = songs;
        this.settings.myMusicFolderPath = collection.folderPath;

        if (this.currentTrackIndex >= songs.length) {
            this.currentTrackIndex = 0;
        }

        new Notice(
            `Soundscapes: Indexing complete. ${songs.length} songs were indexed for "${collection.name}".`
        );

        if (songs.length === 0) {
            new Notice(
                `Warning: Soundscapes found no songs at the configured file path.`
            );
        }

        this.saveSettings();

        // Reschedule index based on settings
        if (this.settings.reindexFrequency !== "never") {
            this.reindexTimer = setTimeout(
                () => this.indexMusicLibrary(),
                60000 * parseInt(this.settings.reindexFrequency)
            );
        }
    }

    resetReindexTimer() {
        if (this.reindexTimer) {
            clearTimeout(this.reindexTimer);
        }
        if (this.settings.reindexFrequency !== "never") {
            this.reindexTimer = setTimeout(
                () => this.indexMusicLibrary(),
                60000 * parseInt(this.settings.reindexFrequency)
            );
        }
    }

    /******************************************************************************************************************/
    //#endregion Startup
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Create UI Elements
    /******************************************************************************************************************/

    /**
     * Opens react view of MyMusic
     */
    async OpenMyMusicView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(SOUNDSCAPES_REACT_VIEW);

        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf for it
            leaf = workspace.getLeaf(true);
            await leaf.setViewState({
                type: SOUNDSCAPES_REACT_VIEW,
                active: true,
            });
        }

        // "Reveal" the leaf in case it is in a collapsed sidebar
        workspace.revealLeaf(leaf);
    }

    /**
     * Create the Youtube player
     */
    createPlayer() {
        // Load in youtube iframe api script
        const ytScript = this.statusBarItem.createEl("script", {
            attr: {
                src: "https://www.youtube.com/iframe_api",
            },
        });
        ytScript.addEventListener("error", () => {
            new Notice(
                "Soundscapes was unable to load the Youtube player. This could be because you are offline or have youtube blocked. You may still use My Music mode."
            );
            this.onPlayerReady();
        });

        // Create div to insert the video into
        this.statusBarItem.createEl("div", {
            attr: { id: "player" },
            cls: "soundscapesroot-player",
        });

        // Create local media player and listen to events
        this.localPlayer = new Audio();
        this.localPlayer.volume = this.settings.volume / 100;
        this.localPlayer.addEventListener("play", () => {
            this.onStateChange({ data: PLAYER_STATE.PLAYING });
        });
        this.localPlayer.addEventListener("pause", () => {
            this.onStateChange({ data: PLAYER_STATE.PAUSED });
        });
        this.localPlayer.addEventListener("ended", () => {
            this.onStateChange({ data: PLAYER_STATE.ENDED });
        });

        this.localPlayer.addEventListener("timeupdate", () => {
            this.updateLocalPlayerState({
                currentTime: this.localPlayer.currentTime,
            });
        });

        // Once the API is ready, create a player
        // @ts-ignore
        // Once the API is ready, create a player
        // @ts-ignore
        window.onYouTubeIframeAPIReady = () => {
            // @ts-ignore
            this.player = new YT.Player("player", {
                height: "100",
                width: "200",
                playerVars: {
                    playsinline: 1,
                    fs: 0,
                    disablekb: 1,
                    controls: 0,
                },
                events: {
                    onReady: this.onPlayerReady.bind(this),
                    onStateChange: (e: any) => {
                        // This is to suppress the player from sending events when it's not the active player
                        if (!this.isMusicCollectionActive()) {
                            this.onStateChange.bind(this)(e);
                        }
                    },
                },
            });

            // YOUTUBE TICK ENGINE: Push periodic time notifications down to the React layer
            setInterval(() => {
                const ytPlayer = this.player as any;
                if (ytPlayer && typeof ytPlayer.getPlayerState === "function") {
                    // State 1 means actively PLAYING, and check that music collection is not active
                    if (ytPlayer.getPlayerState() === 1 && !this.isMusicCollectionActive()) {
                        const currentTime = ytPlayer.getCurrentTime() || 0;
                        const duration = ytPlayer.getDuration() || 0;
                        
                        const currentState = this.localPlayerStateObservable.getValue();
                        
                        let author = "YouTube Creator";
                        if (typeof ytPlayer.getVideoData === "function") {
                            const videoData = ytPlayer.getVideoData();
                            if (videoData && videoData.author) {
                                author = videoData.author;
                            }
                        }

                        // Auto-fill and save missing track details permanently to the list configuration
                        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
                            const customSoundscape = this.getCurrentCustomSoundscape();
                            const track = customSoundscape?.tracks[this.currentTrackIndex];
                            if (track && (!(track as any).author || !(track as any).duration)) {
                                (track as any).author = author;
                                (track as any).duration = duration;
                                this.saveSettings();
                            }
                        }
                        
                        this.updateLocalPlayerState({
                            currentTime: currentTime,
                            playerState: currentState.playerState,
                            currentTrack: currentState.currentTrack ? {
                                ...currentState.currentTrack,
                                duration: duration,
                                artist: currentState.currentTrack.artist === "YouTube Creator" ? author : currentState.currentTrack.artist
                            } : {
                                title: this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM 
                                    ? this.getCurrentCustomSoundscape()?.tracks[this.currentTrackIndex]?.name || "" 
                                    : SOUNDSCAPES[this.settings.soundscape]?.name || "",
                                artist: author,
                                duration: duration
                            } as any
                        });
                    }
                }
            }, 500);
        };
    }

    /**
     * Create all the UI elements
     */
    createControls() {
        // Previous Button
        this.previousButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-previousbutton",
        });
        setIcon(this.previousButton, "skip-back");
        this.previousButton.onclick = () => this.previous();

        // Play Button
        this.playButton = this.statusBarItem.createEl("button", {});
        setIcon(this.playButton, "play");
        this.playButton.onclick = () => this.play();

        // Pause Button
        this.pauseButton = this.statusBarItem.createEl("button", {});
        setIcon(this.pauseButton, "pause");
        this.pauseButton.onclick = () => this.pause();

        // Next Button
        this.nextButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-nextbutton",
        });
        setIcon(this.nextButton, "skip-forward");
        this.nextButton.onclick = () => this.next();

        // Repeat/Shuffle Toggle Button
        this.repeatToggleButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-repeattogglebutton",
        });
        this.updateRepeatToggleIcon();
        this.repeatToggleButton.onclick = () => this.toggleRepeat();

        // Change Soundscape Button
        const changeSoundscapeButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-changesoundscapebutton",
        });
        setIcon(changeSoundscapeButton, "list-music");
        this.changeSoundscapeSelect = changeSoundscapeButton.createEl(
            "select",
            {
                cls: "soundscapesroot-changesoundscapeselect",
                attr: {
                    id: "soundscapesroot-changesoundscapeselect",
                },
            }
        );
        this.populateChangeSoundscapeButton();
        this.changeSoundscapeSelect.addEventListener(
            "change",
            (event: Event) => {
                this.changeSoundscape(
                    (event?.target as HTMLSelectElement).value
                );
            }
        );

        // Now Playing
        this.nowPlayingRoot = this.statusBarItem.createEl("div", {
            cls: "soundscapesroot-nowplaying",
        });
        this.nowPlaying = this.nowPlayingRoot.createEl("div", {
            cls: "soundscapesroot-nowplaying-text",
        });
        this.toggleNowPlayingScroll();

        // Volume button (always visible)
        this.volumeButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-volumebutton",
        });
        this.volumeIconSpan = this.volumeButton.createSpan();
        this.updateVolumeIcon(this.settings.volume);
        this.volumeButton.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            if (this.volumePopup.hasClass("soundscapesroot-volumePopup--visible")) {
                this.volumePopup.removeClass("soundscapesroot-volumePopup--visible");
            } else {
                this.volumePopup.addClass("soundscapesroot-volumePopup--visible");
            }
        };

        // Volume popup (hidden by default, appears above button)
        this.volumePopup = this.volumeButton.createEl("div", {
            cls: "soundscapesroot-volumePopup",
        });
        this.volumeSlider = this.volumePopup.createEl("input", {
            attr: {
                type: "range",
                min: 0,
                max: 100,
                value: this.settings.volume,
            },
        });
        this.volumeSlider.addEventListener(
            "input",
            this.onVolumeChange.bind(this)
        );

        this.closeVolumePopupHandler = () => {
            if (this.volumePopup.hasClass("soundscapesroot-volumePopup--visible")) {
                this.volumePopup.removeClass("soundscapesroot-volumePopup--visible");
            }
        };
        document.addEventListener("click", this.closeVolumePopupHandler);
        this.volumePopup.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
        });
    }

    /**
     * Populates the dropdown on the miniplayer with all available soundscapes
     * Organized cleanly using nested option groups (optgroups)
     */
    populateChangeSoundscapeButton() {
        // Defensive guard against undefined select element
        if (!this.changeSoundscapeSelect) return;

        this.changeSoundscapeSelect.replaceChildren();

        // 1. Group: 📻 Ambient Streams (Always Visible)
        const ambientGroup = this.changeSoundscapeSelect.createEl("optgroup", {
            attr: { label: "📻 Ambient Streams" }
        });
        Object.values(SOUNDSCAPES).forEach((soundscape) => {
            ambientGroup.createEl("option", {
                text: soundscape.name,
                value: soundscape.id,
            });
        });

        // 2. Group: 📺 YouTube Playlists (Matches the Sidebar layout icon text branding)
        const validCustomPlaylists = this.settings.customSoundscapes.filter(
            (cs) => cs.tracks && cs.tracks.length > 0
        );
        if (validCustomPlaylists.length > 0) {
            const youtubeGroup = this.changeSoundscapeSelect.createEl("optgroup", {
                attr: { label: "▶ 𝚈𝚘𝚞𝚝𝚞𝚋𝚎" }
            });
            validCustomPlaylists.forEach((customSoundscape) => {
                youtubeGroup.createEl("option", {
                    text: customSoundscape.name,
                    value: `${SOUNDSCAPE_TYPE.CUSTOM}_${customSoundscape.id}`,
                });
            });
        }

        // 3. Group: 📁 Local Music Collection (Only if folders exist)
        if (this.settings.musicCollections && this.settings.musicCollections.length > 0) {
            const localGroup = this.changeSoundscapeSelect.createEl("optgroup", {
                attr: { label: "📁 Collections" }
            });
            this.settings.musicCollections.forEach((collection) => {
                localGroup.createEl("option", {
                    text: collection.name,
                    value: `MUSIC_COLLECTION_${collection.id}`,
                });
            });
        }

        // Bind the current active selection back to the selector value
        this.changeSoundscapeSelect.value = this.settings.soundscape;
    }

    /******************************************************************************************************************/
    //#endregion Create UI Elements
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Control Player
    /******************************************************************************************************************/

    /**
     * Plays the current track. When it's a live video, attempt to jump to the "live" portion.
     */
    play() {
        if (
            this.soundscapeType === SOUNDSCAPE_TYPE.STANDARD &&
            SOUNDSCAPES[this.settings.soundscape].isLiveVideo
        ) {
            this.player?.seekTo(this.player.getDuration());
        }

        if (this.isMusicCollectionActive()) {
            // If we don't currently have an audio source because we recently changed folders but now we do have an index, play the first song
            if (
                this.localPlayer.src === location.href &&
                this.settings.myMusicIndex.length > 0
            ) {
                this.currentTrackIndex = 0;
                this.onSoundscapeChange(true);
            } else {
                this.localPlayer.play();
            }
        } else {
            this.player?.playVideo();
        }
    }

    /**
     * Pause the current track.
     */
    pause() {
        if (this.isMusicCollectionActive()) {
            this.localPlayer.pause();
        } else {
            this.player?.pauseVideo();
        }
    }

    /**
     * Skip to the previous track.
     */
    previous() {
        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();

            if (this.currentTrackIndex === 0) {
                this.currentTrackIndex =
                    (customSoundscape?.tracks.length || 1) - 1;
            } else {
                this.currentTrackIndex--;
            }
        } else if (this.isMusicCollectionActive()) {
            // Are we in shuffle mode?
            if (this.settings.playMode === "shuffle") {
                // If Shuffle queue is empty, let's populate it
                if (this.shuffleQueue.length === 0) {
                    this.shuffleQueue = createShuffleQueue(
                        this.settings.myMusicIndex
                    );
                    this.shuffleQueueSpot = 0;
                }

                if (this.shuffleQueueSpot === 0) {
                    // If we are at the beginning, wrap around to the end!
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueue.length - 1];
                } else {
                    // Otherwise, go to the previous song in the shuffle queue
                    this.shuffleQueueSpot--;
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueueSpot];
                }
            } else {
                // Not in shuffle mode, go to next song
                if (this.currentTrackIndex === 0) {
                    this.currentTrackIndex =
                        this.settings.myMusicIndex.length - 1;
                } else {
                    this.currentTrackIndex--;
                }
            }
        }
        this.onSoundscapeChange();
    }

    /**
     * Skip to the next track.
     */
    next() {
        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();

            if (customSoundscape?.tracks[this.currentTrackIndex + 1]) {
                this.currentTrackIndex++;
            } else {
                this.currentTrackIndex = 0;
            }
        } else if (this.isMusicCollectionActive()) {
            // Are we in shuffle mode?
            if (this.settings.playMode === "shuffle") {
                // If Shuffle queue is empty, let's populate it
                if (this.shuffleQueue.length === 0) {
                    this.shuffleQueue = createShuffleQueue(
                        this.settings.myMusicIndex
                    );
                    this.shuffleQueueSpot = 0;
                }

                if (this.shuffleQueueSpot === this.shuffleQueue.length - 1) {
                    // If we get to the end of all possible songs to shuffle, go back to the start and reset the shuffle queue
                    this.currentTrackIndex = this.shuffleQueue[0];
                    this.shuffleQueue = [];
                    this.shuffleQueueSpot = 0;
                } else {
                    // Otherwise, go to the next song in the shuffle queue
                    this.shuffleQueueSpot++;
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueueSpot];
                }
            } else {
                // Not in shuffle mode, go to next song
                if (this.settings.myMusicIndex[this.currentTrackIndex + 1]) {
                    this.currentTrackIndex++;
                } else {
                    this.currentTrackIndex = 0;
                }
            }
        }
        this.onSoundscapeChange();
    }

    /**
     * Seek to a specific spot in the song
     * @param time
     */
    seek(time: number) {
        if (this.isMusicCollectionActive()) {
            this.localPlayer.currentTime = time;
        }
    }

    /**
     * Changes the currently playing song when in My Music mode
     * @param fileName
     */
    changeMyMusicTrack(fileName: string) {
        this.currentTrackIndex = this.settings.myMusicIndex.findIndex(
            (song) => song.fileName === fileName
        );
        this.onSoundscapeChange();
    }

    /**
     * Turn on shuffle mode. When we toggle it on, reset the shuffle queue.
     */
    toggleShuffle() {
        this.settings.playMode = this.settings.playMode === "shuffle" ? "repeat" : "shuffle";
        this.saveSettings();

        if (this.settings.playMode === "shuffle") {
            this.shuffleQueue = [];
            this.shuffleQueueSpot = 0;
        }
        this.updateRepeatToggleIcon();
    }

    toggleRepeat() {
        this.settings.playMode = this.settings.playMode === "shuffle" ? "repeat" : "shuffle";
        this.saveSettings();

        if (this.settings.playMode === "shuffle") {
            this.shuffleQueue = [];
            this.shuffleQueueSpot = 0;
        }
        this.updateRepeatToggleIcon();
    }

    updateRepeatToggleIcon() {
        if (this.settings.playMode === "repeat") {
            setIcon(this.repeatToggleButton, "repeat");
        } else {
            setIcon(this.repeatToggleButton, "shuffle");
        }
        this.repeatToggleButton.onclick = () => this.toggleRepeat();
    }

    /**
     * Either enables or disables song title scrolling on the mini player depending on the user's settings
     */
    toggleNowPlayingScroll() {
        if (this.settings.scrollSongTitle) {
            this.nowPlayingRoot.removeClass(
                "soundscapesroot-nowplaying--noscroll"
            );
        } else {
            this.nowPlayingRoot.addClass(
                "soundscapesroot-nowplaying--noscroll"
            );
        }
    }

    /**
     * Changes the currently playing soundscape and triggers other downstream side effects
     * @param soundscape
     */
    changeSoundscape(soundscape: string) {
        const prevCollection = this.getActiveMusicCollection();
        if (prevCollection) {
            prevCollection.currentTrackIndex = this.currentTrackIndex;
        }

        this.settings.soundscape = soundscape;

        if (this.settings.soundscape.startsWith(`${SOUNDSCAPE_TYPE.CUSTOM}_`)) {
            this.currentTrackIndex = 0;
        }

        if (this.isMusicCollectionActive()) {
            const collection = this.getActiveMusicCollection();
            if (collection) {
                this.settings.myMusicIndex = collection.musicIndex;
                this.settings.myMusicFolderPath = collection.folderPath;
                const savedIndex = collection.currentTrackIndex ?? 0;
                this.currentTrackIndex = savedIndex < this.settings.myMusicIndex.length ? savedIndex : 0;
            }
            this.shuffleQueue = [];
            this.shuffleQueueSpot = 0;
            if (collection && collection.musicIndex.length === 0) {
                this.indexMusicLibrary();
            } else {
                this.resetReindexTimer();
            }
            this.ribbonButton.show();
        } else {
            this.ribbonButton.hide();
        }

        this.onSoundscapeChange();
        this.saveSettings();
    }

    /******************************************************************************************************************/
    //#endregion Control Player
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Events
    /******************************************************************************************************************/

    /**
     * Once the player is ready, create the controls and play some music! (or not if autoplay is disabled)
     */
    onPlayerReady() {
        this.onSoundscapeChange(this.settings.autoplay);
    }

    /**
     * Update the UI when the state of the video changes
     */
    onStateChange({ data: state }: { data: PLAYER_STATE }) {
        const customSoundscape = this.getCurrentCustomSoundscape();

        // Next and Previous buttons only apply when we have a playlist-type soundscape
        if (this.soundscapeType === SOUNDSCAPE_TYPE.STANDARD) {
            this.previousButton.hide();
            this.nextButton.hide();
            this.repeatToggleButton.hide();
        } else {
            this.previousButton.show();
            this.nextButton.show();
            this.repeatToggleButton.show();
        }

        // Dynamically resolve what track metadata frame should be broadcasted out to React
        let resolvedTrack: any = undefined;
        if (this.isMusicCollectionActive()) {
            resolvedTrack = this.settings.myMusicIndex[this.currentTrackIndex];
        } else if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const track = customSoundscape?.tracks[this.currentTrackIndex];
            const ytPlayer = this.player as any;
            let author = (track as any)?.author || (track as any)?.channelName || "YouTube Creator";
            let duration = (track as any)?.duration || 0;

            if (ytPlayer && typeof ytPlayer.getVideoData === "function") {
                const videoData = ytPlayer.getVideoData();
                if (videoData && videoData.author) author = videoData.author;
                if (typeof ytPlayer.getDuration === "function") {
                    const ytDuration = ytPlayer.getDuration();
                    if (ytDuration > 0) duration = ytDuration;
                }
            }

            // Save details permanently if newly discovered from playback frame
            if (track && (!(track as any).author || !(track as any).duration)) {
                (track as any).author = author;
                (track as any).duration = duration;
                this.saveSettings();
            }

            resolvedTrack = {
                fileName: track?.name || "",
                fullPath: track?.id || "",
                title: track?.name || "",
                artist: author,
                album: customSoundscape?.name || "YouTube Playlist",
                duration: duration
            };
        } else {
            const ambient = SOUNDSCAPES[this.settings.soundscape];
            resolvedTrack = {
                fileName: ambient?.name || "",
                fullPath: ambient?.youtubeId || "",
                title: ambient?.name || "",
                artist: "Ambient Radio",
                album: "Soundscapes",
                duration: 0
            };
        }

        switch (state) {
            case PLAYER_STATE.UNSTARTED:
                this.playButton.show();
                this.pauseButton.hide();
                break;
            case PLAYER_STATE.PLAYING:
                this.playButton.hide();
                this.pauseButton.show();
                this.updateLocalPlayerState({
                    currentTrack: resolvedTrack,
                    playerState: PLAYER_STATE.PLAYING,
                });
                break;
            case PLAYER_STATE.PAUSED:
                this.playButton.show();
                this.pauseButton.hide();
                this.updateLocalPlayerState({
                    currentTrack: resolvedTrack,
                    playerState: PLAYER_STATE.PAUSED,
                });
                break;
            case PLAYER_STATE.ENDED:
                if (this.settings.playMode === "repeat" && this.isMusicCollectionActive()) {
                    // Repeat-one: replay current track without advancing
                } else if (
                    this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM ||
                    this.isMusicCollectionActive()
                ) {
                    this.next();
                }
                this.onSoundscapeChange();
        }
    }

    /**
     * When we change the volume (usually via the slider), update the player volume, the UI, and save the current volume to settings
     */
    onVolumeChange(e: any) {
        const volume = parseInt(e.target.value);
        this.volumeSlider.value = e.target.value;
        this.player?.setVolume(volume);
        this.localPlayer.volume = volume / 100; // Audio object expects 0-1

        this.updateVolumeIcon(volume);

        this.settings.volume = volume;
        this.settingsObservable.setValue(this.settings);
        this.debouncedSaveSettings();
    }

    updateVolumeIcon(volume: number) {
        if (volume === 0) {
            setIcon(this.volumeIconSpan, "volume-x");
        } else if (volume <= 50) {
            setIcon(this.volumeIconSpan, "volume-1");
        } else {
            setIcon(this.volumeIconSpan, "volume-2");
        }
    }

    /**
     * Play the selected soundscape!
     *
     * When in My Music mode, the song content is read from the file and base64ed. This is because electron blocks
     * local file paths from being used in the Audio element.
     */
    onSoundscapeChange(autoplay = true) {
        // Defensive guard against undefined text layout element
        if (!this.nowPlaying) return;
        
        if (this.settings.soundscape.startsWith(`${SOUNDSCAPE_TYPE.CUSTOM}_`)) {
            this.soundscapeType = SOUNDSCAPE_TYPE.CUSTOM;
        } else if (this.isMusicCollectionActive()) {
            this.soundscapeType = SOUNDSCAPE_TYPE.MY_MUSIC;
        } else {
            this.soundscapeType = SOUNDSCAPE_TYPE.STANDARD;
        }

        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();

            this.player?.loadVideoById({
                videoId: customSoundscape?.tracks[this.currentTrackIndex].id,
            });
            this.nowPlaying.setText(
                customSoundscape?.tracks[this.currentTrackIndex].name || ""
            );

            if (!autoplay) {
                this.player?.pauseVideo();
            }

            this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
            this.localPlayer.pause(); // Edge Case: When switching from MyMusic to Youtube, the youtube video keeps playing
        } else if (this.isMusicCollectionActive()) {
            const track = this.settings.myMusicIndex[this.currentTrackIndex];

            if (track) {
                const fileData = fs.readFileSync(track.fullPath);
                const base64Data = fileData.toString("base64");

                this.localPlayer.pause();
                const ext = track.fullPath.split(".").pop()?.toLowerCase() || "mp3";
                this.localPlayer.src = `data:${getMimeType(ext)};base64,${base64Data}`;

                this.nowPlaying.setText(`${track.title} - ${track.artist}`);

                if (autoplay) {
                    this.localPlayer.play();
                } else {
                    // Need to manually send this cause the state won't be set otherwise
                    this.onStateChange({ data: PLAYER_STATE.PAUSED });
                }
            } else {
                // We don't have a track (still indexing or empty index)
                // Reset the player
                this.localPlayer.src = "";
                this.nowPlaying.setText("");
                this.onStateChange({ data: PLAYER_STATE.PAUSED });
            }

            this.statusBarItem.addClass("soundscapesroot--hideyoutube");
            this.player?.pauseVideo(); // Edge Case: When switching from youtube to MyMusic, the youtube video keeps playing
        } else {
            this.player?.loadVideoById({
                videoId: SOUNDSCAPES[this.settings.soundscape].youtubeId,
            });
            if (SOUNDSCAPES[this.settings.soundscape].isLiveVideo) {
                this.player?.seekTo(this.player.getDuration());
            }
            this.nowPlaying.setText(
                SOUNDSCAPES[this.settings.soundscape].nowPlayingText
            );

            if (!autoplay) {
                this.player?.pauseVideo();
            }

            this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
            this.localPlayer.pause(); // Edge Case: When switching from MyMusic to Youtube, the youtube video keeps playing
        }

        // Keep miniplayer's soundscape selection button up to date
        this.changeSoundscapeSelect.value = this.settings.soundscape;
        this.saveSettings();
    }

    /******************************************************************************************************************/
    //#endregion Events
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Settings and State
    /******************************************************************************************************************/

    /**
     * Load data from disk, stored in data.json in plugin folder
     */
    async loadSettings() {
        const data = (await this.loadData()) || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

        // Migrate legacy single My Music to music collections
        if (
            data.myMusicFolderPath &&
            data.myMusicFolderPath.trim() !== "" &&
            this.settings.musicCollections.length === 0
        ) {
            this.settings.musicCollections.push({
                id: uuidv4(),
                name: "My Music",
                folderPath: data.myMusicFolderPath,
                musicIndex: data.myMusicIndex || [],
                currentTrackIndex: 0,
            });
            this.settings.soundscape = `MUSIC_COLLECTION_${this.settings.musicCollections[0].id}`;
            this.saveSettings();
        }

        // Reset legacy MY_MUSIC soundscape if no migration happened
        if (this.settings.soundscape === SOUNDSCAPE_TYPE.MY_MUSIC) {
            this.settings.soundscape = "lofi";
        }

        // Fix invalid collection references (e.g. collection was deleted)
        if (
            this.settings.soundscape.startsWith("MUSIC_COLLECTION_") &&
            !this.getActiveMusicCollection()
        ) {
            this.settings.soundscape = "lofi";
        }
    }

    /**
     * Save data to disk, stored in data.json in plugin folder
     */
    async saveSettings() {
        this.settings.currentTrackIndex = this.currentTrackIndex;

        const collection = this.getActiveMusicCollection();
        if (collection) {
            collection.currentTrackIndex = this.currentTrackIndex;
        }

        this.settingsObservable.setValue(this.settings);
        await this.saveData(this.settings);
    }

    /**
     * Merges the update object with the existing local player state
     * @param updateObject
     */
    updateLocalPlayerState(updateObject: LocalPlayerState) {
        this.localPlayerStateObservable.setValue({
            ...this.localPlayerStateObservable.getValue(),
            ...updateObject,
        });
    }

    /******************************************************************************************************************/
    //#endregion Settings and State
    /******************************************************************************************************************/
}
