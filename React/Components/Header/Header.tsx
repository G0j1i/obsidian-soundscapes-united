import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import secondsToMinutesAndSeconds from "../../Utils/secondsToMinutesAndSeconds";
import { LocalPlayerState } from "src/Types/Interfaces";
import { PLAYER_STATE } from "src/Types/Enums";

const Header = () => {
	const { localPlayerStateObservable, plugin } = useObsidianPluginContext();
	const [localPlayerState, setLocalPlayerState] = useState<LocalPlayerState>(localPlayerStateObservable?.getValue());
	
	const titleElementRef = useRef<HTMLDivElement>(null);
	const videoContainerRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const headerRef = useRef<HTMLDivElement>(null);
	const videoResizeRef = useRef<{ pointerId: number; startX: number; startY: number; startWidth: number } | null>(null);
	const panelResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
	
	const [videoWidth, setVideoWidth] = useState(320);
	const [panelHeight, setPanelHeight] = useState<number | null>(null);

	const startVideoResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		videoResizeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startWidth: wrapperRef.current?.getBoundingClientRect().width || videoWidth,
		};
		headerRef.current?.classList.add("is-video-resizing");
	};

	const moveVideoResize = (event: React.PointerEvent<HTMLDivElement>) => {
		const resize = videoResizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - resize.startX;
		const deltaY = event.clientY - resize.startY;
		const maxPanelVideoWidth = Math.max(200, Math.min(800, (window.innerHeight * 0.75 - 250) * 16 / 9));
		const nextWidth = Math.max(200, Math.min(maxPanelVideoWidth, resize.startWidth + (deltaX + deltaY) / 2));
		setVideoWidth(nextWidth);
		setPanelHeight((currentHeight) => {
			const currentSize = currentHeight ?? headerRef.current?.getBoundingClientRect().height ?? 260;
			const requiredHeight = nextWidth * 9 / 16 + 250;
			return Math.min(window.innerHeight * 0.75, Math.max(currentSize, requiredHeight));
		});
	};

	const finishVideoResize = (event: React.PointerEvent<HTMLDivElement>) => {
		if (videoResizeRef.current?.pointerId !== event.pointerId) return;
		videoResizeRef.current = null;
		headerRef.current?.classList.remove("is-video-resizing");
	};

	const startPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		panelResizeRef.current = {
			pointerId: event.pointerId,
			startY: event.clientY,
			startHeight: headerRef.current?.getBoundingClientRect().height || 260,
		};
		headerRef.current?.classList.add("is-panel-resizing");
	};

	const movePanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
		const resize = panelResizeRef.current;
		if (!resize || resize.pointerId !== event.pointerId) return;
		const height = Math.max(190, Math.min(window.innerHeight * 0.75, resize.startHeight + event.clientY - resize.startY));
		setPanelHeight(height);

	};

	const finishPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
		if (panelResizeRef.current?.pointerId !== event.pointerId) return;
		panelResizeRef.current = null;
		headerRef.current?.classList.remove("is-panel-resizing");
	};

	const shouldScrollTitle = titleElementRef?.current
		? titleElementRef?.current?.scrollWidth > titleElementRef?.current?.clientWidth : false;

	const isLocalActive = plugin?.settings.soundscape?.startsWith("MUSIC_COLLECTION_");
	const hasTrack = !!localPlayerState.currentTrack;
	const displayedVideoWidth = panelHeight === null
		? videoWidth
		: Math.max(200, Math.min(videoWidth, (panelHeight - 250) * 16 / 9));

	useEffect(() => {
		const unsubscribe = localPlayerStateObservable?.onChange((newState: LocalPlayerState) => setLocalPlayerState(newState));
		return () => unsubscribe?.();
	}, [localPlayerStateObservable]);

	useLayoutEffect(() => {
		const ytPlayerElement = document.getElementById("player");
		const container = videoContainerRef.current;
		if (!ytPlayerElement || !container) return;

		if (ytPlayerElement.parentElement !== container) {
			container.appendChild(ytPlayerElement);
		}
	}, [plugin]);

	useLayoutEffect(() => {
		const ytPlayerElement = document.getElementById("player");
		if (!ytPlayerElement) return;
		if (isLocalActive || !hasTrack) {
			ytPlayerElement.style.setProperty("display", "none", "important");
			return;
		}

		ytPlayerElement.style.setProperty("display", "block", "important");
		ytPlayerElement.style.setProperty("position", "absolute", "important");
		ytPlayerElement.style.setProperty("top", "0", "important");
		ytPlayerElement.style.setProperty("left", "0", "important");
		ytPlayerElement.style.setProperty("width", "100%", "important");
		ytPlayerElement.style.setProperty("height", "100%", "important");
		ytPlayerElement.style.setProperty("opacity", "1", "important");
		ytPlayerElement.style.setProperty("z-index", "1", "important");
	}, [hasTrack, isLocalActive]);

	useEffect(() => {
		return () => {
			if (plugin) (plugin as any).resetPlayerToStatusBar();
		};
	}, [plugin]);

	useLayoutEffect(() => {
		const ytPlayerElement = document.getElementById("player");
		if (!ytPlayerElement) return;

		if (isLocalActive || !hasTrack || localPlayerState.isYtdlFallback) {
			ytPlayerElement.style.setProperty("display", "none", "important");
		} else {
			ytPlayerElement.style.setProperty("display", "block", "important");
		}
	}, [hasTrack, isLocalActive, localPlayerState.isYtdlFallback]);

	return (
		<div ref={headerRef} className="soundscapesmymusic-header" style={panelHeight ? { height: `${panelHeight}px` } : undefined}>
 
			{/* 1. The Artwork / Video */}
			<div
				ref={wrapperRef}
				className="soundscapes-video-wrapper"
				style={{
					width: `${displayedVideoWidth}px`,
					maxWidth: "100%",
					minWidth: 0,
					display: hasTrack && !isLocalActive && (panelHeight === null || panelHeight >= 380) ? "block" : "none",
				}}
			>
					<div 
						ref={videoContainerRef} 
						className="soundscapes-video-placeholder"
						style={{ 
							backgroundImage: localPlayerState.isYtdlFallback ? `url(https://img.youtube.com/vi/${localPlayerState.currentTrack?.fullPath}/hqdefault.jpg)` : 'none',
							backgroundSize: 'cover', 
							backgroundPosition: 'center' 
						}}
					/>
					<div
						className="soundscapes-resize-handle"
						role="separator"
						aria-orientation="vertical"
						title="Drag to resize video"
						onPointerDown={startVideoResize}
						onPointerMove={moveVideoResize}
						onPointerUp={finishVideoResize}
						onPointerCancel={finishVideoResize}
						onLostPointerCapture={finishVideoResize}
					/>
			</div>

			{/* 2. The Title & Artist */}
			{hasTrack && (
				<div className="soundscapes-player-info">
					<div className={`soundscapesmymusic-middle-line1-title ${shouldScrollTitle && "soundscapesmymusic-middle-line1-title--scroll"}`} ref={titleElementRef}>
						<span className="soundscapesmymusic-middle-line1-title-text">
							{localPlayerState.currentTrack?.title}
						</span>
					</div>
					<div className="soundscapes-player-artist">
						{localPlayerState.currentTrack?.artist}
					</div>
				</div>
			)}

			{/* 3. The Time & Scrubber */}
			{hasTrack && (
				<div className="soundscapes-player-scrubber">
					<span className="time">{secondsToMinutesAndSeconds(localPlayerState.currentTime || 0)}</span>
					{(() => {
						const duration = localPlayerState.currentTrack?.duration || 0;
						const currentTime = localPlayerState.currentTime || 0;
						return (
							<input
									type="range" min="0" max="100" step="0.1"
									disabled={duration <= 0}
									value={duration > 0 ? (currentTime / duration) * 100 : 0}
									onChange={(e) => {
											if (duration > 0) plugin?.seek((parseFloat(e.target.value) / 100) * duration);
									}}
									className="soundscapesmymusic-middle-seekbar"
									style={{ cursor: duration > 0 ? "pointer" : "not-allowed" }}
							/>
						);
					})()}
					<span className="time">-{secondsToMinutesAndSeconds(Math.max(0, (localPlayerState.currentTrack?.duration || 0) - (localPlayerState.currentTime || 0)))}</span>
				</div>
			)}

			{/* 4. The Controls */}
			<div className="player-island">
				<div className="soundscapes-player-controls">
				{/* 🔥 Shuffle Button (Highlights when Shuffle is ON) */}
				<button 
					className={`control-btn ${plugin?.settings.playMode === "shuffle" ? "active" : ""}`} 
					onClick={() => plugin?.toggleShuffle()}
					title="Shuffle"
				>
					<Icon name="shuffle" />
				</button>

				{/* 🔥 Repeat Button (Highlights when Repeat is ON) */}
				<button 
					className={`control-btn ${plugin?.settings.playMode === "repeat" ? "active" : ""}`} 
					onClick={() => plugin?.toggleRepeat()}
					title="Repeat"
				>
					<Icon name="repeat" />
				</button>

				{/* Manual Fallback Button */}
				{!isLocalActive && !plugin?.settings.soundscape?.startsWith("MUSIC_COLLECTION_") && (
					<button 
						className="control-btn" 
						onClick={() => {
							if (plugin) {
								(plugin as any).useYtdlFallback = true;
								plugin.updateLocalPlayerState({ isYtdlFallback: true });
								(plugin as any).onSoundscapeChange(true);
							}
						}}
						title="Force Audio Fallback"
						style={{ opacity: 0.5 }}
					>
						<Icon name="headphones" />
					</button>
				)}
				
				<button className="control-btn" onClick={() => plugin?.previous()}>
					<Icon name="skip-back" />
				</button>
				
				<button className="control-btn large" onClick={() => localPlayerState.playerState === PLAYER_STATE.PLAYING ? plugin?.pause() : plugin?.play()}>
					{localPlayerState.playerState === PLAYER_STATE.PLAYING ? <Icon name="pause" /> : <Icon name="play" />}
				</button>
				
				<button className="control-btn" onClick={() => plugin?.next()}>
					<Icon name="skip-forward" />
				</button>
				
				<div className="volume-control">
					<Icon name="volume-2" />
					<input type="range" min="0" max="100" value={plugin?.settings.volume} onChange={(e) => plugin?.onVolumeChange(e)} />
				</div>
				</div>
			</div>
			<div
				className="soundscapes-header-resize-handle"
				role="separator"
				aria-orientation="horizontal"
				title="Drag to resize player panel"
				onPointerDown={startPanelResize}
				onPointerMove={movePanelResize}
				onPointerUp={finishPanelResize}
				onPointerCancel={finishPanelResize}
				onLostPointerCapture={finishPanelResize}
			/>
		</div>
	);
};

export default Header;
