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

const PROJECT_DIR = __dirname;
const INDEX_FILE = path.join(PROJECT_DIR, 'index.html');
const LOGO_FILENAME = 'token_logo.png';
const LOGO_PATH = path.join(PROJECT_DIR, LOGO_FILENAME);

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
    const titleRegex = /(<title>)[^<]*(<\/title>)/i;
    if (titleRegex.test(html)) {
        html = html.replace(titleRegex, `$1$${tokenName.toUpperCase()}$2`);
        console.log('    ✓ Title updated');
        changes++;
    }

    const headerRegex = /(<span class="text-white">)[^<]*(<\/span>)/i;
    if (headerRegex.test(html)) {
        html = html.replace(headerRegex, `$1$${tokenSymbol.toUpperCase()}$2`);
        console.log('    ✓ Header symbol updated');
        changes++;
    }

    const distTextRegex = /Eligible\s+users\s+are\s+invited\s+to\s+take\s+part\s+in\s+the\s+distribution\s+of\s+.*?\s+tokens\./i;
    if (distTextRegex.test(html)) {
        html = html.replace(distTextRegex, `Eligible users are invited to take part in the distribution of $${tokenName.toUpperCase()} tokens.`);
        console.log('    ✓ Distribution text updated');
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

    console.log('');
}

main().catch(err => {
    console.error(`\n❌  Unexpected error: ${err.message}\n`);
    process.exit(1);
});
