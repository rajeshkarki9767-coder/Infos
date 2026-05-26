# Infos v16

A Progressive Web App for managing multiple businesses, with **shared business access** for teammates. Local-first, installable, optional end-to-end encryption.

## What's new in v16

### Shared business access (replaces view-only sharing)
- A **business login** (email + password the owner sets) now gives the **full editable app** — not a read-only screen. Anyone with the login can sign in on any device and add/edit entries (balance, items, everything), just like the owner.
- **Shared, live-synced data.** The owner and all business-login users edit the **same** data for that business. Changes sync live across every device via Supabase realtime.
- **Per-business shared row.** Each shared business's data lives in one cloud row (`shared_state`), keyed by the business, that the owner and its team members all read and write. Row-Level Security guarantees a member can only touch their own business's data (cross-business access is blocked; delete is owner-only).
- A business login gets every data tab fully editable, but not owner-account administration (managing other businesses, account delete/email/password, encryption/backup) — that stays with the owner.
- The old published-copy / view-only member screen has been removed. See `docs/SHARED_BUSINESS_REWORK.md` and run `npm test` for the proof suite.

## What's new in v15

### Numbered entries on all non-notice tabs
- System, Games, ID & Pass System, ID & Pass Accounts, Attachments, and **all custom tabs** now show an ascending number badge (#1, #2, #3 …) before each card from top to bottom.
- Notices stays unnumbered (it's a reminder feed, not a list).
- Numbering reflects the current view (filter + search + sort), so #1 always means "first row you see right now".

### Reorder entries per business
- When the owner filters to a specific business (or signs in as a business team), each card on a numbered tab gets **up/down arrows** on the right side.
- Click the arrows to move items up or down. The first card's "up" and the last card's "down" are disabled.
- The order saves per-business per-tab in `state.itemOrder[bizId][tabKey]`, so each business can have its own ordering for the same items.
- A blue banner at the top of the list confirms which business you're reordering for.

### Notices → Reminder / Activity Log
- Notices now has a horizontal segmented sub-tab control:
  - **Reminder** = the original notices behavior (create/edit/delete entries)
  - **Activity Log** = a global feed of edits across System, Games, ID & Pass System/Accounts, and all custom tabs
- The activity log shows each event as a row with a verb icon (Created / Edited / Trashed / Restored), the tab and item name, the businesses involved, and a relative timestamp.
- Events are grouped by Today / Yesterday / earlier date.
- Click any activity row to jump straight to the item.
- Notice creation itself is **not** logged here (it has its own representation — the reminder card).
- The log honors the active business filter — pick a biz from the dropdown and the log shows only events touching that biz.

### Refined custom color picker
- Bigger live-preview swatch (56×56) with gradient + brand shadow next to the picker.
- Preview updates live as you type a hex code (no need to click Apply first).
- Whole section sits on a tinted gradient background.
- Preset accent swatches now have a satisfying spring scale animation and double-ring effect when selected.

### Interactive polish across devices
- Touch devices: larger tap targets on cards, reorder buttons, accent swatches.
- Ultra-wide screens (>1400px / >1920px): content max-width keeps the layout balanced.
- Focus-visible outlines on every interactive element for keyboard users.
- `prefers-reduced-motion` respected throughout.

## What's new in v4–v14 (preserved)

### ID & Pass is now a single flat sidebar item with horizontal sub-tabs
- The expandable parent + two child nav-items in the sidebar are gone.
- Clicking **ID & Pass** opens a single page with horizontal segmented tabs at the top — **System** and **Accounts** — exactly like a modern tab pattern.
- Routes to `idpass-system` or `idpass-accounts` (e.g. from search) auto-redirect to the parent and pre-select the right segment.
- Saving an item from within a seg-tab refreshes the list correctly (no need to re-click).

### Business settings: only the Items list
- The Assigned/Unassigned segmented control inside business detail was removed.
- The **Items** section now simply lists every tab that's currently turned ON in "Show items on tabs" below — with each row showing the item count for that business.
- When you toggle a tab off in the switches below, that row disappears from the Items list above. Toggle it back on and it reappears.
- One source of truth, no redundant view.

### Bottom-tab layouts (already in place, now verified)
- **Owner**: Notices · ID & Pass · Business · Profile
- **Business**: Notices · System · Games · ID & Pass

## What's new in v4–v13 (preserved)

### Cleaner sidebar header
- Removed the sidebar collapse/expand toggle button (the icon between the logo and the X). Desktop has plenty of room for a full sidebar; mobile shows the drawer when needed.
- The X (close-drawer) button is now correctly hidden on desktop and only appears on mobile, where it actually closes the drawer.
- Old users who had the collapsed-sidebar state turned on previously are auto-recovered — the boot path force-clears that setting so nobody stays stuck in the icon-only mini-rail.

### Assigned / Unassigned tabs reflect "Show items on tabs"
- The Assigned/Unassigned segmented control inside each business detail page now matches what the toggle switches in "Show items on tabs" actually do.
- **Assigned** = tabs currently turned ON for this business (with their item counts shown)
- **Unassigned** = tabs currently turned OFF for this business
- Toggle a tab off → it moves to the Unassigned side. Toggle it back on → it's in Assigned again.
- Empty state messages explain which tabs would appear in each section.

## What's new in v4–v12 (preserved)

### Custom accent color in Appearance settings
- Native HTML5 color picker + free hex input + Apply button right below the preset swatches
- Choose any color you want — green, hot pink, navy, anything
- Stored per device; persists across reloads and across business switches (when no business is filtering)
- Preset swatch click clears the custom override

### Change password is now a button → dedicated page
- The Profile page no longer auto-shows the password form
- Instead: a clean "Change password" button row with an icon and chevron
- Tap it → a dedicated `change-password` page slides in
- Full form with current/new/confirm + strength bar + "Forgot current password?" link
- Saves and slides back to Profile

### Real toggle switches in business settings
- The per-business tab list is now controlled with actual sliding toggle switches (not click-pills)
- Section title: **"Show items on tabs"** (clearer intent)
- **When you toggle a tab off**, items assigned to that business stop appearing on that tab — for both the business team AND for you, the owner
- Assigned/Unassigned grouping continues to work exactly as before, but now respects this toggle
- Up/down arrows still set the per-business tab order

### Refresh preserves your tab
- The app now remembers which tab you were on across page reloads
- No more bouncing back to Notices when you hit refresh on Settings, ID & Pass, or any other tab
- Item-detail and biz-detail pages, which need URL context, still fall back to Notices on refresh (intentional — those pages can't restore without their parent context)

## What's new in v4–v11 (preserved)

### Visual design refresh
- **Layered depth.** A shared shadow scale (sm/md/lg/xl) lifts cards, modals, buttons, and the FAB consistently, with dark-mode shadow tunings so the same hierarchy reads in both themes.
- **Springier motion.** Cards, buttons, the FAB, and bottom tabs all use a spring-easing curve on tap so the app feels alive instead of static.
- **Refined header.** Taller, more breathing room, with a saturated blur backdrop and a hairline border so it floats over content.
- **Active-nav indicator.** A 3px accent bar slides in next to the active sidebar item.
- **Polished modals.** Bigger radius, scale-bounce entrance, blurred backdrop.
- **Cleaner empty states.** Rounded icon tile, tighter typography, more inviting.
- **FAB upgrade.** Chunkier 56px shape with rounded 18px corners, brand-color shadow, and an inner highlight that makes it look pressed in 3D.
- **Subtle gradients** on owner avatar + switch-splash avatar (linear gradient from accent to a softer accent).
- **Sign-in form is now an elevated card** for better focus on the action.

### Wider slide-to-open gesture
- The swipe-to-open-drawer now works from **anywhere in the left half of the screen**, not just the very edge.
- Smart detection: it ignores swipes that start inside scrollable containers, form inputs, cards (so long-press still works), bottom tabs, or modals.
- **Swipe left to close** the drawer when it's open (natural counterpart).
- Direction lock-in prevents accidental triggers during vertical scrolling.

### Existing v10 features preserved
All 27 v10 items still work: Attachments (renamed from Schedule), switch-account, long-press detail, color picker, device registry, etc.

## What's new in v4–v10 (preserved)

### New tab
- **Attachments.** Upload an image attachment (a roster, a document scan, signage, anything), assign to one or more businesses. Tap a thumbnail to open a full-screen photo viewer. (Internal data key still `schedule` for compatibility with earlier versions.)

### Major UX improvements
- **Switch-account button in the header** (top-right). One-tap access to swap between any account on this device.
- **Splash screen after sign-in.** 3-second branded loading screen with pulsing logo, name, and progress bar while data loads.
- **Long-press → quick-view modal.** Long-press (touch) or right-click (desktop) any list item to see all its fields with per-field copy buttons. No need to open the full detail page just to grab a value.
- **Slide-from-left gesture.** On phones, swipe right from the screen edge to open the sidebar drawer.
- **Universal search reworked.** Now positioned above the business filter, full-width across the sidebar, no ⌘K hint inside the box. Search results are data-only — no more clutter from "Actions", "Navigation", or "Filters" categories.
- **Notice chime.** A soft two-note bell sound plays when a new notice is created (Web Audio API — no audio file shipped).

### Per-business controls
- **Reorder tabs per business.** Inside any business's detail page, set the exact order the team will see their tabs in. Each business can have its own ordering.
- **Edit custom tabs from biz detail.** Custom tabs now have an edit button right in the biz tab manager — no need to bounce out to Settings.
- **Devices signed in.** Every device that has ever signed in to a business is now listed in the biz detail page, with browser, OS, first-seen, and last-seen timestamps.
- **Custom brand color picker.** Native HTML5 color picker + free hex input + preset swatches, all kept in sync.

### Profile & account
- **"Forgot current password?" link.** When changing password, if you don't know the current one, this link takes you to the full reset flow.
- **Delete account from Profile.** New "Danger zone" section with a double-confirmation flow that wipes everything for the current owner account.

### Polish
- **Bug fix: System tab now visible for businesses.** Previously, the allowed-tabs picker hardcoded `['notices','games','idpass-system','idpass-accounts']` and silently dropped System. Now derives from the actual tab order.
- **Bug fix: Card click works in view-only mode.** Business users can now open item-detail (they still can't edit).
- **No more "How it works" hint** on the sign-in screen.
- **ID & Pass horizontal sub-tabs.** System/Accounts is now a segmented control inline, not a sidebar expansion.
- **No italic fonts anywhere.** Better font stack (Inter + system), kerning, ligatures, tuned letter-spacing.
- **Hide "Custom" sidebar header** when no custom tabs exist (or none are visible to the current account).
- **Hide back-arrow on phone** — bottom tabs handle navigation.

## What's new in v4-v9 (preserved)

- **Cleaner sign-in screen.** The "Sign in / Create account" tab segment is gone. The screen now leads with sign-in and shows a small "Don't have an account? Create new account" line below the button. Tap it to flip the form into signup mode (and back).
- **In-app account switcher.** "Switch account" no longer signs you out and dumps you on the sign-in screen. Instead, it opens an in-app picker showing every account this device knows about (your owner accounts + all businesses you've created). Tap one → a 2-second splash with the account avatar and name → you're signed into that account.
- **No password re-prompt when switching.** Switching is instant because credentials are already stored locally. (To switch into an account this device has never seen, use Sign out → Sign in normally.)
- **Picker hides the current account.** No "switch to yourself" no-op rows.
- **Polite no-op when no other accounts.** If there's nothing to switch to, tapping Switch account shows a toast instead of an empty modal.

## How the new auth screen flows

**To create your first account:**
1. Open the app → sign-in screen
2. Click "Create new account" below the Sign in button → form flips to signup mode
3. Enter name + email + password, tick the T&Cs, submit

**To sign in:**
1. Email + password → Sign in

**To switch from owner to a business view (or between businesses):**
1. Click "Switch account" in the sidebar
2. Pick a target account from the in-app list
3. 2-second splash → you're now signed in as that account

## What's new in v4-v8 (preserved)

- **Multi-account quick-switch.** The sign-in screen now shows recent sign-ins as tappable chips. Tap one to pre-fill the email and jump straight to password entry. Each chip is labeled "Owner" or "Business" so you can tell them apart. Up to 6 recent accounts. Tap the small × on any chip to forget it.
- **Switch account shortcut.** A new "Switch account" item in the sidebar takes you straight to the sign-in screen — no confirmation modal — with the quick-switch chips ready.
- **Sidebar opens by default on desktop.** Fixed a bug where the "collapsed" state was persisting across mobile/desktop, hiding labels even in the mobile drawer. Now `collapsed` only applies on viewports wider than 768px.
- **`file://` heads-up banner.** If you open `index.html` by double-clicking from File Explorer, the browser blocks the manifest, service worker, and IndexedDB. v8 now shows a friendly amber banner explaining this and pointing you at `python -m http.server 8080`. Dismissible if you'd rather work around it.
- **Quieter service-worker registration.** No more noisy console errors when running from `file://` — the registration is skipped silently.

## How to run (important)

**Don't double-click `index.html` from File Explorer.** Browsers treat `file://` URLs as untrusted origins and block:
- The manifest (so PWA install won't work)
- The service worker (so offline mode won't work)
- IndexedDB writes (so larger data won't persist)
- Most fetch operations

**Do this instead:**

```
cd Infos
python -m http.server 8080
```

Then open `http://localhost:8080` in your browser. The amber banner reminds you of this if you forget.

## What's new in v4-v7 (preserved)

- **One item, many businesses.** Assigning a notice or entry to multiple businesses now creates ONE shared item with chips listing each assigned business — no more cloning.
- **Quieter business view.** Business users see no "View only" badges, banners, or pills anywhere. They just see their assigned items quietly, with their profile showing as "{Business} team".
- **Polished search bar.** The list search at the top of every tab now has a proper icon, focus ring with the accent color, and clear button. The header "Search everything" trigger also got a face-lift.
- **Polished entry boxes.** Every input, textarea, and select gets a consistent hover and focus state, larger touch targets on mobile, and a clearer placeholder treatment.
- **Owner Profile rebuilt.** Full name is now editable. Password change section is always visible by default (was below the fold). Two clean cards with save buttons.
- **No more "Create your first business" big CTA.** The Businesses tab always shows a clean "New business" button at the top, and a small inline hint when empty.
- **No "Add tag" anywhere.** Tags were unused friction — gone from business detail.
- **User Guide / About / Privacy moved to Settings → About.** No more duplicate sidebar entries; everything lives in one place.
- **Tab reordering moved to Settings → Management.** A proper UI with up/down arrows replaces the drag handles on the sidebar.
- **Business Detail: Assigned/Unassigned toggle.** Inside a business's detail page, segment toggle between "Assigned" (items assigned to this business) and "Unassigned" (items not assigned to anyone yet) — tap a row to jump to that tab filtered accordingly.

## What's new in v4-v6 (preserved)

- **Account registration required.** Sign-in only works for emails that have been registered. There is no longer "any email + password works" or guest mode.
- **Terms & Conditions acceptance** on signup. The signup form has a Terms & Conditions checkbox that must be checked before "Create account" works. Tap the links to read them in full.
- **No more guest sign-in.** The "Continue as guest" button is gone — you must register an account.
- **Business sign-in flow confirmed.** Businesses you create can sign in with their email and password to view items you've assigned. The biz user's password is stored alongside the business. Email collisions between owner accounts and businesses are blocked at create time on both sides.
- **Better error messages** on sign-in failure.

## What's new in v4-v5 (preserved)

A comprehensive rework based on user feedback. Major changes:

### Onboarding & data
- **No demo businesses.** You start empty. Create your own before view-only sign-in works.

### Settings — horizontal tabs
- **Appearance** — theme, accent, notifications
- **Management** — custom tabs, renames, encryption
- **Backup** — owner-level export/import/clear, sync
- **About** — user guide + privacy policy (context-aware: owner version vs business version)

### Item shapes reworked
- **Notices**: Title, Message, Link (copyable), Assign to (multi-business + "Assign to all" button)
- **System / Games / Accounts**: Name, Short name (optional), Link (copyable), Description (optional), Assign to
- The old System CPU/memory dashboard is gone — System is now a regular list.
- Tag selector hidden when there are no tags, or when assigning to multiple businesses.
- Items with links get a one-tap copy icon on the card.

### Stricter view-only mode
- A business user sees **only items assigned to that business**. Unassigned and other-business items are hidden.
- Owner controls **per-business** which tabs each business sees, set inside the business detail page.

### Confirmation modals
- Every destructive action shows a custom in-app modal (no native browser dialogs).
- Business and account deletion + clear-data require **double confirmation**.
- All sign-outs confirm first.

### Per-business data tools
- Inside a business detail: Export, Import, Clear data (double-confirmed).

### Profile change-password
- Change owner password from Profile — old / new / confirm + forgot-password link.

### Removed
- Recurring items feature
- Per-business theme toggle (now always-on)
- Cover photo on business pages
- "Hide tabs" in settings (replaced by per-business allowed-tabs)
- Floating FAB (replaced by fixed top entry button on each list tab)

### Visual polish
- Bold typography on names, values, section labels
- Larger, cleaner cards
- Sticky top entry button on every list tab

## Files

```
Infos/
├── index.html        # Entry
├── styles.css        # All styles
├── app.js            # Application (2800+ lines)
├── icons.js          # Inline SVG icons
├── db.js             # IndexedDB storage
├── crypto.js         # Web Crypto E2E
├── sync.js           # Pluggable sync
├── manifest.json     # PWA manifest
├── sw.js             # Service worker
├── README.md         # This file
├── SYNC.md           # Real backend wiring
├── MAIL_BACKEND.md   # Real email wiring
├── SCREENSHOTS.md    # Store screenshot guide
└── icons/            # Icon assets
```

## Running locally

```
cd Infos
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Sign-in

- **Owner**: any email + 6+ character password (sign up — no demo)
- **Business (shared access)**: email + password the owner set for a business. Gives the full editable app on that business's shared, live-synced data.

## Allowed tabs

Inside a business detail page: scroll to "Allowed tabs for this business". Tap to toggle. Defaults to all tabs visible.

## Encryption

Settings → Management → Enable encryption. AES-GCM 256 via PBKDF2 250k iters. Master password never stored.

## Keyboard shortcuts

| Key | Action |
|---|---|
| ⌘K | Command palette |
| ⌘N | New item |
| ⌘B | Bulk select |
| ⌘D | Cycle theme |
| ? | Shortcuts overlay |
| Esc | Close modals |

## Notes

- Storage key bumped to `infos-state-v4` — v3 data does not auto-migrate; export from v3 first if you want to keep it.
- Sync demo uses local loopback adapter; see `SYNC.md` for real backends.
- Forgot-password uses code `123456` in demo; see `MAIL_BACKEND.md`.
