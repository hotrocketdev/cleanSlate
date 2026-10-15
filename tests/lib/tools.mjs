// tests/lib/tools.mjs — the test harness decodes media to prove quality is intact,
// so ffmpeg/ffprobe are hard requirements. Fail with a clear message, not ENOENT.
import { execFileSync } from 'node:child_process';

export function requireMediaTools() {
  const missing = [];
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      execFileSync(tool, ['-version'], { stdio: 'ignore' });
    } catch (e) {
      missing.push(tool);
    }
  }
  if (missing.length) {
    console.error(`\n${missing.join(' and ')} not found on PATH.`);
    console.error('The tests decode the cleaned media to prove no quality was lost, so both are required.');
    console.error('  Debian/Ubuntu:  sudo apt-get install -y ffmpeg');
    console.error('  macOS:          brew install ffmpeg');
    console.error('  Windows:        winget install Gyan.FFmpeg\n');
    process.exit(2);
  }
}
