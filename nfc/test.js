const { NFC } = require('nfc-pcsc');
const nfc = new NFC();

nfc.on('reader', reader => {
    console.log('Reader found:', reader.name);

    reader.on('card', card => {
        console.log('Card detected!');
        console.log('UID:', card.uid);
        console.log('Type:', card.type);
    });

    reader.on('card.off', () => {
        console.log('Card removed');
    });

    reader.on('error', err => {
        console.error('Reader error:', err);
    });
});

nfc.on('error', err => console.error('NFC error:', err));
console.log('Waiting for card... (tap your NFC card on the reader)');
