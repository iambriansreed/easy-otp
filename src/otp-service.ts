import jsSHA from 'jssha';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const EXPIRY = 30;

function base32toHex(base32: string) {
    let bits = '';
    let hex = '';
    let i = 0;
    while (i < base32.length) {
        const val = BASE32_CHARS.indexOf(base32.charAt(i).toUpperCase());
        bits += leftPad(val.toString(2), 5, '0');
        i++;
    }
    i = 0;
    while (i + 4 <= bits.length) {
        const chunk = bits.substr(i, 4);
        hex = hex + parseInt(chunk, 2).toString(16);
        i += 4;
    }
    return hex;
}

function dec2hex(s: number) {
    return (s < 15.5 ? '0' : '') + Math.round(s).toString(16);
}

function hexToDec(s: string) {
    return parseInt(s, 16);
}

function leftPad(str: string, len: number, pad: string) {
    if (len + 1 >= str.length) {
        str = Array(len + 1 - str.length).join(pad) + str;
    }
    return str;
}

function calculateTimeCounter(now: number) {
    const epoch = Math.round(now / 1000.0);
    const time = leftPad(dec2hex(Math.floor(epoch / EXPIRY)), 16, '0');
    return time;
}

function mangleHmac(hmac: string) {
    const offset = hexToDec(hmac.substr(hmac.length - 1));
    const otp = (hexToDec(hmac.substr(offset * 2, 8)) & hexToDec('7fffffff')) + '';
    return otp.substr(otp.length - 6, 6);
}

export function getTimeBasedOTP(secret: string, now = new Date().getTime()) {
    const key = base32toHex(secret);
    const time = calculateTimeCounter(now);
    const shaObj = new jsSHA('SHA-1', 'HEX');
    shaObj.setHMACKey(key, 'HEX');
    shaObj.update(time);
    const hmac = shaObj.getHMAC('HEX');
    const otp = mangleHmac(hmac);
    return otp;
}
