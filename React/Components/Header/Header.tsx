import React, { useEffect, useState, useRef } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import Search from "../Search/Search";
import secondsToMinutesAndSeconds from "../../Utils/secondsToMinutesAndSeconds";
import { LocalPlayerState } from "src/Types/Interfaces";
import { PLAYER_STATE } from "src/Types/Enums";
import SOUNDSCAPES from "src/Soundscapes";

const Header = () => {
	const { localPlayerStateObservable, plugin } = useObsidianPluginContext();
	const [localPlayerState, setLocalPlayerState] = useState<LocalPlayerState>(
		localPlayerStateObservable?.getValue() || {}
	);
	const [settings, setSettings] = useState(plugin?.settingsObservable?.getValue() || plugin?.settings);
	const titleElementRef = useRef<HTMLDivElement>(null);
	const shouldScrollTitle = titleElementRef?.current
		? titleElementRef?.current?.scrollWidth >
		  titleElementRef?.current?.clientWidth
		: false;

	/**
	 * Subscribe to local player state from Obsidian
	 */
	useEffect(() => {
		const unsubscribeState = localPlayerStateObservable?.onChange(
			(newState: LocalPlayerState) => {
				setLocalPlayerState(newState);
			}
		);
		const unsubscribeSettings = plugin?.settingsObservable?.onChange(
			(newSettings: any) => {
				setSettings(newSettings);
			}
		);

		return () => {
			unsubscribeState?.();
			unsubscribeSettings?.();
		};
	}, [localPlayerStateObservable, plugin]);

	// 1. Determine active soundscape type
	const activeSoundscape = settings?.soundscape || "lofi";
	const isLocalActive = activeSoundscape.startsWith("MUSIC_COLLECTION_");
	const isCustomYoutubeActive = activeSoundscape.startsWith("CUSTOM_");

	// 2. Safely resolve Title, Artist, Duration, and Current Time
	let activeTitle = "";
	let activeArtist = "";
	let durationSeconds = 0;
	let elapsedSeconds = 0;

	if (isLocalActive) {
		activeTitle = localPlayerState?.currentTrack?.title || localPlayerState?.currentTrack?.fileName || "";
		activeArtist = localPlayerState?.currentTrack?.artist || "Local Audio";
		durationSeconds = localPlayerState?.currentTrack?.duration || 0;
		elapsedSeconds = localPlayerState?.currentTime || 0;
	} else if (isCustomYoutubeActive) {
		const playlistId = activeSoundscape.replace("CUSTOM_", "");
		const currentPlaylist = settings?.customSoundscapes?.find((p: any) => p.id === playlistId);
		const trackIndex = plugin?.currentTrackIndex ?? 0;
		const activeTrack = currentPlaylist?.tracks?.[trackIndex];

		activeTitle = activeTrack?.name || "Loading YouTube Track...";
		activeArtist = activeTrack?.author || activeTrack?.channelName || "YouTube Playlist";
		
		// Read from the track duration updated dynamically by main.ts
		durationSeconds = localPlayerState?.currentTrack?.duration || activeTrack?.duration || 0;
		elapsedSeconds = localPlayerState?.currentTime || 0;
	} else {
		// Built-in standard ambient loops
		const ambientItem = SOUNDSCAPES[activeSoundscape];
		if (ambientItem) {
			activeTitle = ambientItem.name;
			activeArtist = "Ambient Radio";
		}
	}

	const hasTrackInfo = !!activeTitle;
	const isLiveStream = !isLocalActive && (!durationSeconds || durationSeconds === 0);

	return (
		<div className="soundscapesmymusic-header">
			<div className="soundscapesmymusic-left">
				<div className="soundscapesmymusic-left-controls">
					<button
						className="soundscapesmymusic-left-controls-button"
						onClick={() => plugin?.previous()}
					>
						<Icon name="skip-back" />
					</button>
					{localPlayerState.playerState === PLAYER_STATE.PAUSED && (
						<button
							className="soundscapesmymusic-left-controls-button soundscapesmymusic-left-controls-button--large"
							onClick={() => plugin?.play()}
						>
							<Icon name="play" />
						</button>
					)}
					{localPlayerState.playerState === PLAYER_STATE.PLAYING && (
						<button
							className="soundscapesmymusic-left-controls-button soundscapesmymusic-left-controls-button--large"
							onClick={() => plugin?.pause()}
						>
							<Icon name="pause" />
						</button>
					)}
					<button
						className="soundscapesmymusic-left-controls-button"
						onClick={() => plugin?.next()}
					>
						<Icon name="skip-forward" />
					</button>
				</div>
			</div>
			<div className="soundscapesmymusic-volume">
				<input
					type="range"
					min="0"
					max="100"
					value={settings?.volume ?? 50}
					onChange={(e) => plugin?.onVolumeChange(e)}
				/>
			</div>
			<div className="soundscapesmymusic-middle">
				{hasTrackInfo && (
					<>
						<div className="soundscapesmymusic-middle-line1">
							<div className="soundscapesmymusic-middle-line1-left">
								<button
									className={`soundscapesmymusic-middle-line1-button ${
										settings?.playMode === "shuffle" &&
										"soundscapesmymusic-middle-line1-button--active"
									}`}
									onClick={() => {
										plugin?.toggleShuffle();
									}}
								>
									<Icon name="shuffle" />
								</button>
							</div>
							<div
								className={`soundscapesmymusic-middle-line1-title ${
									shouldScrollTitle &&
									"soundscapesmymusic-middle-line1-title--scroll"
								}`}
								ref={titleElementRef}
							>
								<span className="soundscapesmymusic-middle-line1-title-text">
									{activeTitle}
								</span>
							</div>
							<div className="soundscapesmymusic-middle-line1-right"></div>
						</div>
						<div className="soundscapesmymusic-middle-line2">
							<div className="soundscapesmymusic-middle-line2-left">
								{isLiveStream ? "00:00" : secondsToMinutesAndSeconds(elapsedSeconds)}
							</div>
							<div className="soundscapesmymusic-middle-line2-artist">
								{activeArtist}
							</div>
							<div className="soundscapesmymusic-middle-line2-right">
								{isLiveStream ? "Stream" : `-${secondsToMinutesAndSeconds(Math.max(0, durationSeconds - elapsedSeconds))}`}
							</div>
						</div>
						<input
							type="range"
							min="0"
							max={isLiveStream ? 100 : durationSeconds || 100}
							step="0.1"
							value={isLiveStream ? 0 : elapsedSeconds}
							disabled={isLiveStream}
							onChange={(e) => {
								const targetSeconds = parseFloat(e.target.value);
								if (isLocalActive) {
									plugin?.seek(targetSeconds);
								} else if (isCustomYoutubeActive && plugin?.player) {
									(plugin.player as any).seekTo?.(targetSeconds, true);
									// Instantly paint the state update forward
									plugin.updateLocalPlayerState({ currentTime: targetSeconds });
								}
							}}
							className="soundscapesmymusic-middle-seekbar"
						/>
					</>
				)}
			</div>
			<div className="soundscapesmymusic-right">
				<Search />
			</div>
		</div>
	);
};

export default Header;