import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import Header from "../Header/Header";
import secondsToMinutesAndSeconds from "../../Utils/secondsToMinutesAndSeconds";
import { LocalPlayerState } from "src/Types/Interfaces";
import { PLAYER_STATE } from "src/Types/Enums";
import { SoundscapesPluginSettings } from "src/Settings/Settings";
import SOUNDSCAPES from "src/Soundscapes";

// Define the navigation view context
type ViewContext = {
	type: "home" | "ambient" | "youtube" | "local";
	id: string | null;
	label: string;
};

// Define our unified track row structure
interface UnifiedTrack {
	id: string;
	title: string;
	artist: string;
	album: string;
	duration: number;
	source: "ambient" | "youtube" | "local";
	nativeTrackRef: any; // original item pointer to pass back to play functions
}

const App = () => {
	const { settingsObservable, localPlayerStateObservable, plugin } = useObsidianPluginContext();
	const [settings, setSettings] = useState<SoundscapesPluginSettings>(settingsObservable?.getValue());
	const [localPlayerState, setLocalPlayerState] = useState<LocalPlayerState>(localPlayerStateObservable?.getValue());

	// Fallback layout style configuration safely
	const layoutStyle = settings ? (settings as any).layoutStyle || "split" : "split";

	// Navigation panel tracking state
	const [activeView, setActiveView] = useState<ViewContext>({ type: "home", id: null, label: "Library" });
	const [ambientExpanded, setAmbientExpanded] = useState<boolean>(false);
	const [youtubeExpanded, setYoutubeExpanded] = useState<boolean>(true);
	const [localExpanded, setLocalExpanded] = useState<boolean>(true);

	/**
	 * Safe helper to trigger plugin context switches without repetitive type casting
	 */
	const handleSoundscapeChange = useCallback((soundscapeId: string) => {
		if (plugin && typeof (plugin as any).changeSoundscape === "function") {
			(plugin as any).changeSoundscape(soundscapeId);
		}
	}, [plugin]);

	/**
	 * Resolves any plugin setting soundscape string to our navigation active view state
	 */
	const syncViewFromSoundscapeId = useCallback((soundscapeId: string) => {
		if (!soundscapeId || !settings) {
			setActiveView({ type: "home", id: null, label: "Library" });
			return;
		}

		if (soundscapeId.startsWith("CUSTOM_")) {
			const targetId = soundscapeId.replace("CUSTOM_", "");
			const targetPlaylist = settings.customSoundscapes?.find(p => p.id === targetId);
			setActiveView({
				type: "youtube",
				id: targetId,
				label: targetPlaylist ? targetPlaylist.name : "YouTube Playlist"
			});
		} else if (soundscapeId.startsWith("MUSIC_COLLECTION_")) {
			const targetId = soundscapeId.replace("MUSIC_COLLECTION_", "");
			const targetCollection = settings.musicCollections?.find(c => c.id === targetId);
			setActiveView({
				type: "local",
				id: targetId,
				label: targetCollection ? targetCollection.name : "Local Music"
			});
		} else {
			const ambient = SOUNDSCAPES[soundscapeId];
			if (ambient) {
				setActiveView({ type: "ambient", id: soundscapeId, label: ambient.name });
			} else {
				setActiveView({ type: "home", id: null, label: "Library" });
			}
		}
	}, [settings]);

	// Synchronize settings changes from the main application thread
	useEffect(() => {
		const unsubscribe = settingsObservable?.onChange((newSettings: SoundscapesPluginSettings) => {
			setSettings(newSettings);
		});
		return () => unsubscribe?.();
	}, [settingsObservable]);

	// Listen to player state updates
	useEffect(() => {
		const unsubscribe = localPlayerStateObservable?.onChange((newState: LocalPlayerState) => {
			setLocalPlayerState(newState);
		});
		return () => unsubscribe?.();
	}, [localPlayerStateObservable]);

	// Auto-navigate to whichever playlist is currently running when loaded or switched
	useEffect(() => {
		if (settings?.soundscape) {
			syncViewFromSoundscapeId(settings.soundscape);
			
			const isAmbientActive = !settings.soundscape.startsWith("CUSTOM_") && !settings.soundscape.startsWith("MUSIC_COLLECTION_");
			if (isAmbientActive) {
				setAmbientExpanded(true);
			}
		}
	}, [settings?.soundscape, syncViewFromSoundscapeId]);

	/**
	 * Compiles list items for the primary navigation panel (Memoized for performance)
	 */
	const navigationItems = useMemo(() => {
		const items: Array<{ type: "youtube" | "local"; id: string; name: string; icon: string }> = [];
		if (!settings) return items;

		if (settings.customSoundscapes && settings.customSoundscapes.length > 0) {
			settings.customSoundscapes.forEach(list => {
				items.push({ type: "youtube", id: list.id, name: list.name, icon: "youtube" });
			});
		}

		if (settings.musicCollections && settings.musicCollections.length > 0) {
			settings.musicCollections.forEach(collection => {
				items.push({ type: "local", id: collection.id, name: collection.name, icon: "folder" });
			});
		} else if (settings.myMusicIndex && settings.myMusicIndex.length > 0) {
			items.push({ type: "local", id: "legacy_root", name: "Local Music Library", icon: "music" });
		}

		return items;
	}, [settings?.customSoundscapes, settings?.musicCollections, settings?.myMusicIndex]);

	/**
	 * Computes dynamic dataset row arrays based on the currently selected active view (Memoized)
	 */
	const currentTracks = useMemo((): UnifiedTrack[] => {
		if (!settings) return [];

		if (activeView.type === "ambient") {
			// If a specific stream ID is chosen, display it. Otherwise, display ALL streams together (Bug 2)
			if (activeView.id) {
				const stream = SOUNDSCAPES[activeView.id];
				return stream ? [{
					id: stream.id,
					title: stream.name,
					artist: "Ambient Stream",
					album: "Soundscapes",
					duration: 0,
					source: "ambient",
					nativeTrackRef: stream
				}] : [];
			} else {
				return Object.values(SOUNDSCAPES).map((stream: any) => ({
					id: stream.id,
					title: stream.name,
					artist: "Ambient Stream",
					album: "Soundscapes",
					duration: 0,
					source: "ambient",
					nativeTrackRef: stream
				}));
			}
		}

		if (activeView.type === "youtube" && activeView.id) {
			const targetPlaylist = settings.customSoundscapes?.find(p => p.id === activeView.id);
			if (!targetPlaylist || !targetPlaylist.tracks) return [];
			return targetPlaylist.tracks.map((track, idx) => {
				const ytTrack = track as any; // Safe-cast to read dynamic author & duration parameters
				return {
					id: `${track.id}_${idx}`,
					title: track.name,
					artist: ytTrack.author || ytTrack.channelName || "YouTube Creator",
					album: targetPlaylist.name,
					duration: ytTrack.duration || 0,
					source: "youtube",
					nativeTrackRef: track
				};
			});
		}

		if (activeView.type === "local") {
			return (settings.myMusicIndex || []).map(song => ({
				id: song.fullPath,
				title: song.title || song.fileName,
				artist: song.artist || "Unknown Artist",
				album: song.album || "Unknown Album",
				duration: song.duration || 0,
				source: "local",
				nativeTrackRef: song
			}));
		}

		return [];
	}, [activeView, settings?.customSoundscapes, settings?.myMusicIndex]);

	/**
	 * Triggers the correct back-end player actions depending on the source type
	 */
	const handleTrackPlay = useCallback((track: UnifiedTrack) => {
		if (!plugin) return;

		if (track.source === "local") {
			// Since nativeTrackRef is the track string/path payload from your music index, pass it directly!
			plugin.changeMyMusicTrack(track.nativeTrackRef);
		} else if (track.source === "youtube" || track.source === "ambient") {
			// Pass the track ID directly to trigger the specific video/stream playback
			plugin.changeMyMusicTrack(track.id);
		}
	}, [plugin]);

	// Render definitions for the unified Navigation List component
	const renderNavigationList = () => {
		const youtubeItems = settings?.customSoundscapes || [];
		const localCollections = settings?.musicCollections || [];

		return (
			<div className="soundscapes-nav-panel">
				<div className="soundscapes-nav-header">Library Sources</div>
				
				{/* Group 1: Ambient Streams */}
				<div className="soundscapes-nav-group">
					<div 
						className="soundscapes-nav-group-header"
						onClick={() => {
							setAmbientExpanded(!ambientExpanded);
							setActiveView({ type: "ambient", id: null, label: "Ambient Streams" });
						}}
						style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "6px 10px", color: "var(--text-muted)" }}
					>
						<span style={{ fontSize: "0.75rem", width: "12px", textAlign: "center" }}>{ambientExpanded ? "▼" : "▶"}</span>
						<Icon name="radio" />
						<span className="soundscapes-nav-text" style={{ fontWeight: 500 }}>Ambient Streams</span>
					</div>

					{ambientExpanded && (
						<div className="soundscapes-nav-group-items" style={{ marginLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
							{Object.values(SOUNDSCAPES).map((stream: any) => {
								const isSelected = activeView.type === "ambient" && activeView.id === stream.id;
								return (
									<div
										key={stream.id}
										className={`soundscapes-nav-item ${isSelected ? "is-active" : ""}`}
										onClick={(e) => {
											e.stopPropagation();
											handleSoundscapeChange(stream.id);
										}}
									>
										<span className="soundscapes-nav-icon">🎵</span>
										<span className="soundscapes-nav-text">{stream.name}</span>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Group 2: YouTube Custom Playlists */}
				<div className="soundscapes-nav-group" style={{ marginTop: "8px" }}>
					<div 
						className="soundscapes-nav-group-header"
						onClick={() => setYoutubeExpanded(!youtubeExpanded)}
						style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "6px 10px", color: "var(--text-muted)" }}
					>
						<span style={{ fontSize: "0.75rem", width: "12px", textAlign: "center" }}>{youtubeExpanded ? "▼" : "▶"}</span>
						<Icon name="youtube" />
						<span className="soundscapes-nav-text" style={{ fontWeight: 500 }}>YouTube Playlists</span>
					</div>

					{youtubeExpanded && (
						<div className="soundscapes-nav-group-items" style={{ marginLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
							{youtubeItems.map((list) => {
								const isSelected = activeView.type === "youtube" && activeView.id === list.id;
								return (
									<div
										key={list.id}
										className={`soundscapes-nav-item ${isSelected ? "is-active" : ""}`}
										onClick={() => handleSoundscapeChange(`CUSTOM_${list.id}`)}
									>
										<Icon name="youtube" />
										<span className="soundscapes-nav-text">{list.name}</span>
									</div>
								);
							})}
							{youtubeItems.length === 0 && (
								<div style={{ padding: "4px 24px", fontSize: "0.8em", color: "var(--text-muted)" }}>No custom streams</div>
							)}
						</div>
					)}
				</div>

				{/* Group 3: Local Music Collections */}
				<div className="soundscapes-nav-group" style={{ marginTop: "8px" }}>
					<div 
						className="soundscapes-nav-group-header"
						onClick={() => {
							setLocalExpanded(!localExpanded);
							setActiveView({ type: "local", id: null, label: "Local Music" });
						}}
						style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "6px 10px", color: "var(--text-muted)" }}
					>
						<span style={{ fontSize: "0.75rem", width: "12px", textAlign: "center" }}>{localExpanded ? "▼" : "▶"}</span>
						<Icon name="folder" />
						<span className="soundscapes-nav-text" style={{ fontWeight: 500 }}>Collections</span>
					</div>

					{localExpanded && (
						<div className="soundscapes-nav-group-items" style={{ marginLeft: "14px", display: "flex", flexDirection: "column", gap: "2px" }}>
							{localCollections.map((collection) => {
								const isSelected = activeView.type === "local" && activeView.id === collection.id;
								return (
									<div
										key={collection.id}
										className={`soundscapes-nav-item ${isSelected ? "is-active" : ""}`}
										onClick={() => handleSoundscapeChange(`MUSIC_COLLECTION_${collection.id}`)}
									>
										<Icon name="folder" />
										<span className="soundscapes-nav-text">{collection.name}</span>
									</div>
								);
							})}
							{localCollections.length === 0 && (settings.myMusicIndex || []).length > 0 && (
								<div
									className={`soundscapes-nav-item ${activeView.type === "local" ? "is-active" : ""}`}
									onClick={() => setActiveView({ type: "local", id: null, label: "Local Music Library" })}
								>
									<Icon name="music" />
									<span className="soundscapes-nav-text">All Local Music</span>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		);
	};

	// Render definitions for the dynamic Song track list table
	const renderTrackTable = () => (
		<div className="soundscapesmymusic-musiclist">
			{activeView.type !== "home" && layoutStyle === "drilldown" && (
				<button 
					className="soundscapes-back-btn" 
					onClick={() => setActiveView({ type: "home", id: null, label: "Library" })}
				>
					⬅ Back to Library
				</button>
			)}
			<table className="soundscapesmymusic-musiclist-table">
				<thead>
					<tr>
						<th></th>
						<th>Title</th>
						<th>Artist</th>
						<th>Album</th>
						<th>Time</th>
					</tr>
				</thead>
				<tbody>
					{currentTracks.map((track) => {
						const isCurrentLocal = localPlayerState?.currentTrack?.fileName === track.nativeTrackRef?.fileName && track.source === "local";
						const isCurrentStreaming = settings?.soundscape === activeView.id || (track.source === "youtube" && settings?.soundscape === `CUSTOM_${activeView.id}`);
						const isThisRowPlaying = isCurrentLocal || isCurrentStreaming;

						return (
							<tr key={track.id} onClick={() => handleTrackPlay(track)} style={{ cursor: "pointer" }}>
								<td>
									{isThisRowPlaying && localPlayerState?.playerState === PLAYER_STATE.PLAYING && <Icon name="volume-2" />}
									{isThisRowPlaying && localPlayerState?.playerState === PLAYER_STATE.PAUSED && <Icon name="volume" />}
								</td>
								<td>{track.title}</td>
								<td>{track.artist}</td>
								<td>{track.album}</td>
								<td>{track.duration > 0 ? secondsToMinutesAndSeconds(track.duration) : "Stream"}</td>
							</tr>
						);
					})}
					{currentTracks.length === 0 && (
						<tr>
							<td colSpan={5} style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)" }}>
								No tracks found. Select a source or check your configurations.
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);

	// Prevent rendering crashes if settings haven't loaded yet
	if (!settings) return null;

	return (
		<div className="soundscapes-holistic-container">
			<Header />
			{layoutStyle === "split" ? (
				<div className="soundscapes-split-workspace" style={{ display: "flex", height: "100%" }}>
					<aside className="soundscapes-sidebar-aside" style={{ width: "220px", borderRight: "1px solid var(--background-modifier-border)", overflowY: "auto" }}>
						{renderNavigationList()}
					</aside>
					<main className="soundscapes-main-content" style={{ flex: 1, position: "relative" }}>
						{renderTrackTable()}
					</main>
				</div>
			) : (
				<div className="soundscapes-drilldown-workspace" style={{ height: "100%", position: "relative" }}>
					{activeView.type === "home" ? renderNavigationList() : renderTrackTable()}
				</div>
			)}
		</div>
	);
};

export default App;