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

		if (activeView.type === "ambient" && activeView.id) {
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
		}

		if (activeView.type === "youtube" && activeView.id) {
			const targetPlaylist = settings.customSoundscapes?.find(p => p.id === activeView.id);
			if (!targetPlaylist || !targetPlaylist.tracks) return [];
			return targetPlaylist.tracks.map((track, idx) => ({
				id: `${track.id}_${idx}`,
				title: track.name,
				artist: "YouTube Stream",
				album: targetPlaylist.name,
				duration: 0,
				source: "youtube",
				nativeTrackRef: track
			}));
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
			plugin.changeMyMusicTrack(track.nativeTrackRef.fileName);
		} else if (track.source === "youtube" || track.source === "ambient") {
			const fullPluginSoundscapeId = track.source === "youtube" ? `CUSTOM_${activeView.id}` : activeView.id;
			if (fullPluginSoundscapeId) handleSoundscapeChange(fullPluginSoundscapeId);
		}
	}, [plugin, activeView.id, handleSoundscapeChange]);

	// Render definitions for the unified Navigation List component
	const renderNavigationList = () => (
		<div className="soundscapes-nav-panel">
			<div className="soundscapes-nav-header">Library Sources</div>
			
			<div className="soundscapes-nav-group">
				<div 
						className="soundscapes-nav-group-header"
						onClick={() => setAmbientExpanded(!ambientExpanded)}
						style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "6px 10px", color: "var(--text-muted)" }}
				>
						<span style={{ fontSize: "0.75rem", width: "12px", textAlign: "center" }}>{ambientExpanded ? "▼" : "▶"}</span>
						<Icon name="radio" /> {/* Clean stream antenna/radio icon */}
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
									onClick={() => handleSoundscapeChange(stream.id)}
								>
									<span className="soundscapes-nav-icon">🎵</span>
									<span className="soundscapes-nav-text">{stream.name}</span>
								</div>
							);
						})}
					</div>
				)}
			</div>

				{navigationItems.map(item => {
						const isSelected = activeView.type === item.type && activeView.id === item.id;
						const targetSoundscapeId = item.type === "youtube" ? `CUSTOM_${item.id}` : item.type === "local" ? `MUSIC_COLLECTION_${item.id}` : item.id;
						
						return (
								<div
										key={`${item.type}_${item.id}`}
										className={`soundscapes-nav-item ${isSelected ? "is-active" : ""}`}
										onClick={() => handleSoundscapeChange(targetSoundscapeId)}
								>
										{/* Swapped out emojis for unified Lucide vector icons */}
										{item.icon === "youtube" ? (
												<Icon name="youtube" />
										) : item.icon === "folder" ? (
												<Icon name="folder" />
										) : (
												<Icon name="music" />
										)}
										<span className="soundscapes-nav-text">{item.name}</span>
								</div>
						);
				})}
		</div>
	);

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
							<tr key={track.id} onDoubleClick={() => handleTrackPlay(track)}>
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