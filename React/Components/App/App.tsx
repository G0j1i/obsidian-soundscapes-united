import React, { useEffect, useState } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import Header from "../Header/Header";
import secondsToMinutesAndSeconds from "../../Utils/secondsToMinutesAndSeconds";
import { LocalPlayerState } from "src/Types/Interfaces";
import { PLAYER_STATE, SOUNDSCAPE_TYPE } from "src/Types/Enums";
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

	// Fallback layout style configuration if not yet in user settings
	const layoutStyle = (settings as any).layoutStyle || "split";

	// Navigation panel tracking state
	const [activeView, setActiveView] = useState<ViewContext>({ type: "home", id: null, label: "Library" });

	/**
	 * Resolves any plugin setting soundscape string to our navigation active view state
	 */
	const syncViewFromSoundscapeId = (soundscapeId: string) => {
		if (!soundscapeId) {
			setActiveView({ type: "home", id: null, label: "Library" });
			return;
		}

		if (soundscapeId.startsWith("CUSTOM_")) {
			const targetId = soundscapeId.replace("CUSTOM_", "");
			const targetPlaylist = settings.customSoundscapes.find(p => p.id === targetId);
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
			// Built-in ambient tracking
			const ambient = SOUNDSCAPES[soundscapeId];
			if (ambient) {
				setActiveView({ type: "ambient", id: soundscapeId, label: ambient.name });
			} else {
				setActiveView({ type: "home", id: null, label: "Library" });
			}
		}
	};

	// Synchronize settings changes from the main application thread
	useEffect(() => {
		const unsubscribe = settingsObservable?.onChange((newSettings: SoundscapesPluginSettings) => {
			setSettings(newSettings);
		});
		return () => unsubscribe?.();
	}, [setSettings]);

	// Listen to player state updates
	useEffect(() => {
		const unsubscribe = localPlayerStateObservable?.onChange((newState: LocalPlayerState) => {
			setLocalPlayerState(newState);
		});
		return () => unsubscribe?.();
	}, [setLocalPlayerState]);

	// Auto-navigate to whichever playlist is currently running on the status bar when loaded or switched
	useEffect(() => {
		if (settings?.soundscape) {
			syncViewFromSoundscapeId(settings.soundscape);
		}
	}, [settings?.soundscape]);

	/**
	 * Compiles list items for the primary navigation panel
	 */
	const getNavigationItems = () => {
		const items: Array<{ type: "ambient" | "youtube" | "local"; id: string; name: string; icon: string }> = [];

		// 1. Append built-in streams
		Object.values(SOUNDSCAPES).forEach(stream => {
			items.push({ type: "ambient", id: stream.id, name: stream.name, icon: "radio" });
		});

		// 2. Append custom user streaming lists
		if (settings.customSoundscapes && settings.customSoundscapes.length > 0) {
			settings.customSoundscapes.forEach(list => {
				items.push({ type: "youtube", id: list.id, name: list.name, icon: "youtube" });
			});
		}

		// 3. Append indexed local tracks or directories
		if (settings.musicCollections && settings.musicCollections.length > 0) {
			settings.musicCollections.forEach(collection => {
				items.push({ type: "local", id: collection.id, name: collection.name, icon: "folder" });
			});
		} else if (settings.myMusicIndex && settings.myMusicIndex.length > 0) {
			// Backwards compatibility fallback if flat indexing was previously applied
			items.push({ type: "local", id: "legacy_root", name: "Local Music Library", icon: "music" });
		}

		return items;
	};

	/**
	 * Computes dynamic dataset row arrays based on the currently selected active navigation item
	 */
	const getTracksForView = (): UnifiedTrack[] => {
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
			const targetPlaylist = settings.customSoundscapes.find(p => p.id === activeView.id);
			if (!targetPlaylist) return [];
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
			// Gather active scanned files
			return settings.myMusicIndex.map(song => ({
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
	};

	/**
	 * Triggers the correct back-end player actions depending on the source type
	 */
	const handleTrackPlay = (track: UnifiedTrack) => {
		if (!plugin) return;

		if (track.source === "local") {
			plugin.changeMyMusicTrack(track.nativeTrackRef.fileName);
		} else if (track.source === "youtube" || track.source === "ambient") {
			const fullPluginSoundscapeId = track.source === "youtube" 
				? `CUSTOM_${activeView.id}` 
				: activeView.id;
			
			if (fullPluginSoundscapeId) {
				(plugin as any).changeSoundscape?.(fullPluginSoundscapeId);
			}
		}
	};

	const currentTracks = getTracksForView();

	// Render definitions for the unified Navigation List component
	const renderNavigationList = () => (
		<div className="soundscapes-nav-panel">
			<div className="soundscapes-nav-header">Library Sources</div>
			{getNavigationItems().map(item => {
				const isSelected = activeView.type === item.type && activeView.id === item.id;
				return (
					<div
						key={`${item.type}_${item.id}`}
						className={`soundscapes-nav-item ${isSelected ? "is-active" : ""}`}
						onClick={() => {
							const targetSoundscapeId = item.type === "youtube" 
								? `CUSTOM_${item.id}` 
								: item.type === "local" 
									? `MUSIC_COLLECTION_${item.id}` 
									: item.id;
							(plugin as any).changeSoundscape?.(targetSoundscapeId);
						}}
					>
						<span className="soundscapes-nav-icon">
							{item.icon === "youtube" ? "📺" : item.icon === "folder" ? "📁" : item.icon === "radio" ? "📻" : "🎵"}
						</span>
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
						const isCurrentLocal = localPlayerState.currentTrack?.fileName === track.nativeTrackRef?.fileName && track.source === "local";
						const isCurrentStreaming = settings.soundscape === activeView.id || (track.source === "youtube" && settings.soundscape === `CUSTOM_${activeView.id}`);
						const isThisRowPlaying = isCurrentLocal || isCurrentStreaming;

						return (
							<tr key={track.id} onDoubleClick={() => handleTrackPlay(track)}>
								<td>
									{isThisRowPlaying && localPlayerState.playerState === PLAYER_STATE.PLAYING && (
										<Icon name="volume-2" />
									)}
									{isThisRowPlaying && localPlayerState.playerState === PLAYER_STATE.PAUSED && (
										<Icon name="volume" />
									)}
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