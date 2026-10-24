import { requestUrl } from "obsidian";
import { CustomSoundscapeTrack } from "src/Types/Interfaces";

export function extractPlaylistId(source: string): string {
    const value = source.trim();
    const match = value.match(/[?&]list=([^&]+)/);
    return decodeURIComponent(match?.[1] || value);
}

function extractInitialData(html: string): unknown {
    const assignment = /(?:var\s+)?ytInitialData\s*=\s*/g;
    const match = assignment.exec(html);
    if (!match) {
        throw new Error("YouTube playlist page did not contain ytInitialData.");
    }

    const start = assignment.lastIndex;
    if (html[start] !== "{") {
        throw new Error("YouTube playlist data was not a JSON object.");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index++) {
        const character = html[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === "\"") {
                inString = false;
            }
            continue;
        }

        if (character === "\"") {
            inString = true;
        } else if (character === "{") {
            depth++;
        } else if (character === "}") {
            depth--;
            if (depth === 0) {
                return JSON.parse(html.slice(start, index + 1));
            }
        }
    }

    throw new Error("YouTube playlist data was incomplete.");
}

export default async function fetchPlaylistTracks(source: string): Promise<CustomSoundscapeTrack[]> {
    const playlistId = extractPlaylistId(source);
    if (!playlistId || playlistId.startsWith("RD")) {
        throw new Error("A standard YouTube playlist ID is required.");
    }

    const response = await requestUrl({
        url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    });
    const data = extractInitialData(response.text);
    const tracks = new Map<string, CustomSoundscapeTrack>();

    const addTrack = (id: unknown, title: unknown): void => {
        if (typeof id !== "string" || !id) return;
        tracks.set(id, {
            id,
            name: typeof title === "string" && title ? title : id,
        });
    };

    const visit = (value: unknown, isRichItemContent = false): void => {
        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, isRichItemContent));
            return;
        }
        if (!value || typeof value !== "object") return;

        const record = value as Record<string, unknown>;
        const renderer = record.playlistVideoRenderer as Record<string, unknown> | undefined;
        const richVideoRenderer = isRichItemContent
            ? record.videoRenderer as Record<string, unknown> | undefined
            : undefined;
        const video = renderer ?? richVideoRenderer;
        if (video) {
            const title = video.title as Record<string, unknown> | undefined;
            const runs = title?.runs as Array<Record<string, unknown>> | undefined;
            addTrack(video.videoId, runs?.[0]?.text ?? title?.simpleText);
        }

        const richItem = record.richItemRenderer as Record<string, unknown> | undefined;
        if (richItem?.content) {
            visit(richItem.content, true);
        }

        const lockup = record.lockupViewModel as Record<string, unknown> | undefined;
        if (
            lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" &&
            typeof lockup.contentId === "string"
        ) {
            const metadata = lockup.metadata as Record<string, unknown> | undefined;
            const metadataView = metadata?.lockupMetadataViewModel as Record<string, unknown> | undefined;
            const title = metadataView?.title as Record<string, unknown> | undefined;
            addTrack(lockup.contentId, title?.content ?? title?.text);
        }

        Object.entries(record).forEach(([key, child]) => {
            if (key !== "richItemRenderer") {
                visit(child, isRichItemContent);
            }
        });
    };

    visit(data);
    const parsedTracks = Array.from(tracks.values());
    console.log("Parsed tracks:", parsedTracks);
    if (parsedTracks.length === 0) {
        throw new Error("No videos were found in the YouTube playlist.");
    }
    return parsedTracks;
}
