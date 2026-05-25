# ⚠️ This bundle ships **v89.31.5** — index.html md5 `65a7405259fb3ca58442655d2e04488d`
# (The historical notes below describe earlier v89.30.x work and are kept for reference.)

# Hisabs v89.30.4 — distribution placement (refined)

```
index.html:  65a7405259fb3ca58442655d2e04488d
vercel.json: 28c00b0c24a3a0f7c910e816d2493cf9 (unchanged — media-src for sounds)
```

## What's new in v89.30.4 (now with flaw-hunt refinements)

After applying initial v89.30.4 changes, I reviewed them critically and
found 2 flaws to fix:

### Flaw 1 (FIXED): Salary bottom + Add placement created weird reading flow

**Initial placement**: After the totals card, before the Remaining card.

**Problem**: Reading order became:
- Total final paid
- + Add another (?)
- Remaining for profit shares

The Add button visually interrupted the flow between salary totals and
the Remaining bridge to the next section.

**Fix**: Moved bottom + Add to BEFORE the totals card (directly after
the salary rows). New reading flow:
- Salary rows
- + Add another ← directly tied to "add another row"
- Total salary / adjustment / final paid (section summary)
- Remaining for profit shares (bridge to next section)

Same fix applied to Profit Shares section for consistency.

### Flaw 2 (FIXED): + Add buttons would appear in printed output

**Problem**: When user prints the Distribution page, the top and bottom
+ Add buttons would render in the printout. Action UI doesn't belong
in a financial document.

**Fix**: Added `@media print` rule:
```css
.dist-section-actions,
.dist-section-add-bottom { display: none !important; }
```

This also hides the top + Add button (pre-existing print issue).

## Summary of v89.30.4 changes (after refinements)

1. **Bottom "+ Add another" button** on Salaries and Profit Shares
   sections, placed BEFORE the totals card so it sits naturally with
   the rows it adds to. Only shows when rows exist.
2. **Section descriptions tightened** (~50% shorter, same meaning).
3. **Print rule** to hide both + Add buttons during print.

### What I left alone (and why)

- Net Profit card position — bottom-line first is correct
- Split & Convert ordering — bigger UX change, risks regressions
- Edit/Save button row — would change click-target positioning
- Section structure (Salaries before Shares) — correct logical chain
- Row card layouts — already redesigned in v89.30, don't fix what works

## Flaw hunt results (other findings)

Checked these potential issues — all CLEAN:

- **Permission gating**: The existing CSS selector
  `[onclick*="addDistSalaryRow"]` uses substring matching, so it
  covers BOTH the top + Add and my new bottom + Add buttons for
  non-owner viewers. ✓
- **Permission belt+suspenders**: `addDistSalaryRow()` and
  `addDistShareRow()` also have owner-check at function entry. ✓
- **Re-render**: Adding a row calls renderDistributionCard which
  rebuilds the section DOM. The new row appears immediately. ✓
- **Auto-focus**: Both add functions auto-focus the new row's first
  input (existing behavior, not changed). ✓
- **Theme**: `.btn-ghost` uses CSS variables, adapts to light/dark. ✓
- **Mobile**: `.dist-section-add-bottom` uses flex+center, responsive
  out of the box. ✓
- **Empty state**: Bottom button hidden when no rows (conditional
  template literal). Top button always present. ✓
- **No save throttle conflict**: Adding rows is idempotent
  (each click → new uid). ✓

## All previous fixes preserved (16/16)

| Version | What it fixed |
|---------|---------------|
| v89.30 #1 | Save Entry red on Cash Out |
| v89.30 #2 | Invoice # removed from PDF/CSV/print |
| v89.30 #3 | Clear activity log btn removed |
| v89.30 #4 | Mobile chart padding + min-height 180px |
| v89.30 #7 | Distribution row redesign (trash inside, color tints) |
| v89.30 #8 | Live calc on distribution rows |
| v89.30.1 | Removed broken 580px cap |
| v89.30.2 | CSP media-src for inline audio |
| v89.30.3 | Tiered chart sizing + hover shadow |
| v89.30.4 | Distribution placement + section desc + print fix |

## Verification

```
JS syntax:      OK
HTML comments:  51/51 balanced
CSS braces:     1984/1984 balanced
Backticks:      2096 (even)
```

## Setup tasks still required (unchanged)

See **V89_28_SETUP.md**:
- 3 Supabase email templates
- delete-self-account Edge Function deploy

## Deploy

```bash
cd ~/Documents/GitHub/hisabs
cp ~/Downloads/hisabs_v89_27_final/index.html ./index.html
md5sum index.html
# expected: 65a7405259fb3ca58442655d2e04488d
git add . && git commit -m "v89.30.4: distribution placement polish"
git push
```

After deploy, test in Distribution:
1. Add 3+ salary rows → "+ Add another" button appears AFTER the rows
   and BEFORE the totals card
2. Same for Profit Shares
3. Print → no + Add buttons appear in the output
4. Section description text reads more concisely

