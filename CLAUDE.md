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


## Android (v9.4)
- `android/` — Kotlin TWA + background steps (`LauncherActivity`, `EnableStepsActivity`, `StepsEngine` → `RecordingProvider`/`SensorProvider`, `SyncJobService`, `Scheduler`, `Api`). Package `com.brodoit.app`, built by `.github/workflows/android.yml`.
- `modules/android.js` — fetches the newest GitHub release, signs with the on-volume upload key, serves `/download/brodoit.apk`, `/android`, `/api/android/status`; `global._androidCert()` feeds `/.well-known/assetlinks.json`.
- Steps client: `isTWA()` accepts `android-app://com.brodoit.*` and `?twa=1`; "Turn on" opens `intent://enable#Intent;scheme=brodoit;package=com.brodoit.app;end`.

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
