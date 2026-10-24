import React, { useEffect, useRef, useState } from "react";
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
type SidebarResize = { pointerId: number; startX: number; startWidth: number };

interface UnifiedTrack {
	id: string; title: string; artist: string; album: string; duration: number;
	source: "ambient" | "youtube" | "local"; nativeTrackRef: any;
}

const App = () => {
    const { settingsObservable, localPlayerStateObservable, plugin } = useObsidianPluginContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioAnalyserRef = useRef<AnalyserNode | null>(null);
    const audioDataRef = useRef<Uint8Array | null>(null);
    const cursorDotRef = useRef<HTMLDivElement>(null);
    const cursorRingRef = useRef<HTMLDivElement>(null);
    const [settings, setSettings] = useState<SoundscapesPluginSettings>(settingsObservable?.getValue());
    const [localPlayerState, setLocalPlayerState] = useState<LocalPlayerState>(localPlayerStateObservable?.getValue());
    const [activeView, setActiveView] = useState<ViewContext>({ type: "home", id: null, label: "Library" });
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(260);
    const sidebarResizeRef = useRef<SidebarResize | null>(null);
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

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const pointer = { x: 0, y: 0 };
        
        // Create particles with orbital properties
        const particles = Array.from({ length: 80 }, () => ({
            angle: Math.random() * Math.PI * 2,
            radius: 20 + Math.random() * 200, // Distance from center
            speed: (Math.random() * 0.5 + 0.2) * 0.0005, // Rotation speed
            size: 0.5 + Math.random() * 1.5,
            hue: Math.random() > 0.5 ? 218 : 254, // Blue/Purple mix
            opacity: 0.2 + Math.random() * 0.6
        }));

        let frameId = 0;
        let width = 0;
        let height = 0;
        let previousTime = 0;

        const resize = () => {
            const bounds = container.getBoundingClientRect();
            width = bounds.width;
            height = bounds.height;
            const scale = window.devicePixelRatio || 1;
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            context.setTransform(scale, 0, 0, scale, 0, 0);
            pointer.x = width / 2;
            pointer.y = height / 2;
        };

        const draw = (time: number) => {
            const delta = Math.min(time - previousTime, 32);
            previousTime = time;
            context.clearRect(0, 0, width, height);

            // 1. Calculate the Bass Level
            let bassLevel = 0;
            
            // Check if we are playing raw audio that we can analyze
            if (audioAnalyserRef.current && audioDataRef.current && plugin?.localPlayer && !plugin.localPlayer.paused) {
                audioAnalyserRef.current.getByteFrequencyData(audioDataRef.current);
                // Average the first 4 bins (deep bass)
                let sum = 0;
                for (let i = 0; i < 4; i++) sum += audioDataRef.current[i];
                bassLevel = (sum / 4) / 255; // Normalize to 0.0 - 1.0
            } else {
                // 2. The Fallback: If playing YouTube (CORS blocked), simulate a smooth heartbeat
                // Combines a slow wave with a fast wave, and adds a touch of randomness
                const slowBeat = Math.sin(time * 0.003); 
                const fastBeat = Math.sin(time * 0.008);
                // Only trigger the pulse on the positive half of the wave, and make it snappy
                bassLevel = Math.pow(Math.max(0, (slowBeat * 0.7) + (fastBeat * 0.3)), 2) * 0.7;
            }

            const centerX = width / 2 + (pointer.x - width / 2) * 0.05;
            const centerY = height / 2 + (pointer.y - height / 2) * 0.05;

            // Draw a faint perspective floor, masked so it fades into the aurora.
            context.save();
            context.strokeStyle = "rgba(165, 185, 225, 0.045)";
            context.lineWidth = 0.65;
            const horizonY = centerY + height * 0.02;
            const verticalCount = 22;
            for (let index = 0; index <= verticalCount; index += 1) {
                const bottomX = (index / verticalCount) * width;
                context.beginPath();
                context.moveTo(centerX, horizonY);
                context.lineTo(bottomX, height);
                context.stroke();
            }
            for (let index = 1; index <= 18; index += 1) {
                const depth = index / 18;
                const y = horizonY + (height - horizonY) * depth * depth;
                const halfWidth = width * depth * 0.62;
                context.beginPath();
                context.moveTo(centerX - halfWidth, y);
                context.lineTo(centerX + halfWidth, y);
                context.stroke();
            }
            context.globalCompositeOperation = "destination-in";
            const gridMask = context.createRadialGradient(centerX, height * 0.58, 0, centerX, height * 0.58, Math.max(width, height) * 0.72);
            gridMask.addColorStop(0, "rgba(255, 255, 255, 0.9)");
            gridMask.addColorStop(0.58, "rgba(255, 255, 255, 0.48)");
            gridMask.addColorStop(1, "rgba(255, 255, 255, 0)");
            context.fillStyle = gridMask;
            context.fillRect(0, 0, width, height);
            context.restore();

            // Draw connection lines
            for (let i = 0; i < particles.length; i++) {
                const p1 = particles[i];
                // 🔥 Apply the bass pulse to the radius
                const pulseRadius1 = p1.radius + (bassLevel * 60); 
                const x1 = centerX + Math.cos(p1.angle) * pulseRadius1;
                const y1 = centerY + Math.sin(p1.angle) * pulseRadius1;

                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const pulseRadius2 = p2.radius + (bassLevel * 60);
                    const x2 = centerX + Math.cos(p2.angle) * pulseRadius2;
                    const y2 = centerY + Math.sin(p2.angle) * pulseRadius2;
                    
                    const dist = Math.hypot(x2 - x1, y2 - y1);
                    // Increase line distance slightly on bass hits
                    const maxDist = 60 + (bassLevel * 40); 
                    if (dist < maxDist) {
                        context.strokeStyle = `rgba(157, 183, 255, ${0.15 * (1 - dist / maxDist)})`;
                        context.lineWidth = 0.5 + (bassLevel * 0.5); // Lines get thicker
                        context.beginPath();
                        context.moveTo(x1, y1);
                        context.lineTo(x2, y2);
                        context.stroke();
                    }
                }
            }

            // Update and draw particles
            particles.forEach((p) => {
                if (!reducedMotion) {
                    p.angle += p.speed * delta;
                }

                // 🔥 Apply the pulse to the radius and size
                const pulseRadius = p.radius + (bassLevel * 60);
                const x = centerX + Math.cos(p.angle) * pulseRadius;
                const y = centerY + Math.sin(p.angle) * pulseRadius;

                // Particles get bigger on the bass hit
                const visualSize = p.size + (bassLevel * 2.5); 

                context.shadowBlur = 8 + (bassLevel * 20); // Glow intensifies
                context.shadowColor = `hsla(${p.hue}, 100%, 78%, ${p.opacity + bassLevel * 0.2})`;
                context.fillStyle = `hsla(${p.hue}, 100%, 88%, ${p.opacity + bassLevel * 0.2})`;
                context.beginPath();
                context.arc(x, y, visualSize, 0, Math.PI * 2);
                context.fill();
            });
            context.shadowBlur = 0;

            if (!reducedMotion) frameId = window.requestAnimationFrame(draw);
        };

        const onPointerMove = (event: PointerEvent) => {
            const bounds = container.getBoundingClientRect();
            pointer.x = event.clientX - bounds.left;
            pointer.y = event.clientY - bounds.top;
        };

        const observer = new ResizeObserver(resize);
        observer.observe(container);
        container.addEventListener("pointermove", onPointerMove);
        resize();
        draw(0);

        return () => {
            observer.disconnect();
            container.removeEventListener("pointermove", onPointerMove);
            window.cancelAnimationFrame(frameId);
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        const dot = cursorDotRef.current;
        const ring = cursorRingRef.current;
        if (
            !container ||
            !dot ||
            !ring ||
            !window.matchMedia("(pointer: fine)").matches ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) return;

        let mouseX = 0;
        let mouseY = 0;
        let ringX = 0;
        let ringY = 0;
        let frameId = 0;
        let isVisible = false;
        let isActive = false;

        const render = () => {
            ringX += (mouseX - ringX) * 0.15;
            ringY += (mouseY - ringY) * 0.15;
            dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
            ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) scale(${isActive ? 1.8 : 1})`;
            frameId = window.requestAnimationFrame(render);
        };

        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerType && event.pointerType !== "mouse") return;
            const bounds = container.getBoundingClientRect();
            mouseX = event.clientX - bounds.left;
            mouseY = event.clientY - bounds.top;
            if (!isVisible) {
                ringX = mouseX;
                ringY = mouseY;
                isVisible = true;
                container.classList.add("is-custom-cursor-visible");
            }
            const interactive = (event.target as HTMLElement | null)?.closest("button, a, input, [role='button'], .nav-item, .track-row");
            isActive = Boolean(interactive);
            container.classList.toggle("is-custom-cursor-active", isActive);
        };

        const onPointerLeave = () => {
            container.classList.remove("is-custom-cursor-visible", "is-custom-cursor-active");
            isVisible = false;
            isActive = false;
        };

        container.classList.add("has-custom-cursor");
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerleave", onPointerLeave);
        frameId = window.requestAnimationFrame(render);

        return () => {
            container.classList.remove("has-custom-cursor", "is-custom-cursor-visible", "is-custom-cursor-active");
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerleave", onPointerLeave);
            window.cancelAnimationFrame(frameId);
        };
    }, []);

    useEffect(() => {
        // We need to wait for the plugin and the localPlayer to exist
        if (!plugin || !plugin.localPlayer) return;

        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContext();
            const analyser = audioCtx.createAnalyser();
            
            // fftSize 64 is perfect for isolating bass frequencies (the "thump")
            analyser.fftSize = 64; 
            
            // Connect the HTML5 audio element to the analyzer
            const source = audioCtx.createMediaElementSource(plugin.localPlayer);
            source.connect(analyser);
            
            // You MUST connect to destination to hear the audio after routing it through the analyser
            analyser.connect(audioCtx.destination);

            audioAnalyserRef.current = analyser;
            audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);

            return () => {
                audioCtx.close();
            };
        } catch (e) {
            console.warn("Audio Context could not be initialized", e);
        }
    }, [plugin]);

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
			plugin.changeMyMusicTrack(track.nativeTrackRef.fullPath);
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

	const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		event.currentTarget.parentElement?.classList.add("is-resizing");
		sidebarResizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: sidebarCollapsed ? 56 : sidebarWidth,
		};
	};

	const moveSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
		const resize = sidebarResizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) return;
		const width = resize.startWidth + event.clientX - resize.startX;
		if (width < 190) {
			setSidebarCollapsed(true);
		} else {
			setSidebarWidth(Math.min(360, width));
			setSidebarCollapsed(false);
		}
	};

	const endSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
		if (sidebarResizeRef.current?.pointerId !== event.pointerId) return;
		sidebarResizeRef.current = null;
		event.currentTarget.parentElement?.classList.remove("is-resizing");
	};

	const renderSidebar = () => (
		<aside
			className={`soundscapes-sidebar-aside ${sidebarCollapsed ? "is-collapsed" : ""}`}
			style={{ "--sidebar-width": `${sidebarCollapsed ? 56 : sidebarWidth}px` } as React.CSSProperties}
		>
			<div className="sidebar-heading">
				<div className="nav-header-title">Library Sources</div>
				<button
					type="button"
					className="sidebar-collapse-btn"
					aria-label={sidebarCollapsed ? "Expand Library Sources" : "Collapse Library Sources"}
					title={sidebarCollapsed ? "Expand Library Sources" : "Collapse Library Sources"}
					onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
				>
					<Icon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} />
				</button>
			</div>
			
			{/* Ambient Group */}
			<div className="nav-group">
				<div className="nav-group-header" onClick={() => {
					if (sidebarCollapsed) {
						setSidebarCollapsed(false);
						setExpanded((p) => ({ ...p, ambient: true }));
					} else {
						setExpanded((p) => ({ ...p, ambient: !p.ambient }));
					}
				}}>
					<span className="chevron">{expanded.ambient ? "▼" : "▶"}</span>
					<Icon name="radio-tower" /> <span className="nav-group-label">Ambient Streams</span>
				</div>
				{expanded.ambient && (
					<div className="nav-group-items">
						{Object.values(SOUNDSCAPES).map((s, index) => (
							<div key={s.id} className={`nav-item ${activeView.type === "ambient" && activeView.id === s.id ? "is-active" : ""}`}
								style={{ "--motion-index": index } as React.CSSProperties}
								onClick={() => (plugin as any).changeSoundscape?.(s.id)}>
								{s.name}
							</div>
						))}
					</div>
				)}
			</div>

			{/* YouTube Group */}
			<div className="nav-group">
				<div className="nav-group-header" onClick={() => {
					if (sidebarCollapsed) {
						setSidebarCollapsed(false);
						setExpanded((p) => ({ ...p, youtube: true }));
					} else {
						setExpanded((p) => ({ ...p, youtube: !p.youtube }));
					}
				}}>
					<span className="chevron">{expanded.youtube ? "▼" : "▶"}</span>
					<i className="fa-brands fa-youtube" style={{ color: "#ff0000", fontSize: "14px" }}></i> <span className="nav-group-label">YouTube Playlists</span>
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
						{settings.customSoundscapes.map((list, index) => (
							<div key={list.id} className={`nav-item ${activeView.type === "youtube" && activeView.id === list.id ? "is-active" : ""}`}
								style={{ "--motion-index": index } as React.CSSProperties}
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
					<div className="nav-group-header" onClick={() => {
						if (sidebarCollapsed) {
							setSidebarCollapsed(false);
							setExpanded((p) => ({ ...p, collections: true }));
						} else {
							setExpanded((p) => ({ ...p, collections: !p.collections }));
						}
					}}>
						<span className="chevron">{expanded.collections ? "▼" : "▶"}</span>
						<Icon name="folder" /> <span className="nav-group-label">Collections</span>
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
							{settings.musicCollections.map((col, index) => (
								<div key={col.id} className={`nav-item ${activeView.type === "local" && activeView.id === col.id ? "is-active" : ""}`}
									style={{ "--motion-index": index } as React.CSSProperties}
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
			<div
				className="soundscapes-sidebar-resize-handle"
				role="separator"
				aria-orientation="vertical"
				title="Drag to resize; drag left to collapse"
				onPointerDown={beginSidebarResize}
				onPointerMove={moveSidebarResize}
				onPointerUp={endSidebarResize}
				onPointerCancel={endSidebarResize}
				onLostPointerCapture={endSidebarResize}
			/>
		</aside>
	);

	return (
		<div ref={containerRef} className="soundscapes-holistic-container">
			<canvas ref={canvasRef} className="soundscapes-ambient-canvas" aria-hidden="true" />
			<div ref={cursorDotRef} className="soundscapes-cursor soundscapes-cursor-dot" aria-hidden="true" />
			<div ref={cursorRingRef} className="soundscapes-cursor soundscapes-cursor-ring" aria-hidden="true" />
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
									style={{ "--motion-index": i } as React.CSSProperties}
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
