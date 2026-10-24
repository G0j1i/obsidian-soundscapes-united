import { Modal, Notice, Setting } from "obsidian";
import SoundscapesPlugin from "../../main";
import ConfirmModal from "../ConfirmModal/ConfirmModal";
import { CustomSoundscape } from "src/Types/Interfaces";
import fetchPlaylistTracks, { extractPlaylistId } from "src/Utils/fetchPlaylistTracks";

class EditCustomSoundscapeModal extends Modal {
	_customSoundscape: CustomSoundscape;
	_plugin: SoundscapesPlugin;
	_onSave: (soundscape: CustomSoundscape) => void | Promise<void>;

	constructor(
		plugin: SoundscapesPlugin,
		customSoundscape: CustomSoundscape,
		onSave: (soundscape: CustomSoundscape) => void | Promise<void>
	) {
		super(plugin.app);
		this._plugin = plugin;
		this._customSoundscape = customSoundscape;
		this._onSave = onSave;
	}

	onOpen() {
		this.display();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	display(): void {
		const { contentEl } = this;

		contentEl.empty();

		contentEl.createEl("h2", { text: "Edit custom soundscape" });

		new Setting(contentEl)
			.setName("Soundscape name")
			.setDesc(`What would you like to call the soundscape?`)
			.addText((component) => {
				component.setValue(this._customSoundscape.name);

				if (component.getValue().trim() === "") {
					component.inputEl.addClass("soundscapes-validation-error");
				} else {
					component.inputEl.removeClass(
						"soundscapes-validation-error"
					);
				}

				component.onChange((value: string) => {
					this._customSoundscape.name = value;
				});

				component.inputEl.addEventListener("blur", () => {
					this.display();
				});
			});

		new Setting(contentEl)
			.setName("YouTube playlist URL or ID")
			.setDesc("Update the source playlist and re-fetch its tracks when saved.")
			.addText((component) => {
				component.setPlaceholder("https://youtube.com/playlist?list=...");
				component.setValue(this._customSoundscape.sourceUrl || "");
				component.onChange((value: string) => {
					this._customSoundscape.sourceUrl = value;
				});
			});

		this._customSoundscape.tracks.forEach((track, index) => {
			new Setting(contentEl)
				.setName(`Track #${index + 1}`)
				.setHeading()
				.addButton((component) => {
					component.setButtonText("Remove track");
					component.setClass("mod-warning");

					component.onClick(() => {
						new ConfirmModal(
							this.app,
							() => {
								this._customSoundscape.tracks.splice(index, 1);
								this.display();
							},
							"Remove track",
							`This will remove "${track.name}" from your custom soundscape. Are you sure?`,
							"Remove"
						).open();
					});
				});

			new Setting(contentEl)
				.setName("Track name")
				.setDesc(`Name of the track`)
				.addText((component) => {
					component.setValue(track.name);

					if (component.getValue().trim() === "") {
						component.inputEl.addClass(
							"soundscapes-validation-error"
						);
					} else {
						component.inputEl.removeClass(
							"soundscapes-validation-error"
						);
					}

					component.onChange((value: string) => {
						this._customSoundscape.tracks[index].name = value;
					});

					component.inputEl.addEventListener("blur", () => {
						this.display();
					});
				});

			new Setting(contentEl)
				.setName("Youtube id")
				.setDesc(`Id of the Youtube video for the track`)
				.addText((component) => {
					component.setValue(track.id);

					if (component.getValue().trim() === "") {
						component.inputEl.addClass(
							"soundscapes-validation-error"
						);
					} else {
						component.inputEl.removeClass(
							"soundscapes-validation-error"
						);
					}

					component.onChange((value: string) => {
						this._customSoundscape.tracks[index].id = value;
					});

					component.inputEl.addEventListener("blur", () => {
						this.display();
					});
				});
		});

		if (!this._customSoundscape.isNativePlaylist) {
			new Setting(contentEl).addButton((component) => {
				component.setButtonText("Add new track").onClick(() => {
					this._customSoundscape.tracks.push({
						name: "",
						id: "",
					});
					this.display();
				});
			});
		}

		new Setting(contentEl).addButton((component) => {
			component.setButtonText("Save custom soundscape");

			component.setCta().onClick(async () => {
				if (this._customSoundscape.name.trim() === "") {
					new Notice("Enter a name for this custom soundscape.");
					return;
				}

				const sourceUrl = this._customSoundscape.sourceUrl?.trim() || "";
				if (sourceUrl) {
					const playlistId = extractPlaylistId(sourceUrl);
					if (!playlistId) {
						new Notice("Enter a valid YouTube playlist URL or ID.");
						return;
					}

					this._customSoundscape.sourceUrl = sourceUrl;
					if (playlistId.startsWith("RD")) {
						this._customSoundscape.isNativePlaylist = true;
						this._customSoundscape.nativePlaylistId = playlistId;
						this._customSoundscape.tracks = [];
					} else {
						try {
							this._customSoundscape.tracks =
								await fetchPlaylistTracks(sourceUrl);
						} catch (error) {
							console.error("Failed to refresh playlist tracks", error);
							new Notice("Failed to refresh tracks. Check the playlist URL and try again.");
							return;
						}
						this._customSoundscape.isNativePlaylist = false;
						delete this._customSoundscape.nativePlaylistId;
					}
				} else if (
					!this._customSoundscape.isNativePlaylist &&
					this._customSoundscape.tracks.some(
						(track) => !track.name.trim() || !track.id.trim()
					)
				) {
					new Notice("Complete or remove the tracks with missing names or YouTube IDs.");
					return;
				}

				await this._onSave(this._customSoundscape);
				this.close();
			});
		});
	}
}

export default EditCustomSoundscapeModal;
