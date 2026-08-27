# ATLAS Remotion Edit Engine V1

The actual renderer now uses Remotion by default. The legacy FFmpeg renderer remains as fallback.

Install exact aligned versions:

```powershell
npm install --save-exact remotion@4.0.514 @remotion/bundler@4.0.514 @remotion/renderer@4.0.514
```

Then:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Expected logs: `ATLAS REMOTION PRO EDIT ENGINE V1`, `ATLAS REMOTION: bundling edit engine...`, `ATLAS REMOTION: rendering ... frames`, `ATLAS REMOTION: render complete`.

The render still returns `X-Atlas-Review-Id`, so the existing AI review loop continues after Remotion.
