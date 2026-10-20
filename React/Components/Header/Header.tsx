import React, { useEffect, useState, useRef } from "react";
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
	
	const [videoWidth, setVideoWidth] = useState(320);

	const handleResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = videoWidth;
		const onMouseMove = (moveEvent: MouseEvent) => {
			const newWidth = Math.max(200, Math.min(800, startWidth + (moveEvent.clientX - startX)));
			setVideoWidth(newWidth);
		};
		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
		};
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
	};

	const shouldScrollTitle = titleElementRef?.current
		? titleElementRef?.current?.scrollWidth > titleElementRef?.current?.clientWidth : false;

	const isLocalActive = plugin?.settings.soundscape?.startsWith("MUSIC_COLLECTION_");
	const hasTrack = !!localPlayerState.currentTrack;

	useEffect(() => {
		const unsubscribe = localPlayerStateObservable?.onChange((newState: LocalPlayerState) => setLocalPlayerState(newState));
		return () => unsubscribe?.();
	}, [localPlayerStateObservable]);

	useEffect(() => {
		const ytPlayerElement = document.getElementById("player");
		const container = videoContainerRef.current;
		if (!ytPlayerElement || !container) return;

		if (isLocalActive || !hasTrack) {
			ytPlayerElement.style.setProperty("display", "none", "important");
			if (plugin) (plugin as any).resetPlayerToStatusBar();
			return;
		}

		const soundscapeId = plugin?.settings.soundscape || "";
		const currentPlaylist = plugin?.settings.customSoundscapes?.find(
			p => p.id === soundscapeId.replace("CUSTOM_", "")
		);
		const isNativeMix = currentPlaylist?.isNativePlaylist === true;
		const isAmbient = !soundscapeId.startsWith("CUSTOM_") && !soundscapeId.startsWith("MUSIC_COLLECTION_");
		const isFallback = localPlayerState.isYtdlFallback;

		// 🔥 FIX: If it's a fallback, hide the IFrame immediately and return
		if (isFallback && !isNativeMix && !isAmbient) {
			ytPlayerElement.style.setProperty("display", "none", "important");
			if (ytPlayerElement.parentElement === container && plugin) {
				(plugin as any).resetPlayerToStatusBar();
			}
			return;
		}

		if (ytPlayerElement.parentElement !== container) {
			container.appendChild(ytPlayerElement);
		}

		ytPlayerElement.style.setProperty("display", "block", "important");
		ytPlayerElement.style.setProperty("position", "absolute", "important");
		ytPlayerElement.style.setProperty("top", "0", "important");
		ytPlayerElement.style.setProperty("left", "0", "important");
		ytPlayerElement.style.setProperty("width", "100%", "important");
		ytPlayerElement.style.setProperty("height", "100%", "important");
		ytPlayerElement.style.setProperty("opacity", "1", "important");
		ytPlayerElement.style.setProperty("z-index", "1", "important");

		return () => {
			if (ytPlayerElement && ytPlayerElement.parentElement === container && plugin) {
				(plugin as any).resetPlayerToStatusBar();
			}
		};
	}, [hasTrack, isLocalActive, plugin?.settings.soundscape, localPlayerState.isYtdlFallback]);

	return (
		<div className="soundscapesmymusic-header">
 
			{/* 1. The Artwork / Video */}
			{hasTrack && !isLocalActive && (
				<div className="soundscapes-video-wrapper" style={{ width: `${videoWidth}px` }}>
					<div 
						ref={videoContainerRef} 
						className="soundscapes-video-placeholder"
						style={{ 
							backgroundImage: localPlayerState.isYtdlFallback ? `url(https://img.youtube.com/vi/${localPlayerState.currentTrack?.fullPath}/hqdefault.jpg)` : 'none',
							backgroundSize: 'cover', 
							backgroundPosition: 'center' 
						}}
					/>
					<div className="soundscapes-resize-handle" onMouseDown={handleResize} />
				</div>
			)}

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
			<div className="soundscapes-player-controls">
				<button className={`control-btn ${plugin?.settings.playMode === "shuffle" ? "active" : ""}`} onClick={() => plugin?.toggleShuffle()}>
					<Icon name={plugin?.settings.playMode === "shuffle" ? "shuffle" : "repeat"} />
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
				<button className="control-btn" onClick={() => plugin?.previous()}><Icon name="skip-back" /></button>
				<button className="control-btn large" onClick={() => localPlayerState.playerState === PLAYER_STATE.PLAYING ? plugin?.pause() : plugin?.play()}>
					{localPlayerState.playerState === PLAYER_STATE.PLAYING ? <Icon name="pause" /> : <Icon name="play" />}
				</button>
				<button className="control-btn" onClick={() => plugin?.next()}><Icon name="skip-forward" /></button>
				<div className="volume-control">
					<Icon name="volume-2" />
					<input type="range" min="0" max="100" value={plugin?.settings.volume} onChange={(e) => plugin?.onVolumeChange(e)} />
				</div>
			</div>
		</div>
	);
};

export default Header;