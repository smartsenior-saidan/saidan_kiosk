const { NFC } = require('nfc-pcsc');
const nfc = new NFC();

const url = 'https://kiosk.saidans.org/family.html?person=rg8wIb1cabvbtxExAlcE&site=testtenant1';

function encodeNdefUri(url) {
    const prefixes = [
        '', 'http://www.', 'https://www.', 'http://', 'https://',
        'tel:', 'mailto:'
    ];

    let prefixCode = 0x00;
    let remainingUrl = url;

    for (let i = 1; i < prefixes.length; i++) {
        if (url.startsWith(prefixes[i])) {
            prefixCode = i;
            remainingUrl = url.slice(prefixes[i].length);
            break;
        }
    }

    const payload = Buffer.alloc(remainingUrl.length + 1);
    payload[0] = prefixCode;
    Buffer.from(remainingUrl).copy(payload, 1);

    const record = Buffer.alloc(payload.length + 4);
    record[0] = 0xD1; // MB=1, ME=1, SR=1, TNF=Well-known
    record[1] = 0x01; // Type length
    record[2] = payload.length;
    record[3] = 0x55; // Type "U" (URI)
    payload.copy(record, 4);

    const tlv = Buffer.alloc(record.length + 3);
    tlv[0] = 0x03; // NDEF Message TLV
    tlv[1] = record.length;
    record.copy(tlv, 2);
    tlv[tlv.length - 1] = 0xFE; // Terminator TLV

    const paddedLength = Math.ceil(tlv.length / 4) * 4;
    const padded = Buffer.alloc(paddedLength);
    tlv.copy(padded);

    return padded;
}

nfc.on('reader', reader => {
    console.log('Reader ready:', reader.name);
    console.log('Tap your card to write...');

    reader.on('card', async card => {
        console.log('Card detected, UID:', card.uid);

        try {
            const data = encodeNdefUri(url);
            console.log(`Writing ${data.length} bytes...`);
            await reader.write(4, data, 4);
            console.log('Successfully written!');
            console.log('URL:', url);
        } catch (err) {
            console.error('Write failed:', err);
        }
    });
});

nfc.on('error', err => console.error('Error:', err));
console.log('Waiting for reader...');
