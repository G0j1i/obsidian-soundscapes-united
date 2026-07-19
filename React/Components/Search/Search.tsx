import React, { useEffect, useMemo, useState, useRef } from "react";
import { useObsidianPluginContext } from "../../Context/ObsidianPluginContext";
import Icon from "../Icon/Icon";
import { SoundscapesPluginSettings } from "src/Settings/Settings";
import SOUNDSCAPES from "src/Soundscapes";
import { SOUNDSCAPE_TYPE } from "src/Types/Enums";

const Search = () => {
	const { settingsObservable, plugin } = useObsidianPluginContext();
	const [settings, setSettings] = useState<SoundscapesPluginSettings>(
		settingsObservable?.getValue()
	);
	const [query, setQuery] = useState("");
	const [selectedResultIndex, setSelectedResultIndex] = useState(0);
	const resultsDiv = useRef<HTMLDivElement>(null);

	// Sync local component state when plugin settings change globally
	useEffect(() => {
		const unbind = settingsObservable?.onChange((newSettings: SoundscapesPluginSettings) => {
			setSettings(newSettings);
		});
		return () => {
			if (typeof unbind === "function") unbind();
		};
	}, [settingsObservable]);

	// Auto-scroll dropdown window on arrow-key selections
	useEffect(() => {
		if (resultsDiv.current) {
			resultsDiv.current.scrollTo({
				top: (selectedResultIndex - 2) * 40,
				behavior: "smooth"
			});
		}
	}, [selectedResultIndex]);

	// Aggregate all database pools dynamically based on query string
	const searchResult = useMemo(() => {
		if (!query || query.trim().length === 0) return [];

		const cleanQuery = query.toLowerCase();

		// 1. Map Local Music Files pool safely
		const localMusicItems = (settings?.myMusicIndex || []).map((song) => ({
			type: "LOCAL",
			id: song.fileName || "",
			fileName: song.fileName || "",
			title: song.title || song.fileName || "Unknown Track",
			artist: song.artist || "Local Audio File",
			album: song.album || "Local Directory"
		}));

		// 2. Map Standard Ambient Stream configurations safely
		const defaultSoundscapeItems = Object.values(SOUNDSCAPES || {}).map((sc: any) => ({
			type: "STANDARD",
			id: sc.id || "",
			fileName: sc.id || "",
			title: sc.name || "Unknown Stream",
			artist: "Ambient Stream",
			album: "Soundscapes"
		}));

		// 3. Map Custom YouTube Track lists safely
		const customSoundscapeItems: any[] = [];
		(settings?.customSoundscapes || []).forEach((customGroup) => {
			(customGroup.tracks || []).forEach((track) => {
				customSoundscapeItems.push({
					type: "CUSTOM",
					id: track.id || "",
					fileName: track.id || "",
					customGroupId: customGroup.id || "",
					title: track.name || "Unknown Custom Track",
					artist: "Custom YouTube Track",
					album: customGroup.name || "Custom Playlist"
				});
			});
		});

		// 4. Merge pools and apply keyword matching queries defensively
		const aggregateDatabase = [
			...localMusicItems,
			...defaultSoundscapeItems,
			...customSoundscapeItems
		];

		return aggregateDatabase
			.filter(
				(item) =>
					String(item.title || "").toLowerCase().includes(cleanQuery) ||
					String(item.artist || "").toLowerCase().includes(cleanQuery) ||
					String(item.album || "").toLowerCase().includes(cleanQuery) ||
					String(item.id || "").toLowerCase().includes(cleanQuery)
			)
			.slice(0, 20);
	}, [settings?.myMusicIndex, settings?.customSoundscapes, query]);

	// Shared function to handle complex multi-source track updates smoothly
	const playSelectedItem = (item: any) => {
		if (!plugin) return;

		if (item.type === "LOCAL") {
			const parentCollection = settings?.musicCollections?.find((collection: any) =>
				(collection.tracks || collection.files || [])?.some((t: any) => t.fileName === item.fileName)
			);
			if (parentCollection) {
				plugin.settings.soundscape = `MUSIC_COLLECTION_${parentCollection.id}`;
				plugin.saveSettings();
			}
			plugin.changeMyMusicTrack(item.fileName);
		} else if (item.type === "STANDARD") {
			plugin.changeSoundscape(item.id);
		} else if (item.type === "CUSTOM") {
			plugin.settings.soundscape = `${SOUNDSCAPE_TYPE.CUSTOM}_${item.customGroupId}`;
			plugin.saveSettings();

			const customGroup = settings?.customSoundscapes?.find(g => g.id === item.customGroupId);
			const trackIdx = customGroup?.tracks?.findIndex((t: any) => t.id === item.id) ?? 0;
			plugin.currentTrackIndex = trackIdx >= 0 ? trackIdx : 0;
			plugin.onSoundscapeChange();
		}
		setQuery("");
	};

	return (
		<div className="soundscapesmymusic-right-search">
			<Icon name="search" />
			<input
				type="text"
				className="soundscapesmymusic-right-search-input"
				placeholder="Search tracks, streams..."
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setSelectedResultIndex(0);
				}}
				onKeyDown={(e) => {
					if (searchResult.length > 0) {
						switch (e.key) {
							case "ArrowDown":
								e.preventDefault();
								setSelectedResultIndex((prev) =>
									prev === searchResult.length - 1 ? 0 : prev + 1
								);
								break;
							case "ArrowUp":
								e.preventDefault();
								setSelectedResultIndex((prev) =>
									prev === 0 ? searchResult.length - 1 : prev - 1
								);
								break;
							case "Enter": {
								e.preventDefault();
								const currentActiveItem = searchResult[selectedResultIndex];
								if (currentActiveItem) {
									playSelectedItem(currentActiveItem);
								}
								break;
							}
							case "Escape":
								setQuery("");
								break;
						}
					}
				}}
			/>
			
			{/* Fixed: Only render dropdown container when query text exists, matching original layout constraints */}
			{query.trim().length > 0 && (
				<div className="soundscapesmymusic-right-search-results" ref={resultsDiv}>
					{searchResult.length === 0 ? (
						<div className="soundscapesmymusic-right-search-results-message">
							No results found
						</div>
					) : (
						searchResult.map((item, index) => (
							<div
								key={`${item.type}-${item.id}`}
								className={`soundscapesmymusic-right-search-results-result ${
										selectedResultIndex === index ? "soundscapesmymusic-right-search-results-result--selected" : ""
								}`}
								onClick={() => playSelectedItem(item)}
							>
								<div className="soundscapesmymusic-right-search-results-result-line1">
									{item.title}
								</div>
								<div className="soundscapesmymusic-right-search-results-result-line2">
									{item.artist || item.album}
								</div>
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
};

export default Search;