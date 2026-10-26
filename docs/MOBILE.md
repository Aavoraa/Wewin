# Mobile app

The phone version of Wewin ERP is the same web app with a phone layout (Q-065). There is nothing to
install from a store; it can be added to the home screen.

## Opening it

| Where | How |
|---|---|
| On a phone | Open the ERP address (e.g. `https://wewin.vercel.app`). Phones get the phone layout automatically. Browser menu › **Add to Home screen** installs it like an app. |
| Preview on a computer | Open **`/m`** (e.g. `http://localhost:5190/m`). The phone app runs in a device frame at phone size, with a QR code to open it on a phone. The account menu also has **Mobile app**. |
| Back to the full screen | Phone: Menu › **Desktop site** (remembered on that phone). Preview: Menu › **Exit the mobile preview**. |

## What is on it

| Tab | What it does |
|---|---|
| **Home** | Greeting, "waiting for your approval" banner, KPI tiles, quick actions (final / inline / fabric QC, cutting lay, sewing output, carton, yarn receipt, outward D.C., scan invoice, reports — only those the user may use), production progress, the five stages with their status, heads-up. |
| **Approvals** | Everything waiting for this user, grouped: cutting lays, quality checks, outward D.C.s, vendor bills; plus other tasks (scans to review, alerts). Cutting lays and quality checks open phone screens with the details and an **Approve** button (note required); an approved lay can be posted from the phone. |
| **Locate** | The item locator: scan a roll, bundle or carton label with the camera (Chrome on Android) or search a lot, item, order or style; shows where it is now and a unit's movement history. |
| **Inbox** | Notifications with filters: accounts feed, approvals, alerts. Shows whether the email copy was sent. |
| **Menu** | Every module the user may open (the full screens, in the phone layout), change password, log out. |

The microphone (voice commands, VOICE.md) is in the top bar on every screen. Scan fields everywhere
in the app get a camera button on phones that support it.

## Notes

- Phone screens need the same permissions as the desktop: approving a lay needs `cutting.approve`,
  a quality check `qc.approve` (Owner only by default; Masters › Roles).
- The app needs a connection; nothing is stored for offline use.
- Locally, a phone on the same Wi-Fi can open the preview only if the dev server listens on the
  network (`vite --host`); the deployed site works anywhere.
