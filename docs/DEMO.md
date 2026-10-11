# Demo mode

ForkLog runs end to end with **no backend** when `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are missing from `.env`, or when you tap **Demo** on the Library tab. Everything is clearly labelled `DEMO`.

| Real app | Demo mode |
| --- | --- |
| Supabase tables + storage | In-memory store (`lib/demoDb.ts`), resets on reload or **Exit demo** |
| `extract-recipe` on your video | `Use the demo clip` on Import → the sample recipe (same JSON the Edge Function returns in `STUB_MODE`) |
| Gemini watching the camera | Scripted coach events per step (`lib/demoData.ts` → `DEMO_COACH_SCRIPT`); camera optional |
| ElevenLabs TTS | Device text-to-speech (`expo-speech`), also used as a fallback whenever the `tts` function fails |
| `recap` function | Sample diff: soy 2 → ~3 tbsp, garlic 60 → 90 s |

## Walkthrough (matches the 3-minute script in HACKATHON.md)

1. **Library** – demo recipe is pre-loaded. *Skip to the recap of a finished cook* jumps straight to step 4.
2. **Import** → *Use the demo clip* → *Extract recipe* → review (ingredients with `~` were estimated).
3. **Cook** – step 1 notes the noodles at 4 s. Tap *Next step* to step 4: soy is noted, then the voice corrects: "Creator used less soy. Add a splash of water." Linger on step 3 for 40 s to see a red **stop** banner. **Guide** opens preset questions answered from the selected recipe version.
4. **I'm done** → **Recap** – rate it, *Show me what I changed*, then *Save child version* (next: v2 for the untouched sample).
5. **Versions** – v1 and v2 with the diff summary; *Cook v2* starts from the saved version.

## Intentional ingredient/version rehearsal

1. Start the original recipe and go to the garlic step. Tap the **garlic** pill to omit it; tap **Omitted · garlic ↶** to undo. Draft changes pause coaching. Manual step navigation stays available.
2. With garlic omitted, tap **Save child version & apply**. Wait for the saved version badge. The child retains canonical ingredient names, source step numbers and reference-frame links; original v1 is preserved. A step with all listed ingredients omitted asks you to review/skip it manually.
3. **Ingredient choices / quantities** lets you edit amounts in the existing units and restore omitted ingredients. These are explicit user choices, not camera measurements. Each confirmed adaptation is a child of the current version.
4. **Guide** supplies preset answers from the selected recipe version. Omitted ingredients are excluded from quantity answers. This is not a microphone conversation.
5. Finish, review the recap, then open **Versions** and **Cook v2** (or whichever number was actually saved). The selected version controls cooking; v1 remains available. Changing an older version produces the next available version number, not necessarily parent+1.

**Mode and persistence:** App DEMO uses an in-memory store; versions survive screen navigation but are lost on app reload/termination or Exit demo. An adapted DEMO recipe disables source-scripted camera comparisons and returns an explicitly non-measured recap. Unmodified demo recipes retain the existing scripted walkthrough. Demo thumbnail progress does not upload images or measure latency.

**Real backend review required:** The updated `coach-frame` and `recap` sources must both be reviewed and separately authorized for deployment before adapted live coaching can be used. The app checks their `ingredient-options-v1` capability before saving/applying an adaptation and before adapted coaching/recap; an older deployment pauses with an error. Public Supabase settings alone do not prove model readiness. Updated functions report backend STUB_MODE so sample output can be labelled. No database migration is needed. Do not put model/service-role keys in the app.

**Recovery:** If the child was saved but could not be attached to the cook, **Retry attach saved version** reuses that child while coaching remains paused. Partial reference/link/title failures are reported as warnings after the version is saved. Network loss after a server insert can still leave an ambiguous outcome; inspect history before retrying after restarting the app. Thumbnail status distinguishes completed attempts from successful references; failed references fall back to visual cues.

Local checks (native modules/model/database calls are mocked; these do not certify phone/cloud behavior):

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test scripts/check-finishing.cjs
git diff --check
```

Rehearse on the actual demo phone before submission: original scripted flow, omit → save child → replay → restore, quantity edit, rapid Next/Back, mute/finish during delayed speech/coaching, camera denial, network failures, and readability with the keyboard open. A real cloud run still needs separate configuration/deployment/model/reference/audio verification. This session adds no background queue, translation, typed model guidance, downloader, or share extension.

## Deep links (Expo Go, handy for rehearsal and screenshots)

```
exp://127.0.0.1:8081/--/cook/demo-recipe-seed?step=4
exp://127.0.0.1:8081/--/recap/demo-cook-seed?autorun=1      # rates 8 and generates the recap
exp://127.0.0.1:8081/--/recap/demo-cook-seed?autorun=save   # ...and saves v2, lands on Versions
exp://127.0.0.1:8081/--/import?autorun=1                    # runs the demo clip through import
```
`autorun` and the seeded cook only exist in demo mode. In the simulator: `xcrun simctl openurl booted "<url>"`.

## Screens

These are earlier-build screenshots; the added ingredient/version controls and Guide label differ.

| | |
| --- | --- |
| ![Library](demo/1-library.png) | ![Import review](demo/2-import-review.png) |
| ![Cook step 1](demo/3-cook-step1.png) | ![Cook step 4 correction](demo/4-cook-step4-correction.png) |
| ![Recap diff](demo/5-recap-diff.png) | ![Versions](demo/6-history-v2.png) |
