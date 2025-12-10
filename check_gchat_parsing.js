
const fs = require('fs');
const path = require('path');

const threadId = 'DM 16V3CwAAAAE';
const msgPath = path.join(process.cwd(), 'data/Google Chat/Groups', threadId, 'messages.json');

console.log(`Reading from: ${msgPath}`);

if (!fs.existsSync(msgPath)) {
    console.error("File not found!");
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
const rawMessages = data.messages || [];

console.log(`Raw messages count: ${rawMessages.length}`);

const googleDateToMs = (dateStr) => {
    if (!dateStr) return 0;
    try {
        // "Saturday, July 9, 2022 at 2:03:54 PM UTC"
        const clean = dateStr
            .replace(' at ', ' ')
            .replace(' UTC', '')
            .replace(/\u202f/g, ' ');
        const date = new Date(clean);
        return date.getTime();
    } catch (e) {
        console.error("Date parse error", e);
        return 0;
    }
};

const messages = rawMessages.map((m) => {
    const ms = googleDateToMs(m.created_date);
    // console.log(`Parsed date: ${m.created_date} -> ${ms}`);
    return {
        timestamp_ms: ms,
        content: m.text
    };
});

console.log("First 3 parsed messages:");
console.log(JSON.stringify(messages.slice(0, 3), null, 2));

console.log("Last 3 parsed messages:");
console.log(JSON.stringify(messages.slice(-3), null, 2));
