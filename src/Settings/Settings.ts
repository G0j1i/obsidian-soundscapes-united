import SoundscapesPlugin from "main";
import { App, PluginSettingTab, Setting } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import ConfirmModal from "src/ConfirmModal/ConfirmModal";
import EditCustomSoundscapeModal from "src/EditCustomSoundscapeModal/EditCustomSoundscapeModal";
import SOUNDSCAPES from "src/Soundscapes";
import { SOUNDSCAPE_TYPE } from "src/Types/Enums";
import { CustomSoundscape, LocalMusicFile, MusicCollection } from "src/Types/Interfaces";
import electron from "electron";

export interface SoundscapesPluginSettings {
	soundscape: string;
	volume: number;
	autoplay: boolean;
	scrollSongTitle: boolean;
	customSoundscapes: CustomSoundscape[];
	myMusicIndex: LocalMusicFile[];
	myMusicFolderPath: string;
	musicCollections: MusicCollection[];
	reindexFrequency: string;
	playMode: "repeat" | "shuffle" | "neutral";
	currentTrackIndex: number;
}

export const DEFAULT_SETTINGS: SoundscapesPluginSettings = {
	soundscape: "lofi",
	volume: 25,
	autoplay: false,
	scrollSongTitle: true,
	customSoundscapes: [],
	myMusicIndex: [],
	myMusicFolderPath: "",
	musicCollections: [],
        reindexFrequency: "1440",
	playMode: "neutral", 
	currentTrackIndex: 0,
};

export class SoundscapesSettingsTab extends PluginSettingTab {
	plugin: SoundscapesPlugin;

	constructor(app: App, plugin: SoundscapesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Soundscape")
			.setDesc(`Which soundscape would you like to listen to?`)
			.addDropdown((component) => {
				Object.values(SOUNDSCAPES).forEach((soundscape) => {
					component.addOption(soundscape.id, soundscape.name);
				});

				this.plugin.settings.customSoundscapes.forEach(
					(customSoundscape) => {
						if (customSoundscape.tracks.length > 0) {
							component.addOption(
								`${SOUNDSCAPE_TYPE.CUSTOM}_${customSoundscape.id}`,
								customSoundscape.name
							);
						}
					}
				);

				this.plugin.settings.musicCollections.forEach((collection) => {
					component.addOption(
						`MUSIC_COLLECTION_${collection.id}`,
						collection.name
					);
				});

				component.setValue(this.plugin.settings.soundscape);

				component.onChange((value: string) => {
					this.plugin.changeSoundscape(value);
					this.display();
				});
			});

		new Setting(containerEl)
			.setName("Autoplay soundscape")
			.setDesc(`Automatically play chosen soundscape on startup?`)
			.addToggle((component) => {
				component.setValue(this.plugin.settings.autoplay);
				component.onChange((value) => {
					this.plugin.settings.autoplay = value;
					this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Scroll song title")
			.setDesc(`Save space on the status bar by scrolling song title?`)
			.addToggle((component) => {
				component.setValue(this.plugin.settings.scrollSongTitle);
				component.onChange((value) => {
					this.plugin.settings.scrollSongTitle = value;
					this.plugin.toggleNowPlayingScroll();
					this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h1", { text: "Custom soundscapes" });
		containerEl.createEl("p", {
			text: "Custom soundscapes allow you to create your own playlists of youtube videos that can be selected as a soundscape.",
		});

		this.plugin.settings.customSoundscapes.forEach(
			(customSoundscape, index) => {
				new Setting(containerEl)
					.setName(customSoundscape.name)
					.setDesc(`${customSoundscape.tracks.length} tracks`)
					.addButton((component) => {
						component.setButtonText("Edit");

						component.onClick(() => {
							new EditCustomSoundscapeModal(
								this.plugin,
								// Gross way to deep clone the object
								JSON.parse(JSON.stringify(customSoundscape)),
								(
									modifiedCustomSoundscape: CustomSoundscape
								) => {
									this.plugin.settings.customSoundscapes[
										index
									] = modifiedCustomSoundscape;
									this.plugin.saveSettings();
									this.display();
									this.plugin.populateChangeSoundscapeButton();
								}
							).open();
						});
					})
					.addButton((component) => {
						component.setButtonText("Remove");
						component.setClass("mod-warning");

						component.onClick(() => {
							new ConfirmModal(
								this.plugin.app,
								() => {
									this.plugin.settings.customSoundscapes.splice(
										index,
										1
									);

									if (
										this.plugin.settings.soundscape ===
										`${SOUNDSCAPE_TYPE.CUSTOM}_${customSoundscape.id}`
									) {
										this.plugin.settings.soundscape =
											"lofi";
										this.plugin.onSoundscapeChange();
									}

									this.plugin.saveSettings();
									this.display();
									this.plugin.populateChangeSoundscapeButton();
								},
								"Remove custom soundscape",
								`This will remove your custom soundscape "${customSoundscape.name}". Are you sure?`,
								"Remove"
							).open();
						});
					});
			}
		);

		new Setting(containerEl).addButton((component) => {
			component
				.setButtonText("Add custom soundscape")
				.setCta()
				.onClick(() => {
					new EditCustomSoundscapeModal(
						this.plugin,
						{ id: uuidv4(), name: "", tracks: [] },
						(customSoundscape: CustomSoundscape) => {
							this.plugin.settings.customSoundscapes.push(
								customSoundscape
							);
							this.plugin.saveSettings();
							this.display();
							this.plugin.populateChangeSoundscapeButton();
						}
					).open();
				});
		});

		containerEl.createEl("h1", { text: "Music Collections" });
		containerEl.createEl("p", {
			text: "Music collections allow you to play music files from your local computer. Each collection can point to a different folder. Switch between them from the soundscape dropdown or mini-player.",
		});

		this.plugin.settings.musicCollections.forEach(
			(collection, index) => {
				const isActive = this.plugin.settings.soundscape === `MUSIC_COLLECTION_${collection.id}`;

				const settingEl = new Setting(containerEl)
					.setName(collection.name)
					.setDesc(
						`${collection.musicIndex.length} songs — ${collection.folderPath || "No path set"}`
					)
					.addText((component) => {
						component.setValue(collection.name);
						component.onChange((value) => {
							collection.name = value;
							this.plugin.saveSettings();
							this.plugin.populateChangeSoundscapeButton();
							settingEl.setName(value);
						});
					})
					.addExtraButton((component) => {
						component.setIcon("folder-open");
						component.setTooltip("Select folder");
						component.onClick(() => {
							// @ts-ignore
							electron.remote.dialog
								.showOpenDialog({
									properties: ["openDirectory"],
									title: `Select folder for "${collection.name}"`,
								})
								.then((result: any) => {
									if (!result.canceled) {
										collection.folderPath = result.filePaths[0];
										collection.musicIndex = [];
										if (isActive) {
											this.plugin.settings.myMusicIndex = [];
											this.plugin.settings.myMusicFolderPath = collection.folderPath;
										}
										this.plugin.saveSettings();
										this.display();
										if (isActive) {
											this.plugin.indexMusicLibrary();
											this.plugin.onSoundscapeChange();
										}
									}
								});
						});
					})
					.addExtraButton((component) => {
						component.setIcon("folder-sync");
						component.setTooltip("Re-index now");
						component.onClick(() => {
							if (isActive) {
								this.plugin.indexMusicLibrary();
							} else {
								// Switch to this collection, index, then switch back
								const prevSoundscape = this.plugin.settings.soundscape;
								this.plugin.changeSoundscape(`MUSIC_COLLECTION_${collection.id}`);
								this.plugin.indexMusicLibrary();
								this.plugin.populateChangeSoundscapeButton();
								this.display();
							}
						});
					})
					.addButton((component) => {
						component.setButtonText("Remove");
						component.setClass("mod-warning");
						component.onClick(() => {
							new ConfirmModal(
								this.plugin.app,
								() => {
									if (isActive) {
										this.plugin.settings.soundscape = "lofi";
										this.plugin.onSoundscapeChange();
									}
									this.plugin.settings.musicCollections.splice(index, 1);
									this.plugin.settings.myMusicIndex = [];
									this.plugin.settings.myMusicFolderPath = "";
									this.plugin.saveSettings();
									this.display();
									this.plugin.populateChangeSoundscapeButton();
								},
								"Remove music collection",
								`This will remove your music collection "${collection.name}". Are you sure?`,
								"Remove"
							).open();
						});
					});
			}
		);

		new Setting(containerEl).addButton((component) => {
			component
				.setButtonText("Add Music Collection")
				.setCta()
				.onClick(() => {
					const id = uuidv4();
					this.plugin.settings.musicCollections.push({
						id,
						name: "New Collection",
						folderPath: "",
						musicIndex: [],
						currentTrackIndex: 0,
					});
					this.plugin.saveSettings();
					this.display();
					this.plugin.populateChangeSoundscapeButton();
				});
		});

		new Setting(containerEl)
			.setName("Periodic re-index")
			.setDesc(
				"To keep your music library up to date, the plugin needs to occasionally re-index from your music folder. You can disable this if you would prefer to manually trigger re-indexes. Re-indexes will also be triggered on startup of Obsidian or when the Soundscape or music folder path are changed."
			)
			.addDropdown((component) => {
				component.addOption("never", "Never");
				component.addOption("5", "5 Minutes (default)");
				component.addOption("15", "15 Minutes");
				component.addOption("30", "30 Minutes");
				component.addOption("60", "60 Minutes");
				component.addOption("1440", "Daily");

				component.setValue(this.plugin.settings.reindexFrequency);

				component.onChange((value) => {
					this.plugin.settings.reindexFrequency = value;
					this.plugin.saveSettings();
					this.display();
				});
			})
			.addExtraButton((component) => {
				component.setIcon("folder-sync");
				component.setTooltip("Re-index now");

				component.onClick(() => {
					this.plugin.indexMusicLibrary();
				});
			});
	}
}
