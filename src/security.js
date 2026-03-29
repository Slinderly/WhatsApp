const helmet = require('helmet');

const ipData        = new Map();
const permBlacklist = new Set();

const BAD_AGENTS = ['sqlmap','nikto','masscan','dirbuster','nmap','acunetix','burpsuite','havij','hydra','zgrab'];
const BAD_PATTERNS = [/<script/i,/javascript:/i,/on\w+\s*=/i,/UNION\s+SELECT/i,/DROP\s+TABLE/i,/INSERT\s+INTO/i,/exec\s*\(/i,/eval\s*\(/i,/\.\.\//,/\/etc\/passwd/i];

const getIP = req =>
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || '0.0.0.0';

const getD = ip => {
    if (!ipData.has(ip)) ipData.set(ip, { reqs: [], auths: [], violations: 0, authViolations: 0, blockedUntil: 0, authBlockedUntil: 0, conns: 0 });
    return ipData.get(ip);
};

const helmetMiddleware = helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
});

const mainGuard = (req, res, next) => {
    const ip = getIP(req);
    if (permBlacklist.has(ip)) return res.status(403).json({ error: 'Forbidden' });

    const d   = getD(ip);
    const now = Date.now();

    if (d.blockedUntil > now) return res.status(429).json({ error: 'Too many requests' });
    if (d.conns > 80) return res.status(429).json({ error: 'Too many connections' });

    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (BAD_AGENTS.some(b => ua.includes(b))) {
        permBlacklist.add(ip);
        return res.status(403).json({ error: 'Forbidden' });
    }

    d.reqs = d.reqs.filter(t => now - t < 60000);
    d.reqs.push(now);

    if (d.reqs.length > 200) {
        d.violations++;
        d.blockedUntil = now + Math.min(d.violations * 30000, 30 * 60000);
        if (d.violations >= 5) permBlacklist.add(ip);
        return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    d.conns++;
    res.on('finish', () => { d.conns = Math.max(0, d.conns - 1); });
    next();
};

const authGuard = (req, res, next) => {
    const ip  = getIP(req);
    const d   = getD(ip);
    const now = Date.now();

    if (d.authBlockedUntil > now) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

    d.auths = d.auths.filter(t => now - t < 60000);
    d.auths.push(now);

    if (d.auths.length > 10) {
        d.authViolations++;
        d.authBlockedUntil = now + Math.min(d.authViolations * 60000, 60 * 60000);
        return res.status(429).json({ error: 'Too many login attempts' });
    }
    next();
};

const checkVal = (v, depth = 0) => {
    if (depth > 5) return false;
    if (typeof v === 'string') return BAD_PATTERNS.some(p => p.test(v));
    if (v && typeof v === 'object') return Object.values(v).some(x => checkVal(x, depth + 1));
    return false;
};

const payloadGuard = (req, res, next) => {
    const body = req.body;
    if (!body) return next();
    const raw = JSON.stringify(body);
    if (raw.length > 50000) return res.status(413).json({ error: 'Payload too large' });
    if (checkVal(body)) {
        const ip = getIP(req);
        const d  = getD(ip);
        d.violations++;
        if (d.violations >= 3)
            d.blockedUntil = Date.now() + Math.min(d.violations * 60000, 60 * 60000);
        return res.status(400).json({ error: 'Invalid payload' });
    }
    next();
};

const reqTimeout = (req, res, next) => {
    req.setTimeout(30000, () => res.status(408).json({ error: 'Request Timeout' }));
    next();
};

module.exports = { helmetMiddleware, mainGuard, authGuard, payloadGuard, reqTimeout };
