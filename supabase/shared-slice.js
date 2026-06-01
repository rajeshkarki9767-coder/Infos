// ============================================================================
//  Infos — shared business slice helpers
// ----------------------------------------------------------------------------
//  Pure functions (no DOM, no globals) that convert between the app's local
//  `state` and the per-business SHARED snapshot stored in the `shared_state`
//  cloud row. Kept dependency-free so they can be unit-tested in Node and
//  reused by app.js (loaded as a normal <script>, attaches to window).
//
//  THE SHARED SNAPSHOT SHAPE  (one per business, the live shared row's `data`)
//    {
//      schema: 1,
//      business: { id, name, color, logo? },     // the business record (sans secrets)
//      items:    { tabKey: [ item, ... ] },       // ONLY items assigned to this biz
//      itemOrder:    { tabKey: [itemId,...] },     // this biz's per-tab ordering
//      allowedTabs:  [ ... ] | null,               // optional UI scoping (not security)
//      tabOrder:     [ ... ] | null,               // this biz's tab ordering
//      customTabs:   [ ... ],                       // custom tab defs used by this biz
//      activity:     [ ... ]                        // activity entries touching this biz
//    }
//
//  WHY a per-business slice (not the owner's whole state): the owner may own
//  many businesses in one personal app_state; only ONE business's data is
//  shared with a given team. The slice is the unit both owner and members edit.
// ============================================================================

(function (root) {
  'use strict';

  var SCHEMA = 1;

  function itemBizIds(it) {
    if (!it) return [];
    if (Array.isArray(it.bizIds)) return it.bizIds;
    if (it.bizId) return [it.bizId];
    return [];
  }
  function itemHasBiz(it, bizId) { return itemBizIds(it).indexOf(bizId) !== -1; }

  // ID & Pass items are SHARED CONTENT: the whole point is for the business team
  // to see the username/password so they can log in to those systems. So we keep
  // `password` in the slice. We only drop the legacy encrypted field (dead since
  // encryption was removed) — the plaintext password is the data the team needs.
  function sanitizeItem(it) {
    var copy = Object.assign({}, it);
    delete copy.passwordEnc;
    return copy;
  }
  // A BUSINESS's OWN sign-in password (b.password) is different: that's the owner's
  // credential for distributing login access, not data the member needs in their
  // copy. Keep stripping it from the shared business record.
  function sanitizeBusiness(b) {
    var copy = Object.assign({}, b);
    delete copy.password; delete copy.passwordEnc;
    // devices/heartbeat are owner-side bookkeeping; not needed in the shared slice.
    delete copy.devices;
    return copy;
  }

  // Build the shared snapshot for ONE business out of the full local `state`.
  // `bizId` is the LOCAL business id. `cloudId` (optional) is the business's
  // cloud uuid; when given, item assignments and the business id are normalized
  // to the cloud id so the slice is portable across devices (the owner's local
  // id and the member's view of the same business must agree). Defaults to the
  // local id when no cloudId is provided (e.g. member-side rebuilds).
  function buildSharedSlice(state, bizId, cloudId) {
    state = state || {};
    var canonical = cloudId || bizId;
    var items = state.items || {};
    var sliceItems = {};
    var TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000; // keep deletions visible 30 days
    var now = Date.now();
    Object.keys(items).forEach(function (tab) {
      var live = (items[tab] || []).filter(function (it) {
        return itemHasBiz(it, bizId) && !it.deleted;
      }).map(function (it) {
        var clean = sanitizeItem(it);
        // Normalize this business's assignment to the canonical (cloud) id while
        // preserving any OTHER business assignments the item may carry.
        var others = itemBizIds(it).filter(function (id) { return id !== bizId && id !== canonical; });
        clean.bizIds = others.concat([canonical]);
        delete clean.bizId;
        return clean;
      });
      // Include lightweight TOMBSTONES for recently-deleted items belonging to this
      // business, so the non-destructive merge on the other side can honor the
      // deletion (otherwise a deleted item would silently come back). Old
      // tombstones expire so the slice doesn't grow forever.
      var tombs = (items[tab] || []).filter(function (it) {
        return itemHasBiz(it, bizId) && it.deleted && (now - (it.deletedAt || 0) < TOMBSTONE_MS);
      }).map(function (it) {
        return { id: it.id, deleted: true, deletedAt: it.deletedAt || now, bizIds: [canonical] };
      });
      var list = live.concat(tombs);
      if (list.length) sliceItems[tab] = list;
    });

    var bizSrc = (state.businesses || []).filter(function (b) { return b.id === bizId; })[0] || { id: bizId };
    var biz = sanitizeBusiness(bizSrc);
    biz.id = canonical;            // the slice always identifies the business by its cloud id
    biz.localId = bizId;           // hint for the owner's apply (ignored by members)

    var activity = (state.globalActivity || []).filter(function (ev) {
      if (!ev) return false;
      var bids = ev.bizIds || (ev.bizId ? [ev.bizId] : []);
      return bids.indexOf(bizId) !== -1;
    }).map(function (ev) {
      var copy = Object.assign({}, ev);
      copy.bizIds = (ev.bizIds || (ev.bizId ? [ev.bizId] : [])).map(function (id) { return id === bizId ? canonical : id; });
      return copy;
    });

    return {
      schema: SCHEMA,
      business: biz,
      items: sliceItems,
      itemOrder: remapOrder((state.itemOrder && state.itemOrder[bizId]) || {}, bizId, canonical),
      allowedTabs: (state.bizAllowedTabs && state.bizAllowedTabs[bizId]) || null,
      tabOrder: (state.bizTabOrder && state.bizTabOrder[bizId]) || null,
      customTabs: (state.customTabs || []).slice(),
      activity: activity,
      // Clear-floor for this business so the member side drops cleared activity too.
      activityClearedAt: Math.max(
        state.activityClearedAt || 0,
        (state.activityClearedByBiz && state.activityClearedByBiz[bizId]) || 0
      )
    };
  }

  // itemOrder is keyed by tab -> [itemId,...]; ids are unaffected by biz id, so
  // this is a pass-through today, kept as a hook if ordering ever embeds biz ids.
  function remapOrder(order /*, fromId, toId */) { return order || {}; }

  // Turn a shared snapshot into a FULL local `state` for a business-login user.
  // The member runs the normal app against this state: one business, its items,
  // its ordering. `email`/`name` describe the signed-in member for display.
  function sliceToMemberState(slice, opts) {
    slice = slice || {};
    opts = opts || {};
    var biz = slice.business || { id: slice.businessId || 'shared', name: 'Shared business', color: '#378ADD' };
    // Merge with the current local items (if a previous state exists) so a
    // just-made local edit isn't clobbered by a stale realtime payload that
    // arrived between the local save and the cloud catching up. Compare
    // updatedAt — keep whichever is newer.
    var prev = (opts.prevItems && typeof opts.prevItems === 'object') ? opts.prevItems : null;
    var items = {
      notices: [], system: [], games: [], schedule: [], balance: [],
      'idpass-system': [], 'idpass-accounts': []
    };
    Object.keys(slice.items || {}).forEach(function (tab) {
      var incoming = (slice.items[tab] || []).filter(function (it) { return !it || !it.deleted; });
      if (!prev || !prev[tab] || !prev[tab].length) { items[tab] = incoming; return; }
      // Build incoming-by-id map.
      var incById = {};
      incoming.forEach(function (it) { if (it && it.id != null) incById[String(it.id)] = it; });
      // Walk previous items; if local copy is newer than incoming, keep local.
      var seen = {};
      var merged = [];
      prev[tab].forEach(function (lit) {
        if (!lit || lit.id == null) return;
        var k = String(lit.id);
        var inc = incById[k];
        if (!inc) return; // not in incoming (and not a tombstone since we filtered) — drop
        var lu = (typeof lit.updatedAt === 'number') ? lit.updatedAt : 0;
        var iu = (typeof inc.updatedAt === 'number') ? inc.updatedAt : 0;
        merged.push(iu >= lu ? inc : lit);
        seen[k] = true;
      });
      // Add new incoming items not in prev.
      incoming.forEach(function (it) {
        if (it && it.id != null && !seen[String(it.id)]) merged.push(it);
      });
      items[tab] = merged;
    });

    // A shared (business) login is a FULL editor of this one business — they get
    // every tab, editable. The owner's optional allowed-tabs UI-scoping must NOT
    // hide a member's own data, so we deliberately do NOT populate bizAllowedTabs
    // here (leaving it empty = all tabs allowed in isTabAllowedForBiz / nav).
    var bizAllowedTabs = {};
    var bizTabOrder = {};    if (slice.tabOrder)    bizTabOrder[biz.id]    = slice.tabOrder;
    var itemOrder = {};      itemOrder[biz.id] = slice.itemOrder || {};

    // Highest item id present, so new local entries don't collide.
    var maxId = 0;
    Object.keys(items).forEach(function (tab) {
      items[tab].forEach(function (it) {
        var n = parseInt(String(it.id).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      });
    });

    return {
      businesses: [biz],
      items: items,
      itemOrder: itemOrder,
      bizAllowedTabs: bizAllowedTabs,
      bizTabOrder: bizTabOrder,
      customTabs: (slice.customTabs || []).slice(),
      globalActivity: (slice.activity || []).slice(),
      activityClearedAt: slice.activityClearedAt || 0,
      nextItemId: maxId + 1,
      // The member is "signed into" this one business — full edit, scoped to it.
      activeBizId: biz.id,
      __sharedBusinessId: biz.id
    };
  }

  // Merge a member's full edited state BACK into a shared slice for upload.
  // The member state holds exactly one business keyed by the CLOUD id, so we
  // re-extract with that id as both the local and canonical id.
  function memberStateToSlice(state) {
    var bizId = state && (state.__sharedBusinessId ||
      (state.businesses && state.businesses[0] && state.businesses[0].id));
    if (!bizId) return null;
    return buildSharedSlice(state, bizId, bizId);
  }

  // Merge a freshly-pulled shared slice into an OWNER's full state in place:
  // replace that business's items across tabs with the shared copy, update the
  // business record, ordering, and merge activity. Returns the mutated state.
  // This is how the owner sees members' live edits to a shared business.
  //
  // The slice identifies the business by its CLOUD id. `localBizId` is the
  // owner's local id for the same business; incoming items/business are remapped
  // from the cloud id back to the local id. If omitted, falls back to
  // slice.business.localId, then to the cloud id itself.
  function applySliceToOwnerState(state, slice, localBizId) {
    if (!state || !slice) return state;
    var biz = slice.business || {};
    var cloudId = biz.id;
    if (!cloudId) return state;
    var localId = localBizId || biz.localId || cloudId;

    function remapItem(it) {
      var copy = Object.assign({}, it);
      var ids = itemBizIds(it).map(function (id) { return id === cloudId ? localId : id; });
      // de-dupe in case both ids were present
      copy.bizIds = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
      delete copy.bizId;
      return copy;
    }

    state.items = state.items || {};
    var tabs = {};
    Object.keys(state.items).forEach(function (t) { tabs[t] = true; });
    Object.keys(slice.items || {}).forEach(function (t) { tabs[t] = true; });
    Object.keys(tabs).forEach(function (tab) {
      var incoming = (slice.items[tab] || []).map(remapItem);
      var incomingById = {};
      var tombstoned = {};
      incoming.forEach(function (it) {
        if (it && it.id != null) {
          incomingById[String(it.id)] = it;
          if (it.deleted) tombstoned[String(it.id)] = true;
        }
      });

      // NON-DESTRUCTIVE merge by id. An existing owner item is removed ONLY if the
      // incoming slice explicitly tombstones it (it.deleted). We never silently
      // drop an owner item just because a partial slice omits it — that omission
      // was the cause of entries "disappearing after some time".
      var result = [];
      var seen = {};
      (state.items[tab] || []).forEach(function (it) {
        if (!it || it.id == null) { result.push(it); return; }
        var key = String(it.id);
        if (tombstoned[key]) { seen[key] = true; return; } // explicitly deleted remotely
        var inc = incomingById[key];
        if (inc && !inc.deleted) {
          // Only replace with incoming if it's strictly NEWER than the local copy.
          // Otherwise keep the local copy: it may be a just-made edit that hasn't
          // been pushed yet, and a stale realtime payload would clobber it. The
          // updatedAt fields are millisecond timestamps set on every edit.
          var localUpd = (typeof it.updatedAt === 'number') ? it.updatedAt : 0;
          var incUpd = (typeof inc.updatedAt === 'number') ? inc.updatedAt : 0;
          if (incUpd >= localUpd) { result.push(inc); seen[key] = true; }
          else { result.push(it); seen[key] = true; }
        }
        else { result.push(it); } // keep — not in incoming slice, don't lose it
      });
      // Add brand-new incoming items (skip pure tombstones).
      incoming.forEach(function (it) {
        if (it && it.id != null && !it.deleted && !seen[String(it.id)]) {
          var existsAlready = (state.items[tab] || []).some(function (e) { return e && String(e.id) === String(it.id); });
          if (!existsAlready) result.push(it);
        }
      });
      state.items[tab] = result;
    });

    // Update the business record (name/color/logo) from the shared copy, keyed
    // by the owner's LOCAL id, preserving owner-only secrets.
    state.businesses = state.businesses || [];
    var idx = -1;
    for (var i = 0; i < state.businesses.length; i++) { if (state.businesses[i].id === localId) { idx = i; break; } }
    if (idx >= 0) {
      var keep = {
        id: localId,
        password: state.businesses[idx].password,
        passwordEnc: state.businesses[idx].passwordEnc,
        email: state.businesses[idx].email,
        devices: state.businesses[idx].devices
      };
      var incomingBiz = Object.assign({}, biz); delete incomingBiz.localId;
      state.businesses[idx] = Object.assign({}, state.businesses[idx], incomingBiz, keep);
    }

    // Ordering + activity (activity bizIds remapped to local id).
    if (slice.itemOrder) { state.itemOrder = state.itemOrder || {}; state.itemOrder[localId] = slice.itemOrder; }
    if (Array.isArray(slice.activity)) {
      var remappedActivity = slice.activity.map(function (ev) {
        var c = Object.assign({}, ev);
        if (Array.isArray(ev.bizIds)) c.bizIds = ev.bizIds.map(function (id) { return id === cloudId ? localId : id; });
        return c;
      });
      // Respect clear tombstones: drop any incoming entry older than a global clear,
      // or older than a per-business clear for the business it belongs to. Without
      // this, clearing the activity log would "undo" itself on the next sync as the
      // cloud slice merged the old entries back.
      var gFloor = state.activityClearedAt || 0;
      var byBiz = state.activityClearedByBiz || {};
      remappedActivity = remappedActivity.filter(function (ev) {
        if (!ev) return false;
        if ((ev.ts || 0) <= gFloor) return false;
        var bids = ev.bizIds || [];
        for (var i = 0; i < bids.length; i++) {
          if (byBiz[bids[i]] && (ev.ts || 0) <= byBiz[bids[i]]) return false;
        }
        return true;
      });
      state.globalActivity = mergeActivity(state.globalActivity || [], remappedActivity);
    }
    return state;
  }

  // Merge two activity arrays, de-duped by id, newest first (by ts).
  function mergeActivity(a, b) {
    var byId = {};
    (a || []).concat(b || []).forEach(function (ev) {
      if (!ev) return;
      var key = ev.id != null ? ('id:' + ev.id) : ('ts:' + ev.ts + ':' + (ev.verb || '') + ':' + (ev.itemId || ''));
      if (!byId[key] || (ev.ts || 0) > (byId[key].ts || 0)) byId[key] = ev;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; })
      .sort(function (x, y) { return (y.ts || 0) - (x.ts || 0); });
  }

  var api = {
    SCHEMA: SCHEMA,
    buildSharedSlice: buildSharedSlice,
    sliceToMemberState: sliceToMemberState,
    memberStateToSlice: memberStateToSlice,
    applySliceToOwnerState: applySliceToOwnerState,
    mergeActivity: mergeActivity,
    _itemHasBiz: itemHasBiz
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.InfosSharedSlice = api;
})(typeof window !== 'undefined' ? window : null);
