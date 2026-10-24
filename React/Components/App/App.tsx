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
import ContextMenu, { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { App as ObsidianApp, Notice } from "obsidian";
import ConfirmModal from "src/ConfirmModal/ConfirmModal";
import fetchPlaylistTracks, { extractPlaylistId } from "src/Utils/fetchPlaylistTracks";
import { CustomSoundscape } from "src/Types/Interfaces";
import EditCustomSoundscapeModal from "src/EditCustomSoundscapeModal/EditCustomSoundscapeModal";

type ViewContext = { type: "home" | "ambient" | "youtube" | "local"; id: string | null; label: string; };
type EditableTrackTarget = { playlistId: string; trackId: string; trackIndex: number };
type ContextMenuTarget =
    | { type: "playlist"; playlistId: string }
    | ({ type: "track" } & EditableTrackTarget);
type ContextMenuState = { x: number; y: number; target: ContextMenuTarget } | null;

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
    const [modalType, setModalType] = useState<"playlist" | "track" | "import" | "renamePlaylist" | "renameTrack" | "renameCollection" | null>(null);
    const [modalPlaylistId, setModalPlaylistId] = useState<string | null>(null);
    const [modalCollectionId, setModalCollectionId] = useState<string | null>(null);
    const [modalTrackTarget, setModalTrackTarget] = useState<EditableTrackTarget | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

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
    }, [settings]);

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

    const persistSettings = () => {
        if (!plugin) return;
        plugin.saveSettings();
        plugin.populateChangeSoundscapeButton();
        plugin.settingsObservable.setValue(plugin.settings);
    };

    const openPluginSettings = () => {
        if (!plugin) return;

        type InternalSettingsManager = {
            open?: () => void;
            openTabById?: (tabId: string) => void;
        };
        const settingsManager = (plugin.app as ObsidianApp & {
            setting?: InternalSettingsManager;
        }).setting;
        if (
            typeof settingsManager?.open !== "function" ||
            typeof settingsManager.openTabById !== "function"
        ) {
            new Notice("Unable to open Soundscapes settings in this Obsidian version.");
            return;
        }

        try {
            settingsManager.open();
            settingsManager.openTabById(plugin.manifest.id);
        } catch (error) {
            console.error("Failed to open Soundscapes settings", error);
            new Notice("Could not open Soundscapes settings. Please open it from Settings.");
        }
    };

    const showContextMenu = (event: React.MouseEvent, target: ContextMenuTarget) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY, target });
    };

    const openPlaylistTrackModal = (playlistId: string) => {
        setModalPlaylistId(playlistId);
        setModalType("track");
    };

    const editPlaylist = (playlistId: string) => {
        if (!plugin) return;
        const playlist = plugin.settings.customSoundscapes.find((item) => item.id === playlistId);
        if (!playlist) return;

        new EditCustomSoundscapeModal(
            plugin,
            JSON.parse(JSON.stringify(playlist)),
            (updatedPlaylist) => {
                const index = plugin.settings.customSoundscapes.findIndex(
                    (item) => item.id === playlistId
                );
                if (index < 0) return;
                plugin.settings.customSoundscapes[index] = updatedPlaylist;
                persistSettings();
            }
        ).open();
    };

    const removeMusicCollection = (collectionId: string) => {
        if (!plugin) return;
        const collection = plugin.settings.musicCollections.find((item) => item.id === collectionId);
        if (!collection) return;

        new ConfirmModal(
            plugin.app,
            () => {
                if (plugin.settings.soundscape === `MUSIC_COLLECTION_${collectionId}`) {
                    plugin.changeSoundscape("lofi");
                    plugin.settings.myMusicIndex = [];
                    plugin.settings.myMusicFolderPath = "";
                }
                plugin.settings.musicCollections =
                    plugin.settings.musicCollections.filter((item) => item.id !== collectionId);
                persistSettings();
            },
            "Remove music collection",
            `This will remove your music collection "${collection.name}". Are you sure?`,
            "Remove"
        ).open();
    };

    const getContextMenuItems = (): ContextMenuItem[] => {
        if (!contextMenu) return [];

        if (contextMenu.target.type === "playlist") {
            const { playlistId } = contextMenu.target;
            const playlist = settings.customSoundscapes.find((item) => item.id === playlistId);
            const items: ContextMenuItem[] = [];
            if (!playlist?.isNativePlaylist) {
                items.push({
                    label: "Add Track",
                    onSelect: () => openPlaylistTrackModal(playlistId),
                });
            }
            items.push(
                {
                    label: "Edit Playlist",
                    onSelect: () => editPlaylist(playlistId),
                },
                {
                    label: "Rename",
                    onSelect: () => {
                        setModalPlaylistId(playlistId);
                        setModalType("renamePlaylist");
                    },
                },
                {
                    label: "Delete",
                    onSelect: () => {
                        if (!plugin) return;
                        plugin.settings.customSoundscapes =
                            plugin.settings.customSoundscapes.filter((item) => item.id !== playlistId);
                        persistSettings();
                    },
                }
            );
            return items;
        }

        const target = contextMenu.target;
        return [
            {
                label: "Rename",
                onSelect: () => {
                    setModalTrackTarget(target);
                    setModalType("renameTrack");
                },
            },
            {
                label: "Delete",
                onSelect: () => {
                    if (!plugin) return;
                    const playlist = plugin.settings.customSoundscapes.find(
                        (item) => item.id === target.playlistId
                    );
                    if (playlist?.tracks[target.trackIndex]?.id === target.trackId) {
                        playlist.tracks.splice(target.trackIndex, 1);
                        persistSettings();
                    }
                },
            },
        ];
    };

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
					<i className="fa-brands fa-youtube" style={{ color: "#ff0000", fontSize: "14px" }}></i> <span>YouTube Playlists</span>
                    <div className="nav-actions">
                        <button className="nav-add-btn" onClick={(e) => { e.stopPropagation(); setModalType("import"); }} title="Import Playlist">
                            <Icon name="download" />
                        </button>
                        <button className="nav-add-btn" onClick={(e) => { e.stopPropagation(); setModalType("playlist"); }} title="Create Blank Playlist">
                            +
                        </button>
                    </div>
				</div>
				{expanded.youtube && (
					<div className="nav-group-items">
						{settings.customSoundscapes.map(list => (
							<div key={list.id} className={`nav-item ${activeView.type === "youtube" && activeView.id === list.id ? "is-active" : ""}`}
								onClick={() => (plugin as any).changeSoundscape?.(`CUSTOM_${list.id}`)}
                                onContextMenu={(event) => showContextMenu(event, { type: "playlist", playlistId: list.id })}>
								<span className="nav-item-name">{list.name}</span>
                                <div className="nav-actions">
                                    <button className="nav-action-btn" onClick={(e) => {
                                        e.stopPropagation();
                                        setModalPlaylistId(list.id);
                                        setModalType("renamePlaylist");
                                    }} title="Rename Playlist" aria-label={`Rename ${list.name}`}>
                                        <Icon name="pencil" />
                                    </button>
                                    <button className="nav-action-btn" onClick={(e) => {
                                        e.stopPropagation();
                                        if (!plugin) return;
                                        plugin.settings.customSoundscapes =
                                            plugin.settings.customSoundscapes.filter(p => p.id !== list.id);
                                        persistSettings();
                                    }} title="Delete Playlist" aria-label={`Delete ${list.name}`}>
                                        <Icon name="trash-2" />
                                    </button>
                                </div>
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
                        <div className="nav-actions">
                            <button className="nav-add-btn" onClick={async (e) => {
                                e.stopPropagation();
                                const { remote } = (window as any).require("electron");
                                const res = await remote.dialog.showOpenDialog({ properties: ["openDirectory"] });
                                if (!res.canceled && res.filePaths.length > 0) {
                                    if (plugin && typeof (plugin as any).addMusicCollection === "function") {
                                        (plugin as any).addMusicCollection(res.filePaths[0]);
                                    }
                                }
                            }} title="Add Local Folder" aria-label="Add Local Folder">+</button>
                        </div>
					</div>
					{expanded.collections && (
						<div className="nav-group-items">
							{settings.musicCollections.map(col => (
								<div key={col.id} className={`nav-item ${activeView.type === "local" && activeView.id === col.id ? "is-active" : ""}`}
									onClick={() => (plugin as any).changeSoundscape?.(`MUSIC_COLLECTION_${col.id}`)}>
									<span className="nav-item-name">{col.name}</span>
                                    <div className="nav-actions">
                                        <button className="nav-action-btn" onClick={(e) => {
                                            e.stopPropagation();
                                            setModalCollectionId(col.id);
                                            setModalType("renameCollection");
                                        }} title="Rename Collection" aria-label={`Rename ${col.name}`}>
                                            <Icon name="pencil" />
                                        </button>
                                        <button className="nav-action-btn" onClick={(e) => {
                                            e.stopPropagation();
                                            removeMusicCollection(col.id);
                                        }} title="Delete Collection" aria-label={`Delete ${col.name}`}>
                                            <Icon name="trash-2" />
                                        </button>
                                    </div>
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
                            <button className="btn-add-track" onClick={() => activeView.id && openPlaylistTrackModal(activeView.id)}>
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
                        {currentTracks.length === 0 ? (
                            <button
                                type="button"
                                className="soundscapes-empty-state-link"
                                onClick={openPluginSettings}
                            >
                                No tracks found. Select a source or check your configurations
                            </button>
                        ) : currentTracks.map((track, i) => {
							const isCurrentTrack = 
								(track.source === "local" && localPlayerState.currentTrack?.fileName === track.nativeTrackRef?.fileName) ||
								(track.source === "youtube" && localPlayerState.currentTrack?.fullPath === track.nativeTrackRef?.id) ||
								(track.source === "ambient" && localPlayerState.currentTrack?.fileName === track.nativeTrackRef?.name);

							const isPlaying = isCurrentTrack && localPlayerState.playerState === PLAYER_STATE.PLAYING;

							return (
								<div
                                    key={track.id}
                                    className="track-row"
                                    onClick={() => handleTrackPlay(track)}
                                    onContextMenu={(event) => {
                                        if (
                                            track.source === "youtube" &&
                                            activeView.id &&
                                            !settings.customSoundscapes.find(
                                                (playlist) => playlist.id === activeView.id
                                            )?.isNativePlaylist
                                        ) {
                                            showContextMenu(event, {
                                                type: "track",
                                                playlistId: activeView.id,
                                                trackId: track.nativeTrackRef.id,
                                                trackIndex: i,
                                            });
                                        }
                                    }}
                                >
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
													persistSettings();
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
                persistSettings();
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
                
                const sourceUrl = values.url.trim();
                const listId = extractPlaylistId(sourceUrl);
                if (!listId) {
                    new Notice("Enter a YouTube playlist URL or ID.");
                    return;
                }

                const playlistName = values.name.trim() || "Imported Playlist";
                const newPlaylist: CustomSoundscape = {
                    id: crypto.randomUUID(),
                    name: listId.startsWith("RD") ? `${playlistName} (Mix)` : playlistName,
                    tracks: [],
                    sourceUrl,
                    ...(listId.startsWith("RD")
                        ? { isNativePlaylist: true, nativePlaylistId: listId }
                        : {}),
                };

                if (!newPlaylist.isNativePlaylist) {
                    try {
                        newPlaylist.tracks = await fetchPlaylistTracks(sourceUrl);
                    } catch (error) {
                        console.error("Playlist import failed", error);
                        new Notice("Failed to import playlist. Check the URL and try again.");
                        return;
                    }
                }

                plugin.settings.customSoundscapes.push(newPlaylist);
                persistSettings();
            }}
        />

        <InputModal 
            isOpen={modalType === "track"}
            title={`Add Track to ${settings.customSoundscapes.find((playlist) => playlist.id === modalPlaylistId)?.name || activeView.label}`}
            fields={[
                { key: "name", label: "Track Name", placeholder: "e.g., Song Title" },
                { key: "id", label: "YouTube Video ID", placeholder: "e.g., dQw4w9WgXcQ" }
            ]}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin) return;
                const targetPlaylist = plugin.settings.customSoundscapes.find(p => p.id === modalPlaylistId);
                if (targetPlaylist) {
                    targetPlaylist.tracks.push({ name: values.name, id: values.id });
                    persistSettings();
                }
            }}
        />
        <InputModal
            isOpen={modalType === "renamePlaylist"}
            title="Rename Playlist"
            fields={[{ key: "name", label: "Playlist Name", placeholder: "Enter a playlist name" }]}
            initialValues={{
                name: settings.customSoundscapes.find((playlist) => playlist.id === modalPlaylistId)?.name || "",
            }}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin) return;
                const playlist = plugin.settings.customSoundscapes.find(
                    (item) => item.id === modalPlaylistId
                );
                if (playlist) {
                    playlist.name = values.name.trim();
                    persistSettings();
                }
            }}
        />
        <InputModal
            isOpen={modalType === "renameTrack"}
            title="Rename Track"
            fields={[{ key: "name", label: "Track Name", placeholder: "Enter a track name" }]}
            initialValues={{
                name: modalTrackTarget
                    ? settings.customSoundscapes.find((playlist) => playlist.id === modalTrackTarget.playlistId)
                        ?.tracks[modalTrackTarget.trackIndex]?.name || ""
                    : "",
            }}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin || !modalTrackTarget) return;
                const playlist = plugin.settings.customSoundscapes.find(
                    (item) => item.id === modalTrackTarget.playlistId
                );
                const track = playlist?.tracks[modalTrackTarget.trackIndex];
                if (track?.id === modalTrackTarget.trackId) {
                    track.name = values.name.trim();
                    persistSettings();
                }
            }}
        />
        <InputModal
            isOpen={modalType === "renameCollection"}
            title="Rename Collection"
            fields={[{ key: "name", label: "Collection Name", placeholder: "Enter a collection name" }]}
            initialValues={{
                name: settings.musicCollections.find((collection) => collection.id === modalCollectionId)?.name || "",
            }}
            onClose={() => setModalType(null)}
            onSubmit={(values) => {
                if (!plugin) return;
                const collection = plugin.settings.musicCollections.find(
                    (item) => item.id === modalCollectionId
                );
                if (collection) {
                    collection.name = values.name.trim();
                    persistSettings();
                }
            }}
        />
        {contextMenu && (
            <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                items={getContextMenuItems()}
                onClose={() => setContextMenu(null)}
            />
        )}
		</div>
	);
};

export default App;