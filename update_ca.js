#!/usr/bin/env node
/**
 * CA Updater Script
 * 
 * Usage: node update_ca.js <CONTRACT_ADDRESS>
 * 
 * Fetches token info from DexScreener, downloads the logo,
 * and updates index.html with the new CA, DexScreener link, and image.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_DIR = __dirname;
const INDEX_FILE = path.join(PROJECT_DIR, 'index.html');
const LOGO_FILENAME = 'token_logo.png';
const LOGO_PATH = path.join(PROJECT_DIR, LOGO_FILENAME);
const BASE_URL = 'https://solana-seven-rouge.vercel.app/';

// ── Helpers ──────────────────────────────────────────────────────────

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'CA-Updater/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJSON(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Failed to parse JSON: ' + e.message)); }
            });
        }).on('error', reject);
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'CA-Updater/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} downloading image`));
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
        }).on('error', reject);
    });
}

function takeScreenshot() {
    console.log('📸  Generating new site preview screenshot...');
    const chromeCandidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    const chromePath = chromeCandidates.find(p => fs.existsSync(p));
    
    // Format the file URL correctly for Windows
    const absolutePath = path.resolve(INDEX_FILE);
    const fileUrl = 'file:///' + absolutePath.replace(/\\/g, '/');
    const outputPath = path.join(PROJECT_DIR, 'site_preview.png');
    
    try {
        if (!chromePath) {
            console.error('❌  Could not find Chrome/Edge to take screenshot.');
            return;
        }
        console.log(`    Source: ${fileUrl}`);
        // Use headless chrome to take a screenshot
        const result = spawnSync(chromePath, [
            '--headless',
            `--screenshot=${outputPath}`,
            '--window-size=1200,630',
            '--force-device-scale-factor=1',
            '--hide-scrollbars',
            '--virtual-time-budget=5000',
            '--run-all-compositor-stages-before-draw',
            '--no-sandbox',
            fileUrl
        ]);

        if (result.error) {
            throw result.error;
        }
        if (typeof result.status === 'number' && result.status !== 0) {
            throw new Error(`Browser exited with code ${result.status}`);
        }

        console.log('✅  Screenshot saved to site_preview.png');
    } catch (err) {
        console.error(`❌  Failed to take screenshot: ${err.message}`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
    const newCA = process.argv[2];
    if (!newCA) {
        console.error('\n  Usage: node update_ca.js <CONTRACT_ADDRESS>\n');
        console.error('  Example: node update_ca.js EPuZ1X6pPzac3ELPsT59LStmgaSr4kBJvaAbL15Fpump\n');
        process.exit(1);
    }

    console.log(`\n🔍  Fetching token info for: ${newCA}`);

    // 1. Fetch token data from DexScreener
    const apiUrl = `https://api.dexscreener.com/tokens/v1/solana/${newCA}`;
    let pairs;
    try {
        pairs = await fetchJSON(apiUrl);
    } catch (err) {
        console.error(`❌  Failed to fetch from DexScreener: ${err.message}`);
        process.exit(1);
    }

    if (!Array.isArray(pairs) || pairs.length === 0) {
        console.error('❌  No pairs found on DexScreener for this contract address.');
        process.exit(1);
    }

    const pair = pairs[0];
    const tokenName = pair.baseToken?.name || 'Unknown';
    const tokenSymbol = pair.baseToken?.symbol || '???';
    const pairAddress = pair.pairAddress || '';
    const imageUrl = pair.info?.imageUrl || '';
    const dexUrl = pair.url || `https://dexscreener.com/solana/${pairAddress}`;

    console.log(`✅  Found: ${tokenName} ($${tokenSymbol})`);
    console.log(`    Pair: ${pairAddress}`);
    console.log(`    DexScreener: ${dexUrl}`);

    // 2. Download the logo
    let downloadedLogo = false;
    if (imageUrl) {
        console.log(`📥  Downloading logo...`);
        const fetchUrls = [
            `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}`,
            imageUrl
        ];

        for (const url of fetchUrls) {
            try {
                await downloadFile(url, LOGO_PATH);
                console.log(`✅  Logo saved to ${LOGO_FILENAME}`);
                downloadedLogo = true;
                break;
            } catch (err) {
                console.log(`    ⚠️  Failed with ${url}: ${err.message}`);
            }
        }

        if (!downloadedLogo) {
            console.log('    ❌  All attempts to download logo failed. Image will not be updated.');
        }
    } else {
        console.log('⚠️  No logo URL found on DexScreener. Image will not be updated.');
    }

    // 3. Update index.html
    console.log(`📝  Updating index.html...`);

    let html;
    try {
        html = fs.readFileSync(INDEX_FILE, 'utf8');
    } catch (err) {
        console.error(`❌  Cannot read ${INDEX_FILE}: ${err.message}`);
        process.exit(1);
    }

    let changes = 0;

    // 3a. Replace the CA text in the bottom bar
    //     Matches the span that contains the contract address (alphanumeric string)
    const caRegex = /(<span[^>]*class="[^"]*font-mono[^"]*"[^>]*>)[A-Za-z0-9]{30,50}(<\/span>)/;
    if (caRegex.test(html)) {
        html = html.replace(caRegex, `$1${newCA}$2`);
        console.log('    ✓ Contract address updated');
        changes++;
    } else {
        console.log('    ⚠ Could not find CA span to update');
    }

    // 3b. Replace the DexScreener link
    const dexLinkRegex = /(href=")(https:\/\/dexscreener\.com\/solana\/[A-Za-z0-9]+)(")/;
    if (dexLinkRegex.test(html)) {
        html = html.replace(dexLinkRegex, `$1${dexUrl}$3`);
        console.log('    ✓ DexScreener link updated');
        changes++;
    } else {
        console.log('    ⚠ Could not find DexScreener link to update');
    }

    // 3c. Replace the title and header with actual name and symbol
    const titleRegex = /(<title>)[^<]*(<\/title>)/gi;
    if (titleRegex.test(html)) {
        html = html.replace(titleRegex, `$1$${tokenName.toUpperCase()}$2`);
        console.log('    ✓ Title updated');
        changes++;
    }

    const headerRegex = /(<span class="text-white">)[^<]*(<\/span>)/gi;
    if (headerRegex.test(html)) {
        html = html.replace(headerRegex, `$1$${tokenSymbol.toUpperCase()}$2`);
        console.log('    ✓ Header symbol updated');
        changes++;
    }

    // New: Replace symbol in h1 tag (The $... Airdrop is Live)
    const h1SymbolRegex = /(<h1[^>]*>.*?<span[^>]*>\$)[^<]*(<\/span>)/gi;
    if (h1SymbolRegex.test(html)) {
        html = html.replace(h1SymbolRegex, `$1${tokenSymbol.toUpperCase()}$2`);
        console.log('    ✓ H1 symbol updated');
        changes++;
    }

    // Keep your existing sentence, but ensure placeholder is resolved.
    // Example: "Eligible users ... distribution of $SYMBOL tokens."
    // becomes:  "Eligible users ... distribution of $SYMBOL FACE tokens."
    const distLineRegex = /(Eligible\s+users\s+are\s+invited\s+to\s+take\s+part\s+in\s+the\s+distribution\s+of\s+)\$DISTORTED(\b)/i;
    if (distLineRegex.test(html)) {
        html = html.replace(distLineRegex, `$1$${tokenSymbol.toUpperCase()}$2`);
        console.log('    ✓ Distribution line placeholder updated');
        changes++;
    }

    // 3d. Update Meta Tags (OG / Twitter)
    // NOTE: Do NOT use .test() before .replace() with /g flag — .test() advances
    // lastIndex so the subsequent .replace() misses the match.
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/gi, `$1${BASE_URL}site_preview.png$2`);
    console.log('    ✓ og:image updated');
    changes++;

    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/gi, `$1$${tokenSymbol.toUpperCase()}$2`);
    console.log('    ✓ og:title updated');
    changes++;

    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/gi, `$1The $${tokenSymbol.toUpperCase()} Airdrop is Live. Eligible users are invited to take part in the distribution of $${tokenName.toUpperCase()} tokens.$2`);
    console.log('    ✓ og:description updated');
    changes++;

    html = html.replace(/(<meta property="twitter:title" content=")[^"]*(")/gi, `$1$${tokenSymbol.toUpperCase()}$2`);
    console.log('    ✓ twitter:title updated');
    changes++;

    html = html.replace(/(<meta property="twitter:description" content=")[^"]*(")/gi, `$1The $${tokenSymbol.toUpperCase()} Airdrop is Live. Eligible users are invited to take part in the distribution of $${tokenName.toUpperCase()} tokens.$2`);
    console.log('    ✓ twitter:description updated');
    changes++;

    html = html.replace(/(<meta property="twitter:image" content=")[^"]*(")/gi, `$1${BASE_URL}site_preview.png$2`);
    console.log('    ✓ twitter:image updated');
    changes++;

    // Update standard description tag
    html = html.replace(/(<meta name="description" content=")[^"]*(")/gi, `$1The $${tokenSymbol.toUpperCase()} Airdrop is Live. Eligible users are invited to take part in the distribution of $${tokenName.toUpperCase()} tokens.$2`);
    console.log('    ✓ meta:description updated');
    changes++;

    // 3f. Replace all "Distorted" variations case-insensitively
    html = html.replace(/\$?distorted(?:\s+face)?/gi, (match) => {
        return match.startsWith('$') ? `$${tokenSymbol.toUpperCase()}` : tokenSymbol.toUpperCase();
    });
    console.log('    ✓ All "Distorted" tokens/text updated');

    // 3g. Update OG/Twitter URLs (set to absolute BASE_URL)
    // Uses [^"]* to match both empty and populated content values
    html = html.replace(/(<meta property="(?:og|twitter):url" content=")[^"]*(")/gi, `$1${BASE_URL}$2`);
    console.log('    ✓ Social URLs set to BASE_URL');
    changes++;

    // 3h. Update absolute URLs pointing to the old domains or broken placeholders
    const domainRegex = /https?:\/\/(?:distortedface|distortedcoin|\$TESTICLEface)\.app\//gi;
    if (domainRegex.test(html)) {
        html = html.replace(domainRegex, BASE_URL);
        console.log('    ✓ Domain links normalized to BASE_URL');
        changes++;
    }

    // 3i. Replace all remaining $FML placeholders with the token symbol
    const fmlRegex = /\$FML/g;
    if (fmlRegex.test(html)) {
        html = html.replace(fmlRegex, `$${tokenSymbol.toUpperCase()}`);
        console.log('    ✓ All $FML placeholders updated');
        changes++;
    }

    // 3f. Replace $DISTORTED placeholder with fetched token symbol
    // This keeps existing suffix text, e.g. "$DISTORTED FACE" -> "$SYMBOL FACE"
    const distortedRegex = /\$DISTORTED\b/g;
    if (distortedRegex.test(html)) {
        html = html.replace(distortedRegex, `$${tokenSymbol.toUpperCase()}`);
        console.log('    ✓ All $DISTORTED placeholders updated');
        changes++;
    }

    // 3d. Update favicon
    const faviconRegex = /(<link rel="icon" href=")[^"]*(")/i;
    if (faviconRegex.test(html)) {
        if (imageUrl && fs.existsSync(LOGO_PATH)) {
            html = html.replace(faviconRegex, `$1${LOGO_FILENAME}$2`);
            console.log('    ✓ Favicon updated');
            changes++;
        }
    }

    // 3e. Update Twitter URL
    const twitterRegex = /(href=")(https:\/\/x\.com\/[^"]+)(")/i;
    let newTwitterUrl = 'https://x.com/witloofsol'; // default fallback
    if (pair.info && pair.info.socials && pair.info.socials.length > 0) {
        const twitterSocial = pair.info.socials.find(s => s.type === 'twitter');
        if (twitterSocial && twitterSocial.url) {
            newTwitterUrl = twitterSocial.url;
        }
    }
    
    // There are potentially multiple twitter links - this captures the first prominent one (the icon link)
    // The second twitter link in this file is the "website by @witloofsol" link at the bottom.
    // To only replace the main social link and not the website creator link, we match the one in the top box.
    const twitterIconRegex = /(<a href=")(https:\/\/x\.com\/[^"]+)("[^>]*>\s*<div[^>]*>\s*<\/div><svg viewBox="0 0 24 24")/i;
    if (twitterIconRegex.test(html)) {
        html = html.replace(twitterIconRegex, `$1${newTwitterUrl}$3`);
        console.log('    ✓ Twitter URL updated');
        changes++;
    }

    // 3f. Inject floating animation CSS if not already present
    if (!html.includes('.token-logo-frame')) {
        const logoCSS = `
        @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            25% { transform: translateY(-12px) rotate(1.5deg); }
            50% { transform: translateY(-6px) rotate(0deg); }
            75% { transform: translateY(-14px) rotate(-1.5deg); }
        }

        .token-logo-frame {
            width: 350px;
            height: 350px;
            border-radius: 50%;
            overflow: hidden;
            border: 3px solid rgba(255, 255, 255, 0.25);
            box-shadow: 0 0 60px rgba(255, 200, 0, 0.35), 0 0 120px rgba(255, 150, 0, 0.15), inset 0 0 30px rgba(0,0,0,0.3);
            animation: float 4s ease-in-out infinite;
        }

        .token-logo-frame img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .logo-center-wrap {
            position: fixed;
            top: 70%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 30;
        }`;
        const styleInsertRegex = /(@property\s+--angle\s*\{[^}]+\}\s*)<\/style>/;
        if (styleInsertRegex.test(html)) {
            html = html.replace(styleInsertRegex, `$1\n${logoCSS}\n    </style>`);
            console.log('    ✓ Floating animation CSS injected');
            changes++;
        }
    }

    // 3e. Replace the main image with circular frame
    const buttonImgRegex = /(<button[^>]*class="[^"]*cursor-pointer[^"]*"[^>]*>)\s*(?:<div class="token-logo-frame">\s*<img[^>]*>\s*<\/div>|<img[^>]*>)\s*(<\/button>)/;
    if (buttonImgRegex.test(html)) {
        if (imageUrl && fs.existsSync(LOGO_PATH)) {
            html = html.replace(buttonImgRegex,
                `$1\n                <div class="token-logo-frame">\n                    <img alt="Token logo" decoding="async" src="${LOGO_FILENAME}">\n                </div>\n            $2`);
            console.log('    ✓ Main image updated with circular frame');
            changes++;
        }
    } else {
        console.log('    ⚠ Could not find main image to update');
    }

    // Write changes
    if (changes > 0) {
        fs.writeFileSync(INDEX_FILE, html, 'utf8');
        console.log(`\n🎉  Done! ${changes} change(s) applied to index.html`);
    } else {
        console.log('\n⚠️  No changes were made to index.html');
    }

    // 4. Update the preview screenshot
    takeScreenshot();

    console.log('');
}

main().catch(err => {
    console.error(`\n❌  Unexpected error: ${err.message}\n`);
    process.exit(1);
});
