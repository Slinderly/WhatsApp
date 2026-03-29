const https = require('https');

const getToken = (clientId, clientSecret) => new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
    const options = {
        hostname: 'api-sec-vlc.hotmart.com',
        path:     '/security/oauth/token',
        method:   'POST',
        headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON from Hotmart')); }
        });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Hotmart timeout')); });
    req.write(body);
    req.end();
});

const getProducts = (token) => new Promise((resolve, reject) => {
    const options = {
        hostname: 'developers.hotmart.com',
        path:     '/product/api/v1/products',
        method:   'GET',
        headers:  { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(options, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON from Hotmart')); }
        });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Hotmart timeout')); });
    req.end();
});

const syncProducts = async (clientId, clientSecret) => {
    const tokenData = await getToken(clientId, clientSecret);
    if (!tokenData.access_token) throw new Error('No se pudo obtener token de Hotmart');

    const data     = await getProducts(tokenData.access_token);
    const items    = data.items || data.content || [];
    return items.map(p => ({
        name:        p.name || p.productName,
        price:       p.price?.value || 0,
        stock:       null,
        description: (p.description || '').slice(0, 200),
        source:      'hotmart',
        sourceId:    String(p.id || p.productId || ''),
    }));
};

module.exports = { syncProducts };
