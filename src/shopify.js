const https = require('https');

const fetchShopify = (storeUrl, accessToken, path) => new Promise((resolve, reject) => {
    const host = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const options = {
        hostname: host,
        path,
        method: 'GET',
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    };
    const req = https.request(options, res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON from Shopify')); }
        });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Shopify timeout')); });
    req.end();
});

const syncProducts = async (storeUrl, accessToken) => {
    let all = [];
    let page = `/admin/api/2024-01/products.json?limit=50&fields=id,title,variants,body_html`;
    while (page) {
        const data = await fetchShopify(storeUrl, accessToken, page);
        const products = data.products || [];
        for (const p of products) {
            const variant = p.variants?.[0];
            all.push({
                name:        p.title,
                price:       variant ? Number(variant.price) : 0,
                stock:       variant?.inventory_quantity ?? null,
                description: (p.body_html || '').replace(/<[^>]*>/g, '').trim().slice(0, 200),
                source:      'shopify',
                sourceId:    String(p.id),
            });
        }
        const linkHeader = data.nextPage || null;
        page = linkHeader;
        break;
    }
    return all;
};

const parseCSV = (text) => {
    const lines  = text.trim().split('\n');
    const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const products = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const row  = {};
        header.forEach((h, idx) => { row[h] = vals[idx] || ''; });
        if (!row.name && !row.title) continue;
        products.push({
            name:        row.name || row.title,
            price:       Number(row.price) || 0,
            stock:       row.stock !== undefined ? Number(row.stock) : null,
            description: (row.description || row.desc || '').slice(0, 200),
            source:      'csv',
        });
    }
    return products;
};

module.exports = { syncProducts, parseCSV };
