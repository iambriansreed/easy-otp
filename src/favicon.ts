import { nativeImage, type NativeImage } from 'electron';

/**
 * Best-effort favicon lookup for an issuer name.
 *
 * The issuer is turned into one or more candidate domains ("Privacy.com" ->
 * privacy.com, "T-Mobile ID" -> t-mobileid.com, t-mobile.com), each is asked of
 * DuckDuckGo's icon service, and the first icon we can decode wins. Everything
 * is returned as a 32x32 PNG data URL so it can be stored alongside the account
 * and handed straight to nativeImage later.
 *
 * Every icon comes from an icon service on purpose. Fetching sites directly
 * gave inconsistent results: those behind bot protection (ID.me, Namecheap)
 * answer 403 to everything including static icons, and the rest served a grab
 * bag of sizes, formats and letterboxing.
 *
 * DuckDuckGo is asked first. Google's service is only a fallback for domains
 * DuckDuckGo has nothing for, which in practice means sites that publish only an
 * SVG icon (render.com): DuckDuckGo won't rasterise those, Google will. The
 * tradeoff is that DuckDuckGo sees which issuers are looked up, and Google sees
 * the ones DuckDuckGo missed; no other part of the account ever leaves here.
 */

const ICON_SERVICE = 'https://icons.duckduckgo.com/ip3';
// Answers 404 (with a generic globe) for domains it has no icon for, which get()
// already treats as a miss, so the globe is never stored
const FALLBACK_ICON_SERVICE = 'https://www.google.com/s2/favicons';

const TIMEOUT_MS = 5000;
const ICON_SIZE = 32;
const MAX_ICON_BYTES = 2_000_000;

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * A miss (icon: null) is cached for NEGATIVE_TTL_MS rather than forever. A hit is kept
 * for the process lifetime — a found icon doesn't need re-asking — but a miss is
 * ambiguous: it's indistinguishable here from a transient failure (offline, DNS not
 * up yet at login, the service timing out), and without a TTL a bad launch-time
 * moment poisons that domain for every lookup — including an explicit "Find favicon"
 * click in Settings — until the app restarts.
 */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { promise: Promise<string | null>; cachedAt: number; resolved?: string | null };

// service:domain -> the (possibly still in-flight) lookup. Caching the promise itself,
// not just its resolved value, is what makes this safe against backfillIcons' concurrent
// workers: two workers racing on the same domain both find it here before either has
// awaited far enough to store a result, and share the one request instead of firing two.
const cache = new Map<string, CacheEntry>();

export function decode(s: string) {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

function looksLikeDomain(s: string) {
    return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(s);
}

/** Candidate domains for an issuer, best guess first. */
export function issuerToDomains(issuer: string): string[] {
    const raw = decode(issuer || '').trim();
    if (!raw) return [];

    const domains: string[] = [];
    const add = (d: string) => {
        const clean = d.toLowerCase().replace(/^www\./, '');
        if (looksLikeDomain(clean) && !domains.includes(clean)) domains.push(clean);
    };

    if (/^https?:\/\//i.test(raw)) {
        try {
            add(new URL(raw).hostname);
            return domains;
        } catch {
            return [];
        }
    }

    // "ID.me+Wallet" / "Google (Work)" -> only the part before the separator matters
    const primary = raw.split(/[+|(/,]/)[0]!.trim();

    // An issuer that is already a domain is taken at its word. Running it through the
    // guesses below would strip the dot and invent a different site entirely —
    // "render.com" becomes rendercom.com, whose unrelated icon wins whenever
    // DuckDuckGo has nothing for the real domain.
    if (looksLikeDomain(primary)) {
        add(primary);
        return domains;
    }

    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const words = primary.split(/[\s_]+/).filter(Boolean);

    // "T-Mobile ID" and "Google Authenticator" are really t-mobile.com and google.com
    const trimmed = words.filter(
        (w, i) => i === 0 || !/^(id|account|accounts|auth|authenticator|login|otp|totp|2fa|mfa|sso)$/i.test(w),
    );
    if (trimmed.length < words.length) add(`${slug(trimmed.join(''))}.com`);

    const joined = slug(words.join(''));
    if (joined) add(`${joined}.com`);
    if (words.length > 1) {
        const first = slug(words[0]!);
        if (first) add(`${first}.com`);
    }

    return domains;
}

/**
 * Fetches the whole body as a Buffer, or null on any failure (non-OK status,
 * oversized, network error, timeout). The abort timer covers the entire call —
 * headers and body — rather than being cleared once headers arrive: a service that
 * sends headers and then stalls the body would otherwise hang this indefinitely,
 * and with it every concurrent backfill worker and cached() call sharing this promise.
 */
async function get(url: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'user-agent': USER_AGENT,
                accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
                'accept-language': 'en-US,en;q=0.9',
            },
        });
        if (!res.ok) return null;

        const length = Number(res.headers.get('content-length') || 0);
        if (length > MAX_ICON_BYTES) return null;

        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > MAX_ICON_BYTES) return null;
        return buf;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const isIco = (b: Buffer) => b.length > 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1;

/**
 * Decode a BITMAPINFOHEADER DIB stored inside an .ico entry.
 * Handles the uncompressed 1/4/8 (palettized), 24 and 32 bit variants.
 */
function decodeDib(data: Buffer): NativeImage | null {
    if (data.length < 40) return null;

    const headerSize = data.readUInt32LE(0);
    if (headerSize < 40 || headerSize > data.length) return null;

    const width = data.readInt32LE(4);
    // ICO stores the XOR image and the AND mask stacked, so height is doubled
    const height = Math.floor(data.readInt32LE(8) / 2);
    const bitCount = data.readUInt16LE(14);
    const compression = data.readUInt32LE(16);

    if (compression !== 0) return null;
    if (![1, 4, 8, 24, 32].includes(bitCount)) return null;
    if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;

    // Indexed formats carry a BGRX palette directly after the header
    const paletteEntries = bitCount <= 8 ? data.readUInt32LE(32) || 1 << bitCount : 0;
    const pixelStart = headerSize + paletteEntries * 4;
    const rowSize = Math.floor((width * bitCount + 31) / 32) * 4;
    if (data.length < pixelStart + rowSize * height) return null;

    // A 1bpp AND mask (1 = transparent) follows the colour data
    const maskStart = pixelStart + rowSize * height;
    const maskRowSize = Math.floor((width + 31) / 32) * 4;
    const hasMask = data.length >= maskStart + maskRowSize * height;

    const bgra = Buffer.alloc(width * height * 4);
    let anyOpaque = false;

    for (let y = 0; y < height; y++) {
        const srcRow = pixelStart + (height - 1 - y) * rowSize; // rows are bottom-up
        const maskRow = maskStart + (height - 1 - y) * maskRowSize;

        for (let x = 0; x < width; x++) {
            const d = (y * width + x) * 4;
            let alpha = 255;

            if (bitCount >= 24) {
                const s = srcRow + x * (bitCount / 8);
                bgra[d] = data.readUInt8(s);
                bgra[d + 1] = data.readUInt8(s + 1);
                bgra[d + 2] = data.readUInt8(s + 2);
                if (bitCount === 32) alpha = data.readUInt8(s + 3);
            } else {
                const bit = x * bitCount;
                const packed = data.readUInt8(srcRow + (bit >> 3));
                const index = (packed >> (8 - bitCount - (bit & 7))) & ((1 << bitCount) - 1);
                const p = headerSize + index * 4;
                if (p + 3 > data.length) return null;
                bgra[d] = data.readUInt8(p);
                bgra[d + 1] = data.readUInt8(p + 1);
                bgra[d + 2] = data.readUInt8(p + 2);
            }

            if (bitCount !== 32 && hasMask) {
                const maskByte = data.readUInt8(maskRow + (x >> 3));
                if ((maskByte >> (7 - (x & 7))) & 1) alpha = 0;
            }

            bgra[d + 3] = alpha;
            if (alpha !== 0) anyOpaque = true;
        }
    }

    // Some 32bpp icons ship an all-zero alpha channel; treat those as opaque
    if (!anyOpaque) {
        for (let i = 3; i < bgra.length; i += 4) bgra[i] = 255;
    }

    // nativeImage wants premultiplied BGRA
    for (let i = 0; i < bgra.length; i += 4) {
        const alpha = bgra.readUInt8(i + 3);
        if (alpha === 255) continue;
        bgra[i] = (bgra.readUInt8(i) * alpha) / 255;
        bgra[i + 1] = (bgra.readUInt8(i + 1) * alpha) / 255;
        bgra[i + 2] = (bgra.readUInt8(i + 2) * alpha) / 255;
    }

    return nativeImage.createFromBitmap(bgra, { width, height });
}

function decodeIco(buf: Buffer): NativeImage | null {
    const count = buf.readUInt16LE(4);
    if (!count) return null;

    const entries: { width: number; offset: number; size: number }[] = [];
    for (let i = 0; i < count; i++) {
        const p = 6 + i * 16;
        if (p + 16 > buf.length) break;
        entries.push({
            width: buf.readUInt8(p) || 256,
            size: buf.readUInt32LE(p + 8),
            offset: buf.readUInt32LE(p + 12),
        });
    }

    const bigEnough = entries.filter((e) => e.width >= ICON_SIZE).sort((a, b) => a.width - b.width);
    const ordered = bigEnough.length ? bigEnough : [...entries].sort((a, b) => b.width - a.width);

    for (const entry of ordered) {
        const data = buf.subarray(entry.offset, entry.offset + entry.size);
        if (data.length < 8) continue;
        const img = isPng(data) ? nativeImage.createFromBuffer(data) : decodeDib(data);
        if (img && !img.isEmpty()) return img;
    }
    return null;
}

function toIcon(buf: Buffer): string | null {
    // .ico needs our own decoder; everything else (PNG, JPEG, WebP, ...) Chromium
    // can sniff and decode itself.
    const img = isIco(buf) ? decodeIco(buf) : nativeImage.createFromBuffer(buf);
    if (!img || img.isEmpty()) return null;

    const { width, height } = img.getSize();
    if (!width || !height) return null;

    const resized =
        width === ICON_SIZE && height === ICON_SIZE
            ? img
            : img.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });

    const png = resized.toPNG();
    return png.length ? `data:image/png;base64,${png.toString('base64')}` : null;
}

async function fetchIcon(url: string): Promise<string | null> {
    const buf = await get(url);
    return buf ? toIcon(buf) : null;
}

/**
 * The service often only has the `www.` variant of a site indexed — the bare
 * apex domain (e.g. npmjs.com) can 404 while `www.npmjs.com` answers fine — so
 * a miss on the canonical domain gets one retry with `www.` before giving up.
 */
async function faviconForDomain(domain: string): Promise<string | null> {
    const bare = await fetchIcon(`${ICON_SERVICE}/${domain}.ico`);
    if (bare) return bare;
    return fetchIcon(`${ICON_SERVICE}/www.${domain}.ico`);
}

/**
 * `sz=64` asks for the largest size the fallback keeps, which downscales cleanly
 * to 32; it hands back something smaller when that's all a site offers.
 */
function fallbackFaviconForDomain(domain: string): Promise<string | null> {
    return fetchIcon(`${FALLBACK_ICON_SERVICE}?domain=${encodeURIComponent(domain)}&sz=64`);
}

/** A 32x32 PNG data URL plus the domain that actually produced it. */
export type FaviconResult = { icon: string; domain: string };

function cached(
    lookup: (domain: string) => Promise<string | null>,
    domain: string,
): Promise<string | null> {
    const key = `${lookup.name}:${domain}`;
    const existing = cache.get(key);

    // A hit is kept indefinitely; a miss (resolved === null) expires after
    // NEGATIVE_TTL_MS so a transient failure heals itself within the same run
    // instead of being indistinguishable from a real "no icon" forever.
    const expired = existing?.resolved === null && Date.now() - existing.cachedAt > NEGATIVE_TTL_MS;
    if (existing && !expired) return existing.promise;

    const cachedAt = Date.now();
    const promise: Promise<string | null> = lookup(domain)
        .catch((err: unknown) => {
            console.error(`Favicon lookup failed for ${domain}:`, err);
            return null;
        })
        .then((result) => {
            // Re-fetch rather than close over `entry`: by the time this runs the
            // set() below has already happened, and looking it up fresh means a
            // concurrent cached() call for the same key can't be raced.
            const entry = cache.get(key);
            if (entry) entry.resolved = result;
            return result;
        });
    cache.set(key, { promise, cachedAt });
    return promise;
}

/**
 * Returns the favicon and the domain it came from, or null if nothing usable was found.
 *
 * DuckDuckGo gets every candidate domain before the fallback sees any of them, so
 * Google is only ever asked about an issuer DuckDuckGo came up empty on entirely —
 * not about a long-shot guess that happens to come before a DuckDuckGo hit.
 */
export async function fetchFavicon(issuer: string): Promise<FaviconResult | null> {
    const domains = issuerToDomains(issuer);
    for (const lookup of [faviconForDomain, fallbackFaviconForDomain]) {
        for (const domain of domains) {
            const icon = await cached(lookup, domain);
            if (icon) return { icon, domain };
        }
    }
    return null;
}
