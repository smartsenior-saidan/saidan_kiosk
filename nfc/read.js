const { NFC } = require('nfc-pcsc');
const { exec } = require('child_process');
const fs = require('fs');
const nfc = new NFC();

const REDIRECT_DELAY_MS = 5000; // 5 seconds after card removed
const CONFIG_PATH = 'C:\\ProgramData\\SmartSenior\\config.json';
const FALLBACK_HOME = 'https://kiosk.saidans.org';

function getHomeUrl() {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return config.homeUrl || FALLBACK_HOME;
    } catch {
        return FALLBACK_HOME;
    }
}

let redirectTimer = null;

function openUrl(url) {
    const opener = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
    exec(opener);
}

nfc.on('reader', reader => {
    console.log('Reader ready:', reader.name);
    console.log('Tap your card to read...');

    reader.on('card', async card => {
        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = null;
            console.log('New card tapped - redirect cancelled');
        }

        console.log('Card UID:', card.uid);

        try {
            const data = await reader.read(4, 128, 4);

            if (data[0] === 0x03) {
                const ndefLength = data[1];
                const ndefRecord = data.slice(2, 2 + ndefLength);

                if (ndefRecord[3] === 0x55) {
                    const prefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:'];
                    const prefixCode = ndefRecord[4];
                    const prefix = prefixes[prefixCode] || '';
                    const urlPart = ndefRecord.slice(5).toString('utf8');
                    const fullUrl = prefix + urlPart;
                    console.log('Opening URL:', fullUrl);
                    openUrl(fullUrl);
                }
            } else {
                console.log('No NDEF data found on card');
            }
        } catch (err) {
            console.error('Read failed:', err);
        }
    });

    reader.on('card.off', () => {
        const homeUrl = getHomeUrl();
        console.log(`Card removed - redirecting to ${homeUrl} in ${REDIRECT_DELAY_MS / 1000} seconds...`);
        redirectTimer = setTimeout(() => {
            console.log('Redirecting to home page...');
            openUrl(homeUrl);
            redirectTimer = null;
        }, REDIRECT_DELAY_MS);
    });
});

nfc.on('error', err => console.error('Error:', err));
console.log('Waiting for reader...');
