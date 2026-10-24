import { PLAYER_STATE, SOUNDSCAPE_TYPE } from "./Enums";

export interface CustomSoundscape {
    id: string;
    name: string;
    tracks: CustomSoundscapeTrack[];
    isNativePlaylist?: boolean;
    nativePlaylistId?: string;
    sourceUrl?: string;
}

export interface CustomSoundscapeTrack {
    name: string;
    id: string;
}

export interface Soundscape {
    id: string;
    name: string;
    nowPlayingText: string;
    isLiveVideo: boolean;
    youtubeId: string;
    type: SOUNDSCAPE_TYPE;
}

// Documentation: https://developers.google.com/youtube/iframe_api_reference
export interface Player {
    playVideo(): void;
    pauseVideo(): void;
    seekTo(position: number, allowSeekAhead?: boolean): void;
    getDuration(): number;
    getCurrentTime(): number;
    getPlayerState(): number; // Added for the polling sync
    setVolume(volume: Number): void;
    loadVideoById(options: { videoId: String | undefined }): void;
    loadPlaylist(options: { list: string; listType: string; index?: number }): void;
    nextVideo(): void;
    previousVideo(): void;
    getVideoData(): { title: string; video_id: string; author: string };
    destroy(): void; // Keep this so the plugin cleans up audio on unload
}

export interface LocalMusicFile {
    fileName: string;
    fullPath: string;
    title: string | undefined | null;
    artist: string | undefined | null;
    album: string | undefined | null;
    duration: number | undefined | null;
}

export interface MusicCollection {
    id: string;
    name: string;
    folderPath: string;
    musicIndex: LocalMusicFile[];
    currentTrackIndex: number;
}

export interface LocalPlayerState {
    currentTrack?: LocalMusicFile | undefined;
    playerState?: PLAYER_STATE | undefined;
    currentTime?: number | undefined;
    isYtdlFallback?: boolean;
}
