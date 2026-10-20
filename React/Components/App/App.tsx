import React, { useEffect, useState } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import Header from "../Header/Header";
import secondsToMinutesAndSeconds from "../../Utils/secondsToMinutesAndSeconds";
import { LocalPlayerState } from "src/Types/Interfaces";
import { PLAYER_STATE } from "src/Types/Enums";
import { SoundscapesPluginSettings } from "src/Settings/Settings";
import SOUNDSCAPES from "src/Soundscapes";
import Search from "../Search/Search";
import { InputModal } from "../Modals/InputModal";
import { requestUrl } from "obsidian"; // 🔥 Top-level import

// ==========================================
// HELPER FUNCTION (For Option A - Static)
// ==========================================
async function fetchPlaylistTracks(playlistId: string) {
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const response = await requestUrl({ url });
    const html = response.text;
    
    // The ytInitialData variable is still there, but its structure changed
    const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (!match) return [];

    try {
        const data = JSON.parse(match[1]);
        const tracks: any[] = [];

        const findVideos = (obj: any) => {
            if (!obj || typeof obj !== "object") return;
            
            // 🔥 NEW: Check for lockupViewModel (current structure)
            if (obj.lockupViewModel) {
                const lockup = obj.lockupViewModel;
                // Only process video lockups
                if (lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && lockup.contentId) {
                    const title = lockup.metadata?.lockupMetadataViewModel?.title?.content 
                        || lockup.metadata?.lockupMetadataViewModel?.title?.text 
                        || "Unknown Video";
                    
                    tracks.push({
                        id: lockup.contentId,
                        name: title
                    });
                }
            }
            
            // Fallback for older structures (still useful)
            if (obj.playlistVideoRenderer) {
                const video = obj.playlistVideoRenderer;
                if (video.videoId && video.title?.runs?.[0]?.text) {
                    tracks.push({
                        id: video.videoId,
                        name: video.title.runs[0].text
                    });
                }
            }
            
            for (const key in obj) {
                findVideos(obj[key]);
            }
        };

        findVideos(data);
        return tracks;
    } catch (e) {
        console.error("Failed to parse ytInitialData", e);
        return [];
    }
}

type ViewContext = { type: "home" | "ambient" | "youtube" | "local"; id: string | null; label: string; };

interface UnifiedTrack {
	id: string; title: string; artist: string; album: string; duration: number;
	source: "ambient" | "youtube" | "local"; nativeTrackRef: any;
}

const App = () => {
    const { settingsObservable, localPlayerStateObservable, plugin } = useObsidianPluginContext();
    const [settings, setSettings] = useState<SoundscapesPluginSettings>(settingsObservable?.getValue());
    const [localPlayerState, setLocalPlayerState] = useState<LocalPlayerState>(localPlayerStateObservable?.getValue());
    const [activeView, setActiveView] = useState<ViewContext>({ type: "home", id: null, label: "Library" });
    const [expanded, setExpanded] = useState({ ambient: false, youtube: false, collections: false });
	  const [modalType, setModalType] = useState<"playlist" | "track" | "import" | null>(null);

    useEffect(() => {
        const unsubSettings = settingsObservable?.onChange((s: any) => setSettings(s));
        const unsubState = localPlayerStateObservable?.onChange((s: any) => setLocalPlayerState(s));
        return () => { unsubSettings?.(); unsubState?.(); };
    }, [settingsObservable, localPlayerStateObservable]);

    useEffect(() => {
        if (!settings?.soundscape) return;
        const id = settings.soundscape;
        if (id.startsWith("CUSTOM_")) {
            const target = settings.customSoundscapes?.find(p => p.id === id.replace("CUSTOM_", ""));
            setActiveView({ type: "youtube", id: target?.id || null, label: target?.name || "YouTube Playlist" });
        } else if (id.startsWith("MUSIC_COLLECTION_")) {
            const target = settings.musicCollections?.find(c => c.id === id.replace("MUSIC_COLLECTION_", ""));
            setActiveView({ type: "local", id: target?.id || null, label: target?.name || "Local Music" });
        } else {
            const ambient = SOUNDSCAPES[id];
            setActiveView(ambient ? { type: "ambient", id: id, label: ambient.name } : { type: "home", id: null, label: "Library" });
        }
    }, [settings?.soundscape]);

    if (!settings) {
        return (
            <div className="soundscapes-holistic-container" style={{ padding: 24, color: "var(--fg)" }}>
                <p>Soundscapes: waiting for settings to load...</p>
            </div>
        );
    }

	const getTracksForView = (): UnifiedTrack[] => {
		if (activeView.type === "ambient" && activeView.id) {
			const stream = SOUNDSCAPES[activeView.id];
			return stream ? [{ id: stream.id, title: stream.name, artist: "Ambient Stream", album: "Soundscapes", duration: 0, source: "ambient", nativeTrackRef: stream }] : [];
		}
		if (activeView.type === "youtube" && activeView.id) {
            const target = settings.customSoundscapes?.find(p => p.id === activeView.id);
            
            // 🔥 FIX: Handle Native Playlists
            if (target?.isNativePlaylist) {
                return [{
                    id: target.id,
                    title: target.name + " (YouTube Mix)",
                    artist: "Dynamic Stream",
                    album: "YouTube",
                    duration: 0,
                    source: "youtube",
                    nativeTrackRef: { id: target.nativePlaylistId, name: target.name }
                }];
            }

            // Standard Static Playlist
            return target ? target.tracks.map((track, idx) => ({
                id: `${track.id}_${idx}`, title: track.name, artist: "YouTube Stream",
                album: target.name, duration: 0, source: "youtube", nativeTrackRef: track
            })) : [];
        }
		if (activeView.type === "local") {
			return settings.myMusicIndex.map(song => ({
				id: song.fullPath, title: song.title || song.fileName, artist: song.artist || "Unknown Artist", album: song.album || "Unknown Album", duration: song.duration || 0, source: "local", nativeTrackRef: song
			}));
		}
		return [];
	};

	const handleTrackPlay = (track: UnifiedTrack) => {
		if (!plugin) return;

		if (track.source === "local") {
			plugin.changeMyMusicTrack(track.nativeTrackRef.fileName);
		} else if (track.source === "youtube") {
            const target = settings.customSoundscapes?.find(p => p.id === activeView.id);
            
            // 🔥 FIX: Handle Native Playlist Playback
            if (target?.isNativePlaylist) {
                plugin.changeSoundscape(`CUSTOM_${target.id}`);
                return;
            }

			plugin.settings.soundscape = `CUSTOM_${activeView.id}`;
			plugin.saveSettings();
			
			const trackIdx = target ? target.tracks.findIndex((t: any) => t.id === track.nativeTrackRef.id) : 0;
			plugin.currentTrackIndex = trackIdx >= 0 ? trackIdx : 0;
			plugin.onSoundscapeChange();
		} else if (track.source === "ambient") {
			plugin.changeSoundscape(track.nativeTrackRef.id);
		}
	};

	const currentTracks = getTracksForView();

	const renderSidebar = () => (
		<aside className="soundscapes-sidebar-aside">
			<div className="nav-header-title">Library Sources</div>
			
			{/* Ambient Group */}
			<div className="nav-group">
				<div className="nav-group-header" onClick={() => setExpanded(p => ({ ...p, ambient: !p.ambient }))}>
					<span className="chevron">{expanded.ambient ? "▼" : "▶"}</span>
					<Icon name="radio-tower" /> <span>Ambient Streams</span>
				</div>
				{expanded.ambient && (
					<div className="nav-group-items">
						{Object.values(SOUNDSCAPES).map(s => (
							<div key={s.id} className={`nav-item ${activeView.type === "ambient" && activeView.id === s.id ? "is-active" : ""}`}
								onClick={() => (plugin as any).changeSoundscape?.(s.id)}>
								{s.name}
							</div>
						))}
					</div>
				)}
			</div>

			{/* YouTube Group */}
			<div className="nav-group">
				<div className="nav-group-header" onClick={() => setExpanded(p => ({ ...p, youtube: !p.youtube }))}>
					<span className="chevron">{expanded.youtube ? "▼" : "▶"}</span>
					<Icon name="youtube" /> <span>YouTube Playlists</span>
					<button className="nav-add-btn" onClick={(e) => { e.stopPropagation(); setModalType("import"); }} title="Import Playlist" style={{ marginLeft: 'auto' }}>
						<Icon name="download" />
					</button>
					<button className="nav-add-btn" onClick={(e) => { e.stopPropagation(); setModalType("playlist"); }} title="Create Blank Playlist" style={{ marginLeft: '4px' }}>
						+
					</button>
				</div>
				{expanded.youtube && (
					<div className="nav-group-items">
						{settings.customSoundscapes.map(list => (
							<div key={list.id} className={`nav-item ${activeView.type === "youtube" && activeView.id === list.id ? "is-active" : ""}`}
								onClick={() => (plugin as any).changeSoundscape?.(`CUSTOM_${list.id}`)}>
								<span className="nav-item-name">{list.name}</span>
								<button className="nav-delete-btn" onClick={(e) => {
									e.stopPropagation();
									if (!plugin) return;
									plugin.settings.customSoundscapes = plugin.settings.customSoundscapes.filter(p => p.id !== list.id);
									plugin.saveSettings();
									plugin.populateChangeSoundscapeButton();
									plugin.settingsObservable.setValue(plugin.settings);
								}} title="Delete Playlist">
									<Icon name="trash-2" />
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Collections Group */}
			{settings.musicCollections?.length > 0 && (
				<div className="nav-group">
					<div className="nav-group-header" onClick={() => setExpanded(p => ({ ...p, collections: !p.collections }))}>
						<span className="chevron">{expanded.collections ? "▼" : "▶"}</span>
						<Icon name="folder" /> <span>Collections</span>
						<button className="nav-add-btn" onClick={async (e) => { 
							e.stopPropagation(); 
							const { remote } = (window as any).require("electron");
							const res = await remote.dialog.showOpenDialog({ properties: ["openDirectory"] });
							if (!res.canceled && res.filePaths.length > 0) {
								if (plugin && typeof (plugin as any).addMusicCollection === "function") {
									(plugin as any).addMusicCollection(res.filePaths[0]);
								}
							}
						}} title="Add Local Folder">+</button>
					</div>
					{expanded.collections && (
						<div className="nav-group-items">
							{settings.musicCollections.map(col => (
								<div key={col.id} className={`nav-item ${activeView.type === "local" && activeView.id === col.id ? "is-active" : ""}`}
									onClick={() => (plugin as any).changeSoundscape?.(`MUSIC_COLLECTION_${col.id}`)}>
									{col.name}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</aside>
	);

	return (
		<div className="soundscapes-holistic-container">
			<Header />
			<div className="soundscapes-split-workspace">
				{renderSidebar()}
				<main className="soundscapes-main-content">
					<div className="track-list-header">
						<h2>{activeView.label || "My Mix"}</h2>
                        {/* Hide Add Track for Native Playlists */}
                        {activeView.type === "youtube" && !settings.customSoundscapes.find(p => p.id === activeView.id)?.isNativePlaylist && (
                            <button className="btn-add-track" onClick={() => setModalType("track")}>
                                + Add Track
                            </button>
                        )}
						<div className="global-search-wrapper">
							<Search />
						</div>
					</div>
					
					<div className="track-list">
						<div className="track-header">
							<span className="col-idx">#</span>
							<span className="col-title">Title</span>
							<span className="col-artist">Artist</span>
							<span className="col-time">Time</span>
						</div>
						{currentTracks.map((track, i) => {
							const isCurrentTrack = 
								(track.source === "local" && localPlayerState.currentTrack?.fileName === track.nativeTrackRef?.fileName) ||
								(track.source === "youtube" && localPlayerState.currentTrack?.fullPath === track.nativeTrackRef?.id) ||
								(track.source === "ambient" && localPlayerState.currentTrack?.fileName === track.nativeTrackRef?.name);

							const isPlaying = isCurrentTrack && localPlayerState.playerState === PLAYER_STATE.PLAYING;

							return (
								<div key={track.id} className="track-row" onClick={() => handleTrackPlay(track)}>
									<span className="col-idx">
										{isPlaying ? (
											<div className="eq-live"><span className="eq-bar"/><span className="eq-bar"/><span className="eq-bar"/></div>
										) : i + 1}
									</span>
									<span className="col-title">{track.title}</span>
									<span className="col-artist">{track.artist}</span>
									<span className="col-time">{track.duration > 0 ? secondsToMinutesAndSeconds(track.duration) : "Stream"}</span>
									
									{track.source === "youtube" && !settings.customSoundscapes.find(p => p.id === activeView.id)?.isNativePlaylist && (
										<span className="col-delete">
											<button onClick={(e) => {
												e.stopPropagation();
												if (!plugin) return;
												const target = plugin.settings.customSoundscapes.find(p => p.id === activeView.id);
												if (target) {
													target.tracks = target.tracks.filter(t => t.id !== track.nativeTrackRef.id);
													plugin.saveSettings();
													plugin.settingsObservable.setValue(plugin.settings);
												}
											}}>
												<Icon name="trash-2" />
											</button>
										</span>
									)}
								</div>
							);
						})}
					</div>
				</main>
			</div>
            
        <InputModal 
            isOpen={modalType === "playlist"}
            title="Create New Playlist"
            fields={[{ key: "name", label: "Playlist Name", placeholder: "e.g., Chill Vibes" }]}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin) return;
                const newPlaylist = { id: crypto.randomUUID(), name: values.name, tracks: [] };
                plugin.settings.customSoundscapes.push(newPlaylist);
                plugin.saveSettings();
                plugin.populateChangeSoundscapeButton();
            }}
        />

        <InputModal 
            isOpen={modalType === "import"}
            title="Import YouTube Playlist"
            fields={[
                { key: "url", label: "Playlist URL or ID", placeholder: "https://youtube.com/playlist?list=..." },
                { key: "name", label: "Custom Name (Optional)", placeholder: "e.g., My Awesome Mix" }
            ]}
            onClose={() => setModalType(null)}
            onSubmit={async (values) => {
                if (!plugin) return;
                
                const match = values.url.match(/[&?]list=([^&]+)/);
                const listId = match ? match[1] : values.url.trim();
                if (!listId) { alert("Invalid Playlist URL or ID"); return; }

                const playlistName = values.name || "Imported Playlist";
                
                if (listId.startsWith("RD")) {
                    // OPTION B: Native Playlist
                    const newPlaylist: any = {
                        id: crypto.randomUUID(),
                        name: playlistName + " (Mix)",
                        tracks: [],
                        isNativePlaylist: true,
                        nativePlaylistId: listId
                    };
                    plugin.settings.customSoundscapes.push(newPlaylist);
                } else {
                    // OPTION A: Static Import
                    const newPlaylist: any = {
                        id: crypto.randomUUID(),
                        name: playlistName + " (Importing...)",
                        tracks: []
                    };
                    plugin.settings.customSoundscapes.push(newPlaylist);
                    plugin.saveSettings();
                    plugin.settingsObservable.setValue(plugin.settings);

                    try {
                        const tracks = await fetchPlaylistTracks(listId);
                        newPlaylist.name = playlistName;
                        newPlaylist.tracks = tracks;
                        if (tracks.length === 0) alert("No tracks found. The playlist might be private.");
                    } catch (e) {
                        console.error("Import failed", e);
                        alert("Failed to import playlist.");
                    }
                }

                // Final save and UI refresh
                plugin.saveSettings();
                plugin.populateChangeSoundscapeButton();
                plugin.settingsObservable.setValue(plugin.settings);
            }}
        />

        <InputModal 
            isOpen={modalType === "track"}
            title={`Add Track to ${activeView.label}`}
            fields={[
                { key: "name", label: "Track Name", placeholder: "e.g., Song Title" },
                { key: "id", label: "YouTube Video ID", placeholder: "e.g., dQw4w9WgXcQ" }
            ]}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin) return;
                const targetPlaylist = plugin.settings.customSoundscapes.find(p => p.id === activeView.id);
                if (targetPlaylist) {
                    targetPlaylist.tracks.push({ name: values.name, id: values.id });
                    plugin.saveSettings();
                    plugin.populateChangeSoundscapeButton();
                    plugin.settingsObservable.setValue(plugin.settings);
                }
            }}
        />
		</div>
	);
};

export default App;