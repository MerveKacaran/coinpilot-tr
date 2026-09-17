const byId = id => document.getElementById(id);
const moneyFormat = new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', maximumFractionDigits: 4,
});
const positionKey = 'coinpilot-pro-positions';
const historyKey = 'coinpilot-pro-history';
const state = {
  prices: {},
  gainers: [],
  losers: [],
  signals: [],
  marketAnalysis: null,
  selected: null,
  positions: JSON.parse(localStorage.getItem(positionKey) || '[]'),
  history: JSON.parse(localStorage.getItem(historyKey) || '[]'),
};

function money(value) {
  return moneyFormat.format(Number(value || 0));
}

function percent(value) {
  const number = Number(value || 0);
  return (number >= 0 ? '+' : '') + number.toFixed(2) + '%';
}

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, handler) {
  const node = create('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function signalKind(signal) {
  if (signal.action === 'SAT') return 'sell';
  if (signal.action.includes('AL')) return 'buy';
  return 'wait';
}

function currentPrice(position) {
  return Number(state.prices[position.coin.symbol] || position.entry);
}

function savePortfolio() {
  localStorage.setItem(positionKey, JSON.stringify(state.positions));
  localStorage.setItem(historyKey, JSON.stringify(state.history));
}

function setLive(online, text) {
  const dot = byId('live-dot');
  dot.classList.toggle('online', online);
  byId('live-status').textContent = text;
}

function renderDashboard() {
  let cost = 0;
  let value = 0;
  state.positions.forEach(position => {
    cost += Number(position.amount);
    value += position.quantity * currentPrice(position);
  });
  const gain = value - cost;
  byId('portfolio-value').textContent = money(value);
  byId('portfolio-profit').textContent = money(gain);
  byId('portfolio-profit').className = gain >= 0 ? 'positive' : 'negative';
  byId('portfolio-percent').textContent = percent(cost ? gain / cost * 100 : 0);
  byId('portfolio-percent').className = gain >= 0 ? 'positive' : 'negative';
  byId('position-count').textContent = String(state.positions.length);
  byId('setup-count').textContent = String(
    state.signals.filter(signal => signal.all_frames_passed).length,
  );
  renderPositions();
  renderCompactRadar();
  renderMarket();
}

function renderPositions() {
  const targets = [
    byId('home-positions'),
    byId('radar-positions'),
    byId('position-page-list'),
  ];
  targets.forEach(target => {
    target.replaceChildren();
    if (!state.positions.length) {
      target.append(create('div', 'panel empty', 'Henüz açık sanal işlem yok. Radar sayfasından uygun bir sinyali değerlendirebilirsin.'));
      return;
    }
    state.positions.forEach(position => target.append(positionCard(position)));
  });
  const history = byId('history');
  history.replaceChildren();
  if (!state.history.length) {
    const row = create('tr');
    const cell = create('td', '', 'Henüz işlem geçmişi yok.');
    cell.colSpan = 5;
    row.append(cell);
    history.append(row);
    return;
  }
  state.history.forEach(item => {
    const row = create('tr');
    [item.date, item.coin, money(item.entry), money(item.exit), percent(item.percent)]
      .forEach((text, index) => {
        const cell = create('td', index === 4 ? (item.percent >= 0 ? 'positive' : 'negative') : '', text);
        row.append(cell);
      });
    history.append(row);
  });
}

function positionCard(position) {
  const now = currentPrice(position);
  const currentValue = position.quantity * now;
  const result = (currentValue - position.amount) / position.amount * 100;
  const span = position.target - position.entry;
  const progress = span > 0 ? Math.max(0, Math.min(100, (now - position.entry) / span * 100)) : 0;
  const card = create('article', 'position');
  const top = create('div', 'position-top');
  const left = create('div');
  left.append(create('h3', '', position.coin.symbol));
  left.append(create('small', '', 'Giriş ' + money(position.entry) + ' · Güncel ' + money(now)));
  top.append(left);
  top.append(create('b', result >= 0 ? 'positive' : 'negative', percent(result)));
  card.append(top);
  card.append(create('b', 'value ' + (result >= 0 ? 'positive' : 'negative'), money(currentValue)));
  const extended = position.extendedTarget
    ? ' · Uzatılmış hedef: ' + money(position.extendedTarget)
    : '';
  card.append(create('div', 'levels', 'İlk satış hedefi: ' + money(position.target) + extended + ' · Stop: ' + money(position.stop)));
  const bar = create('div', 'bar');
  const fill = create('i');
  fill.style.width = progress.toFixed(0) + '%';
  bar.append(fill);
  card.append(bar);
  card.append(create('small', '', 'Hedefe ilerleme: %' + progress.toFixed(0)));
  card.append(button('SAT', 'sell', () => closePosition(position.id)));
  return card;
}

function renderCompactRadar() {
  const box = byId('home-radar');
  box.replaceChildren();
  if (!state.signals.length) {
    box.append(create('div', 'panel empty', 'Teknik tarama hazırlanıyor…'));
    return;
  }
  state.signals.slice(0, 3).forEach(signal => {
    const card = create('article', 'panel compact-signal');
    card.append(create('b', '', signal.coin.symbol));
    const summary = create('div');
    summary.append(create('span', '', signal.action));
    summary.append(create('strong', signalKind(signal), String(signal.score) + '/100'));
    card.append(summary);
    card.addEventListener('click', () => showDetail(signal));
    box.append(card);
  });
}

function renderMarket() {
  renderMarketList(byId('gainers'), state.gainers);
  renderMarketList(byId('losers'), state.losers);
  const symbols = byId('market-symbols');
  symbols.replaceChildren();
  Object.keys(state.prices).sort().forEach(symbol => {
    const option = document.createElement('option');
    option.value = symbol;
    symbols.append(option);
  });
  renderMarketAnalysis();
}

function renderMarketList(target, coins) {
  target.replaceChildren();
  coins.forEach(coin => {
    const row = create('div', 'market-row clickable');
    row.append(create('b', '', coin.symbol));
    row.append(create('span', '', coin.formatted_price));
    row.append(create('strong', coin.change >= 0 ? 'positive' : 'negative', percent(coin.change)));
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', coin.symbol + ' teknik analizini aç');
    row.addEventListener('click', () => analyzeMarketSymbol(coin.symbol));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') analyzeMarketSymbol(coin.symbol);
    });
    target.append(row);
  });
}

function normalizeMarketSymbol(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s_\/-]/g, '');
  if (!compact || !compact.endsWith('TRY') || compact.length <= 3) return null;
  return compact.slice(0, -3) + '/TRY';
}

function renderMarketAnalysis() {
  const target = byId('market-analysis');
  target.replaceChildren();
  if (!state.marketAnalysis) return;
  target.append(signalCard(state.marketAnalysis));
}

async function analyzeMarketSymbol(value) {
  const symbol = normalizeMarketSymbol(value);
  const input = byId('market-search-input');
  const message = byId('market-search-message');
  const action = byId('market-search-button');
  if (!symbol) {
    message.textContent = 'Bir BtcTurk TRY paritesi yaz: örneğin WIF/TRY.';
    return;
  }
  input.value = symbol;
  if (!state.prices[symbol]) {
    message.textContent = symbol + ' BtcTurk TRY listesinde bulunamadı.';
    return;
  }
  action.disabled = true;
  state.marketAnalysis = null;
  byId('market-analysis').replaceChildren(create('div', 'panel empty', symbol + ' için Günlük, 4 Saat, 1 Saat ve 15 Dakika analizi hazırlanıyor…'));
  message.textContent = 'Canlı mum verisi ve risk hesabı alınıyor…';
  try {
    const response = await fetch('/api/analyze?symbol=' + encodeURIComponent(symbol));
    const data = await response.json();
    if (!response.ok || data.status !== 'success') throw new Error(data.message || 'analysis');
    state.marketAnalysis = data.item;
    message.textContent = symbol + ' analizi güncellendi: ' + new Date(data.updated_at).toLocaleTimeString('tr-TR');
    renderMarketAnalysis();
  } catch (error) {
    const detail = error && error.message && error.message !== 'analysis' ? error.message : 'Analiz şu an hazırlanamadı. Yeniden dene.';
    message.textContent = detail;
    byId('market-analysis').replaceChildren();
  } finally {
    action.disabled = false;
  }
}

function renderRadar() {
  const grid = byId('radar-grid');
  grid.replaceChildren();
  if (!state.signals.length) {
    grid.append(create('div', 'panel empty', 'Tarama sonucu hazırlanıyor. Bu ilk tarama biraz sürebilir.'));
    return;
  }
  state.signals.forEach(signal => grid.append(signalCard(signal)));
}

function frameSummary(frame) {
  const rsi = frame.rsi_cross_up
    ? '50 seviyesini alttan yukarı kesti'
    : frame.rsi_rising
      ? '50 üstünde yukarı ivmeli'
      : 'ivme teyidi bekliyor';
  const macdLevel = frame.macd_above_zero
    ? 'sıfır üstü'
    : frame.macd_near_zero
      ? 'sıfıra yakın'
      : 'sıfır altında';
  const macd = frame.macd_cross_up
    ? 'mavi kırmızıyı yukarı kesti'
    : frame.macd_bullish
      ? 'mavi kırmızının üstünde, yukarı ivmeli'
      : frame.macd_cross_down
        ? 'aşağı kesişim'
        : 'mavi/kırmızı teyidi bekliyor';
  const fisherLevel = frame.fisher >= 0
    ? 'sıfır üstü'
    : frame.fisher_near_zero
      ? 'sıfıra yakın'
      : 'sıfır altında';
  const fisher = frame.fisher_cross_up
    ? 'mavi kırmızıyı yukarı kesti'
    : frame.fisher_bullish
      ? 'mavi kırmızının üstünde, yukarı ivmeli'
      : 'mavi/kırmızı teyidi bekliyor';
  return [
    'RSI(10) ' + Number(frame.rsi).toFixed(1) + ' · ' + rsi + (frame.rsi_condition ? ' ✓' : ' ✕'),
    'Fisher(30) ' + Number(frame.fisher).toFixed(2) + ' · ' + fisherLevel + ' · ' + fisher + (frame.fisher_condition ? ' ✓' : ' ✕'),
    'MACD ' + macdLevel + ' · ' + macd + (frame.macd_condition ? ' ✓' : ' ✕'),
    'EMA200 ' + (frame.above_ema200 ? 'üstünde' : 'altında') + (frame.ema_cross_up ? ' · yeni yukarı geçti' : '') + (frame.above_ema200 ? ' ✓' : ' ✕'),
    'Hacim x' + Number(frame.volume_ratio).toFixed(2) + (frame.above_average_volume ? ' ✓' : ' ✕'),
  ].join('\n');
}

function signalCard(signal) {
  const kind = signalKind(signal);
  const card = create('article', 'signal');
  const header = create('div', 'signal-header');
  const title = create('div');
  title.append(create('h3', '', signal.coin.symbol));
  title.append(create('div', 'price', money(signal.coin.price) + ' · ' + percent(signal.coin.change)));
  header.append(title);
  header.append(create('span', 'badge ' + kind, signal.action + ' · ' + signal.score + '/100'));
  card.append(header);

  const content = create('div', 'signal-content');
  const radar = document.createElement('canvas');
  radar.className = 'radar-canvas';
  content.append(radar);
  const checks = create('div', 'frame-list');
  const frameList = [
    ['Günlük', signal.frames.daily],
    ['4 Saat', signal.frames.four_hour],
    ['1 Saat', signal.frames.one_hour],
    ['15 Dakika', signal.frames.fifteen_minute],
  ];
  frameList.forEach(item => {
    const frame = create('div', 'frame clickable ' + (item[1].core_pass ? 'ok' : ''));
    frame.append(create('b', '', item[0]));
    frame.append(create('span', 'tag', item[1].checks_passed + '/5 ' + (item[1].core_pass ? 'UYGUN · DETAY' : 'BEKLE · DETAY')));
    frame.tabIndex = 0;
    frame.setAttribute('role', 'button');
    frame.setAttribute('aria-label', item[0] + ' koşul detayını aç');
    frame.addEventListener('click', () => showFrameDetail(signal, item[0], item[1]));
    frame.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') showFrameDetail(signal, item[0], item[1]);
    });
    checks.append(frame);
  });
  const note = create('div', 'fib-note ' + (signal.in_fib_zone ? 'good' : ''));
  const fibText = signal.in_fib_zone
    ? 'Fib 0.618–0.786 geri çekilme bölgesinde · İlk satış: ' + money(signal.target)
    : 'Fib 0.618–0.786 retest bölgesi: ' + money(signal.fib['786']) + ' – ' + money(signal.fib['618']);
  const maxStop = Number(signal.max_stop_pct || 8);
  note.textContent = fibText + (signal.risk_ok ? '' : ' · Stop %' + Number(signal.stop_pct).toFixed(1) + ', izin verilen %' + maxStop.toFixed(0) + ' sınırını aşıyor');
  checks.append(note);
  content.append(checks);
  card.append(content);
  const line = document.createElement('canvas');
  line.className = 'line-canvas';
  card.append(line);

  const metrics = create('div', 'signal-metrics');
  [
    ['Puan', signal.score + '/100'],
    ['İlk satış', percent(signal.target_pct)],
    ['Stop', '-' + Number(signal.stop_pct).toFixed(1) + '%'],
    ['1s hacim', 'x' + Number(signal.frames.one_hour.volume_ratio).toFixed(2)],
  ]
    .forEach(item => {
      const metric = create('div');
      metric.append(create('span', '', item[0]));
      metric.append(create('b', '', item[1]));
      metrics.append(metric);
    });
  card.append(metrics);
  const actions = create('div', 'signal-actions');
  actions.append(button('GRAFİK & DETAY', 'detail', () => showDetail(signal)));
  const tradeText = signal.sell_setup ? 'SAT UYARISI' : signal.risk_ok ? 'İŞLEM AÇ' : 'RİSK FAZLA';
  const trade = button(tradeText, '', () => openTrade(signal));
  trade.disabled = !signal.can_open_trade;
  actions.append(trade);
  card.append(actions);

  requestAnimationFrame(() => {
    drawRadar(radar, signal.radar, signalColor(kind));
    drawLine(line, signal.chart, signalColor(kind));
  });
  return card;
}

function showDetail(signal) {
  const dialog = byId('detail-dialog');
  const box = byId('detail-content');
  box.replaceChildren();
  const heading = create('div');
  heading.append(create('small', '', 'DETAYLI TEKNİK ANALİZ'));
  heading.append(create('h2', '', signal.coin.symbol + ' · ' + signal.action));
  heading.append(create('p', 'muted', '1 saatlik grafik ve dört zaman dilimi kontrolü'));
  box.append(heading);
  const chart = document.createElement('canvas');
  chart.className = 'detail-chart';
  box.append(chart);
  const frames = create('div', 'detail-grid');
  [
    ['Günlük', signal.frames.daily],
    ['4 Saat', signal.frames.four_hour],
    ['1 Saat', signal.frames.one_hour],
    ['15 Dakika · giriş zamanlaması', signal.frames.fifteen_minute],
  ]
    .forEach(item => frames.append(detailFrame(item[0], item[1])));
  box.append(frames);
  const levels = create('div', 'detail-levels');
  [
    ['Fib 0.618', money(signal.fib['618'])],
    ['Fib 0.786', money(signal.fib['786'])],
    ['Destek', money(signal.fib.support)],
    ['Direnç', money(signal.fib.resistance)],
    ['İlk satış hedefi', money(signal.target)],
    ['Fib 1.272 uzatılmış hedef', money(signal.extended_target)],
    ['Koruyucu stop', money(signal.stop)],
  ].forEach(item => {
    const level = create('div');
    level.append(create('small', '', item[0]));
    level.append(create('b', '', item[1]));
    levels.append(level);
  });
  box.append(levels);
  const rule = create('p', 'muted', 'Kontrol listesi: EMA200 üstü · RSI(10) 50 üstü ve yukarı ivmeli · MACD sıfır üstü/sıfıra yakın ve mavi çizgi kırmızının üstünde · Fisher(30) sıfır üstü/sıfıra yakın ve mavi çizgi kırmızının üstünde · son kapanan mumda ortalama üstü hacim. SAT kuralı: Fisher(30) sıfır altına iner ve MACD aşağı keser. Stop mesafesi %8’i geçerse işlem açma kapatılır.');
  box.append(rule);
  const open = button(signal.sell_setup ? 'SAT UYARISI AKTİF' : signal.risk_ok ? 'SANAL İŞLEM AÇ' : 'RİSK FAZLA · İŞLEM AÇILAMAZ', 'wide', () => {
    dialog.close();
    openTrade(signal);
  });
  open.disabled = !signal.can_open_trade;
  box.append(open);
  dialog.showModal();
  requestAnimationFrame(() => drawLine(chart, signal.chart, signalColor(signalKind(signal)), true));
}

function detailFrame(name, frame) {
  const card = create('div', 'detail-frame');
  card.append(create('b', frame.core_pass ? 'positive' : 'negative', name + ' · ' + frame.checks_passed + '/5 ' + (frame.core_pass ? 'UYGUN' : 'BEKLE')));
  card.append(create('p', '', frameSummary(frame) + '\nRetest ' + (frame.retest ? 'var' : 'bekliyor')));
  return card;
}

function showFrameDetail(signal, name, frame) {
  const dialog = byId('detail-dialog');
  const box = byId('detail-content');
  box.replaceChildren();
  box.append(create('small', '', 'ZAMAN DİLİMİ KONTROLÜ'));
  box.append(create('h2', '', signal.coin.symbol + ' · ' + name));
  box.append(create('p', 'muted', 'Karttaki ' + frame.checks_passed + '/5 alanına tıkladın. Her kural aşağıda tek tek açıklanır.'));
  box.append(detailFrame(name, frame));
  box.append(create('p', 'muted', '✓ = koşul sağlandı · ✕ = bu zaman diliminde teyit bekleniyor. 15 dakika, yalnızca giriş zamanlamasını güçlendirir; ana trend için Günlük, 4 Saat ve 1 Saat birlikte değerlendirilir.'));
  dialog.showModal();
}

function openTrade(signal) {
  if (!signal.can_open_trade) return;
  state.selected = signal;
  byId('trade-title').textContent = signal.coin.symbol + ' · Sanal İşlem Aç';
  byId('trade-entry').textContent = 'Anlık giriş: ' + money(signal.coin.price);
  byId('trade-target').textContent = money(signal.target) + ' (' + percent(signal.target_pct) + ')';
  byId('trade-stop').textContent = money(signal.stop) + ' (-' + Number(signal.stop_pct).toFixed(1) + '%)';
  byId('trade-amount').value = '';
  byId('trade-dialog').showModal();
}

function closePosition(id) {
  const index = state.positions.findIndex(position => position.id === id);
  if (index < 0) return;
  const position = state.positions[index];
  const exit = currentPrice(position);
  const result = (exit - position.entry) / position.entry * 100;
  state.history.unshift({
    date: new Date().toLocaleString('tr-TR'),
    coin: position.coin.symbol,
    entry: position.entry,
    exit: exit,
    percent: result,
  });
  state.positions.splice(index, 1);
  savePortfolio();
  renderDashboard();
}

function signalColor(kind) {
  return kind === 'buy' ? '#1fd49a' : kind === 'sell' ? '#ff6478' : '#ffc857';
}

function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  return { context: context, width: rect.width, height: rect.height };
}

function drawRadar(canvas, values, color) {
  const view = fitCanvas(canvas);
  const context = view.context;
  const centerX = view.width / 2;
  const centerY = view.height / 2;
  const radius = Math.min(view.width, view.height) * .39;
  const point = (index, amount) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / values.length;
    return [centerX + Math.cos(angle) * radius * amount, centerY + Math.sin(angle) * radius * amount];
  };
  context.strokeStyle = '#314866';
  context.lineWidth = 1;
  [.33, .66, 1].forEach(amount => {
    context.beginPath();
    values.forEach((value, index) => {
      const p = point(index, amount);
      if (index === 0) context.moveTo(p[0], p[1]); else context.lineTo(p[0], p[1]);
    });
    context.closePath();
    context.stroke();
  });
  context.beginPath();
  values.forEach((value, index) => {
    const p = point(index, value);
    if (index === 0) context.moveTo(p[0], p[1]); else context.lineTo(p[0], p[1]);
  });
  context.closePath();
  context.fillStyle = color + '3d';
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
}

function drawLine(canvas, values, color, detailed) {
  const view = fitCanvas(canvas);
  const context = view.context;
  if (!values || values.length < 2) return;
  const data = values.length > 90 ? values.slice(-90) : values;
  const low = Math.min.apply(null, data);
  const high = Math.max.apply(null, data);
  const range = Math.max(high - low, Math.abs(high) * .002);
  context.strokeStyle = '#263a55';
  context.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const y = view.height * index / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(view.width, y);
    context.stroke();
  }
  const point = index => [
    view.width * index / (data.length - 1),
    view.height - ((data[index] - low) / range * (view.height - 7)) - 3,
  ];
  context.beginPath();
  data.forEach((value, index) => {
    const p = point(index);
    if (index === 0) context.moveTo(p[0], p[1]); else context.lineTo(p[0], p[1]);
  });
  context.strokeStyle = color;
  context.lineWidth = detailed ? 2.2 : 1.8;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
  const last = point(data.length - 1);
  context.fillStyle = color;
  context.beginPath();
  context.arc(last[0], last[1], detailed ? 4 : 2.7, 0, Math.PI * 2);
  context.fill();
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(node => node.classList.toggle('active', node.id === 'page-' + page));
  document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  const labels = {
    home: ['ANA SAYFA', 'Bugün ne yapmalıyım?'],
    radar: ['TEKNİK RADAR', 'Kurallı işlem adayları'],
    positions: ['SANAL PORTFÖY', 'Pozisyonlarım'],
    market: ['PİYASA HAREKETİ', 'Piyasa görünümü'],
  };
  byId('page-label').textContent = labels[page][0];
  byId('title').textContent = labels[page][1];
  byId('sidebar').classList.remove('open');
  if (page === 'radar' && !state.signals.length) loadRadar(false);
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/dashboard');
    const data = await response.json();
    if (data.status !== 'success') throw new Error('dashboard');
    state.prices = data.prices || {};
    state.gainers = data.gainers || [];
    state.losers = data.losers || [];
    setLive(Boolean(data.live), data.live ? 'Canlı BtcTurk verisi' : 'BtcTurk REST verisi');
    renderDashboard();
  } catch (_) {
    setLive(false, 'Bağlantı yok');
  }
}

async function loadRadar(force) {
  const grid = byId('radar-grid');
  if (!state.signals.length) {
    grid.replaceChildren(create('div', 'panel empty', 'Çoklu zaman dilimli tarama yapılıyor…'));
  }
  byId('scan-button').disabled = true;
  try {
    const response = await fetch('/api/radar' + (force ? '?force=1' : ''));
    const data = await response.json();
    state.signals = data.items || [];
    byId('radar-time').textContent = new Date(data.updated_at).toLocaleTimeString('tr-TR');
    renderRadar();
    renderDashboard();
  } catch (_) {
    grid.replaceChildren(create('div', 'panel empty', 'Radar verisi şu an hazırlanamadı. Yeniden dene.'));
  } finally {
    byId('scan-button').disabled = false;
  }
}

document.querySelectorAll('.nav').forEach(node => node.addEventListener('click', () => switchPage(node.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(node => node.addEventListener('click', () => switchPage(node.dataset.goto)));
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => byId(node.dataset.close).close()));
byId('menu-toggle').addEventListener('click', () => byId('sidebar').classList.toggle('open'));
byId('scan-button').addEventListener('click', () => loadRadar(true));
byId('market-search-button').addEventListener('click', () => analyzeMarketSymbol(byId('market-search-input').value));
byId('market-search-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    analyzeMarketSymbol(event.currentTarget.value);
  }
});
byId('trade-form').addEventListener('submit', event => {
  event.preventDefault();
  const amount = Number(byId('trade-amount').value);
  const signal = state.selected;
  if (!signal || !Number.isFinite(amount) || amount <= 0 || signal.target <= 0 || signal.stop <= 0) return;
  state.positions.unshift({
    id: Date.now(),
    coin: signal.coin,
    amount: amount,
    quantity: amount / signal.coin.price,
    entry: signal.coin.price,
    target: signal.target,
    extendedTarget: signal.extended_target,
    stop: signal.stop,
  });
  savePortfolio();
  byId('trade-dialog').close();
  renderDashboard();
  switchPage('home');
});
setInterval(() => {
  byId('clock').textContent = new Date().toLocaleTimeString('tr-TR');
}, 1000);
loadDashboard();
loadRadar(false);
setInterval(loadDashboard, 8000);
