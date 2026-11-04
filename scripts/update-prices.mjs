import { writeFile } from 'node:fs/promises';

const PSE_URL = 'https://api.raporty.pse.pl/api/rce-pln';
const TGE_URL = 'https://tge.pl/gaz-rdn';
const PUBLISHED_PRICES_URL = 'https://plkr-hub.github.io/Plan-produkcji-PLKR/prices.json';
const LAT = 52.1869;
const LON = 22.9469;
const DAY_MS = 24 * 60 * 60 * 1000;

function warsawDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function warsawHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(date));
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
  const result = aggregatePseRows(data.value || [], date)[date];
  if (!result) throw new Error(`PSE returned fewer than 20 hours for ${date}`);
  return result;
}

function aggregatePseRows(rows, defaultDate) {
  const grouped = {};
  for (const row of rows) {
    const match = (row.dtime || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    const price = Number(row.rce_pln);
    if (!match || !Number.isFinite(price)) continue;
    const date = (row.business_date || match[0]).slice(0, 10) || defaultDate;
    const dateOffset = Math.round((Date.UTC(+match[1], +match[2] - 1, +match[3])
      - Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))) / DAY_MS);
    const minute = dateOffset * 1440 + Number(match[4]) * 60 + Number(match[5]);
    const hour = Math.floor((minute - 1) / 60);
    if (hour < 0 || hour >= 24) continue;
    if (!grouped[date]) grouped[date] = Array.from({ length: 24 }, () => []);
    grouped[date][hour].push(price);
  }

  return Object.fromEntries(Object.entries(grouped).map(([date, buckets]) => {
    const pricesMWh = buckets.map(values => values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
      : null);
    const hours = pricesMWh.filter(Number.isFinite).length;
    if (hours < 20) return [date, null];
    return [date, { pricesMWh, hours }];
  }).filter(([, entry]) => entry));
}

async function fetchPseHistory(startDate, endDate) {
  const history = {};
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  for (let month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    month <= end;
    month.setUTCMonth(month.getUTCMonth() + 1)) {
    const monthStart = month.toISOString().slice(0, 10) < startDate ? startDate : month.toISOString().slice(0, 10);
    const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    const monthEnd = nextMonth.toISOString().slice(0, 10) > endDate ? endDate : nextMonth.toISOString().slice(0, 10);
    let nextUrl = null;
    let page = 0;
    while (true) {
      const url = nextUrl ? new URL(nextUrl, PSE_URL) : new URL(PSE_URL);
      if (!nextUrl) {
        url.searchParams.set('$filter', `business_date ge '${monthStart}' and business_date le '${monthEnd}'`);
        url.searchParams.set('$select', 'business_date,dtime,rce_pln');
        url.searchParams.set('$first', '5000');
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PSE history HTTP ${response.status} (${monthStart})`);
      const data = await response.json();
      const rows = data.value || [];
      Object.assign(history, aggregatePseRows(rows));
      nextUrl = data['@odata.nextLink'] || data.nextLink || null;
      page++;
      if (!nextUrl) {
        if (rows.length >= 5000) throw new Error(`PSE history missing continuation link (${monthStart})`);
        break;
      }
      if (page >= 20) throw new Error(`PSE history page limit reached (${monthStart})`);
    }
  }
  return history;
}

async function fetchWeatherHistory(startDate, endDate) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    start_date: startDate,
    end_date: endDate,
    hourly: 'shortwave_radiation',
    timezone: 'Europe/Warsaw'
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo archive HTTP ${response.status}`);
  const data = await response.json();
  const result = {};
  (data.hourly?.time || []).forEach((time, index) => {
    const [date, hour] = time.split('T');
    const irradiance = data.hourly.shortwave_radiation[index];
    if (Number.isFinite(irradiance)) (result[date] ||= Array(24).fill(null))[Number(hour.slice(0, 2))] = irradiance;
  });
  return result;
}

function buildPriceModel(electricity, weather) {
  const buckets = {};
  for (const [date, entry] of Object.entries(electricity)) {
    const irradiation = weather[date];
    if (!irradiation) continue;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
    entry.pricesMWh.forEach((price, hour) => {
      const irradiance = irradiation[hour];
      if (!Number.isFinite(price) || !Number.isFinite(irradiance)) return;
      for (const key of [`${date.slice(5, 7)}-${dayType}-${hour}`, `all-${dayType}-${hour}`]) {
        const b = buckets[key] ||= { n: 0, sumPrice: 0, sumIrr: 0, sumPriceIrr: 0, sumIrr2: 0 };
        b.n++;
        b.sumPrice += price;
        b.sumIrr += irradiance;
        b.sumPriceIrr += price * irradiance;
        b.sumIrr2 += irradiance * irradiance;
      }
    });
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, b]) => {
    const covariance = b.sumPriceIrr - b.sumPrice * b.sumIrr / b.n;
    const variance = b.sumIrr2 - b.sumIrr * b.sumIrr / b.n;
    return [key, {
      samples: b.n,
      meanPrice: Number((b.sumPrice / b.n).toFixed(2)),
      meanIrr: Number((b.sumIrr / b.n).toFixed(1)),
      pricePerWm2: Number((variance > 0 ? covariance / variance : 0).toFixed(4))
    }];
  }));
}

async function loadPublishedPrices() {
  try {
    const response = await fetch(`${PUBLISHED_PRICES_URL}?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Previous prices archive unavailable: ${error.message}`);
    return {};
  }
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
const now = new Date();
const today = warsawDate(now);
const historyStart = shiftDate(today, -365);
const published = await loadPublishedPrices();
const prices = {
  generatedAt,
  electricity: {},
  gas: { priceMWh: null, updatedAt: null },
  history: {
    electricity: {},
    gas: published.history?.gas || {}
  },
  priceModel: {}
};

const pseDates = [-2, -1, 0, ...(warsawHour(now) >= 14 ? [1] : [])];
for (const date of pseDates.map(offset => shiftDate(today, offset))) {
  try {
    prices.electricity[date] = await fetchPseDay(date);
    console.log(`PSE ${date}: ${prices.electricity[date].hours}/24 godzin`);
  } catch (error) {
    console.warn(`PSE ${date}: ${error.message}`);
  }
}

const cachedHistory = published.history?.electricity || {};
const historyIsFresh = Object.keys(cachedHistory).length >= 300
  && Object.keys(published.priceModel || {}).length > 0
  && published.generatedAt
  && warsawDate(new Date(published.generatedAt)) === today;
if (historyIsFresh) {
  prices.history.electricity = cachedHistory;
  prices.priceModel = published.priceModel;
  console.log(`Użyto historii PSE z cache: ${Object.keys(cachedHistory).length} dób`);
} else {
  try {
    prices.history.electricity = await fetchPseHistory(historyStart, today);
    console.log(`PSE history: ${Object.keys(prices.history.electricity).length} dób`);
  } catch (error) {
    console.warn(`Historical PSE data unavailable: ${error.message}`);
    prices.history.electricity = cachedHistory;
  }
  try {
    const weather = await fetchWeatherHistory(historyStart, shiftDate(today, -5));
    prices.priceModel = buildPriceModel(prices.history.electricity, weather);
    console.log(`Forecast model: ${Object.keys(prices.priceModel).length} profiles`);
  } catch (error) {
    console.warn(`Historical weather model unavailable: ${error.message}`);
    prices.priceModel = published.priceModel || {};
  }
  if (!Object.keys(prices.priceModel).length) prices.priceModel = published.priceModel || {};
}

try {
  const response = await fetch(TGE_URL);
  if (!response.ok) throw new Error(`TGE HTTP ${response.status}`);
  const priceMWh = parseTgeGas(await response.text());
  if (priceMWh === null) throw new Error('TGEgasDA not found in TGE table');
  prices.gas = { priceMWh, updatedAt: generatedAt };
  prices.history.gas[today] = priceMWh;
  console.log(`TGEgasDA: ${priceMWh} PLN/MWh`);
} catch (error) {
  console.warn(`TGE gas: ${error.message}`);
  const previousGasPrice = Number(prices.history.gas[today]);
  if (previousGasPrice >= 30 && previousGasPrice <= 1500) {
    prices.gas = { priceMWh: previousGasPrice, updatedAt: generatedAt };
  } else {
    const lastGasDate = Object.keys(prices.history.gas).sort().at(-1);
    if (lastGasDate) prices.gas = { priceMWh: prices.history.gas[lastGasDate], updatedAt: lastGasDate };
  }
}

await writeFile('prices.json', `${JSON.stringify(prices, null, 2)}\n`);
console.log('Wrote prices.json');
