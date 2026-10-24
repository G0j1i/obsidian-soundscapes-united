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
import { LocalPlayerState, Player, LocalMusicFile } from "src/Types/Interfaces";
import { PLAYER_STATE, SOUNDSCAPE_TYPE } from "src/Types/Enums";
import SOUNDSCAPES from "src/Soundscapes";
import {
    DEFAULT_SETTINGS,
    SoundscapesPluginSettings,
    SoundscapesSettingsTab,
} from "src/Settings/Settings";
import createShuffleQueue from "src/Utils/createShuffleQueue";
import { exec } from "child_process";

function getYtdlStreamUrl(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`yt-dlp -g -f "ba/b" "${videoUrl}"`, (error, stdout, stderr) => {
            if (error) {
                console.error("yt-dlp stderr:", stderr);
                reject(error);
                return;
            }
            
            const url = stdout.trim().split('\n').find(line => line.startsWith('http'));
            if (url) {
                resolve(url);
            } else {
                reject(new Error("No URL returned from yt-dlp"));
            }
        });
    });
}

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
    ytPollingInterval: NodeJS.Timeout | null = null;    

    // Put this anywhere in the class
    async addMusicCollection(folderPath: string) {
        const newCol = {
            id: uuidv4(),
            name: path.basename(folderPath),
            folderPath: folderPath,
            musicIndex: [],
            currentTrackIndex: 0
        };
        this.settings.musicCollections.push(newCol);
        this.settings.soundscape = `MUSIC_COLLECTION_${newCol.id}`;
        await this.saveSettings();
        this.populateChangeSoundscapeButton();
        this.indexMusicLibrary();
    }

    resetPlayerToStatusBar() {
        const ytPlayerElement = document.getElementById("player");
        if (ytPlayerElement && this.statusBarItem) {
            this.statusBarItem.appendChild(ytPlayerElement);
            ytPlayerElement.style.removeProperty("position");
            ytPlayerElement.style.removeProperty("left");
            ytPlayerElement.style.removeProperty("top");
            ytPlayerElement.style.removeProperty("z-index");
            ytPlayerElement.style.removeProperty("border-radius");
            // Let the old status bar CSS handle the display
        }
    }

    private useYtdlFallback: boolean = false;
    private playTimeout: NodeJS.Timeout | null = null;
    private currentPlayingId: string | null = null;
    private activeSoundscapeId: string | null = null;
    private activePlaybackKey: string | null = null;
    private playbackRequestId = 0;

    private isLocalPlayerActive() {
        return this.isMusicCollectionActive() ||
            (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM && this.useYtdlFallback);
    }

    private getNativeTrackData(): LocalMusicFile | undefined {
        const customSoundscape = this.getCurrentCustomSoundscape();
        const videoData = this.player?.getVideoData?.();
        if (!customSoundscape?.isNativePlaylist || !videoData?.video_id) {
            return undefined;
        }

        return {
            fileName: videoData.video_id,
            fullPath: videoData.video_id,
            title: videoData.title || videoData.video_id,
            artist: videoData.author || "YouTube",
            album: customSoundscape.name,
            duration: this.player?.getDuration() || 0,
        };
    }

    private showYouTubePlayer() {
        document.getElementById("player")?.style.setProperty("display", "block", "important");
    }

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

        // NOTE: versionCheck disabled because the original repo 404s and breaks the load sequence.
        // this.versionCheck();

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass("soundscapesroot");

        this.createControls();
        this.createPlayer();

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

        this.addSettingTab(new SoundscapesSettingsTab(this.app, this));

        if (this.isMusicCollectionActive()) {
            this.ribbonButton.show();
            setTimeout(() => {
                this.indexMusicLibrary();
            }, 1000);
        }

        this.addCommand({
            id: "open-my-music-view",
            name: "Open My Music View",
            callback: () => {
                this.OpenMyMusicView();
            },
        });

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
        if (this.ytPollingInterval) {
            clearInterval(this.ytPollingInterval); // Stop polling
        }
        if (this.closeVolumePopupHandler) {
            document.removeEventListener("click", this.closeVolumePopupHandler);
        }
        
        // Destroy the YouTube player and remove the orphaned IFrame
        if (this.player && typeof (this.player as any).destroy === "function") {
            (this.player as any).destroy();
        }
        const ytPlayerElement = document.getElementById("player");
        if (ytPlayerElement) {
            ytPlayerElement.remove();
        }
    }

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

    private getCurrentTrackData(): LocalMusicFile | undefined {
        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();
            const track = customSoundscape?.tracks[this.currentTrackIndex];
            
            if (!track) return undefined;
            
            return {
                fileName: track.name,
                fullPath: track.id,
                title: track.name,
                artist:
                    (track as any).author ||
                    (track as any).channelName ||
                    "YouTube Creator",
                album: customSoundscape?.name || "YouTube Playlist",
                duration: (track as any).duration || 0,
            };
        } else if (this.isMusicCollectionActive()) {
            return this.settings.myMusicIndex[this.currentTrackIndex];
        } else {
            const ambient = SOUNDSCAPES[this.settings.soundscape];
            return ambient
                ? {
                      fileName: ambient.name,
                      fullPath: ambient.youtubeId,
                      title: ambient.name,
                      artist: "Ambient Radio",
                      album: "Soundscapes",
                      duration: 0,
                  }
                : undefined;
        }
    }

    /******************************************************************************************************************/
    //#region Startup
    /******************************************************************************************************************/

    async versionCheck() {
        // Disabled - see comment in onload
    }

    async indexMusicLibrary() {
        console.time("MusicIndex");
        const collection = this.getActiveMusicCollection();

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

    async OpenMyMusicView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(SOUNDSCAPES_REACT_VIEW);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getLeaf(true);
            await leaf.setViewState({
                type: SOUNDSCAPES_REACT_VIEW,
                active: true,
            });
        }

        workspace.revealLeaf(leaf);
    }

    createPlayer() {
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

        this.statusBarItem.createEl("div", {
            attr: { id: "player" },
            cls: "soundscapesroot-player",
        });

        this.localPlayer = new Audio();
        this.localPlayer.volume = this.settings.volume / 100;
        this.localPlayer.addEventListener("play", () => {
            if (this.isLocalPlayerActive()) {
                this.onStateChange({ data: PLAYER_STATE.PLAYING });
            }
        });
        this.localPlayer.addEventListener("pause", () => {
            if (this.isLocalPlayerActive()) {
                this.onStateChange({ data: PLAYER_STATE.PAUSED });
            }
        });
        this.localPlayer.addEventListener("ended", () => {
            if (this.isLocalPlayerActive()) {
                this.onStateChange({ data: PLAYER_STATE.ENDED });
            }
        });
        const updateLocalPlayerDuration = () => {
            const duration = this.localPlayer.duration;
            const currentTrack = this.localPlayerStateObservable.getValue().currentTrack;
            if (!this.isLocalPlayerActive() || !currentTrack || !Number.isFinite(duration)) return;

            this.updateLocalPlayerState({
                currentTrack: {
                    ...currentTrack,
                    duration,
                },
            });
        };
        this.localPlayer.addEventListener("loadedmetadata", updateLocalPlayerDuration);
        this.localPlayer.addEventListener("durationchange", updateLocalPlayerDuration);
        this.localPlayer.addEventListener("timeupdate", () => {
            if (!this.isLocalPlayerActive()) return;
            this.updateLocalPlayerState({
                currentTime: this.localPlayer.currentTime,
            });
        });

                const setupYouTubePlayer = () => {
            // @ts-ignore
            if (this.player) return; 
            // @ts-ignore
            this.player = new YT.Player("player", {
                height: "100",
                width: "200",
                playerVars: {
                    playsinline: 1,
                    fs: 0,
                    disablekb: 1,
                    controls: 0,
                    enablejsapi: 1, // CRITICAL: Allows reliable API control
                },
                                events: {
                    onReady: this.onPlayerReady.bind(this),
                    onStateChange: (e: any) => {
                        if (!this.isMusicCollectionActive() && !this.useYtdlFallback) {
                            const currentTrackData = this.getCurrentTrackData();
                            const currentVideoId = this.player?.getVideoData?.()?.video_id;
                            if (
                                currentTrackData?.fullPath &&
                                currentVideoId &&
                                currentTrackData.fullPath !== currentVideoId
                            ) return;
                            this.onStateChange.bind(this)(e);
                        }
                    },
                    onError: (e: any) => {
                        console.warn("YouTube Player Error:", e.data);

                        if (e.data === 101 || e.data === 150) {
                            if (this.useYtdlFallback) return;
                            const customSoundscape = this.getCurrentCustomSoundscape();
                            const nativeTrackData = customSoundscape?.isNativePlaylist
                                ? this.getNativeTrackData()
                                : undefined;
                            const currentTrackData = nativeTrackData ?? this.getCurrentTrackData();
                            const errorVideoId = this.player?.getVideoData?.()?.video_id;
                            const expectedVideoId = currentTrackData?.fullPath;
                            if (
                                !currentTrackData ||
                                (errorVideoId && expectedVideoId && errorVideoId !== expectedVideoId)
                            ) return;

                            if (this.playTimeout) {
                                clearTimeout(this.playTimeout);
                                this.playTimeout = null;
                            }
                            this.currentPlayingId = currentTrackData.fullPath;
                            this.activePlaybackKey = null;
                            this.useYtdlFallback = true;
                            this.updateLocalPlayerState({
                                currentTrack: currentTrackData,
                                currentTime: 0,
                                isYtdlFallback: true,
                            });
                            void this.onSoundscapeChange(true);
                        } else if (e.data === 100) {
                            new Notice("Video unavailable. Skipping...");
                            setTimeout(() => this.next(), 1000);
                        }
                    }
                },
            });

            this.ytPollingInterval = setInterval(() => {
                if (
                    this.useYtdlFallback ||
                    this.localPlayerStateObservable.getValue().isYtdlFallback
                ) return;
                if (this.player && typeof this.player.getCurrentTime === "function" && !this.isMusicCollectionActive()) {
                    try {
                        const currentTime = this.player.getCurrentTime() || 0;
                        const ytState = this.player.getPlayerState();
                        
                        let mappedState = this.localPlayerStateObservable.getValue().playerState;
                        if (ytState === 1 || ytState === 3) mappedState = PLAYER_STATE.PLAYING;
                        else if (ytState === 2) mappedState = PLAYER_STATE.PAUSED;
                        else if (ytState === 0) mappedState = PLAYER_STATE.ENDED;

                        let currentTrack = this.getCurrentTrackData();
                        const currentVideoId = this.player.getVideoData?.()?.video_id;
                        const expectedVideoId = currentTrack?.fullPath;
                        if (
                            expectedVideoId &&
                            currentVideoId &&
                            expectedVideoId !== currentVideoId &&
                            !this.getCurrentCustomSoundscape()?.isNativePlaylist
                        ) return;
                        
                        // 🔥 Native Playlist Polling
                        const customSoundscape = this.getCurrentCustomSoundscape();
                        if (customSoundscape?.isNativePlaylist && typeof this.player.getVideoData === "function") {
                            const nativeTrackData = this.getNativeTrackData();
                            if (nativeTrackData) {
                                if (nativeTrackData.fullPath !== this.currentPlayingId) {
                                    this.currentPlayingId = nativeTrackData.fullPath;
                                    this.activePlaybackKey = null;
                                    this.useYtdlFallback = false;
                                    this.updateLocalPlayerState({ isYtdlFallback: false });
                                }
                                currentTrack = nativeTrackData;
                            }
                        } else if (currentTrack) {
                            currentTrack.duration = this.player.getDuration() || 0;
                        }

                        if (mappedState !== this.localPlayerStateObservable.getValue().playerState) {
                            this.onStateChange({ data: mappedState });
                        }

                        this.updateLocalPlayerState({ currentTime, currentTrack });
                    } catch (e) {}
                }
            }, 1000);
        };

        // @ts-ignore
        if (window.YT && window.YT.Player) {
            setupYouTubePlayer();
        } else {
            // @ts-ignore
            window.onYouTubeIframeAPIReady = setupYouTubePlayer;
        }
    }

    createControls() {
        this.previousButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-previousbutton",
        });
        setIcon(this.previousButton, "skip-back");
        this.previousButton.onclick = () => this.previous();

        this.playButton = this.statusBarItem.createEl("button", {});
        setIcon(this.playButton, "play");
        this.playButton.onclick = () => this.play();

        this.pauseButton = this.statusBarItem.createEl("button", {});
        setIcon(this.pauseButton, "pause");
        this.pauseButton.onclick = () => this.pause();

        this.nextButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-nextbutton",
        });
        setIcon(this.nextButton, "skip-forward");
        this.nextButton.onclick = () => this.next();

        this.repeatToggleButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-repeattogglebutton",
        });
        this.updateRepeatToggleIcon();
        this.repeatToggleButton.onclick = () => this.toggleRepeat();

        const changeSoundscapeButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-changesoundscapebutton",
        });
        setIcon(changeSoundscapeButton, "list-music");
        
        this.changeSoundscapeSelect = changeSoundscapeButton.createEl("select", {
            cls: "soundscapesroot-changesoundscapeselect",
        });
        this.populateChangeSoundscapeButton();
        this.changeSoundscapeSelect.addEventListener(
            "change",
            (event: Event) => {
                this.changeSoundscape(
                    (event?.target as HTMLSelectElement).value
                );
            }
        );

        this.nowPlayingRoot = this.statusBarItem.createEl("div", {
            cls: "soundscapesroot-nowplaying",
        });
        this.nowPlaying = this.nowPlayingRoot.createEl("div", {
            cls: "soundscapesroot-nowplaying-text",
        });
        this.toggleNowPlayingScroll();

        this.volumeButton = this.statusBarItem.createEl("button", {
            cls: "soundscapesroot-volumebutton",
        });
        this.volumeIconSpan = this.volumeButton.createSpan();
        this.updateVolumeIcon(this.settings.volume);
        this.volumeButton.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            if (
                this.volumePopup.hasClass(
                    "soundscapesroot-volumePopup--visible"
                )
            ) {
                this.volumePopup.removeClass(
                    "soundscapesroot-volumePopup--visible"
                );
            } else {
                this.volumePopup.addClass(
                    "soundscapesroot-volumePopup--visible"
                );
            }
        };

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
            if (
                this.volumePopup.hasClass(
                    "soundscapesroot-volumePopup--visible"
                )
            ) {
                this.volumePopup.removeClass(
                    "soundscapesroot-volumePopup--visible"
                );
            }
        };
        document.addEventListener("click", this.closeVolumePopupHandler);
        this.volumePopup.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
        });
    }

    populateChangeSoundscapeButton() {
        if (!this.changeSoundscapeSelect) return;

        this.changeSoundscapeSelect.replaceChildren();

        const ambientGroup = this.changeSoundscapeSelect.createEl(
            "optgroup",
            { attr: { label: "📻 Ambient Streams" } }
        );
        Object.values(SOUNDSCAPES).forEach((soundscape) => {
            ambientGroup.createEl("option", {
                text: soundscape.name,
                value: soundscape.id,
            });
        });

        const validCustomPlaylists = this.settings.customSoundscapes.filter(
            (cs) => cs.tracks && cs.tracks.length > 0
        );
        if (validCustomPlaylists.length > 0) {
            const youtubeGroup = this.changeSoundscapeSelect.createEl(
                "optgroup",
                { attr: { label: "▶𝚈𝚘𝚞𝚝𝚞𝚋𝚎" } }
            );
            validCustomPlaylists.forEach((customSoundscape) => {
                youtubeGroup.createEl("option", {
                    text: customSoundscape.name,
                    value: `${SOUNDSCAPE_TYPE.CUSTOM}_${customSoundscape.id}`,
                });
            });
        }

        if (
            this.settings.musicCollections &&
            this.settings.musicCollections.length > 0
        ) {
            const localGroup = this.changeSoundscapeSelect.createEl(
                "optgroup",
                { attr: { label: "📁 Local Music Libraries" } }
            );
            this.settings.musicCollections.forEach((collection) => {
                localGroup.createEl("option", {
                    text: collection.name,
                    value: `MUSIC_COLLECTION_${collection.id}`,
                });
            });
        }

        this.changeSoundscapeSelect.value = this.settings.soundscape;
    }

    /******************************************************************************************************************/
    //#endregion Create UI Elements
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Control Player
    /******************************************************************************************************************/

    play() {
        if (this.isLocalPlayerActive()) {
            this.localPlayer.play();
        } else {
            this.player?.playVideo();
        }
    }
    pause() {
        if (this.isLocalPlayerActive()) {
            this.localPlayer.pause();
        } else {
            this.player?.pauseVideo();
        }
    }

   previous() {
        this.useYtdlFallback = false;
       if (this.playTimeout) {
           clearTimeout(this.playTimeout);
           this.playTimeout = null;
       }
       this.playbackRequestId++;
        this.activePlaybackKey = null;
        this.updateLocalPlayerState({ isYtdlFallback: false });
        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();
            const total = customSoundscape?.tracks.length || 0;

            if (customSoundscape?.isNativePlaylist) {
                this.currentPlayingId = null;
                this.localPlayer.pause();
                this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
                this.showYouTubePlayer();
                if (this.player && typeof this.player.previousVideo === "function") {
                    this.player.previousVideo();
                }
                return;
            }

            if (total > 0) {
                if (this.settings.playMode === "shuffle") {
                    let newIndex = this.currentTrackIndex;
                    if (total > 1) {
                        while (newIndex === this.currentTrackIndex) {
                            newIndex = Math.floor(Math.random() * total);
                        }
                    }
                    this.currentTrackIndex = newIndex;
                } else {
                    if (this.currentTrackIndex === 0) {
                        this.currentTrackIndex = total - 1;
                    } else {
                        this.currentTrackIndex--;
                    }
                }
            }
        } else if (this.isMusicCollectionActive()) {
            if (this.settings.playMode === "shuffle") {
                if (this.shuffleQueue.length === 0) {
                    this.shuffleQueue = createShuffleQueue(
                        this.settings.myMusicIndex
                    );
                    this.shuffleQueueSpot = 0;
                }

                if (this.shuffleQueueSpot === 0) {
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueue.length - 1];
                } else {
                    this.shuffleQueueSpot--;
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueueSpot];
                }
            } else {
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

    next() {
        this.useYtdlFallback = false;
        if (this.playTimeout) {
            clearTimeout(this.playTimeout);
            this.playTimeout = null;
        }
        this.playbackRequestId++;
        this.activePlaybackKey = null;
        this.updateLocalPlayerState({ isYtdlFallback: false });

        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            const customSoundscape = this.getCurrentCustomSoundscape();
            const total = customSoundscape?.tracks.length || 0;
            
            // Native Playlist Handling (Keep the agent's fixes!)
            if (customSoundscape?.isNativePlaylist) {
                this.currentPlayingId = null;
                this.localPlayer.pause();
                this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
                this.showYouTubePlayer();
                if (this.player && typeof this.player.nextVideo === "function") {
                    this.player.nextVideo();
                }
                return;
            }

            if (total > 0) {
                if (this.settings.playMode === "shuffle") {
                    let newIndex = this.currentTrackIndex;
                    // Pick a random track that isn't the current one
                    if (total > 1) {
                        while (newIndex === this.currentTrackIndex) {
                            newIndex = Math.floor(Math.random() * total);
                        }
                    }
                    this.currentTrackIndex = newIndex;
                } else {
                    // 🔥 3-STATE LOGIC: Sequential handling for Repeat and Neutral
                    if (customSoundscape?.tracks[this.currentTrackIndex + 1]) {
                        this.currentTrackIndex++;
                    } else {
                        if (this.settings.playMode === "repeat") {
                            this.currentTrackIndex = 0;
                        } else {
                            // Neutral: Stop at the end of the list
                            this.pause();
                            return;
                        }
                    }
                }
            }
        } else if (this.isMusicCollectionActive()) {
            if (this.settings.playMode === "shuffle") {
                if (this.shuffleQueue.length === 0) {
                    this.shuffleQueue = createShuffleQueue(
                        this.settings.myMusicIndex
                    );
                    this.shuffleQueueSpot = 0;
                }

                if (this.shuffleQueueSpot === this.shuffleQueue.length - 1) {
                    this.currentTrackIndex = this.shuffleQueue[0];
                    this.shuffleQueue = [];
                    this.shuffleQueueSpot = 0;
                } else {
                    this.shuffleQueueSpot++;
                    this.currentTrackIndex =
                        this.shuffleQueue[this.shuffleQueueSpot];
                }
            } else {
                // 🔥 3-STATE LOGIC: Sequential handling for Repeat and Neutral
                if (this.settings.myMusicIndex[this.currentTrackIndex + 1]) {
                    this.currentTrackIndex++;
                } else {
                    if (this.settings.playMode === "repeat") {
                        this.currentTrackIndex = 0;
                    } else {
                        // Neutral: Stop at the end of the list
                        this.pause();
                        return;
                    }
                }
            }
        }
        this.onSoundscapeChange();
    }

    seek(time: number) {
        if (this.isLocalPlayerActive()) {
            this.localPlayer.currentTime = time;
        } else {
            if (this.player && typeof this.player.seekTo === "function") {
                this.player.seekTo(time, true);
            }
        }
    }

    changeMyMusicTrack(fileName: string) {
        this.useYtdlFallback = false;
        this.onSoundscapeChange();
    }

    toggleShuffle() {
        this.settings.playMode = this.settings.playMode === "shuffle" ? "neutral" : "shuffle";
        this.saveSettings();

        if (this.settings.playMode === "shuffle") {
            this.shuffleQueue = [];
            this.shuffleQueueSpot = 0;
        }
        this.updateRepeatToggleIcon();
        this.settingsObservable.setValue(this.settings); // Force React UI to update
    }

    toggleRepeat() {
        this.settings.playMode = this.settings.playMode === "repeat" ? "neutral" : "repeat";
        this.saveSettings();
        
        this.updateRepeatToggleIcon();
        this.settingsObservable.setValue(this.settings); // Force React UI to update
    }

    updateRepeatToggleIcon() {
        if (this.settings.playMode === "repeat") {
            setIcon(this.repeatToggleButton, "repeat");
            this.repeatToggleButton.addClass("soundscapesroot-repeattogglebutton--active"); // Optional CSS class for highlight
        } else if (this.settings.playMode === "shuffle") {
            setIcon(this.repeatToggleButton, "shuffle");
            this.repeatToggleButton.addClass("soundscapesroot-repeattogglebutton--active");
        } else {
            // Neutral
            setIcon(this.repeatToggleButton, "arrow-right"); // Or a "play" icon indicating normal flow
            this.repeatToggleButton.removeClass("soundscapesroot-repeattogglebutton--active");
        }
        
        // Cycle logic
        this.repeatToggleButton.onclick = () => {
            if (this.settings.playMode === "neutral") this.toggleShuffle();
            else if (this.settings.playMode === "shuffle") this.toggleRepeat();
            else this.toggleRepeat(); // Turns repeat off, going to neutral
        };
    }

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
                this.currentTrackIndex =
                    savedIndex < this.settings.myMusicIndex.length
                        ? savedIndex
                        : 0;
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

    onPlayerReady() {
        this.onSoundscapeChange(this.settings.autoplay);
    }

    onStateChange({ data: state }: { data: PLAYER_STATE }) {
        if (this.soundscapeType === SOUNDSCAPE_TYPE.STANDARD) {
            this.previousButton.hide();
            this.nextButton.hide();
            this.repeatToggleButton.hide();
        } else {
            this.previousButton.show();
            this.nextButton.show();
            this.repeatToggleButton.show();
        }

        const selectedTrackData = this.getCurrentTrackData();
        const stateTrackData = this.localPlayerStateObservable.getValue().currentTrack;
        const currentTrackData = selectedTrackData && stateTrackData?.fullPath === selectedTrackData.fullPath
            ? {
                ...selectedTrackData,
                duration: stateTrackData.duration || selectedTrackData.duration,
            }
            : selectedTrackData ?? stateTrackData;

        switch (state) {
            case PLAYER_STATE.UNSTARTED:
                this.playButton.show();
                this.pauseButton.hide();
                break;
            case PLAYER_STATE.PLAYING:
                this.playButton.hide();
                this.pauseButton.show();
                this.updateLocalPlayerState({
                    currentTrack: currentTrackData,
                    playerState: PLAYER_STATE.PLAYING,
                });
                break;
            case PLAYER_STATE.PAUSED:
                this.playButton.show();
                this.pauseButton.hide();
                this.updateLocalPlayerState({
                    currentTrack: currentTrackData,
                    playerState: PLAYER_STATE.PAUSED,
                });
                break;
            case PLAYER_STATE.ENDED:
                // Native Playlists (RD...) handle their own queue. 
                // If the video ends, we just let the IFrame sit there.
                if (
                    this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM &&
                    this.getCurrentCustomSoundscape()?.isNativePlaylist
                ) {
                    break; 
                }

                // "Repeat One" logic (if playMode is "repeat")
                if (this.settings.playMode === "repeat") {
                    if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM && !this.useYtdlFallback) {
                        // Repeat IFrame video
                        this.player?.seekTo(0);
                        this.player?.playVideo();
                    } else if (this.isMusicCollectionActive() || this.useYtdlFallback) {
                        // Repeat Local audio or yt-dlp audio
                        this.localPlayer.currentTime = 0;
                        void this.localPlayer.play();
                    }
                } 
                // "Neutral" or "Shuffle" or "Repeat All" (handled by next())
                else {
                    this.next();
                }
                break;
        }
    }

    onVolumeChange(e: any) {
        const volume = parseInt(e.target.value);
        this.volumeSlider.value = e.target.value;
        if (this.player && typeof this.player.setVolume === "function") {
            this.player.setVolume(volume);
        }
        this.localPlayer.volume = volume / 100;

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

    async onSoundscapeChange(autoplay = true) {
        if (!this.nowPlaying) return;

        if (this.settings.soundscape.startsWith(`${SOUNDSCAPE_TYPE.CUSTOM}_`)) {
            this.soundscapeType = SOUNDSCAPE_TYPE.CUSTOM;
        } else if (this.isMusicCollectionActive()) {
            this.soundscapeType = SOUNDSCAPE_TYPE.MY_MUSIC;
        } else {
            this.soundscapeType = SOUNDSCAPE_TYPE.STANDARD;
        }

        const customSoundscape = this.getCurrentCustomSoundscape();
        const currentTrackData = this.getCurrentTrackData();
        const soundscapeChanged = this.activeSoundscapeId !== this.settings.soundscape;
        const trackChanged = !customSoundscape?.isNativePlaylist &&
            !!currentTrackData &&
            currentTrackData.fullPath !== this.currentPlayingId;

        if (soundscapeChanged || trackChanged) {
            this.playbackRequestId++;
            if (this.playTimeout) {
                clearTimeout(this.playTimeout);
                this.playTimeout = null;
            }
            this.currentPlayingId = customSoundscape?.isNativePlaylist
                ? null
                : currentTrackData?.fullPath ?? null;
            this.useYtdlFallback = false;
            this.activePlaybackKey = null;
            this.updateLocalPlayerState({ isYtdlFallback: false });
        }
        this.activeSoundscapeId = this.settings.soundscape;

        let displayedTrackData = currentTrackData;
        if (this.soundscapeType === SOUNDSCAPE_TYPE.CUSTOM) {
            if (customSoundscape?.isNativePlaylist && customSoundscape.nativePlaylistId) {
                const nativeTrackData = this.useYtdlFallback
                    ? this.getNativeTrackData()
                    : undefined;
                if (this.useYtdlFallback && !nativeTrackData) return;
                displayedTrackData = nativeTrackData ?? currentTrackData;

                if (this.useYtdlFallback && nativeTrackData) {
                    const playbackKey = `${this.settings.soundscape}:audio:${nativeTrackData.fullPath}`;
                    if (this.activePlaybackKey !== playbackKey) {
                        if (this.playTimeout) {
                            clearTimeout(this.playTimeout);
                            this.playTimeout = null;
                        }
                        const requestId = ++this.playbackRequestId;
                        this.activePlaybackKey = playbackKey;
                        this.statusBarItem.addClass("soundscapesroot--hideyoutube");
                        this.player?.pauseVideo();
                        this.updateLocalPlayerState({
                            currentTrack: nativeTrackData,
                            currentTime: 0,
                            isYtdlFallback: true,
                        });

                        try {
                            const streamUrl = await getYtdlStreamUrl(
                                `https://www.youtube.com/watch?v=${nativeTrackData.fullPath}`
                            );
                            if (
                                requestId !== this.playbackRequestId ||
                                !this.useYtdlFallback ||
                                this.currentPlayingId !== nativeTrackData.fullPath
                            ) return;

                            this.localPlayer.src = streamUrl;
                            if (autoplay) void this.localPlayer.play();
                        } catch (e: any) {
                            if (requestId !== this.playbackRequestId) return;
                            this.activePlaybackKey = null;
                            console.error("yt-dlp extraction failed:", e);
                            new Notice("Failed to extract video.");
                            setTimeout(() => {
                                if (
                                    requestId === this.playbackRequestId &&
                                    this.currentPlayingId === nativeTrackData.fullPath
                                ) this.next();
                            }, 1500);
                            return;
                        }
                    }
                    this.nowPlaying.setText(nativeTrackData.title || customSoundscape.name);
                } else {
                    const playlistId = customSoundscape.nativePlaylistId;
                    const playbackKey = `${this.settings.soundscape}:playlist:${playlistId}`;
                    this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
                    this.localPlayer.pause();
                    this.showYouTubePlayer();
                    this.nowPlaying.setText(customSoundscape.name || "Native Playlist");

                    if (
                        this.player &&
                        typeof this.player.loadPlaylist === "function" &&
                        this.activePlaybackKey !== playbackKey
                    ) {
                        if (this.playTimeout) {
                            clearTimeout(this.playTimeout);
                            this.playTimeout = null;
                        }
                        const requestId = ++this.playbackRequestId;
                        this.activePlaybackKey = playbackKey;
                        this.playTimeout = setTimeout(() => {
                            if (requestId !== this.playbackRequestId) return;
                            this.player.loadPlaylist({
                                list: playlistId,
                                listType: "playlist",
                                index: 0,
                            });
                            if (!autoplay) this.player.pauseVideo();
                        }, 100);
                    }
                }
            } else {
                const track = customSoundscape?.tracks[this.currentTrackIndex];
                if (track) {
                    this.nowPlaying.setText(track.name || "");
                    if (this.useYtdlFallback) {
                        const trackData = currentTrackData;
                        if (!trackData) return;
                        displayedTrackData = trackData;
                        const playbackKey = `${this.settings.soundscape}:audio:${track.id}`;
                        this.statusBarItem.addClass("soundscapesroot--hideyoutube");
                        this.player?.pauseVideo();

                        if (this.activePlaybackKey !== playbackKey) {
                            if (this.playTimeout) {
                                clearTimeout(this.playTimeout);
                                this.playTimeout = null;
                            }
                            const requestId = ++this.playbackRequestId;
                            this.activePlaybackKey = playbackKey;
                            this.updateLocalPlayerState({
                                currentTrack: trackData,
                                currentTime: 0,
                                isYtdlFallback: true,
                            });
                            try {
                                const streamUrl = await getYtdlStreamUrl(
                                    `https://www.youtube.com/watch?v=${track.id}`
                                );
                                if (
                                    requestId !== this.playbackRequestId ||
                                    !this.useYtdlFallback ||
                                    this.currentPlayingId !== track.id
                                ) return;

                                this.localPlayer.src = streamUrl;
                                if (autoplay) void this.localPlayer.play();
                            } catch (e: any) {
                                if (requestId !== this.playbackRequestId) return;
                                this.activePlaybackKey = null;
                                console.error("yt-dlp extraction failed:", e);
                                new Notice("Failed to extract video.");
                                setTimeout(() => {
                                    if (
                                        requestId === this.playbackRequestId &&
                                        this.currentPlayingId === track.id
                                    ) this.next();
                                }, 1500);
                                return;
                            }
                        }
                    } else {
                        const playbackKey = `${this.settings.soundscape}:iframe:${track.id}`;
                        this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
                        this.localPlayer.pause();
                        this.updateLocalPlayerState({ isYtdlFallback: false });
                        this.showYouTubePlayer();

                        if (
                            this.player &&
                            typeof this.player.loadVideoById === "function" &&
                            this.activePlaybackKey !== playbackKey
                        ) {
                            if (this.playTimeout) {
                                clearTimeout(this.playTimeout);
                                this.playTimeout = null;
                            }
                            const requestId = ++this.playbackRequestId;
                            this.activePlaybackKey = playbackKey;
                            this.playTimeout = setTimeout(() => {
                                if (requestId !== this.playbackRequestId) return;
                                this.player.loadVideoById({ videoId: track.id });
                                if (!autoplay) this.player.pauseVideo();
                            }, 100);
                        }
                    }
                }
            }
        } else if (this.isMusicCollectionActive()) {
            // Local Music Logic
            const track = this.settings.myMusicIndex[this.currentTrackIndex];

            if (track) {
                const playbackKey = `${this.settings.soundscape}:local:${track.fullPath}`;
                if (this.activePlaybackKey === playbackKey) return;
                if (this.playTimeout) {
                    clearTimeout(this.playTimeout);
                    this.playTimeout = null;
                }
                this.activePlaybackKey = playbackKey;
                this.playbackRequestId++;
                const fileData = fs.readFileSync(track.fullPath);
                const base64Data = fileData.toString("base64");

                this.localPlayer.pause();
                const ext = track.fullPath.split(".").pop()?.toLowerCase() || "mp3";
                this.localPlayer.src = `data:${getMimeType(ext)};base64,${base64Data}`;

                this.nowPlaying.setText(`${track.title} - ${track.artist}`);
                this.updateLocalPlayerState({ isYtdlFallback: false });

                if (autoplay) {
                    this.localPlayer.play();
                }
            } else {
                this.localPlayer.src = "";
                this.nowPlaying.setText("");
            }

            this.statusBarItem.addClass("soundscapesroot--hideyoutube");
            if (this.player && typeof this.player.pauseVideo === "function") {
                this.player.pauseVideo();
            }
        } else {
            // Ambient Streams Logic
            const ambient = SOUNDSCAPES[this.settings.soundscape];
            if (ambient) {
                const playbackKey = `${this.settings.soundscape}:iframe:${ambient.youtubeId}`;
                this.statusBarItem.removeClass("soundscapesroot--hideyoutube");
                this.showYouTubePlayer();
                this.localPlayer.pause();
                this.updateLocalPlayerState({ isYtdlFallback: false });
                if (
                    this.player &&
                    typeof this.player.loadVideoById === "function" &&
                    this.activePlaybackKey !== playbackKey
                ) {
                    if (this.playTimeout) {
                        clearTimeout(this.playTimeout);
                        this.playTimeout = null;
                    }
                    const requestId = ++this.playbackRequestId;
                    this.activePlaybackKey = playbackKey;
                    this.playTimeout = setTimeout(() => {
                        if (requestId !== this.playbackRequestId) return;
                        this.player.loadVideoById({ videoId: ambient.youtubeId });
                        if (ambient.isLiveVideo && typeof this.player.seekTo === "function") {
                            this.player.seekTo(this.player.getDuration());
                        }
                        if (!autoplay && typeof this.player.pauseVideo === "function") {
                            this.player.pauseVideo();
                        }
                    }, 1000);
                }
                this.nowPlaying.setText(ambient.nowPlayingText);
            }
        }

        const currentStateTrack = this.localPlayerStateObservable.getValue().currentTrack;
        const preserveFallbackTrack = this.useYtdlFallback &&
            !!displayedTrackData &&
            currentStateTrack?.fullPath === displayedTrackData.fullPath;

        this.updateLocalPlayerState({
            ...(displayedTrackData && !preserveFallbackTrack
                ? { currentTrack: displayedTrackData }
                : {}),
            ...(this.soundscapeType !== SOUNDSCAPE_TYPE.CUSTOM || !this.useYtdlFallback
                ? {
                    playerState: autoplay ? PLAYER_STATE.PLAYING : PLAYER_STATE.PAUSED,
                    currentTime: 0,
                }
                : { isYtdlFallback: true }),
        });

        this.changeSoundscapeSelect.value = this.settings.soundscape;
        this.saveSettings();
    }

    /******************************************************************************************************************/
    //#endregion Events
    /******************************************************************************************************************/

    /******************************************************************************************************************/
    //#region Settings and State
    /******************************************************************************************************************/

    async loadSettings() {
        const data = (await this.loadData()) || {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

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

        if (this.settings.soundscape === SOUNDSCAPE_TYPE.MY_MUSIC) {
            this.settings.soundscape = "lofi";
        }

        if (
            this.settings.soundscape.startsWith("MUSIC_COLLECTION_") &&
            !this.getActiveMusicCollection()
        ) {
            this.settings.soundscape = "lofi";
        }
    }

    async saveSettings() {
        this.settings.currentTrackIndex = this.currentTrackIndex;

        const collection = this.getActiveMusicCollection();
        if (collection) {
            collection.currentTrackIndex = this.currentTrackIndex;
        }

        this.settingsObservable.setValue(this.settings);
        await this.saveData(this.settings);
    }

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