# Brodoit v9.3 — what to switch on (everything from inside the app)

Everything works out of the box with the device voice. To unlock the studio experience you paste two keys **inside the app**:
**You → Admin** (visible only to the admin = the first account / `ADMIN_EMAIL`). Keys are stored in the app's own database on the
persistent volume and take effect immediately — no Railway variables, no shell. (Railway variables still work as a fallback.)

| Key | What it unlocks | Where |
|---|---|---|
| `OPENAI_API_KEY` | **Talking Bro**: real-time speech-to-speech voice (ChatGPT-voice quality, interruptible, understands Hindi/Hinglish). Without it Bro uses the phone's speech recognition + Gemini + device voice. | platform.openai.com → API keys |
| `ELEVENLABS_API_KEY` | **Studio voices**: daily news bulletins (English + Hindi) recorded once per day, Hindi book briefs, pre-rendered language lessons. Without it the same text is read by the device voice. | elevenlabs.io → Profile → API keys |
| `GEMINI_API_KEY` (already set) | Writes the daily/monthly news bulletins, "explain simply", Hindi translations. | — |

Optional: `OPENAI_REALTIME_VOICE` (default `cedar`; try `marin`), `ELEVEN_VOICE_EN` / `ELEVEN_VOICE_HI` / `ELEVEN_VOICE_ES` … (ElevenLabs voice IDs).

## Recorded once, kept forever
Everything ElevenLabs produces is written to the **persistent volume** next to the database (`/data/media/…`: `news/`, `books-hi/`, `lang-audio/`) and served from there. It is never re-rendered: a deploy, restart or redeploy does not touch it, and every script skips files that already exist. Only **Talking Bro** is live (OpenAI Realtime, per conversation); the news bulletin is rendered once per day, books and lessons once ever.

## One-time recordings — tap, don't type
In **You → Admin** tap **Record today's bulletin**, **Record Hindi books** (all 106 briefs, ~1.1M characters, runs for hours, resumable) and
**Record language lessons** (60 lessons, ~400k characters, needs ffmpeg — included in the Docker image). The jobs run on the server; you can
close the app. If Railway redeploys mid-run, tap Record again — it continues where it stopped. The same scripts can still be run from a shell
(`node scripts/hindi-books.js`, `node scripts/lang-audio.js`) if you ever want to.

## Steps
The Steps tab works on honest data today: steps are **synced when you open Brodoit** (Walk mode, manual entry, iPhone Shortcut, Google Fit backfill until Google retires it). Counting while the app is closed needs the small native part inside the Play Store app — see `android/` (Phase 2 PR).

## What's new in v9
- Home = **Talking Bro** (voice-first; personas: Bro / Teacher / News / Language; EN · हिंदी · auto). Creates tasks, reminders, calendar events, reads news, teaches.
- **News Channel**: daily spoken bulletin in English & Hindi, "Explain simply" (EN + HI + hard words) on any live headline, monthly review, archive.
- **Languages** (/lang): Pimsleur-style audio lessons + Duolingo-style practice for Spanish, French, German, Japanese, Hindi, and spoken English for Hindi speakers.
- **Books**: "हिंदी में सुनें" on every brief once `hindi-books.js` has run; player with sections, ±15 s, speed, read-along.
- **You**: time-in-app analytics, weekly chart, Google Fit steps. Phone-wide screen time needs the native Android build (usage-access permission) — not possible from the web app.
- Games and Wisdom tabs removed; new logo/icons; new theme.


## Android app (automatic steps)
- Source lives in `android/` (Trusted Web Activity + native step counter). Every push that touches `android/**` runs `.github/workflows/android.yml`, which publishes an **unsigned** APK/AAB plus `apksigner.jar` as a GitHub release.
- The server (`modules/android.js`) checks for a new release hourly, signs it with an upload key generated once on the data volume (`/data/media/android/upload.jks`), and serves it at `/download/brodoit.apk`. The install page is `/android`; status at `/api/android/status`.
- In the app: Steps → "Install Brodoit for Android" → Install → Open → **Allow** (Physical activity). Steps then count with the app closed (Recording API on mobile; hardware step counter as fallback) and sync every 30 minutes.
- Pairing is automatic: the app opens the site with `device_id` + `ct`; the web app claims the phone for the logged-in account.
- Play Console (optional, later): download the signed `.aab` from You → Admin (admin only, `/download/brodoit.aab`) and the upload-key backup from `/api/admin/android/keystore`.


## Everything is automatic now
- **Recordings**: once a key is saved in You → Admin, the server queues today's bulletin → Hindi books → language lessons by itself (also on boot and in a daily 03:30 IST sweep that resumes anything incomplete). The Record buttons stay as a manual override. Set `ADMIN_AUTO_RECORD=0` to switch it off.
- **Android**: every push to `android/**` builds a release; the server signs and serves it. Nothing to tap.
- **Deploys**: changes land on a `claude/*` branch, get a PR on both repos and are merged through the GitHub API on the owner's standing instruction; Railway deploys `main`.
