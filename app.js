const DATA_CANDIDATES = [
  './data/CulRelPro_China_1961-2019.kml',
  './data/CulRelPro_China_1961-2019.geojson',
  './data/CulRelPro_China_1961-2019.json',
];

const map = L.map('map', { preferCanvas: true }).setView([35.8617, 104.1954], 4);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap &copy; CARTO',
}).addTo(map);

const markerCluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  chunkedLoading: true,
  chunkProgress: updateClusterProgress,
});

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

const state = {
  items: [],
  filtered: [],
  lookup: new Map(),
  clusters: new Map(),
  bounds: null,
  selectedId: null,
};

const els = {
  searchInput: document.getElementById('searchInput'),
  batchFilter: document.getElementById('batchFilter'),
  provinceFilter: document.getElementById('provinceFilter'),
  typeFilter: document.getElementById('typeFilter'),
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
  els.mapHint.textContent = `正在绘制 ${processed}/${total} 个点位…`;
  if (processed >= total) {
    els.mapHint.textContent = `已完成绘制，共 ${state.items.length} 个点位。`;
  }
}

function safeText(value) {
  return value == null ? '' : String(value).trim();
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
    <div style="min-width:240px;max-width:320px">
      <div style="font-size:16px;font-weight:800;margin-bottom:8px">${escapeHtml(item.name)}</div>
      <div style="font-size:12px;color:#9fb3c9;line-height:1.7">
        <div><strong>批次：</strong>${escapeHtml(item.batch || '未识别')}</div>
        <div><strong>类型：</strong>${escapeHtml(item.type || '未识别')}</div>
        <div><strong>省份/地区：</strong>${escapeHtml(item.province || '未识别')}</div>
        <div><strong>城市：</strong>${escapeHtml(item.city || '未识别')}</div>
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
  const name = safeText(parseXmlText(placemark, 'name')) || pickField(dict, ['name', '名称', 'title', '项目名称']) || `未命名点位 ${index + 1}`;
  const description = decodeHtmlEntities(parseXmlText(placemark, 'description')) || pickField(dict, ['description', '简介', '说明', '备注', '概述']);
  const batch = pickField(dict, ['批次', 'batch', 'year', '年份', '公布年份', '入选批次']);
  const type = pickField(dict, ['类型', 'type', 'category', '类别', '文物类型']);
  const province = pickField(dict, ['省份', 'province', '省', '行政区', '所在地', '行政区划']);
  const city = pickField(dict, ['城市', 'city', '市', '地区', '县市']);
  const era = pickField(dict, ['年代', '时代', '朝代', '时期']);

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
  if (!geometry) {
    const coords = pickField(dict, ['coordinates', '坐标']);
    if (coords) {
      const first = coords.trim().split(/\s+/)[0];
      const [lng, lat] = first.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        geometry = { type: 'Point', coordinates: [lng, lat] };
      }
    }
  }

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
    id: `${index}-${name}`,
    index,
    name,
    description,
    batch,
    type,
    province,
    city,
    era,
    raw,
    geometry,
    center,
    popupHtml: createPopupHtml({ name, batch, type, province, city }),
  };

  item.searchBlob = normalizeKey([
    item.name,
    item.batch,
    item.type,
    item.province,
    item.city,
    item.era,
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
    const geometry = feature.geometry || null;
    let center = null;
    if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
      center = [geometry.coordinates[1], geometry.coordinates[0]];
    } else if (geometry?.coordinates) {
      center = computeCenterFromGeometry(geometry);
    }
    const item = {
      id: props.id || `${index}-${props.name || 'feature'}`,
      index,
      name: props.name || props.title || props.名称 || `未命名点位 ${index + 1}`,
      description: props.description || props.desc || props.简介 || '',
      batch: props.batch || props.批次 || props.year || props.年份 || '',
      type: props.type || props.类型 || props.category || '',
      province: props.province || props.省份 || props.省 || '',
      city: props.city || props.城市 || props.市 || '',
      era: props.era || props.年代 || props.朝代 || '',
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

function setStatus(message) {
  els.mapHint.textContent = message;
}

function updateStats() {
  const items = state.items;
  const filtered = state.filtered;
  const batches = new Set(items.map((item) => item.batch).filter(Boolean));
  const provinces = new Set(items.map((item) => item.province).filter(Boolean));

  els.statCount.textContent = String(items.length);
  els.statBatches.textContent = String(batches.size);
  els.statProvinces.textContent = String(provinces.size);
  els.statFiltered.textContent = String(filtered.length);
  els.resultCount.textContent = String(filtered.length);
}

function optionsForField(items, field) {
  return Array.from(new Set(items.map((item) => safeText(item[field])).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function fillFilterOptions() {
  const batchOptions = optionsForField(state.items, 'batch');
  const provinceOptions = optionsForField(state.items, 'province');
  const typeOptions = optionsForField(state.items, 'type');

  const fill = (select, options) => {
    const current = select.value || 'all';
    select.innerHTML = '<option value="all">全部</option>' + options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
    if (options.includes(current)) select.value = current;
    else select.value = 'all';
  };

  fill(els.batchFilter, batchOptions);
  fill(els.provinceFilter, provinceOptions);
  fill(els.typeFilter, typeOptions);
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
    ? rows.map(([label, count]) => `
      <div class="bar-row">
        <div class="bar-row__label">${escapeHtml(label)}</div>
        <div class="bar-row__track"><div class="bar-row__fill" style="width:${Math.max(6, (count / max) * 100)}%"></div></div>
        <div class="bar-row__count">${count}</div>
      </div>
    `).join('')
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
        ${item.batch ? `<span class="pill">批次 ${escapeHtml(item.batch)}</span>` : ''}
        ${item.type ? `<span class="pill">${escapeHtml(item.type)}</span>` : ''}
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
      <div><strong>批次：</strong>${escapeHtml(item.batch || '未识别')}</div>
      <div><strong>类型：</strong>${escapeHtml(item.type || '未识别')}</div>
      <div><strong>省份/地区：</strong>${escapeHtml(item.province || '未识别')}</div>
      <div><strong>城市：</strong>${escapeHtml(item.city || '未识别')}</div>
      <div><strong>年代：</strong>${escapeHtml(item.era || '未识别')}</div>
      <div><strong>坐标：</strong>${escapeHtml(coords)}</div>
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
  const batch = els.batchFilter.value;
  const province = els.provinceFilter.value;
  const type = els.typeFilter.value;

  state.filtered = state.items.filter((item) => {
    if (batch !== 'all' && item.batch !== batch) return false;
    if (province !== 'all' && item.province !== province) return false;
    if (type !== 'all' && item.type !== type) return false;
    if (query && !item.searchBlob.includes(query)) return false;
    return true;
  });

  clearLayers();
  state.clusters.clear();
  const geoFeatures = [];
  state.filtered.forEach((item) => {
    if (!item.center || !item.geometry) return;
    const latlng = item.center;
    const marker = L.circleMarker(latlng, {
      radius: 5,
      weight: 1.2,
      color: '#dafdf0',
      fillColor: '#77d9b7',
      fillOpacity: 0.95,
    });
    marker.bindPopup(item.popupHtml, { closeButton: true, maxWidth: 340 });
    marker.on('click', () => selectRecord(item.id));
    state.clusters.set(item.id, marker);
    markerCluster.addLayer(marker);

    if (item.geometry.type === 'Point') {
      geoFeatures.push({
        type: 'Feature',
        geometry: item.geometry,
        properties: { id: item.id, popupHtml: item.popupHtml },
      });
    } else {
      geoFeatures.push({
        type: 'Feature',
        geometry: item.geometry,
        properties: { id: item.id, popupHtml: item.popupHtml },
      });
    }
  });
  geoLayer.addData({ type: 'FeatureCollection', features: geoFeatures });

  renderList();
  buildBatchBars();
  updateStats();

  if (state.filtered.length) {
    const bounds = L.latLngBounds(state.filtered.map((item) => item.center).filter(Boolean));
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.1), { animate: true });
    const first = state.filtered[0];
    renderDetail(first);
    state.selectedId = first.id;
  } else {
    renderDetail(null);
    state.selectedId = null;
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
  fillFilterOptions();
  state.filtered = [...state.items];
  updateStats();
  renderList();
  buildBatchBars();
  applyFilters();
  setStatus(message || `已加载 ${items.length} 条记录。`);
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

els.searchInput.addEventListener('input', applyFilters);
els.batchFilter.addEventListener('change', applyFilters);
els.provinceFilter.addEventListener('change', applyFilters);
els.typeFilter.addEventListener('change', applyFilters);
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
  els.batchFilter.value = 'all';
  els.provinceFilter.value = 'all';
  els.typeFilter.value = 'all';
  applyFilters();
  map.setView([35.8617, 104.1954], 4);
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
  } catch (error) {
    console.error(error);
    setStatus('自动加载失败，请手动导入文件。');
  }
})();
