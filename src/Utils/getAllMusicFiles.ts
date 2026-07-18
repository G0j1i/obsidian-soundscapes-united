import fs from "fs";
import path from "path";

const MUSIC_FILE_EXTENSIONS = ["mp3", "m4a", "opus", "ogg", "wav", "flac", "webm"];

const MIME_TYPES: Record<string, string> = {
  mp3: "audio/mp3",
  m4a: "audio/mp4",
  opus: "audio/ogg",  // Opus is technically a subset of Ogg containers in HTML5
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  webm: "audio/webm"
};

export const getMimeType = (extension: string): string => {
  // (OLD: `audio/mp3` - It is safer to default to `audio/mpeg` or generic audio if not found
  return MIME_TYPES[extension] || "audio/mpeg";
};

/**
 * Given a file path, builds a list of music files by recursively going through the file structure and finding
 * files with appropriate file extensions.
 * @param dirPath
 * @param fileArray
 */
const getAllMusicFiles = (
	dirPath: string,
	fileArray: Array<string> | undefined = undefined
) => {
	const files = fs.readdirSync(dirPath);

	fileArray = fileArray || [];

	files.forEach((file) => {
		const filePath = path.join(dirPath, file);
		if (fs.statSync(filePath).isDirectory()) {
			fileArray = getAllMusicFiles(filePath, fileArray);
		} else if (
			MUSIC_FILE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase()) // .toLowerCase() ensures .MP3 works too!
		) {
			fileArray?.push(filePath);
		}
	});

	return fileArray;
};

export default getAllMusicFiles;
