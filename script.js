/* =====================================================
   SkyCast - Weather Forecast Website
   Uses the OpenWeatherMap API with the Fetch API
   ===================================================== */
'use strict';

/* ╔═══════════════════════════════════════════════════════════╗
   ║  1. PUT YOUR OPENWEATHERMAP API KEY HERE                   ║
   ║                                                            ║
   ║  Replace  YOUR_API_KEY_HERE  with your real key, e.g.      ║
   ║  const API_KEY = "a1b2c3d4e5f6...";                        ║
   ║                                                            ║
   ║  Get a free key at: https://openweathermap.org/api         ║
   ║  (New keys can take 10 min - 2 hours to become active.)    ║
   ╚═══════════════════════════════════════════════════════════╝ */


const BASE_URL = 'https://skycast-weather-api.itsfarmi05.workers.dev';
const ICON_URL = (code, size = '2x') => `https://openweathermap.org/img/wn/${code}@${size}.png`;

/* ---------- 2. App state ---------- */
const state = {
  unit: 'C',        // 'C' or 'F' (data is always stored in Celsius / m/s / metres)
  data: null,       // the latest weather data (normalised)
  requestId: 0      // used to ignore outdated responses
};

/* ---------- 3. DOM helpers ---------- */
const $ = (id) => document.getElementById(id);

const el = {
  form: $('searchForm'), input: $('cityInput'),
  errorBox: $('errorBox'), errorText: $('errorText'), errorClose: $('errorClose'),
  notice: $('notice'), noticeText: $('noticeText'),
  welcome: $('welcome'), loader: $('loader'), dashboard: $('dashboard'),
  btnC: $('btnC'), btnF: $('btnF'), unitToggle: $('unitToggle'),
  locateBtn: $('locateBtn'), menuBtn: $('menuBtn'), navLinks: $('navLinks'),
  fx: $('fx'),
  hourList: $('hourList'), dayList: $('dayList'),
  hourPrev: $('hourPrev'), hourNext: $('hourNext'),
  hourlyHint: $('hourlyHint'), dailyTitle: $('dailyTitle')
};

/* Safe localStorage helpers (they never crash the app) */
function saveLocal(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }
function loadLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

/* Escape text before putting it in innerHTML */
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Capitalise every word: "light rain" -> "Light Rain" */
function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- 4. Unit conversion & formatting ---------- */
const cToF = (c) => (c * 9) / 5 + 32;

function formatTemp(celsius) {
  const value = state.unit === 'F' ? cToF(celsius) : celsius;
  return `${Math.round(value)}°`;
}

function formatWind(metersPerSecond) {
  return state.unit === 'F'
    ? `${Math.round(metersPerSecond * 2.23694)} mph`
    : `${Math.round(metersPerSecond * 3.6)} km/h`;
}

function formatVisibility(meters) {
  if (meters == null) return '--';
  return state.unit === 'F' ? `${(meters / 1609.34).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;
}

/* ---------- 5. Date & time helpers (city's local time) ---------- */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Shift a UNIX time by the city's timezone offset, then read it with the UTC getters */
const localDate = (unix, offset) => new Date((unix + offset) * 1000);

function formatHour(unix, offset) {
  const d = localDate(unix, offset);
  const h = d.getUTCHours();
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatClock(unix, offset) {
  const d = localDate(unix, offset);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatFullDate(unix, offset) {
  const d = localDate(unix, offset);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function dayKey(unix, offset) {
  const d = localDate(unix, offset);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/* ---------- 6. Friendly descriptions for the detail cards ---------- */
function humidityLabel(h) { return h < 30 ? 'Dry air' : h <= 60 ? 'Comfortable' : h <= 80 ? 'Humid' : 'Very humid'; }
function windLabel(ms) {
  const k = ms * 3.6;
  return k < 2 ? 'Calm' : k < 20 ? 'Light breeze' : k < 40 ? 'Moderate wind' : k < 62 ? 'Strong wind' : 'Gale force';
}
function visibilityLabel(m) { return m == null ? '' : m >= 10000 ? 'Excellent' : m >= 5000 ? 'Good' : m >= 2000 ? 'Moderate' : 'Poor'; }
function pressureLabel(p) { return p < 1000 ? 'Low pressure' : p <= 1020 ? 'Normal' : 'High pressure'; }
function feelsLabel(feels, actual) {
  const diff = feels - actual;
  return diff >= 2 ? 'Feels warmer than actual' : diff <= -2 ? 'Feels cooler than actual' : 'Close to actual temp';
}

/* ---------- 7. Error handling ---------- */
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function showError(message) {
  el.errorText.textContent = message;
  el.errorBox.hidden = false;
  el.errorBox.classList.remove('shake');
  void el.errorBox.offsetWidth;               // restart the shake animation
  el.errorBox.classList.add('shake');
}
function hideError() { el.errorBox.hidden = true; }

/* ---------- 8. API requests (Fetch API) ---------- */
function hasApiKey() { return true; }

async function fetchJSON(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new ApiError('network', 'Network error. Please check your internet connection and try again.');
  }

  if (!response.ok) {
    const messages = {
      401: 'Your API key is invalid or not active yet. New OpenWeatherMap keys can take up to a couple of hours to activate.',
      404: 'The requested weather data could not be found.',
      429: 'Too many requests. Please wait a minute and try again.'
    };
    throw new ApiError(response.status, messages[response.status] || `The weather service returned an error (code ${response.status}). Please try again later.`);
  }
  return response.json();
}

/* City name -> coordinates (Geocoding API) */
async function geocodeCity(query) {
const url = `${BASE_URL}/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1`;
  const results = await fetchJSON(url);
  if (!Array.isArray(results) || results.length === 0) {
    throw new ApiError(404, `We couldn't find "${query}". Please check the spelling and try again.`);
  }
  const r = results[0];
  return { lat: r.lat, lon: r.lon, name: r.name, country: r.country || '' };
}

/* Coordinates -> city name (used by "current location") */
async function reverseGeocode(lat, lon) {
  try {
   const url = `${BASE_URL}/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1`;
    const results = await fetchJSON(url);
    if (results.length) return { lat, lon, name: results[0].name, country: results[0].country || '' };
  } catch (err) {
    if (err.status === 401 || err.status === 429 || err.status === 'network') throw err;
  }
  return { lat, lon, name: 'Your Location', country: '' };
}

/* Preferred source: One Call API 3.0 (hourly + 8 daily forecasts) */
async function fetchOneCall(place) {
  const url = `${BASE_URL}/data/3.0/onecall?lat=${place.lat}&lon=${place.lon}&exclude=minutely,alerts&units=metric`;
  const d = await fetchJSON(url);

  return {
    place, source: 'onecall', tz: d.timezone_offset,
    current: {
      dt: d.current.dt, temp: d.current.temp, feels: d.current.feels_like,
      humidity: d.current.humidity, wind: d.current.wind_speed,
      visibility: d.current.visibility, pressure: d.current.pressure,
      main: d.current.weather[0].main, desc: d.current.weather[0].description, icon: d.current.weather[0].icon,
      sunrise: d.current.sunrise, sunset: d.current.sunset
    },
    hourly: d.hourly.slice(1, 25).map((h) => ({
      dt: h.dt, temp: h.temp, icon: h.weather[0].icon, desc: h.weather[0].description, pop: h.pop || 0
    })),
    daily: d.daily.slice(0, 7).map((x) => ({
      dt: x.dt, min: x.temp.min, max: x.temp.max, icon: x.weather[0].icon, desc: x.weather[0].description, pop: x.pop || 0
    }))
  };
}

/* Fallback: free plan (Current Weather + 5-day / 3-hour forecast) */
async function fetchFreeTier(place) {
  const q = `lat=${place.lat}&lon=${place.lon}&units=metric`;
  const [cur, fc] = await Promise.all([
    fetchJSON(`${BASE_URL}/data/2.5/weather?${q}`),
    fetchJSON(`${BASE_URL}/data/2.5/forecast?${q}`)
  ]);
  const tz = cur.timezone;

  // Group the 3-hour entries into days
  const groups = new Map();
  fc.list.forEach((item) => {
    const key = dayKey(item.dt, tz);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const daily = [...groups.values()].slice(0, 7).map((items) => {
    // Use the entry closest to midday for the day's icon
    const noon = items.reduce((best, it) => {
      const hr = localDate(it.dt, tz).getUTCHours();
      const bestHr = localDate(best.dt, tz).getUTCHours();
      return Math.abs(hr - 12) < Math.abs(bestHr - 12) ? it : best;
    });
    return {
      dt: items[0].dt,
      min: Math.min(...items.map((i) => i.main.temp_min)),
      max: Math.max(...items.map((i) => i.main.temp_max)),
      icon: noon.weather[0].icon.replace('n', 'd'),
      desc: noon.weather[0].description,
      pop: Math.max(...items.map((i) => i.pop || 0))
    };
  });

  return {
    place, source: 'free', tz,
    current: {
      dt: cur.dt, temp: cur.main.temp, feels: cur.main.feels_like, humidity: cur.main.humidity,
      wind: cur.wind.speed, visibility: cur.visibility, pressure: cur.main.pressure,
      main: cur.weather[0].main, desc: cur.weather[0].description, icon: cur.weather[0].icon,
      sunrise: cur.sys.sunrise, sunset: cur.sys.sunset
    },
    hourly: fc.list.slice(0, 8).map((h) => ({
      dt: h.dt, temp: h.main.temp, icon: h.weather[0].icon, desc: h.weather[0].description, pop: h.pop || 0
    })),
    daily
  };
}

/* Try One Call 3.0 first; if the key has no access, use the free endpoints */
async function getWeather(place) {
  try {
    return await fetchOneCall(place);
  } catch (err) {
    if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
      return fetchFreeTier(place);
    }
    throw err;
  }
}

/* ---------- 9. Main loading flow ---------- */
function setView(view) {
  el.welcome.hidden = view !== 'welcome';
  el.loader.hidden = view !== 'loading';
  el.dashboard.hidden = view !== 'dashboard';
}

/* `findPlace` is a function that returns {lat, lon, name, country} */
async function loadWeather(findPlace) {
  const id = ++state.requestId;
  hideError();
  setView('loading');

  try {
    const place = await findPlace();
    const data = await getWeather(place);
    if (id !== state.requestId) return;        // a newer request replaced this one

    state.data = data;
    saveLocal('skycast_place', JSON.stringify(place));
    renderAll();
    setView('dashboard');
  } catch (err) {
    if (id !== state.requestId) return;
    showError(err.message || 'Something went wrong. Please try again.');
    setView(state.data ? 'dashboard' : 'welcome');   // keep old data if we have it
  }
}

function searchCity(query) {
  if (!hasApiKey()) return showApiKeyMissing();
  const name = query.trim();
  if (!name) return showError('Please type a city name first.');
  el.input.value = name;
  loadWeather(() => geocodeCity(name));
}

function showApiKeyMissing() {
  showError('API key missing. Open script.js and replace YOUR_API_KEY_HERE with your OpenWeatherMap API key.');
}

/* Current location (browser geolocation) */
function useMyLocation() {
  if (!hasApiKey()) return showApiKeyMissing();
  if (!navigator.geolocation) return showError('Your browser does not support geolocation.');

  hideError();
  setView('loading');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      loadWeather(() => reverseGeocode(latitude, longitude));
    },
    (err) => {
      const messages = {
        1: 'Location permission was denied. Allow location access in your browser, or search for a city instead.',
        2: 'Your location could not be determined. Please search for a city instead.',
        3: 'Finding your location took too long. Please try again.'
      };
      showError(messages[err.code] || 'Unable to get your location.');
      setView(state.data ? 'dashboard' : 'welcome');
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
}

/* ---------- 10. Rendering ---------- */
function renderAll() {
  const d = state.data;
  if (!d) return;
  renderCurrent(d);
  renderDetails(d);
  renderHourly(d);
  renderDaily(d);
  applyTheme(d.current.main, d.current.icon);
  showNotice(d);
}

function renderCurrent(d) {
  const c = d.current;
  $('cityName').textContent = d.place.name;
  $('countryName').textContent = d.place.country;
  $('countryName').hidden = !d.place.country;
  $('dateText').textContent = formatFullDate(c.dt, d.tz);

  const icon = $('currentIcon');
  icon.src = ICON_URL(c.icon, '4x');
  icon.alt = c.desc;

  $('currentTemp').textContent = formatTemp(c.temp);
  $('unitLabel').textContent = state.unit;
  $('conditionMain').textContent = c.main;
  $('conditionDesc').textContent = c.desc;

  const today = d.daily[0];
  $('tempHigh').textContent = today ? formatTemp(Math.max(today.max, c.temp)) : '--';
  $('tempLow').textContent = today ? formatTemp(Math.min(today.min, c.temp)) : '--';
}

function renderDetails(d) {
  const c = d.current;
  $('humidity').textContent = `${c.humidity}%`;
  $('humiditySub').textContent = humidityLabel(c.humidity);
  $('wind').textContent = formatWind(c.wind);
  $('windSub').textContent = windLabel(c.wind);
  $('feels').textContent = formatTemp(c.feels);
  $('feelsSub').textContent = feelsLabel(c.feels, c.temp);
  $('visibility').textContent = formatVisibility(c.visibility);
  $('visibilitySub').textContent = visibilityLabel(c.visibility);
  $('pressure').textContent = `${c.pressure} hPa`;
  $('pressureSub').textContent = pressureLabel(c.pressure);
  $('sunrise').textContent = formatClock(c.sunrise, d.tz);
  $('sunsetSub').textContent = `Sunset ${formatClock(c.sunset, d.tz)}`;
}

function renderHourly(d) {
  el.hourlyHint.textContent = d.source === 'onecall' ? 'Next 24 hours · hourly' : 'Next 24 hours · every 3 hours';
  el.hourList.innerHTML = d.hourly.map((h) => `
    <div class="hour-card">
      <div class="hour-time">${formatHour(h.dt, d.tz)}</div>
      <img src="${ICON_URL(h.icon)}" alt="${esc(h.desc)}" loading="lazy" />
      <div class="hour-temp">${formatTemp(h.temp)}</div>
      <div class="hour-pop">${h.pop > 0.05 ? '💧 ' + Math.round(h.pop * 100) + '%' : ''}</div>
    </div>`).join('');
  el.hourList.scrollLeft = 0;
}

function renderDaily(d) {
  el.dailyTitle.textContent = `${d.daily.length}-Day Forecast`;

  // Week-wide min/max so every temperature bar shares the same scale
  const weekMin = Math.min(...d.daily.map((x) => x.min));
  const weekMax = Math.max(...d.daily.map((x) => x.max));
  const span = weekMax - weekMin || 1;
  const todayKey = dayKey(d.current.dt, d.tz);

  el.dayList.innerHTML = d.daily.map((day) => {
    const date = localDate(day.dt, d.tz);
    const name = dayKey(day.dt, d.tz) === todayKey ? 'Today' : DAYS[date.getUTCDay()].slice(0, 3);
    const left = Math.min(((day.min - weekMin) / span) * 100, 90);
    const width = Math.max(((day.max - day.min) / span) * 100, 10);

    return `
      <div class="day-row">
        <div class="day-name"><strong>${name}</strong><small>${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}</small></div>
        <img src="${ICON_URL(day.icon)}" alt="${esc(day.desc)}" loading="lazy" />
        <div class="day-desc">${esc(day.desc)}</div>
        <div class="day-pop">${day.pop > 0.05 ? '💧 ' + Math.round(day.pop * 100) + '%' : ''}</div>
        <div class="range-wrap">
          <span class="m-min">${formatTemp(day.min)}</span>
          <div class="range"><i style="left:${left}%;width:${Math.min(width, 100 - left)}%"></i></div>
          <span class="m-max">${formatTemp(day.max)}</span>
        </div>
        <div class="day-max">${formatTemp(day.max)}</div>
      </div>`;
  }).join('');

  // The desktop layout shows min on the left of the bar, max on the right
  el.dayList.querySelectorAll('.day-row').forEach((row, i) => {
    const min = document.createElement('div');
    min.className = 'day-min';
    min.textContent = formatTemp(d.daily[i].min);
    row.insertBefore(min, row.querySelector('.range-wrap'));
  });
}

function showNotice(d) {
  if (d.source === 'free') {
    el.noticeText.textContent = 'Your OpenWeatherMap plan does not include One Call 3.0, so hourly data is shown in 3-hour steps and the forecast covers about 5 days instead of 7. Subscribe to One Call 3.0 (it has a free daily allowance) for the full 7-day view.';
    el.notice.hidden = false;
  } else {
    el.notice.hidden = true;
  }
}

/* ---------- 11. Dynamic background & weather effects ---------- */
function getTheme(main, icon) {
  const night = icon && icon.endsWith('n');
  switch (main) {
    case 'Clear': return night ? 'clear-night' : 'clear-day';
    case 'Clouds': return 'clouds';
    case 'Rain':
    case 'Drizzle': return 'rain';
    case 'Thunderstorm': return 'thunderstorm';
    case 'Snow': return 'snow';
    default: return 'mist';   // Mist, Fog, Haze, Smoke, Dust, Sand, Ash, Squall, Tornado
  }
}

function applyTheme(main, icon) {
  const theme = getTheme(main, icon);
  document.body.dataset.weather = theme;
  buildEffects(theme);
}

function buildEffects(theme) {
  el.fx.innerHTML = '';
  el.fx.className = 'fx';

  let count = 0;
  let type = '';
  if (theme === 'rain' || theme === 'thunderstorm') { count = 70; type = 'drop'; }
  else if (theme === 'snow') { count = 45; type = 'flake'; }
  else if (theme === 'clear-night') { count = 50; type = 'star'; }
  if (theme === 'thunderstorm') el.fx.classList.add('storm');

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = type;
    s.style.left = Math.random() * 100 + '%';

    if (type === 'drop') {
      s.style.animationDuration = 0.5 + Math.random() * 0.6 + 's';
      s.style.animationDelay = -Math.random() * 2 + 's';
    } else if (type === 'flake') {
      s.style.animationDuration = 6 + Math.random() * 8 + 's';
      s.style.animationDelay = -Math.random() * 10 + 's';
      s.style.opacity = 0.4 + Math.random() * 0.6;
    } else if (type === 'star') {
      const size = 1 + Math.random() * 2.5;
      s.style.top = Math.random() * 100 + '%';
      s.style.width = s.style.height = size + 'px';
      s.style.animationDuration = 1.5 + Math.random() * 3 + 's';
      s.style.animationDelay = -Math.random() * 3 + 's';
    }
    fragment.appendChild(s);
  }
  el.fx.appendChild(fragment);
}

/* ---------- 12. Celsius / Fahrenheit switch ---------- */
function setUnit(unit) {
  state.unit = unit;
  saveLocal('skycast_unit', unit);

  el.btnC.classList.toggle('active', unit === 'C');
  el.btnF.classList.toggle('active', unit === 'F');
  el.btnC.setAttribute('aria-pressed', unit === 'C');
  el.btnF.setAttribute('aria-pressed', unit === 'F');
  el.unitToggle.classList.toggle('is-f', unit === 'F');

  if (state.data) renderAll();   // no new API call needed, we just convert
}

/* ---------- 13. Event listeners ---------- */

// Search button + Enter key (both trigger the form's submit event)
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  searchCity(el.input.value);
});

// Popular city chips
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => searchCity(chip.dataset.city));
});

// Unit switch
el.btnC.addEventListener('click', () => setUnit('C'));
el.btnF.addEventListener('click', () => setUnit('F'));

// Current location
el.locateBtn.addEventListener('click', useMyLocation);

// Dismiss the error message
el.errorClose.addEventListener('click', hideError);

// Hourly forecast scroll buttons
el.hourPrev.addEventListener('click', () => el.hourList.scrollBy({ left: -320, behavior: 'smooth' }));
el.hourNext.addEventListener('click', () => el.hourList.scrollBy({ left: 320, behavior: 'smooth' }));

// Mobile menu
function setMenu(open) {
  el.navLinks.classList.toggle('open', open);
  el.menuBtn.setAttribute('aria-expanded', open);
}
el.menuBtn.addEventListener('click', () => setMenu(!el.navLinks.classList.contains('open')));
el.navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

/* ---------- 14. Start the app ---------- */
function init() {
  setUnit(loadLocal('skycast_unit') === 'F' ? 'F' : 'C');
  setView('welcome');

  if (!hasApiKey()) {
    showApiKeyMissing();
    return;
  }

  // Re-open the last city the visitor viewed
  const saved = loadLocal('skycast_place');
  if (saved) {
    try {
      const place = JSON.parse(saved);
      if (place && typeof place.lat === 'number' && typeof place.lon === 'number') {
        el.input.value = place.name;
        loadWeather(async () => place);
      }
    } catch (e) { /* ignore corrupted data */ }
  }
}

init();