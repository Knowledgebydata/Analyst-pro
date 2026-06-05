// BIBOB Interview Pro v2.0 — Storage (interviews-metadata + transcripts)
//
// MVP: localStorage voor interview-metadata + transcripts (zonder audio).
// Productie-versie zal IndexedDB gebruiken voor audio-archief (AES-256 encrypted).
//
// localStorage-limiet ~5-10 MB per origin. Voor transcripts (gemiddeld <100KB
// per interview) is dat ruim genoeg voor honderden interviews.

const KEY = 'bibob_v2_interviews';

export const Storage = {
    loadAll() {
        try {
            const raw = localStorage.getItem(KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    },

    saveAll(arr) {
        try {
            localStorage.setItem(KEY, JSON.stringify(arr));
            return true;
        } catch (err) {
            console.error('[Storage] save fail:', err);
            return false;
        }
    },

    add(interview) {
        const all = this.loadAll();
        all.unshift(interview);  // nieuwste eerst
        this.saveAll(all);
        return all;
    },

    update(id, patch) {
        const all = this.loadAll();
        const idx = all.findIndex(i => i.id === id);
        if (idx === -1) return null;
        all[idx] = { ...all[idx], ...patch };
        this.saveAll(all);
        return all[idx];
    },

    delete(id) {
        const all = this.loadAll().filter(i => i.id !== id);
        this.saveAll(all);
        return all;
    },

    get(id) {
        return this.loadAll().find(i => i.id === id) || null;
    },

    clear() {
        localStorage.removeItem(KEY);
    },

    // Diagnostic: total bytes in storage voor interviews
    bytesUsed() {
        const raw = localStorage.getItem(KEY) || '';
        return new Blob([raw]).size;
    },
};
