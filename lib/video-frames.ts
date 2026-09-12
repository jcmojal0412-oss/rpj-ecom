import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

export class VideoProcessingError extends Error {}

export interface ExtractedFrame {
  base64: string;
  mediaType: string;
  timestampSec: number;
}

// Evenly spaced frames (skipping the very first/last instant to dodge
// black/fade frames) — not scene-detection, deliberately simple for v1.
// -ss before -i is fast (keyframe-ish) seeking; accuracy doesn't matter
// here since we just want representative coverage across the clip.
export async function extractVideoFrames(
  videoBuffer: Buffer,
  originalExt: string,
  frameCount = 8
): Promise<{ frames: ExtractedFrame[]; durationSec: number }> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ad-video-'));
  const videoPath = path.join(tmpDir, `input.${originalExt.replace(/[^a-z0-9]/gi, '') || 'mp4'}`);

  try {
    await writeFile(videoPath, videoBuffer);

    let durationSec = 0;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ]);
      durationSec = parseFloat(stdout.trim());
    } catch (e: any) {
      console.error('[video-frames] ffprobe failed:', e?.message, 'stderr:', e?.stderr, 'code:', e?.code);
      throw new VideoProcessingError('Unable to read the video file — it may be corrupted or in an unsupported format.');
    }
    if (!durationSec || durationSec <= 0) {
      throw new VideoProcessingError('Could not determine video duration.');
    }

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < frameCount; i++) {
      const t = (durationSec * (i + 0.5)) / frameCount;
      const framePath = path.join(tmpDir, `frame-${i}.jpg`);
      try {
        await execFileAsync('ffmpeg', [
          '-ss', t.toFixed(2),
          '-i', videoPath,
          '-frames:v', '1',
          '-vf', 'scale=1024:-2',
          '-q:v', '4',
          '-y', framePath,
        ]);
        const buf = await readFile(framePath);
        frames.push({ base64: buf.toString('base64'), mediaType: 'image/jpeg', timestampSec: t });
      } catch (e: any) {
        // Skip a frame that fails to extract (e.g. right at a keyframe
        // boundary) rather than failing the whole analysis over one frame.
        console.error(`[video-frames] frame ${i} extraction failed:`, e?.message, 'stderr:', e?.stderr, 'code:', e?.code);
      }
    }

    if (!frames.length) {
      throw new VideoProcessingError('Unable to extract any frames from this video.');
    }

    return { frames, durationSec };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
