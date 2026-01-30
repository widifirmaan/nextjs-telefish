const fs = require('fs');

function reverse(s) {
    return s.split('').reverse().join('');
}

function k0(input) {
    try {
        const r1 = reverse(input);
        const b1 = Buffer.from(r1, 'base64');
        const s1 = b1.toString('latin1');

        const r2 = reverse(s1);
        const b2 = Buffer.from(r2, 'base64');
        const s2 = b2.toString('utf8');

        return reverse(s2);
    } catch (e) {
        return "";
    }
}

function scan(encryptedInfo) {
    for (let i = 0; i < 200; i++) {
        try {
            const sub = encryptedInfo.substring(i);
            const decrypted = k0(sub);
            const trimmed = decrypted.trim();

            if (trimmed.startsWith("{")) {
                const lastBrace = trimmed.lastIndexOf("}");
                if (lastBrace !== -1) {
                    const candidate = trimmed.substring(0, lastBrace + 1);
                    try {
                        JSON.parse(candidate);
                        return { offset: i, data: candidate };
                    } catch (e) {
                    }
                }
            }
        } catch (e) {
        }
    }
    return null;
}

const data = fs.readFileSync(0, 'utf-8');
const result = scan(data);
if (result) {
    console.log(result.data);
} else {
    console.error("Failed to decrypt");
}
