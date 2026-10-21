# Voice commands

Users can speak instead of typing: ask questions, open screens, and fill document forms. Voice
never saves, posts, approves or cancels anything — it opens a screen, shows an answer, or fills
fields that the user checks and saves as usual. Interim rules: OPEN-QUESTIONS Q-060.

## Using it

| Where | How | Example |
|---|---|---|
| Anywhere | Microphone in the top bar, or **Alt+V** | “Which D.C.s are pending at Noyyal?” · “How much 30s yarn is in the yarn store?” · “Open vendor bills” · “New outward D.C.” |
| On a document form (draft) | **Fill by voice** button above the form, or Alt+V | Yarn receipt: “Mill Kaveri Spinning, invoice KSM 0512 dated yesterday, lot KSM-2610 40 bags 1000 kilo at 286” |
| In any text field | Click into the field, press Alt+V, speak, then **Type into the field** | Remarks, vendor D.C. numbers |

The panel shows what was heard; it can be corrected (or typed) before sending. When AI understanding is on, the
request is sent as soon as the speaker pauses.

**Forms that can be filled by voice:** orders (header), yarn receipts, outward D.C.s, inward D.C.s
(rolls), trims receipts / issues, sewing output, cartons, debit notes, payment vouchers, vendor bills
(header). Lines that are spoken are added after the lines already entered; on sewing output and
cartons a spoken colour × size replaces that cell. Fields that need a pick from a short list the
system builds (the programme process on an outward D.C., the D.C.s a bill or inward covers, rolls
scanned by QR) are still chosen by hand.

**Questions** are answered from the reports in Reports (stock balances, pending D.C.s, process
loss, yarn purchases, order progress, payables ageing, export register, export receivables), with
the user's own permissions. The answer gives the matching rows and totals worked out from the rows,
plus a link that opens the full report with the same filters.

## How it works

1. **Speech → text in the browser** (Web Speech API; Chrome and Edge on desktop, Chrome on
   Android). Language from Settings › `voice.language` (default `en-IN`). Chrome's recogniser sends
   the audio to Google's speech service; Edge's to Microsoft's. Browsers without speech
   recognition can still type into the panel.
2. **Text → action** on the server (`POST /api/v1/voice/interpret`). With `VOICE_AI_PROVIDER=anthropic`
   Claude (`VOICE_AI_MODEL`, default `claude-opus-5-5`, low effort) turns the text into one of:
   open a screen, run one report with filters, fill named form fields. Without it only
   “open / new <screen>” commands are understood, and dictation into a field still works.
3. **Checks on the server:** a screen must be one the user can see; a report must be one the user may
   run (the report re-checks the permission); vendor, buyer, item, process and order names are
   matched to the masters — a code or exact name wins, a fuzzy match must be clearly best, otherwise
   the user is shown the candidates and picks; dates, numbers and list choices are validated. Every
   problem is listed in the panel.
4. **Nothing is written.** The interpret endpoint only reads. It is rate-limited to 30 requests per
   minute per user. The audit log is unchanged, because saving still goes through the normal form.

## Settings and switches

| Setting | Where | Default |
|---|---|---|
| Show the microphone | Settings › `voice.enabled` | on |
| Listening language | Settings › `voice.language` | `en-IN` (also `en-US`, `en-GB`, `ta-IN`, `hi-IN`) |
| AI understanding | `.env` `VOICE_AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | off |
| Model | `.env` `VOICE_AI_MODEL` | `claude-opus-5-5` |

The microphone only works on `https://` sites or `localhost` (browser rule). The first use asks
the user to allow the microphone.
