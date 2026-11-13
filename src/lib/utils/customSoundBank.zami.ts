/**
 * The user's own sound bank for MIDI attachments (Settings > Messages & media
 * > MIDI sound bank): validation plus device-local IndexedDB storage for the
 * single custom slot. Read by ./midiSoundBank.ts.
 *
 * `validateCustomSoundBankFile` is pure; `indexedDB` is referenced only inside
 * function bodies so the module import is safe in jsdom and SSR.
 */
import { t } from "$lib/i18n";

/** Same cap as the desktop app's system bank read (electron/main.cjs). */
export const CUSTOM_SOUND_BANK_MAX_BYTES = 256 * 1024 * 1024;
const ALLOWED_EXTS = ["sf2", "sf3", "dls"] as const;
export const CUSTOM_SOUND_BANK_ACCEPT = ALLOWED_EXTS.map((e) => `.${e}`).join(
    ",",
);

export type SoundBankValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

/** Pure: check an uploaded bank's name and size. */
export function validateCustomSoundBankFile(file: {
    name: string;
    size: number;
}): SoundBankValidationResult {
    const dot = file.name.lastIndexOf(".");
    const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
    if (!(ALLOWED_EXTS as readonly string[]).includes(ext)) {
        return { ok: false, reason: t("midiSoundBank.useAnSf2Sf3OrDls") };
    }
    if (file.size <= 0) {
        return { ok: false, reason: t("midiSoundBank.thatFileIsEmpty") };
    }
    if (file.size > CUSTOM_SOUND_BANK_MAX_BYTES) {
        return { ok: false, reason: t("midiSoundBank.fileIsTooLarge") };
    }
    return { ok: true };
}

/** RIFF container check (SF2, SF3 and DLS are all RIFF files). */
export function isRiff(data: ArrayBuffer): boolean {
    const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    return String.fromCharCode(...b) === "RIFF";
}

// ---- IndexedDB (single record, id "custom"). ----

export interface StoredSoundBank {
    id: "custom";
    name: string;
    size: number;
    data: ArrayBuffer;
    storedAt: number;
}

const DB_NAME = "zam-soundbanks";
const STORE = "banks";
const RECORD_ID = "custom";

// Zami: the bank's bytes (up to 256 MB) live in a file, and its record in IndexedDB holds
// the rest and the file's name. react-native-indexeddb-sqlite keeps every database it has
// opened in memory and copies a value on every read, so a bank in the record sat in memory
// for good and was copied whenever its name was shown. Records stored with their `data`
// before still work. expo-file-system is imported when it's used (it needs the native app).
type StoredRecord = Omit<StoredSoundBank, "data"> & {
    data?: ArrayBuffer;
    file?: string;
};

async function bankFile(name: string) {
    const { File, Paths } = await import("expo-file-system");
    return new File(Paths.document, name);
}

/** The record's bank with its bytes, read from its file if they're there. */
async function withBytes(rec: StoredRecord): Promise<StoredSoundBank | null> {
    if (rec.data) return rec as StoredSoundBank;
    if (!rec.file) return null;
    const file = await bankFile(rec.file);
    if (!file.exists) return null;
    const { file: _file, ...bank } = rec;
    return { ...bank, data: await file.arrayBuffer() };
}

async function deleteBankFile(name: string | undefined): Promise<void> {
    if (!name) return;
    try {
        const file = await bankFile(name);
        if (file.exists) file.delete();
    } catch {
        /* a leftover file is harmless */
    }
}

async function readStoredRecord(): Promise<StoredRecord | null> {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readonly");
            const r = tx.objectStore(STORE).get(RECORD_ID);
            r.onsuccess = () => resolve((r.result as StoredRecord) ?? null);
            r.onerror = () => reject(r.error);
        });
    } catch {
        return null;
    }
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getStoredSoundBank(): Promise<StoredSoundBank | null> {
    try {
        // Zami: the record, then the bytes from its file (see StoredRecord). A bank stored
        // in its record moves to a file, so the record stops loading it.
        const rec = await readStoredRecord();
        if (rec?.data) void putStoredSoundBank(rec as StoredSoundBank);
        return rec ? await withBytes(rec) : null;
    } catch {
        return null;
    }
}

/** Name and size of the stored bank, without handing back its bytes. */
export async function getStoredSoundBankInfo(): Promise<{
    name: string;
    size: number;
} | null> {
    // Zami: the record alone; reading the bytes only to drop them took a copy of the bank.
    const rec = await readStoredRecord();
    return rec ? { name: rec.name, size: rec.size } : null;
}

/** Persist the bank. Returns false when the write fails (quota exceeded,
 *  private mode, no IndexedDB); a quota failure surfaces only as a
 *  transaction abort, so `onabort` counts as failure too. */
export async function putStoredSoundBank(
    rec: Omit<StoredSoundBank, "id">,
): Promise<boolean> {
    // Zami: the bytes go to a new file first, then the record names it, then the old file
    // goes: a crash at any point leaves a record that names a whole file.
    const previous = (await readStoredRecord())?.file;
    const fileName = `zami-sound-bank-${Date.now()}`;
    try {
        await (await bankFile(fileName)).write(rec.data);
        const { data: _data, ...info } = rec;
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put({
                ...info,
                file: fileName,
                id: RECORD_ID,
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        await deleteBankFile(previous);
        return true;
    } catch {
        await deleteBankFile(fileName);
        return false;
    }
}

export async function deleteStoredSoundBank(): Promise<void> {
    const previous = (await readStoredRecord())?.file; // Zami: and its file.
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).delete(RECORD_ID);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        await deleteBankFile(previous);
    } catch {
        /* ignore */
    }
}
