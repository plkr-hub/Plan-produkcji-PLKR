import { writeFile } from 'node:fs/promises';

const PSE_URL = 'https://api.raporty.pse.pl/api/rce-pln';
const TGE_URL = 'https://tge.pl/gaz-rdn';
const DAY_MS = 24 * 60 * 60 * 1000;

function warsawDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date, offset) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

async function fetchPseDay(date) {
  const url = new URL(PSE_URL);
  url.searchParams.set('$filter', `business_date eq '${date}'`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PSE HTTP ${response.status}`);

  const data = await response.json();
  const buckets = Array.from({ length: 24 }, () => []);
  for (const row of data.value || []) {
    const match = (row.dtime || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    const price = Number(row.rce_pln);
    if (!match || !Number.isFinite(price)) continue;

    const dateOffset = Math.round((Date.UTC(+match[1], +match[2] - 1, +match[3]) - Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))) / DAY_MS);
    const minute = dateOffset * 1440 + Number(match[4]) * 60 + Number(match[5]);
    const hour = Math.floor((minute - 1) / 60);
    if (hour >= 0 && hour < 24) buckets[hour].push(price);
  }

  const pricesMWh = buckets.map(values => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null);
  const hours = pricesMWh.filter(Number.isFinite).length;
  if (hours < 20) throw new Error(`PSE returned only ${hours}/24 hours for ${date}`);
  return { pricesMWh, hours };
}

function parseTgeGas(html) {
  const label = /<b\b[^>]*>\s*TGEgasDA\s*<\/b>/ig;
  let match;
  while ((match = label.exec(html))) {
    const start = html.lastIndexOf('<tr', match.index);
    const end = html.indexOf('</tr>', match.index);
    if (start < 0 || end < 0) continue;

    const row = html.slice(start, end + 5);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(cell => cell[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
    const price = Number.parseFloat((cells[2] || '').replace(',', '.'));
    if (Number.isFinite(price) && price >= 30 && price <= 1500) return price;
  }
  return null;
}

const generatedAt = new Date().toISOString();
const today = warsawDate();
const prices = {
  generatedAt,
  electricity: {},
  gas: { priceMWh: null, updatedAt: null }
};

for (const date of [-2, -1, 0].map(offset => shiftDate(today, offset))) {
  try {
    prices.electricity[date] = await fetchPseDay(date);
    console.log(`PSE ${date}: ${prices.electricity[date].hours}/24 godzin`);
  } catch (error) {
    console.warn(`PSE ${date}: ${error.message}`);
  }
}

try {
  const response = await fetch(TGE_URL);
  if (!response.ok) throw new Error(`TGE HTTP ${response.status}`);
  const priceMWh = parseTgeGas(await response.text());
  if (priceMWh === null) throw new Error('TGEgasDA not found in TGE table');
  prices.gas = { priceMWh, updatedAt: generatedAt };
  console.log(`TGEgasDA: ${priceMWh} PLN/MWh`);
} catch (error) {
  console.warn(`TGE gas: ${error.message}`);
}

await writeFile('prices.json', `${JSON.stringify(prices, null, 2)}\n`);
console.log('Wrote prices.json');
