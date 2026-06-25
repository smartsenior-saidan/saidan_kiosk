const { NFC } = require('nfc-pcsc');
const { exec } = require('child_process');
const nfc = new NFC();

nfc.on('reader', reader => {
    console.log('Reader ready:', reader.name);
    console.log('Tap your card to read...');

    reader.on('card', async card => {
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
                    console.log('URL:', fullUrl);
                    const opener = process.platform === 'win32' ? 'start ""' : 'open';
                    exec(`${opener} "${fullUrl}"`);
                }
            } else {
                console.log('No NDEF data found on card');
            }
        } catch (err) {
            console.error('Read failed:', err);
        }
    });
});

nfc.on('error', err => console.error('Error:', err));
console.log('Waiting for reader...');
