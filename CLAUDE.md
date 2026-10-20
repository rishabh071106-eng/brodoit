# Brodoit — CLAUDE.md

## Architecture

Single-file monolith: `server.js` (~15,400 lines). Express server serving API + full SPA HTML in one `const HTML = \`...\`` template literal. SQLite database via better-sqlite3. Deployed on Railway via git push.

## Deployment

```bash
# Test locally
node server.js  # starts on port 3000

# Deploy (auto-deploys on Railway)
git add server.js
git commit -m "description"
git push origin main      # GitHub (brodoit.git)
git push railway main     # Railway (taskflow.git) — triggers deploy
```

Both pushes are needed. Railway auto-builds on push to `railway` remote.

## Critical Escaping Rules

The HTML is inside a JS template literal (`const HTML = \`...\``). Inside it:
- Use `✅` (unicode escapes) for emoji, not raw emoji
- Escape backticks: `\`` 
- For `onclick` handlers with string args: `onclick="fn(\\'value\\')"` (double-backslash + quote)
- `${...}` interpolation works — be careful not to accidentally create one
- `\n` becomes a newline in the template — use `\\n` for literal `\n` in strings inside the HTML

Server-side code (outside the template literal) uses normal JS — raw emoji and single-backslash escapes work fine.

## Key Sections (line ranges shift as code changes — use grep)

| Section | Grep landmark |
|---------|--------------|
| DB schema | `CREATE TABLE IF NOT EXISTS` |
| Auth/OTP | `// ═══ OTP AUTH` |
| AI Chat (Bro) | `// ═══ BRO / BRI` |
| Tasks API | `// ═══ TASKS API` |
| Mind Games | `// ═══ MIND GYM` |
| WhatsApp webhook | `// ═══ WHATSAPP CLOUD API WEBHOOK` |
| News feed | `// ═══ NEWS` |
| Frontend HTML start | `const HTML=` |
| CSS start | `<style>` (inside HTML) |
| JS start | `<script>` (inside HTML) |
| Service Worker | `app.get('/sw.js'` |
| Night sky / stars | `night-sky` |
| Tab bar render | `function renderTabs` or `tabBar` |
| Marketing pages | `// ═══ MARKETING` |
| v9 modules (voice, news channel, /lang, Hindi books) | `// ═══ v9:` — code lives in `modules/voice.js`, `modules/bulletin.js`, `app/*.js`, `lang/` |
| Settings + Admin panel (keys live in `app_settings`, env is fallback) | `modules/settings.js`, `modules/admin.js`, `app/admin.js`; identity `isAdminUser` |
| Steps (StepSetGo-style) | `modules/steps.js` (server), `app/steps.js` (tab), tab key `steps`; `dayKey(tz)` for IST days |
| Design system v10 | `app/theme.css` (tokens), `app/icons.js` (`ico()`), `app/mascot.svg`, `app/haptics.js`, fonts in `app/fonts/` |
| Talking Bro home screen | `broVoiceRoot` (render) + `app/voice.js` (client) |
| News Channel | `newsRoot` (render) + `app/news.js` |
| Learn tree | `var _LT=[` |
| Book player v2 | `function bkpPlay` / `_bkBuild`; Hindi via `bkHiBook` |

## Themes

- **Aurora (dark)**: default. `data-theme="aurora"` on body. Dark background, gradient accents.
- **Night Sky**: `body.night-sky` class, adds nebula + star elements.
- **Classic (light)**: no theme attribute, white background.

CSS variables are defined at the top of the `<style>` block under `[data-theme="aurora"]`.

## Database

SQLite at `DB_PATH` env var, or `/data/taskflow.db` (Railway volume), or `./taskflow.db` (local).

Key tables: `users`, `tasks`, `otps`, `mind_gym_progress`, `steps`, `push_subs`, `meetings`, `meeting_voices`, `highlights`, `schedule_blocks`, `community_articles`, `bro_memory`

## Environment Variables (Railway)

| Var | Purpose |
|-----|---------|
| `DB_PATH` | SQLite path (Railway: `/data/taskflow.db`) |
| `RESEND_API_KEY` | Email OTP delivery |
| `GROQ_API_KEY` | AI chat (Bro) — free tier |
| `GEMINI_API_KEY` | AI chat primary — free tier |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notifications |
| `WHATSAPP_TOKEN` | Meta Cloud API permanent token |
| `WHATSAPP_PHONE_ID` | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification (default: `brodoit_verify_2024`) |
| `WHATSAPP_NUMBER` | Business number with +country code |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth |
| `OPENAI_API_KEY` | Talking Bro real-time voice (WebRTC); normally pasted in You → Admin instead; env is the fallback |
| `ELEVENLABS_API_KEY` | Studio voices: bulletins (EN/HI), Hindi book briefs, language lessons; normally pasted in You → Admin |
| `ADMIN_TOKEN` | `POST /api/bulletins/refresh?token=` to re-write today's bulletin |

## Common Tasks

### Change UI text/styling
1. Find the section with `grep -n 'keyword' server.js`
2. Edit server.js
3. Bump CACHE_VER: find `var CACHE_VER="vNN"` in the SW section, increment
4. Also update SW registration: `register('/sw.js?v=NN'`
5. `node -c server.js` to verify syntax
6. Commit + push both remotes

### Add a new API endpoint
Insert near related endpoints. Pattern:
```js
app.post('/api/thing',auth,async(req,res)=>{
  // auth middleware sets req.user = {phone, name, ...}
  res.json({ok:true});
});
```

### Frontend state
Global `S` object holds all app state. `render()` (via requestAnimationFrame) re-renders the whole page. `_render()` renders synchronously.

### Render functions
Frontend is vanilla JS. The `_render()` function returns the full HTML for the current tab. Each tab's content is in a section like:
```js
if(S.tab==='tasks') html += '...';
```

## Auth Pattern

Opaque token auth, NOT JWT. Token stored in `users.token` column. Auth middleware:
```js
function auth(req,res,next){
  const t=req.headers['x-token']||...;
  const user=db.prepare('SELECT * FROM users WHERE token=?').get(t);
  if(!user) return res.status(401)...;
  req.user=user; next();
}
```

## Git Remotes

- `origin` → `github.com/rishabh071106-eng/brodoit.git` (source of truth)
- `railway` → `github.com/rishabh071106-eng/taskflow.git` (deploy trigger)

## Pre-commit Checklist

1. `node -c server.js` — catch syntax errors
2. Bump `CACHE_VER` if frontend changed
3. Push to BOTH `origin` and `railway`

## WhatsApp Integration

Uses Meta WhatsApp Cloud API (not Twilio). Auto-creates accounts for new WhatsApp users. Merges accounts when users later sign up on web. Commands: list, done, doing, delete, help + natural language task adding.

## Don't

- Don't add `require('twilio')` — removed, using native fetch to Graph API
- Don't commit `.env` — it's gitignored
- Don't use `git push --force` — Railway tracks main branch
- Don't assume HMR — server must restart for any change to take effect


## Android (v9.4, v19 Google Play)
- `android/` — Kotlin TWA + background steps (`LauncherActivity`, `EnableStepsActivity`, `StepsEngine` → `RecordingProvider`/`SensorProvider`, `SyncJobService`, `Scheduler`, `Api`). Two flavors of one build (`.github/workflows/android.yml`): `direct` = `com.brodoit.app` (the APK at brodoit.com/android), `play` = `com.brodoit.twa` (the bundle for the existing Play listing). targetSdk 36, versionCode = 1000 + run number. CI checks packages/versions/target SDK, installs on API 35/36 emulators (`.github/scripts/android-smoke.sh`), releases from `main` only, then checks the APK brodoit.com serves.
- `modules/android.js` — fetches the newest GitHub release (every 10 min), signs with the on-volume upload key, serves `/download/brodoit.apk`, `/android`, `/api/android/status` (with `play`), `/download/upload_certificate.pem` (Play Console's upload key reset); `global._androidCert()` feeds `/.well-known/assetlinks.json`.
- `modules/play.js` — uploads each signed Play bundle to Play's `internal` + `alpha` tracks (Play Developer API, service account from Admin → Google Play = `PLAY_SERVICE_ACCOUNT_JSON`; `PLAY_TRACKS`). States: no-account, no-access, waiting-key-reset, uploaded, error.
- Steps client: `isTWA()` accepts `android-app://com.brodoit.*` and `?twa=1`; "Turn on" opens `intent://enable#Intent;scheme=brodoit;package=<twaPkg()>;end` (the app that opened the page).

- `modules/admin.js` `autoRecord()` — self-starting recording chain (bulletin → hindi-books → lang-audio), triggered by key save, boot (+90 s) and a daily 03:30 IST sweep; `GET /api/admin/status` → `auto`, `POST /api/admin/auto` runs it now. `ADMIN_AUTO_RECORD=0` disables.

## Voice (v9.5)
- `modules/elevenvoice.js` — `pickVoice(key, lang, getSetting)` (Admin setting → env → account voices by name → Adam), `speak()` with `eleven_turbo_v2_5` + language_code (multilingual_v2 rejects language_code). Used by bulletin, lang-audio, hindi-books and Bro's TTS.
- `modules/voice.js` — engines in order: ElevenLabs Conversational AI (`ensureAgent`, `/v1/convai/agents/create`, signed URL; `ELEVEN_AGENT_ID`/`_HASH` in settings; `global._voiceStatus()` for Admin) → OpenAI Realtime → classic (`/api/voice/turn`: OpenAI chat → Groq → Gemini with tools; `/api/voice/tts`; `/api/voice/transcribe`).
- `app/voice.js` — `V.connectEleven` loads `@elevenlabs/client` from esm.sh/jsDelivr, client tools → `/api/voice/tool`; full-screen overlay; `V.speak` prefers `/api/voice/tts`.
- AI keys in `server.js` are `geminiKey()` / `groqKey()` (Admin → env); `global._getSetting` is set once settings load.

## News Desk + mini-app chrome (v9.5)
- `modules/newsdesk.js` — batch every 30 min (+boot): all feeds → cluster duplicates (token Jaccard ≥ .28) → writer OpenAI → Gemini → Groq (JSON: headline, 55-65-word summary, why, Hindi trio, category; only facts from sources) or extractive fallback → `news_stories`. `GET /api/news/desk`, `POST /api/news/desk/run` (admin). `NEWS_DESK=0` disables.
- `app/news.js` — default view `top`: Brodoit Desk cards (`N.deckHtml`, `N.card`, `N.sizeDeck`), Listen via `N.say` (studio TTS), Explain via `N.explainObj`, Read via `N.readItem`.
- `lang/assets/topbar.{js,css}` — shared mini-app bar: one back control (parent ‹ or "← Brodoit"), home button on the right when there is a parent; cold-open back guard (referrer-based) so Android back lands in the app.
- Android first open asks the system Physical-activity permission directly (one tap); declining opens the app.

## Money-safe voice, Gemini models, sealed keys (v9.6)
- `modules/studio.js` — the only place text becomes speech (bulletin, News "Listen" via `/api/voice/tts` with `kind:'news'`, Bro classic replies, `scripts/lang-audio.js`, `scripts/hindi-books.js`). Order: ElevenLabs → Gemini TTS (`modules/geminivoice.js`, PCM → mp3 via ffmpeg) → OpenAI `gpt-4o-mini-tts`; null → device voice. `plan()` picks one provider per lesson/book. Monthly usage in `MEDIA_DIR/voice-usage.json`, shown in Admin ("Voice this month"). `/api/voice/tts` caches by text in `MEDIA_DIR/tts-cache` (a story is paid for once).
- ElevenLabs credit guard (`elevenvoice.js` `budget()`): reads `/v1/user/subscription`; purposes `live` (Bro) may use all that is left, `daily` stops with 30% of the plan left, `bulk` only uses the first 40%; never runs into overage. A quota error marks ElevenLabs out for 6 h and the next provider takes over; the voice session skips the agent while out.
- `modules/gemini.js` — every Gemini text call (server `_callGemini`, jobs, News Desk on the lite tier, Hindi translation). Google retires ids (`gemini-2.0-flash` is gone) → chain `GEMINI_MODEL` → `gemini-2.5-flash` → `gemini-flash-latest`. HTTP 402 = project out of prepaid credit → `err.code='credits'`; Admin checks Gemini with a real one-token call (listing models succeeds even with no credit).
- `modules/settings.js` `KEYS` must list every name read through `getSetting` (missing names silently fall back to env and throw on save — that is how pasted Gemini keys and `ELEVEN_AGENT_ID` were lost before v9.6).
- Sealed keys (`modules/sealed.js`): repos are public, so keys handed over in chat are encrypted to the server's own RSA key (private half in `dirname(DB_PATH)/secrets`, never served). Get the public key with the "Server public key" workflow (or `GET /api/seal/pubkey`), run `NAME=value node scripts/seal.js pub.json NAME`, commit `config/sealed-settings.json`; the next boot applies new items once (Admin edits are never overwritten).

## Card UI + live steps (v12)
- Look: the Books section everywhere. `app/cards.css` + `app/cards.js` (`window.Cards`): `Cards.cover()` (image-led cover card; photo by `key`, art fallback by `icon` + `tone-*`), `Cards.row()` (list card with 56-px photo thumb), `Cards.mini()` (small stat/action card), `Cards.sec()`; layout `.cv-grid`, `.cv-rail`, `.page-h`; one button system `.btn` (+ `accent/soft/light/glass/line`, `sm/wide`), `.btn-ic`, filled `.pill`s. Legacy `.b-btn`/`.b-chip` are restyled to match.
- Photos: `app/img/cards/<key>.jpg` (960×640) fetched by CI from Wikimedia Commons, free licences only (`scripts/fetch-images.js`, `config/image-manifest.json`, workflow "Card photos" on a `claude/*` push). Delete a jpg + push the manifest to refetch. Attribution at `/credits` (`modules/credits.js`).
- Screens: Home `app/voice.js` + `app/home.css`; Learn landing `app/learn.js` (`LearnUI.landing()`, hooked in server.js, legacy fallback); You `app/you.js` (`YouUI.html()` replaces `_youDash()`); Tasks `app/tasks.css`; Books `app/books.css`; Steps `app/steps.js/css`; News `app/news.js/css` (section-matched fallback photos).
- Live steps (`app/steps.js`): on Android the motion sensor counts whenever Brodoit is visible (no tap, no permission; iPhone shows "Count live"); the ring and the Home card tick up; display = max(server, base + live steps) with a per-account per-day floor (`bd_live_floor`) so a background Android-app sync never double counts and the number never snaps back. Deltas post as `source:'device'` (trust 1) at most once a minute.

## Learn = two schools, News = recorded cards, ElevenLabs brain (v13)
- **Learn tab** (`app/learn.js`, `app/learn.css`): only Python (`/code/`) and Languages (`/lang/`). Exam prep (`/prep`), jobs, the ML lab and the old inline AI/Product/fake-Python sections are retired; `/prep/*` → `/?tab=learn`, `/learning/*` → `/code/`, `/lang/phrases*` → `/lang/`. Japanese and the phrasebooks were removed; the language school is es/fr/de/hi (taught in English) + en (taught in Hindi).
- **Python: Zero to Hero** (`/code`): 60 days in `code/days/dNN.json` (format: `code/COURSE.md`, syllabus: `code/SYLLABUS.md`). Real CPython runs in the browser: Pyodide pinned in package.json, served by `modules/pyhost.js` at `/code/py/<ver>/` (brotli/gzip precompressed into `MEDIA_DIR/.cache`), executed in `code/assets/pyworker.js` with `code/assets/harness.py` (output capture, stdin, step tracer for "Watch it run", exercise tests). **Always run `node scripts/code-check.mjs`** after editing a day: it runs every snippet in the same harness, checks expected output, predict answers and that exercise solutions pass and starters fail, and rebuilds `code/days/index.json`. Bump `HARNESS` in `code/assets/runner.js` when harness.py changes.
- **Player UI**: `code/day.html` + `assets/player.js` (slides, editor.js, trace.js, visuals.js — 12 animated visual kinds), mission map `code/index.html` + `assets/map.js`, Bro dock `assets/coach.js`. Progress lives in `localStorage bd.py.v1` and syncs to `/api/learn/progress`.
- **modules/learn.js**: progress tables (`learn_units`, `learn_stats`, `learn_events`), `POST /api/learn/coach` (Bro with the learner's profile, slide, code and error), and narration recorded once: every `say` line and every target-language phrase is a catalog entry (`sid = sha1(voice + "\n" + text)[0:20]`, same on client); `GET /api/learn/say/<sid>.mp3` serves `MEDIA_DIR/learn-voice` or records it on first play; `scripts/learn-audio.js` (Admin job `learn-audio`) pre-records everything. Language pages' `speak()` (lang/assets/lang.js) plays these clips before the device voice.
- **Languages UI**: `lang/course.html` + `lang/assets/stages.css` (photo hero, Listen episodes, practice stages with a gate); lessons add combo/XP/burst and sync completions to `/api/learn/progress`.
- **v20 Languages**:
  - **Openings:** every Listen lesson (`lang/audio/<code>.json`, `short: true`) opens with one line ("Lesson N. Let's go!…", in Hindi for the English course), then the last instruction before the first speak-back. The welcome, the opening dialogue and its recap were cut.
  - **Playback:** `lang/audio.html` plays line by line in Bro's voice and prefetches the next lines (`prefetch()` in lang.js; clips `?v=e20`). The stitched lesson mp3 is no longer used.
  - **Clip catalog:** `modules/learn.js` covers every Listen line too: guide `n`/`q` lines under the learner's language key (en, or hi for the English course), `t` lines under the course key. The fill-in sentence uses `options[answer]`.
  - **Recording:** clips go to `learn-voice/<voice id>-<Bro voice style>/`.
    - The recording is strict Bro Core. German tries the studio's ElevenLabs voice first.
    - When busy or booting, the route answers 503, uses a short miss and plays the earlier folder's clip if there is one.
    - Nothing paid is used unless the emergency switch is on.
    - A low-priority warm-up records the first 2 Listen + Practice lessons of each course.
    - Admin no longer auto-runs the paid `learn-audio` / `lang-audio` jobs.
  - **Speak-back** (`hearPhrase` + `matchPhrase` in lang.js):
    - **Hearing:** the phone recogniser (SpeechRecognition) is used when it works. Otherwise MediaRecorder with voice-activity detection records the answer and sends it to `POST /api/voice/transcribe?lang=<course>&expect=<phrase>`. Every Bro Core language is accepted, and `hear.js` never drops the expected phrase as a phantom.
    - **Match:** accents, punctuation and number words are folded first; a close sentence must also have its words.
    - **Flow:** a wrong try shows "You said …" and Bro says the line again. Silence shows "I didn't hear you". After three wrong tries or two silences, Bro waits for a mic tap. Nothing advances by itself.
    - **Ways out:** "Hear it again" and "Stop for now" (the place is kept in localStorage `lang.pos.<code>/<id>`). Skip is gone.
    - **Practice:** the Practice `speak` card passes only when it's right. "Can't speak now" pauses the lesson.
- **News** (`app/news.js`): cards only (desk stories), section chips, "Listen" plays recorded headline clips back to back. `modules/newsvoice.js` records after every desk batch through ElevenLabs only (`NEWS_VOICE_PROVIDER=any` opens the chain): headlines for every story in the feed + `NEWS_VOICE_FULL` (default 10) full read-outs a day per language; files in `MEDIA_DIR/news-voice`, served by `/api/news/voice/<id>-<lang>-<h|s>.mp3`. Nothing is rendered on tap. The long spoken bulletin is opt-in (`BULLETIN_AUDIO=1`). News is a bottom tab; You moved to the header avatar.
- **ElevenLabs brain** (`modules/elevenbrain.js`): a private text-only ElevenLabs agent used as the LLM when Gemini has no key, is out of credit (402 → skipped for an hour via `global._geminiDownUntil`) or fails — `_callGemini` falls back to it, so Bro chat, Explain, the coach and the news desk keep working on ElevenLabs credits. Bro chat no longer runs a second "verify" pass.
- **ElevenLabs budget** (modules/elevenvoice.js `RESERVE`): bulk (static recordings) may use the first 70% of the month, daily (news, first plays) stops at 15% left, live Bro uses the rest. Admin auto-record order: learn-audio → lang-audio → hindi-books.
