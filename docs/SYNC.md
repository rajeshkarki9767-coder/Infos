# Backend sync

Infos ships with a pluggable sync layer. The built-in `loopback` adapter round-trips through a separate IndexedDB store and is purely for demoing the flow. To actually sync across devices, drop in a real adapter.

## Adapter shape

A sync adapter is an object with three methods:

```js
{
  async push(state) { /* upload */ },
  async pull() { /* return remote state or null */ },
  async status() { return { connected: true, message: '...' }; }
}
```

`push(state)` receives the entire prefs object. The simplest approach is to JSON-encode and upload it as a single blob keyed by user ID. `pull()` returns the same shape (or `null` if nothing remote yet). Conflict resolution lives in `sync.js`: `mergeStates(local, remote)` does a basic per-item newest-wins merge using each item's `history[0].ts` timestamp.

## Drop-in: Supabase

```html
<!-- Add to index.html before app.js -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const supa = supabase.createClient('YOUR_URL', 'YOUR_ANON_KEY');
  Sync.register('supabase', {
    async push(state) {
      const user = (await supa.auth.getUser()).data.user;
      if (!user) throw new Error('Not signed in');
      const { error } = await supa.from('infos_state').upsert({
        user_id: user.id,
        state,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
    },
    async pull() {
      const user = (await supa.auth.getUser()).data.user;
      if (!user) return null;
      const { data } = await supa.from('infos_state').select('state').eq('user_id', user.id).single();
      return data?.state || null;
    },
    async status() { return { connected: true, message: 'Supabase' }; }
  });
</script>
```

You'll need a table:

```sql
create table infos_state (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null,
  updated_at timestamptz default now()
);
alter table infos_state enable row level security;
create policy "own state" on infos_state for all using (auth.uid() = user_id);
```

Then in Settings → Backend sync, add an option to the `<select>` for `supabase` (edit `app.js` settings render or accept the registration and expose via a new UI section — the registry exposes adapters automatically; the settings dropdown is hardcoded for now, so add `<option value="supabase">Supabase</option>` next to loopback).

## Drop-in: Firebase

```html
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js"></script>
<script>
  firebase.initializeApp({ /* config */ });
  Sync.register('firebase', {
    async push(state) {
      const u = firebase.auth().currentUser;
      if (!u) throw new Error('Not signed in');
      await firebase.firestore().collection('infos').doc(u.uid).set({ state, updatedAt: new Date() });
    },
    async pull() {
      const u = firebase.auth().currentUser;
      if (!u) return null;
      const doc = await firebase.firestore().collection('infos').doc(u.uid).get();
      return doc.exists ? doc.data().state : null;
    },
    async status() { return { connected: true, message: 'Firebase' }; }
  });
</script>
```

## Drop-in: your own REST backend

```js
Sync.register('rest', {
  async push(state) {
    const r = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(state)
    });
    if (!r.ok) throw new Error('Upload failed');
  },
  async pull() {
    const r = await fetch('/api/state', { headers: { 'Authorization': 'Bearer ' + token } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Download failed');
    return r.json();
  },
  async status() { return { connected: navigator.onLine, message: 'REST' }; }
});
```

## How the merge works

When `Sync.syncNow(state)` runs, it pulls the remote state, merges with local, and pushes the merged result. The merge function is in `sync.js`. Items are deduplicated by ID, and the version with the most recent `history[0].ts` wins. Businesses are deduplicated by ID, with local winning for now (you can implement a per-business `updatedAt` for finer control). Top-level fields like `theme` and `accent` are taken from the local copy.

This is good enough for single-user multi-device. For multi-user collaboration, replace the merge with CRDT logic or last-writer-wins per field with vector clocks. Both are well-trodden paths but out of scope for this build.

## Trigger sync

Auto-sync is wired to fire after every `savePrefs` (debounced) when sync is enabled. Manual sync is the "Sync now" button in Settings — it pulls, merges, replaces local storage, and reloads.

## Encryption interaction

If end-to-end encryption is enabled, business passwords are stored as `passwordEnc` blobs (AES-GCM ciphertext + IV, base64). These are opaque to the backend — the server never sees plaintext. Pull a remote state into a fresh device, enter the same master password, and Infos decrypts locally. The master password verifier (`cryptoMeta`) syncs with the rest of the state, so the new device knows what to verify against.
