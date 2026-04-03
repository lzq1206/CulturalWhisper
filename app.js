const DATA_CANDIDATES = [
  './data/CulRelPro_China_1961-2019.kml',
  './data/CulRelPro_China_1961-2019.kmz.kml',
  './data/CulRelPro_China_1961-2019.geojson',
  './data/CulRelPro_China_1961-2019.json',
];

const DYNASTY_BUCKETS = [
  '新石器时代',
  '夏朝',
  '商朝',
  '西周',
  '东周',
  '秦朝',
  '西汉',
  '东汉',
  '三国（魏、蜀、吴）',
  '西晋',
  '东晋 与 十六国',
  '南北朝',
  '隋朝',
  '唐朝',
  '五代十国',
  '北宋',
  '辽',
  '金',
  '南宋',
  '元朝',
  '明朝',
  '清朝',
  '中华民国（1912年 - 1949年）',
  '新中国：1949年10月1日至今',
];

const map = L.map('map', { preferCanvas: true, zoomControl: false }).setView([35.8617, 104.1954], 4);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
  subdomains: '1234',
  maxZoom: 19,
  attribution: '&copy; 高德地图',
}).addTo(map);

const markerCluster = L.layerGroup();
const pointRenderer = L.canvas({ padding: 0.5 });

const geoLayer = L.geoJSON(null, {
  style: {
    color: '#77d9b7',
    weight: 2,
    opacity: 0.85,
    fillColor: '#77d9b7',
    fillOpacity: 0.18,
  },
  pointToLayer(feature, latlng) {
    return L.circleMarker(latlng, {
      radius: 5,
      weight: 1.5,
      color: '#d9fff1',
      fillColor: '#77d9b7',
      fillOpacity: 0.9,
    });
  },
  onEachFeature(feature, layer) {
    const props = feature.properties || {};
    layer.on('click', () => selectRecord(props.id));
    if (props.popupHtml) layer.bindPopup(props.popupHtml);
  },
});

map.addLayer(markerCluster);
map.addLayer(geoLayer);
map.on('moveend zoomend resize', scheduleVisibleRender);
map.on('locationfound', (e) => {
  state.locationWatchId = 'watching';
  const { latlng, accuracy } = e;
  if (!state.locationMarker) {
    state.locationMarker = L.circleMarker(latlng, {
      radius: 6,
      color: '#60a5fa',
      weight: 2,
      fillColor: '#60a5fa',
      fillOpacity: 1,
      pane: 'markerPane',
    }).addTo(map);
    state.locationCircle = L.circle(latlng, {
      radius: Math.max(accuracy || 0, 20),
      color: '#60a5fa',
      weight: 1,
      fillColor: '#60a5fa',
      fillOpacity: 0.08,
      pane: 'overlayPane',
    }).addTo(map);
  } else {
    state.locationMarker.setLatLng(latlng);
    state.locationCircle.setLatLng(latlng).setRadius(Math.max(accuracy || 0, 20));
  }
  hideStatus();
});
map.on('locationerror', (e) => {
  state.locationWatchId = null;
  updateLocationButton(false);
  showStatus(`定位失败：${e.message}`);
});

const state = {
  items: [],
  filtered: [],
  lookup: new Map(),
  clusters: new Map(),
  batchColors: new Map(),
  renderPending: false,
  visibleCount: 0,
  locationWatchId: null,
  locationMarker: null,
  locationCircle: null,
  bounds: null,
  selectedId: null,
};

const els = {
  searchInput: document.getElementById('searchInput'),
  batchFilter: document.getElementById('batchFilter'),
  provinceFilter: document.getElementById('provinceFilter'),
  typeFilter: document.getElementById('typeFilter'),
  eraFilter: document.getElementById('eraFilter'),
  locationBtn: document.getElementById('locationBtn'),
  batchLegend: document.getElementById('batchLegend'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  sidebar: document.getElementById('sidebar'),
  fileInput: document.getElementById('fileInput'),
  resetViewBtn: document.getElementById('resetViewBtn'),
  mapHint: document.getElementById('mapHint'),
  resultList: document.getElementById('resultList'),
  resultCount: document.getElementById('resultCount'),
  detailCard: document.getElementById('detailCard'),
  statCount: document.getElementById('statCount'),
  statBatches: document.getElementById('statBatches'),
  statProvinces: document.getElementById('statProvinces'),
  statFiltered: document.getElementById('statFiltered'),
  batchBars: document.getElementById('batchBars'),
};

function updateClusterProgress(processed, total, elapsed) {
  if (!total) return;
  showStatus(`正在绘制 ${processed}/${total} 个点位…`);
  if (processed >= total) {
    showStatus(`已完成绘制，共 ${state.items.length} 个点位。`);
  }
}

function showStatus(message) {
  if (!els.mapHint) return;
  els.mapHint.classList.remove('is-hidden');
  els.mapHint.textContent = message;
}

function hideStatus() {
  if (!els.mapHint) return;
  els.mapHint.classList.add('is-hidden');
  els.mapHint.textContent = '';
}

function mountSidebar() {
  if (!els.sidebar) return;
  const targets = [
    document.querySelector('header.hero'),
    document.querySelector('section.toolbar'),
    document.querySelector('aside.side'),
    document.querySelector('footer.footer'),
  ].filter(Boolean);
  targets.forEach((node) => {
    if (node.parentElement !== els.sidebar) els.sidebar.appendChild(node);
  });
}

function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  window.setTimeout(() => map.invalidateSize(), 240);
}

function safeText(value) {
  return value == null ? '' : String(value).trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((x) => x + x).join('') : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
}

function mixHex(left, right, t) {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return rgbToHex({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
}

function batchRank(label) {
  const text = safeText(label);
  const arabic = text.match(/(\d+)/);
  if (arabic) return Number(arabic[1]);
  const chinese = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8,
    '九': 9, '十': 10,
  };
  const hit = text.match(/第?([一二三四五六七八九十]+)批/);
  if (!hit) return Number.POSITIVE_INFINITY;
  const chars = hit[1];
  if (chars.length === 1) return chinese[chars] ?? Number.POSITIVE_INFINITY;
  if (chars === '十') return 10;
  if (chars.length === 2 && chars.startsWith('十')) return 10 + (chinese[chars[1]] || 0);
  if (chars.length === 2 && chars.endsWith('十')) return (chinese[chars[0]] || 0) * 10;
  return chinese[chars] ?? Number.POSITIVE_INFINITY;
}

function batchColorFromRank(rank, total) {
  const start = '#ff4d4f';
  const end = '#3b82f6';
  if (!Number.isFinite(rank) || !Number.isFinite(total) || total <= 1) return mixHex(start, end, 0.45);
  const t = clamp((rank - 1) / Math.max(1, total - 1), 0, 1);
  return mixHex(start, end, t);
}

function classifyDynasty(rawText) {
  const text = safeText(rawText);
  if (!text) return '未标注';

  const keywordRules = [
    ['新石器时代', [/新石器时代/, /新石器/, /史前/]],
    ['夏朝', [/\b夏朝\b/, /夏代/, /夏\b/]],
    ['商朝', [/\b商朝\b/, /商代/, /殷商/, /商\b/]],
    ['西周', [/西周/, /周初/, /周代/, /西周时期/]],
    ['东周', [/东周/, /春秋/, /战国/, /周末/]],
    ['秦朝', [/秦朝/, /秦代/, /秦\b/]],
    ['西汉', [/西汉/, /汉初/, /汉代早期/]],
    ['东汉', [/东汉/, /汉末?/, /汉代中后期/]],
    ['三国（魏、蜀、吴）', [/三国/, /魏蜀吴/, /魏晋南北朝前期/, /魏\b/, /蜀\b/, /吴\b/]],
    ['西晋', [/西晋/, /晋初/, /晋代前期/]],
    ['东晋 与 十六国', [/东晋/, /十六国/, /东晋十六国/]],
    ['南北朝', [/南北朝/, /南朝/, /北朝/]],
    ['隋朝', [/隋朝/, /隋代/, /隋\b/]],
    ['唐朝', [/唐朝/, /唐代/, /唐\b/]],
    ['五代十国', [/五代十国/, /五代/, /十国/]],
    ['北宋', [/北宋/, /宋初/, /北宋时期/]],
    ['辽', [/辽朝/, /辽代/, /契丹/, /辽\b/]],
    ['金', [/金朝/, /金代/, /女真/, /金\b/]],
    ['南宋', [/南宋/, /宋末?/, /南宋时期/]],
    ['元朝', [/元朝/, /元代/, /元\b/]],
    ['明朝', [/明朝/, /明代/, /明\b/]],
    ['清朝', [/清朝/, /清代/, /清\b/]],
    ['中华民国（1912年 - 1949年）', [/中华民国/, /民国/, /民國/]],
    ['新中国：1949年10月1日至今', [/新中国/, /中华人民共和国/, /中华人民共和国时期/, /共和国/]],
  ];

  for (const [bucket, rules] of keywordRules) {
    if (rules.some((rule) => rule.test(text))) return bucket;
  }

  const rangeYears = [];
  const explicitRanges = [
    /(?:公元前|前)?\s*(\d{1,4})\s*(?:年)?\s*[—\-－至~～到]\s*(?:公元前|前)?\s*(\d{1,4})\s*(?:年)?/g,
    /(?:公元前|前)?\s*(\d{1,2})\s*世纪\s*[—\-－至~～到]\s*(?:公元前|前)?\s*(\d{1,2})\s*世纪/g,
  ];

  for (const pattern of explicitRanges) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (pattern.source.includes('世纪')) {
        const y1 = a * 100 - 50;
        const y2 = b * 100 - 50;
        rangeYears.push((y1 + y2) / 2);
      } else {
        rangeYears.push((a + b) / 2);
      }
    }
  }
  if (rangeYears.length) {
    return dynastyFromYear(Math.min(...rangeYears));
  }

  const years = [];
  const singleYearPattern = /(?:公元前|前)?\s*(\d{1,4})\s*年/g;
  let yearMatch;
  while ((yearMatch = singleYearPattern.exec(text)) !== null) {
    const num = Number(yearMatch[1]);
    if (!Number.isFinite(num)) continue;
    const isBce = /(?:公元前|前)\s*\d{1,4}\s*年/.test(yearMatch[0]);
    years.push(isBce ? -num : num);
  }

  const centuryPattern = /(?:公元前|前)?\s*(\d{1,2})\s*世纪/g;
  let centuryMatch;
  while ((centuryMatch = centuryPattern.exec(text)) !== null) {
    const century = Number(centuryMatch[1]);
    if (!Number.isFinite(century)) continue;
    const isBce = /(?:公元前|前)\s*\d{1,2}\s*世纪/.test(centuryMatch[0]);
    const approx = century * 100 - 50;
    years.push(isBce ? -approx : approx);
  }

  if (!years.length) return '未标注';
  return dynastyFromYear(Math.min(...years));
}

function dynastyFromYear(year) {
  if (!Number.isFinite(year)) return '未标注';
  if (year < -2070) return '新石器时代';
  if (year < -1600) return '夏朝';
  if (year < -1046) return '商朝';
  if (year < -771) return '西周';
  if (year < -221) return '东周';
  if (year < -206) return '秦朝';
  if (year <= 8) return '西汉';
  if (year <= 220) return '东汉';
  if (year <= 280) return '三国（魏、蜀、吴）';
  if (year <= 316) return '西晋';
  if (year <= 420) return '东晋 与 十六国';
  if (year <= 589) return '南北朝';
  if (year <= 618) return '隋朝';
  if (year <= 907) return '唐朝';
  if (year <= 979) return '五代十国';
  if (year <= 1127) return '北宋';
  if (year <= 1234) return '金';
  if (year <= 1279) return '南宋';
  if (year <= 1368) return '元朝';
  if (year <= 1644) return '明朝';
  if (year <= 1911) return '清朝';
  if (year <= 1949) return '中华民国（1912年 - 1949年）';
  return '新中国：1949年10月1日至今';
}

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

function projectCoords(coords) {
  if (!Array.isArray(coords)) return coords;
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [lng, lat] = wgs84ToGcj02(Number(coords[0]), Number(coords[1]));
    return coords.length > 2 ? [lng, lat, coords[2]] : [lng, lat];
  }
  return coords.map(projectCoords);
}

function projectGeometry(geometry) {
  if (!geometry || !geometry.coordinates) return geometry;
  return {
    ...geometry,
    coordinates: projectCoords(geometry.coordinates),
  };
}

function categoryGlyph(category) {
  const key = safeText(category);
  const map = {
    '古遗址': '址',
    '古建筑': '建',
    '古墓葬': '墓',
    '石窟寺及石刻': '石',
    '近现代重要史迹及代表性建筑': '今',
    '其他': '其',
  };
  return map[key] || key.slice(0, 1) || '•';
}

function categoryHint(category) {
  const key = safeText(category);
  const map = {
    '古遗址': '遗址',
    '古建筑': '建筑',
    '古墓葬': '墓葬',
    '石窟寺及石刻': '石窟/石刻',
    '近现代重要史迹及代表性建筑': '近现代',
    '其他': '其他',
  };
  return map[key] || key || '未分类';
}

function categoryShape(category) {
  const key = safeText(category);
  const map = {
    '古遗址': 'circle',
    '古建筑': 'square',
    '古墓葬': 'diamond',
    '石窟寺及石刻': 'triangle',
    '近现代重要史迹及代表性建筑': 'hexagon',
    '其他': 'circle',
  };
  return map[key] || 'circle';
}

function shouldShowLabels() {
  return map.getZoom() >= 10;
}

function createMarkerIcon(item, showLabel = shouldShowLabels()) {
  const color = state.batchColors.get(item.batch) || '#77d9b7';
  const shape = categoryShape(item.category);
  const label = showLabel ? escapeHtml(item.name) : '';
  return L.divIcon({
    className: 'heritage-marker',
    html: `
      <div class="heritage-marker__wrap heritage-marker__wrap--${shape}" style="--marker-color:${color}">
        <span class="heritage-marker__dot heritage-marker__dot--${shape}"></span>
        ${showLabel ? `<span class="heritage-marker__label">${label}</span>` : ''}
      </div>
    `,
    iconSize: showLabel ? [170, 22] : [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  });
}

function shapeLatLngs(center, shape, pxRadius) {
  const p = map.latLngToLayerPoint(center);
  const step = Math.max(1, pxRadius || 4);
  const pts = [];
  const push = (dx, dy) => pts.push(map.layerPointToLatLng(L.point(p.x + dx, p.y + dy)));
  if (shape === 'square') {
    push(-step, -step); push(step, -step); push(step, step); push(-step, step);
  } else if (shape === 'diamond') {
    push(0, -step); push(step, 0); push(0, step); push(-step, 0);
  } else if (shape === 'triangle') {
    push(0, -step); push(step, step); push(-step, step);
  } else if (shape === 'hexagon') {
    push(-step, 0); push(-step * 0.5, -step); push(step * 0.5, -step); push(step, 0); push(step * 0.5, step); push(-step * 0.5, step);
  } else {
    return null;
  }
  return pts;
}

function createCanvasShapeLayer(item) {
  const color = state.batchColors.get(item.batch) || '#77d9b7';
  const shape = categoryShape(item.category);
  const latlngs = shapeLatLngs(item.center, shape, map.getZoom() >= 8 ? 5 : 3);
  if (!latlngs) {
    return L.circleMarker(item.center, {
      renderer: pointRenderer,
      radius: map.getZoom() >= 8 ? 3.5 : 2.2,
      weight: 0,
      fillColor: color,
      fillOpacity: 0.95,
      color,
    });
  }
  return L.polygon(latlngs, {
    renderer: pointRenderer,
    weight: 0,
    color,
    fillColor: color,
    fillOpacity: 0.95,
  });
}

function scheduleVisibleRender() {
  if (state.renderPending) return;
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    renderVisibleMarkers();
  });
}

function renderVisibleMarkers() {
  clearLayers();
  state.clusters.clear();
  const visibleBounds = map.getBounds ? map.getBounds().pad(0.2) : null;
  const showLabel = shouldShowLabels();
  const geoFeatures = [];
  const visibleItems = [];

  state.filtered.forEach((item) => {
    if (!item.center || !item.geometry) return;
    if (visibleBounds && !visibleBounds.contains(item.center)) return;
    visibleItems.push(item);
    if (item.geometry.type !== 'Point') {
      geoFeatures.push({
        type: 'Feature',
        geometry: item.geometry,
        properties: { id: item.id, popupHtml: item.popupHtml },
      });
    }
  });

  const visibleCount = visibleItems.length;
  const useDom = showLabel && visibleCount <= 500;

  visibleItems.forEach((item) => {
    const layer = useDom
      ? L.marker(item.center, { icon: createMarkerIcon(item, true), riseOnHover: true })
      : createCanvasShapeLayer(item);

    layer.bindPopup(item.popupHtml, { closeButton: true, maxWidth: 340 });
    layer.on('click', () => selectRecord(item.id));
    state.clusters.set(item.id, layer);
    markerCluster.addLayer(layer);
  });

  geoLayer.addData({ type: 'FeatureCollection', features: geoFeatures });
  state.visibleCount = visibleCount;
}

function escapeHtml(text) {
  return safeText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeKey(text) {
  return safeText(text).toLowerCase();
}

function firstMatch(obj, keys) {
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
  }
  return '';
}

function decodeHtmlEntities(text) {
  const div = document.createElement('div');
  div.innerHTML = text;
  return div.textContent || div.innerText || '';
}

function parseXmlText(node, selector) {
  const el = node.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function parseExtendedData(placemark) {
  const out = {};
  const datas = placemark.querySelectorAll('ExtendedData Data, ExtendedData SimpleData');
  datas.forEach((data) => {
    const name = data.getAttribute('name') || data.getAttribute('field') || data.getAttribute('id') || data.tagName;
    const value = data.querySelector('value') ? data.querySelector('value').textContent : data.textContent;
    if (!name) return;
    out[name.trim()] = safeText(value).trim();
  });

  const dict = {};
  for (const [key, value] of Object.entries(out)) {
    dict[key.toLowerCase()] = value;
    dict[key.replace(/\s+/g, '')] = value;
  }
  return { raw: out, dict };
}

function pickField(dict, candidates) {
  const lower = {};
  Object.entries(dict).forEach(([k, v]) => {
    lower[k.toLowerCase()] = v;
    lower[k.toLowerCase().replace(/\s+/g, '')] = v;
  });
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (lower[key] != null && String(lower[key]).trim() !== '') return lower[key];
    const normalized = key.replace(/\s+/g, '');
    if (lower[normalized] != null && String(lower[normalized]).trim() !== '') return lower[normalized];
    for (const [existing, value] of Object.entries(lower)) {
      if (existing.includes(key) || key.includes(existing)) {
        if (String(value).trim() !== '') return value;
      }
    }
  }
  return '';
}

function centroidFromCoords(coords) {
  const flat = coords.flat(10).filter((x) => Array.isArray(x) && x.length >= 2);
  if (!flat.length) return null;
  let lat = 0;
  let lng = 0;
  flat.forEach((pair) => {
    lng += Number(pair[0]);
    lat += Number(pair[1]);
  });
  return [lat / flat.length, lng / flat.length];
}

function geometryToGeoJSON(geometryNode) {
  if (!geometryNode) return null;
  const type = geometryNode.tagName;
  if (type === 'Point') {
    const coords = parseXmlText(geometryNode, 'coordinates');
    const [lng, lat] = coords.split(',').map((v) => Number(v.trim()));
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { type: 'Point', coordinates: [lng, lat] };
    }
  }
  if (type === 'LineString') {
    const coords = parseXmlText(geometryNode, 'coordinates')
      .split(/\s+/)
      .map((pair) => pair.split(',').slice(0, 2).map(Number))
      .filter((pair) => pair.length >= 2 && pair.every(Number.isFinite));
    if (coords.length) return { type: 'LineString', coordinates: coords };
  }
  if (type === 'Polygon') {
    const rings = [];
    geometryNode.querySelectorAll('outerBoundaryIs LinearRing, innerBoundaryIs LinearRing').forEach((ring) => {
      const coords = parseXmlText(ring, 'coordinates')
        .split(/\s+/)
        .map((pair) => pair.split(',').slice(0, 2).map(Number))
        .filter((pair) => pair.length >= 2 && pair.every(Number.isFinite));
      if (coords.length) rings.push(coords);
    });
    if (rings.length) return { type: 'Polygon', coordinates: rings };
  }
  return null;
}

function createPopupHtml(item) {
  return `
    <div style="min-width:260px;max-width:340px">
      <div style="font-size:16px;font-weight:800;margin-bottom:8px">${escapeHtml(item.name)}</div>
      <div style="font-size:12px;color:#9fb3c9;line-height:1.7">
        <div><strong>批次：</strong>${escapeHtml(item.batch || '未识别')}</div>
        <div><strong>类别：</strong>${escapeHtml(item.type || '未识别')}</div>
        <div><strong>归类朝代：</strong>${escapeHtml(item.dynasty || '未识别')}</div>
        <div><strong>原始时代：</strong>${escapeHtml(item.era || '未识别')}</div>
        <div><strong>省份/地区：</strong>${escapeHtml(item.province || '未识别')}</div>
        <div><strong>城市：</strong>${escapeHtml(item.city || '未识别')}</div>
        <div><strong>编号：</strong>${escapeHtml(item.code || '未识别')}</div>
      </div>
    </div>
  `;
}

function summarizeDescription(item) {
  const parts = [];
  if (item.description) parts.push(item.description);
  if (item.extraNotes) parts.push(item.extraNotes);
  if (!parts.length) return '暂无详细说明。可在 KML 的 description 或 ExtendedData 中补充简介。';
  return parts.join('\n\n');
}

function parsePlacemark(placemark, index) {
  const { raw, dict } = parseExtendedData(placemark);
  const name =
    pickField(dict, ['NameCN', 'namecn', 'Name', 'name', '名称', '项目名称', 'title']) ||
    safeText(parseXmlText(placemark, 'name')) ||
    `未命名点位 ${index + 1}`;

  const nameEn = pickField(dict, ['NameEN', 'nameen', '英文名称']);
  const description =
    decodeHtmlEntities(parseXmlText(placemark, 'description')) ||
    pickField(dict, ['DescCN', 'desc', 'description', '简介', '说明', '备注', '概述']);
  const batch = pickField(dict, ['PackCN', 'packcn', '批次', 'batch', 'year', '年份', '公布年份', '入选批次']);
  const batchEn = pickField(dict, ['PackEN', 'packen']);
  const category = pickField(dict, ['TCN', 'tcn', '类别', 'type', 'category', '文物类型']);
  const categoryEn = pickField(dict, ['TEN', 'ten']);
  const era = pickField(dict, ['PCN', 'pcn', '时代', '年代', '朝代', '时期']);
  const dynasty = classifyDynasty(era);
  const eraEn = pickField(dict, ['PEN', 'pen']);
  const province = pickField(dict, ['PADCN', 'padcn', '省份', 'province', '省', '行政区', '所在地', '行政区划']);
  const provinceEn = pickField(dict, ['PADEN', 'paden']);
  const city = pickField(dict, ['MADCN', 'madcn', '城市', 'city', '市', '地区', '县市', '地级市']);
  const cityEn = pickField(dict, ['MADEN', 'maden']);
  const county = pickField(dict, ['CADCN', 'cadcn', '区县', 'county', '县', '辖区']);
  const countyEn = pickField(dict, ['CADEN', 'caden']);
  const code = pickField(dict, ['Cnum', 'cnum', '编号', '文物编号', '序号']);
  const num = pickField(dict, ['Num', 'num']);
  const lat = pickField(dict, ['LAT84', 'lat84', 'lat', 'latitude']);
  const lon = pickField(dict, ['LON84', 'lon84', 'lon', 'longitude']);
  const cite = pickField(dict, ['CiteCN', 'citecn', '引用']);

  const geometries = [];
  placemark.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && ['Point', 'LineString', 'Polygon', 'MultiGeometry'].includes(node.tagName)) {
      if (node.tagName === 'MultiGeometry') {
        node.childNodes.forEach((child) => {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const geom = geometryToGeoJSON(child);
            if (geom) geometries.push(geom);
          }
        });
      } else {
        const geom = geometryToGeoJSON(node);
        if (geom) geometries.push(geom);
      }
    }
  });

  let geometry = geometries[0] || null;
  if (!geometry && lat && lon) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
      geometry = { type: 'Point', coordinates: [lonNum, latNum] };
    }
  }
  if (!geometry) {
    const coords = pickField(dict, ['coordinates', '坐标']);
    if (coords) {
      const first = coords.trim().split(/\s+/)[0];
      const [lng, lat2] = first.split(',').map(Number);
      if (Number.isFinite(lat2) && Number.isFinite(lng)) {
        geometry = { type: 'Point', coordinates: [lng, lat2] };
      }
    }
  }

  geometry = projectGeometry(geometry);

  let center = null;
  if (geometry) {
    if (geometry.type === 'Point') {
      center = [geometry.coordinates[1], geometry.coordinates[0]];
    } else if (geometry.type === 'LineString') {
      const c = centroidFromCoords([geometry.coordinates]);
      if (c) center = c;
    } else if (geometry.type === 'Polygon') {
      const c = centroidFromCoords(geometry.coordinates);
      if (c) center = c;
    }
  }

  const item = {
    id: `${index}-${code || name}`,
    index,
    name,
    nameEn,
    description,
    batch,
    batchEn,
    category,
    type: category,
    categoryEn,
    era,
    dynasty,
    eraEn,
    province,
    provinceEn,
    city,
    cityEn,
    county,
    countyEn,
    code,
    num,
    lat,
    lon,
    cite,
    raw,
    geometry,
    center,
    popupHtml: createPopupHtml({ name, batch, type: category, province, city, era, code }),
  };

  item.searchBlob = normalizeKey([
    item.name,
    item.nameEn,
    item.batch,
    item.batchEn,
    item.category,
    item.type,
    item.categoryEn,
    item.era,
    item.dynasty,
    item.eraEn,
    item.province,
    item.provinceEn,
    item.city,
    item.cityEn,
    item.county,
    item.countyEn,
    item.code,
    item.num,
    item.description,
    JSON.stringify(item.raw),
  ].join(' '));

  return item;
}

function loadFromXmlText(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) {
    throw new Error('KML/XML 解析失败，请确认文件格式正确。');
  }

  const placemarks = Array.from(xml.querySelectorAll('Placemark'));
  if (!placemarks.length) {
    throw new Error('未找到 Placemark 节点。文件可能不是有效的 KML。');
  }

  const items = placemarks.map((placemark, index) => parsePlacemark(placemark, index)).filter((item) => item.center || item.geometry);
  return items;
}

function loadFromGeoJSON(json) {
  const features = Array.isArray(json.features) ? json.features : [];
  return features.map((feature, index) => {
    const props = feature.properties || {};
    const geometry = projectGeometry(feature.geometry || null);
    let center = null;
    if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
      center = [geometry.coordinates[1], geometry.coordinates[0]];
    } else if (geometry?.coordinates) {
      center = computeCenterFromGeometry(geometry);
    }
    const category = props.category || props.type || props.类型 || props.TCN || props.tcn || '';
    const era = props.era || props.年代 || props.PCN || props.pcn || props.朝代 || '';
    const dynasty = classifyDynasty(era);
    const item = {
      id: props.id || `${index}-${props.name || 'feature'}`,
      index,
      name: props.name || props.title || props.名称 || `未命名点位 ${index + 1}`,
      description: props.description || props.desc || props.简介 || '',
      batch: props.batch || props.批次 || props.PackCN || props.packcn || props.year || props.年份 || '',
      category,
      type: category,
      province: props.province || props.省份 || props.PADCN || props.省 || '',
      city: props.city || props.城市 || props.MADCN || props.市 || '',
      era,
      dynasty,
      raw: props,
      geometry,
      center,
    };
    item.searchBlob = normalizeKey([
      item.name,
      item.batch,
      item.type,
      item.province,
      item.city,
      item.era,
      item.dynasty,
      item.description,
      JSON.stringify(item.raw),
    ].join(' '));
    item.popupHtml = createPopupHtml(item);
    return item;
  }).filter((item) => item.center || item.geometry);
}

function computeCenterFromGeometry(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const coords = geometry.coordinates;
  const pairs = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      pairs.push([value[0], value[1]]);
      return;
    }
    value.forEach(walk);
  };
  walk(coords);
  if (!pairs.length) return null;
  let lat = 0;
  let lng = 0;
  pairs.forEach(([x, y]) => {
    lng += Number(x);
    lat += Number(y);
  });
  return [lat / pairs.length, lng / pairs.length];
}

function clearLayers() {
  markerCluster.clearLayers();
  geoLayer.clearLayers();
}

function buildLookup(items) {
  state.lookup.clear();
  items.forEach((item) => state.lookup.set(item.id, item));
}

function buildBatchColors(items) {
  const labels = Array.from(new Set(items.map((item) => item.batch).filter(Boolean)));
  const sorted = labels.sort((a, b) => batchRank(a) - batchRank(b) || a.localeCompare(b, 'zh-Hans-CN'));
  const total = sorted.length;
  state.batchColors = new Map(sorted.map((label, index) => [label, batchColorFromRank(index + 1, total)]));
}

function defaultSelectedOptions(options) {
  return new Set(options);
}

function renderBatchLegend() {
  const labels = Array.from(state.batchColors.keys());
  const counts = new Map();
  state.items.forEach((item) => {
    const key = item.batch || '未标注';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  els.batchLegend.innerHTML = labels.length
    ? labels.map((label) => {
        const color = state.batchColors.get(label) || '#77d9b7';
        const count = counts.get(label) || 0;
        return `
          <div class="legend-item">
            <span class="legend-item__swatch" style="background:${color}"></span>
            <span class="legend-item__label">${escapeHtml(label)}</span>
            <span class="legend-item__count">${count}</span>
          </div>
        `;
      }).join('')
    : '<div class="panel-text">暂无批次数据。</div>';
}

function setStatus(message) {
  if (!message) {
    hideStatus();
    return;
  }
  showStatus(message);
}

function updateLocationButton(active) {
  if (!els.locationBtn) return;
  els.locationBtn.textContent = active ? '停止定位' : '实时定位';
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    showStatus('当前浏览器不支持定位。');
    return;
  }
  if (state.locationWatchId != null) return;
  state.locationWatchId = 'pending';
  updateLocationButton(true);
  showStatus('正在获取实时定位…');
  map.locate({ watch: true, setView: false, enableHighAccuracy: true, maxZoom: 16 });
}

function stopLocationWatch() {
  map.stopLocate();
  state.locationWatchId = null;
  if (state.locationMarker) {
    map.removeLayer(state.locationMarker);
    state.locationMarker = null;
  }
  if (state.locationCircle) {
    map.removeLayer(state.locationCircle);
    state.locationCircle = null;
  }
  updateLocationButton(false);
  hideStatus();
}

function updateStats() {
  const items = state.items;
  const filtered = state.filtered;
  const batches = new Set(items.map((item) => item.batch).filter(Boolean));
  const provinces = new Set(items.map((item) => item.province).filter(Boolean));
  const categories = new Set(items.map((item) => item.category).filter(Boolean));

  els.statCount.textContent = String(items.length);
  els.statBatches.textContent = String(batches.size);
  els.statProvinces.textContent = String(provinces.size);
  els.statFiltered.textContent = String(filtered.length);
  els.resultCount.textContent = String(filtered.length);
  els.mapHint.dataset.categoryCount = String(categories.size);
}

function optionsForField(items, field) {
  return Array.from(new Set(items.map((item) => safeText(item[field])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function readMultiSelectValues(select) {
  return Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean);
}

function setMultiSelectValues(select, values) {
  const set = new Set(values);
  Array.from(select.options).forEach((option) => {
    option.selected = set.has(option.value);
  });
}

function fillFilterOptions() {
  const batchOptions = optionsForField(state.items, 'batch').sort((a, b) => batchRank(a) - batchRank(b) || a.localeCompare(b, 'zh-Hans-CN'));
  const provinceOptions = optionsForField(state.items, 'province');
  const typeOptions = optionsForField(state.items, 'category');
  const eraOptions = DYNASTY_BUCKETS;

  const fill = (select, options) => {
    const current = readMultiSelectValues(select);
    select.innerHTML = options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
    if (current.length) setMultiSelectValues(select, current.filter((x) => options.includes(x)));
    else setMultiSelectValues(select, options);
  };

  fill(els.batchFilter, batchOptions);
  fill(els.provinceFilter, provinceOptions);
  fill(els.typeFilter, typeOptions);
  fill(els.eraFilter, eraOptions);
}

function buildBatchBars() {
  const counts = new Map();
  state.filtered.forEach((item) => {
    const key = item.batch || '未标注';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
    .slice(0, 8);
  const max = rows[0]?.[1] || 1;
  els.batchBars.innerHTML = rows.length
    ? rows.map(([label, count]) => {
        const color = state.batchColors.get(label) || '#77d9b7';
        return `
          <div class="bar-row">
            <div class="bar-row__label">
              <span class="bar-row__swatch" style="background:${color}"></span>
              <span>${escapeHtml(label)}</span>
            </div>
            <div class="bar-row__track"><div class="bar-row__fill" style="width:${Math.max(6, (count / max) * 100)}%;background:${color}"></div></div>
            <div class="bar-row__count">${count}</div>
          </div>
        `;
      }).join('')
    : '<div class="panel-text">暂无批次统计。</div>';
}

function renderList() {
  els.resultList.innerHTML = '';
  if (!state.filtered.length) {
    els.resultList.innerHTML = '<div class="panel-text">没有符合条件的点位。</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  state.filtered.slice(0, 500).forEach((item) => {
    const node = document.createElement('article');
    node.className = 'list-item';
    node.dataset.id = item.id;
    node.innerHTML = `
      <div class="list-item__title">${escapeHtml(item.name)}</div>
      <div class="list-item__meta">
        ${item.batch ? `<span class="pill">${escapeHtml(item.batch)}</span>` : ''}
        ${item.dynasty ? `<span class="pill pill--accent">${escapeHtml(item.dynasty)}</span>` : ''}
        ${item.province ? `<span class="pill">${escapeHtml(item.province)}</span>` : ''}
        ${item.city ? `<span class="pill">${escapeHtml(item.city)}</span>` : ''}
      </div>
    `;
    node.addEventListener('click', () => selectRecord(item.id, true));
    frag.appendChild(node);
  });
  els.resultList.appendChild(frag);
}

function renderDetail(item) {
  if (!item) {
    els.detailCard.innerHTML = '<div class="detail__empty">点击左侧结果或地图点位查看详情</div>';
    return;
  }

  const coords = item.center ? `${item.center[0].toFixed(5)}, ${item.center[1].toFixed(5)}` : '未识别';
  els.detailCard.innerHTML = `
    <div class="detail__title">${escapeHtml(item.name)}</div>
    <div class="detail__meta">
      <div><strong>英文名称：</strong>${escapeHtml(item.nameEn || '未识别')}</div>
      <div><strong>批次：</strong>${escapeHtml(item.batch || '未识别')} ${item.batchEn ? `(${escapeHtml(item.batchEn)})` : ''}</div>
      <div><strong>类别：</strong>${escapeHtml(item.type || '未识别')} ${item.categoryEn ? `(${escapeHtml(item.categoryEn)})` : ''}</div>
      <div><strong>归类朝代：</strong>${escapeHtml(item.dynasty || '未识别')}</div>
      <div><strong>原始时代：</strong>${escapeHtml(item.era || '未识别')} ${item.eraEn ? `(${escapeHtml(item.eraEn)})` : ''}</div>
      <div><strong>省份/地区：</strong>${escapeHtml(item.province || '未识别')} ${item.provinceEn ? `(${escapeHtml(item.provinceEn)})` : ''}</div>
      <div><strong>城市：</strong>${escapeHtml(item.city || '未识别')} ${item.cityEn ? `(${escapeHtml(item.cityEn)})` : ''}</div>
      <div><strong>区县：</strong>${escapeHtml(item.county || '未识别')} ${item.countyEn ? `(${escapeHtml(item.countyEn)})` : ''}</div>
      <div><strong>编号：</strong>${escapeHtml(item.code || '未识别')} ${item.num ? `#${escapeHtml(item.num)}` : ''}</div>
      <div><strong>坐标：</strong>${escapeHtml(coords)}</div>
      ${item.cite ? `<div><strong>引用：</strong>${escapeHtml(item.cite)}</div>` : ''}
    </div>
    <div class="detail__desc">${escapeHtml(summarizeDescription(item))}</div>
  `;
}

function flyToItem(item) {
  if (!item?.center) return;
  map.flyTo(item.center, 10, { duration: 0.9 });
}

function highlightOnMap(item) {
  if (!item?.center) return;
  const layer = state.clusters.get(item.id);
  if (layer && layer.openPopup) layer.openPopup();
}

function selectRecord(id, fromList = false) {
  const item = state.lookup.get(id);
  if (!item) return;
  state.selectedId = id;
  renderDetail(item);
  if (fromList) flyToItem(item);
  highlightOnMap(item);
}

function applyFilters() {
  const query = normalizeKey(els.searchInput.value);
  const batchValues = new Set(readMultiSelectValues(els.batchFilter));
  const provinceValues = new Set(readMultiSelectValues(els.provinceFilter));
  const typeValues = new Set(readMultiSelectValues(els.typeFilter));
  const eraValues = new Set(readMultiSelectValues(els.eraFilter));

  state.filtered = state.items.filter((item) => {
    if (batchValues.size && !batchValues.has(item.batch)) return false;
    if (provinceValues.size && !provinceValues.has(item.province)) return false;
    if (typeValues.size && !typeValues.has(item.category)) return false;
    if (eraValues.size && !eraValues.has(item.dynasty)) return false;
    if (query && !item.searchBlob.includes(query)) return false;
    return true;
  });

  renderList();
  buildBatchBars();
  updateStats();
  scheduleVisibleRender();

  if (state.selectedId) {
    const selected = state.lookup.get(state.selectedId);
    if (selected && state.filtered.some((item) => item.id === selected.id)) {
      renderDetail(selected);
    } else {
      state.selectedId = null;
      renderDetail(null);
    }
  } else {
    renderDetail(null);
  }
}

async function loadDataFromUrl(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`加载失败：${res.status} ${res.statusText}`);
  const text = await res.text();
  if (/\.kml($|\?)/i.test(url) || text.includes('<kml')) {
    return loadFromXmlText(text);
  }
  const json = JSON.parse(text);
  return loadFromGeoJSON(json);
}

async function tryAutoLoad() {
  for (const url of DATA_CANDIDATES) {
    try {
      setStatus(`正在加载 ${url} …`);
      const items = await loadDataFromUrl(url);
      if (items.length) {
        await ingestItems(items, `已加载 ${url}`);
        return true;
      }
    } catch (error) {
      console.warn(error);
    }
  }
  setStatus('未找到本地数据文件。请把 KML 放到 data/ 目录，或点击“导入文件”。');
  return false;
}

async function ingestItems(items, message) {
  state.items = items;
  buildLookup(state.items);
  buildBatchColors(state.items);
  fillFilterOptions();
  renderBatchLegend();
  state.filtered = [...state.items];
  applyFilters();
  hideStatus();
}

async function handleFile(file) {
  const text = await file.text();
  let items = [];
  if (/\.geojson$|\.json$/i.test(file.name) || text.trim().startsWith('{')) {
    items = loadFromGeoJSON(JSON.parse(text));
  } else {
    items = loadFromXmlText(text);
  }
  await ingestItems(items, `已从 ${file.name} 导入 ${items.length} 条记录。`);
}

mountSidebar();
updateLocationButton(false);

els.searchInput.addEventListener('input', applyFilters);
els.batchFilter.addEventListener('change', applyFilters);
els.provinceFilter.addEventListener('change', applyFilters);
els.typeFilter.addEventListener('change', applyFilters);
els.eraFilter.addEventListener('change', applyFilters);
els.locationBtn.addEventListener('click', () => {
  if (state.locationWatchId != null) stopLocationWatch();
  else startLocationWatch();
});
els.sidebarToggle.addEventListener('click', () => setSidebarOpen(!document.body.classList.contains('sidebar-open')));
els.sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));
els.fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await handleFile(file);
  } catch (error) {
    alert(error.message || String(error));
  }
});
els.resetViewBtn.addEventListener('click', () => {
  els.searchInput.value = '';
  fillFilterOptions();
  setMultiSelectValues(els.batchFilter, Array.from(els.batchFilter.options).map((option) => option.value));
  setMultiSelectValues(els.provinceFilter, Array.from(els.provinceFilter.options).map((option) => option.value));
  setMultiSelectValues(els.typeFilter, Array.from(els.typeFilter.options).map((option) => option.value));
  setMultiSelectValues(els.eraFilter, Array.from(els.eraFilter.options).map((option) => option.value));
  applyFilters();
  map.setView([35.8617, 104.1954], 4);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSidebarOpen(false);
});

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  setStatus('松开即可导入文件。');
});
window.addEventListener('dragleave', (event) => {
  if (event.clientX === 0 && event.clientY === 0) return;
  if (!state.items.length) setStatus('未找到本地数据文件。请把 KML 放到 data/ 目录，或点击“导入文件”。');
});
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  try {
    await handleFile(file);
  } catch (error) {
    alert(error.message || String(error));
  }
});

(async function bootstrap() {
  try {
    await tryAutoLoad();
    if (navigator.permissions?.query) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'granted') startLocationWatch();
      } catch (_) {
        // ignore
      }
    }
  } catch (error) {
    console.error(error);
    setStatus('自动加载失败，请手动导入文件。');
  }
})();
