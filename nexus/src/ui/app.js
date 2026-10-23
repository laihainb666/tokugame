/* ==========================================================
   App — UI 装配
   ----------------------------------------------------------
   把引擎、输入、渲染、模组、钩子面板全部接到 DOM 上。
   这里没有任何战斗逻辑，只是"遥控器"。
   ========================================================== */
(function () {
  'use strict';
  const FE = window.FE;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const canvas = $('#game');
  const engine = new FE.Engine(canvas);
  FE.engine = engine;

  const ui = {
    p1: FE.config.p1,
    p2: FE.config.p2,
    mode: FE.config.mode,
    slot: 0,            // 当前正在给谁选人
    filter: '全部',      // 花名册分组
    stage: null,        // null | stageId | '__random'
    logRows: 0
  };

  /* =========================================================
     初始化
     ========================================================= */
  function fitCanvas() {
    const stage = $('#stage');
    if (!stage) return;
    const w = stage.clientWidth || 1280;
    const h = stage.clientHeight || 720;
    const s = Math.min(w / 1280, h / 720);
    canvas.style.width = Math.round(1280 * s) + 'px';
    canvas.style.height = Math.round(720 * s) + 'px';
  }

  function init() {
    engine.setRenderer(FE.config.renderer);

    /* 画布等比适配：canvas 的 object-fit 不可靠，手动算 */
    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    if (window.ResizeObserver) {
      try { new ResizeObserver(fitCanvas).observe($('#stage')); } catch (_) {}
    }
    // 首帧布局可能还没稳定，补两次
    requestAnimationFrame(fitCanvas);
    setTimeout(fitCanvas, 120);

    /* 本地工坊：先把已保存的角色注册进来，再建选人列表 */
    FE.workshop.load();
    FE.workshop.registerAll();

    /* 内容包：特摄英雄大乱斗（326 角色 + 13 战场） */
    if (window.TOKU_PACK) {
      FE.packs.load(window.TOKU_PACK);
      FE.packs.enable('toku');
    }

    ensureHyperCfg();

    buildRendererPicker();
    buildInputPicker();
    buildSliders();
    buildCharPickers();
    buildModePicker();
    bindToolbar();
    bindTabs();
    bindDebugChecks();
    bindModPanel();
    bindPrefabPanel();
    buildHyperPanel();
    buildWorkshopPanel();
    bindTouch();
    bindLog();
    bindShortcuts();
    renderModList();
    renderPrefabList();

    /* 启用标记为 auto 的内置模组 —— 它们可能注册了新角色/新模式，
       所以之后必须重建选人与模式列表 */
    FE.mods.markReady();
    renderModList();
    buildCharPickers();
    buildModePicker();
    buildInputPicker();

    // 后续动态生成的角色（换人 / 生存模式 / 协战）自动绑定输入
    FE.bus.on('fighter:spawned', e => {
      if (e.fighter.isGhost) return;
      const dev = e.fighter.side === 0 ? FE.config.input1 : FE.config.input2;
      if (!FE.input.bindings.has(e.fighter.uid)) FE.input.bind(e.fighter, dev);
    }, { scope: 'ui' });

    engine.onMatchEnd = showResult;

    /* URL 参数：便于调试与截图 */
    const q = new URLSearchParams(location.search);
    if (q.get('render') && FE.renderers.has(q.get('render'))) {
      engine.setRenderer(q.get('render'));
      $$('#pick-render .rp').forEach(x => x.classList.toggle('on', x.dataset.id === FE.config.renderer));
      updateRenderLabel();
    }
    if (q.get('p1')) ui.p1 = q.get('p1');
    if (q.get('p2')) ui.p2 = q.get('p2');
    if (q.get('mode')) ui.mode = q.get('mode');
    if (q.get('stage')) ui.stage = q.get('stage');
    if (q.get('in1')) FE.config.input1 = q.get('in1');
    if (q.get('in2')) FE.config.input2 = q.get('in2');
    if (q.get('preset')) applyHyperPreset(ensureHyperCfg(), q.get('preset'));
    if (q.get('paused')) engine.paused = true;
    if (q.get('bare')) {
      $('#panel').classList.add('hidden');
      $('#screen-title').classList.add('hidden');
    }
    if (q.get('tab')) {
      const t = document.querySelector(`.tab[data-tab="${q.get('tab')}"]`);
      if (t) t.click();
    }
    buildCharPickers();
    buildModePicker();
    buildInputPicker();

    // 自走内核后端不需要开始对战，直接露出画面
    if (engine.renderer && engine.renderer.ownsSimulation && !engine.match) {
      showScreen(null);
    }

    engine.start();
    if (q.get('auto')) setTimeout(() => {
      startMatch();
      // 快进 N 帧，便于截图 / 调试时直接看到战斗中的画面
      const warm = parseInt(q.get('warm') || '0', 10);
      if (warm > 0 && engine.match) {
        for (let i = 0; i < warm; i++) {
          FE.input.pollAll(engine.match);
          engine.match.update(1);
        }
        engine.render();
      }
      if (q.get('paused')) engine.paused = true;
    }, 60);

    // 定期刷新侧栏统计
    setInterval(refreshStats, 500);
    updateRenderLabel();
  }

  /* =========================================================
     顶栏 / 工具栏
     ========================================================= */
  function bindToolbar() {
    $('#btn-pause').onclick = togglePause;
    $('#btn-restart').onclick = () => { if (engine.match) startMatch(); };
    $('#btn-panel').onclick = () => $('#panel').classList.toggle('hidden');
  }

  function togglePause() {
    if (!engine.match) return;
    engine.paused = !engine.paused;
    $('#btn-pause').textContent = engine.paused ? '继续' : '暂停';
    showScreen(engine.paused ? 'screen-pause' : null);
    FE.bus.emit('engine:pause', { paused: engine.paused });
  }

  function updateRenderLabel() {
    const def = FE.renderers.get(FE.config.renderer);
    $('#lbl-render').textContent = def ? def.short : '—';
    $('#st-render').textContent = 'renderer: ' + FE.config.renderer;
    const dot = $('#dot-render');
    dot.className = 'dot on';
    const note = $('#render-note');
    if (note && def) note.textContent = def.desc || '';
    // 后端可能被 URL 参数 / 快捷键改动，这里统一同步高亮
    $$('#pick-render .rp').forEach(x => x.classList.toggle('on', x.dataset.id === FE.config.renderer));
    updateAdaptNote();
  }

  /* =========================================================
     渲染后端选择
     ========================================================= */
  function buildRendererPicker() {
    const box = $('#pick-render');
    box.innerHTML = '';
    for (const r of FE.renderers.list()) {
      const b = document.createElement('button');
      b.className = 'rp' + (r.id === FE.config.renderer ? ' on' : '');
      b.dataset.id = r.id;
      b.innerHTML = `<div class="rp-t">${r.name}</div><div class="rp-s">${r.short}</div>`;
      b.onclick = () => applyRenderer(r.id);
      box.appendChild(b);
    }
  }

  /** 切换渲染后端，并处理"自走内核"后端的界面状态 */
  function applyRenderer(id) {
    if (!FE.renderers.has(id)) return;
    engine.setRenderer(id);
    $$('#pick-render .rp').forEach(e => e.classList.toggle('on', e.dataset.id === id));
    updateRenderLabel();
    const def = FE.renderers.get(id);
    FE.log('渲染后端切换：' + (def ? def.name : id), 'sys');

    const owns = engine.renderer && engine.renderer.ownsSimulation;
    if (owns && !engine.match) {
      // 自走仿真不需要"开始对战"，直接露出画面
      showScreen(null);
    } else if (!owns && !engine.match) {
      showScreen('screen-title');
    }
  }

  /* =========================================================
     输入设备选择
     ========================================================= */
  function buildInputPicker() {
    const box = $('#pick-input');
    box.innerHTML = '';
    box.style.display = 'block';
    const devs = FE.input.list();
    for (const side of [0, 1]) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center';
      const lbl = document.createElement('span');
      lbl.textContent = side === 0 ? 'P1' : 'P2';
      lbl.style.cssText = 'font:600 10px var(--mono);color:var(--txt3);width:22px';
      wrap.appendChild(lbl);
      for (const d of devs) {
        const cur = side === 0 ? FE.config.input1 : FE.config.input2;
        const b = document.createElement('button');
        b.className = 'btn sm' + (d.id === cur ? '' : ' ghost');
        b.textContent = d.short;
        b.title = d.name;
        b.onclick = () => {
          if (side === 0) FE.config.input1 = d.id; else FE.config.input2 = d.id;
          // 立即重绑当前比赛
          if (engine.match) {
            for (const f of engine.match.sides[side].fighters) FE.input.bind(f, d.id);
          }
          buildInputPicker();
          FE.log(`P${side + 1} 输入设备 → ${d.name}`, 'sys');
        };
        wrap.appendChild(b);
      }
      box.appendChild(wrap);
    }
  }

  /* =========================================================
     平衡滑块
     ========================================================= */
  function buildSliders() {
    const box = $('#sliders');
    box.innerHTML = '';
    for (const d of FE.balanceDefs) {
      const row = document.createElement('div');
      row.className = 'sl';
      row.innerHTML = `<label>${d.l}</label><output>${FE.balance[d.k]}</output>
        <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${FE.balance[d.k]}">`;
      const input = row.querySelector('input');
      const out = row.querySelector('output');
      input.oninput = () => {
        FE.balance[d.k] = parseFloat(input.value);
        out.textContent = FE.balance[d.k];
      };
      box.appendChild(row);
    }
  }

  /* =========================================================
     角色 / 模式选择
     ========================================================= */
  /* =========================================================
     角色花名册（支持 300+ 角色 + 分组筛选）
     ========================================================= */
  function charGroup(c) {
    return c.group || (c.pack ? '其他' : '内置');
  }

  function buildCharPickers() {
    /* --- 两个槽位 --- */
    for (const s of [0, 1]) {
      const el = $('#slot-p' + (s + 1));
      if (el) el.onclick = () => { ui.slot = s; updateSlots(); };
    }

    /* --- 分组筛选 --- */
    const fbox = $('#pick-filter');
    if (fbox) {
      const counts = new Map();
      for (const c of FE.characters.listEnabled()) {
        const g = charGroup(c);
        counts.set(g, (counts.get(g) || 0) + 1);
      }
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const order = ['内置', '奥特曼', '假面骑士', '战队', '漫威', 'DC', '动漫', '游戏', '西方', '中国', 'Ben 10', '其他'];
      const keys = [...counts.keys()].sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      fbox.innerHTML = '';
      const mk = (key, label, n) => {
        const b = document.createElement('button');
        b.className = 'fchip' + (ui.filter === key ? ' on' : '');
        b.innerHTML = label + '<em>' + n + '</em>';
        b.onclick = () => { ui.filter = key; buildCharPickers(); };
        fbox.appendChild(b);
      };
      mk('全部', '全部', total);
      for (const k of keys) mk(k, k, counts.get(k));
    }

    /* --- 花名册 --- */
    const rbox = $('#pick-roster');
    if (rbox) {
      rbox.innerHTML = '';
      const list = FE.characters.listEnabled()
        .filter(c => ui.filter === '全部' || charGroup(c) === ui.filter);
      for (const c of list) {
        const b = document.createElement('button');
        b.className = 'rcard' +
          (c.id === ui.p1 ? ' p1' : '') + (c.id === ui.p2 ? ' p2' : '');
        b.dataset.id = c.id;
        b.title = c.name + (c.title ? ' · ' + c.title : '') + (c.desc ? '\n' + c.desc : '');
        const pal = c.palette || {};
        b.innerHTML =
          `<span class="rav" style="background:${pal.main || '#888'}33;color:${pal.light || '#fff'}">${c.avatar || c.name[0]}</span>` +
          `<span class="rn">${c.name}</span>`;
        b.onclick = () => {
          if (ui.slot === 0) ui.p1 = c.id; else ui.p2 = c.id;
          if (ui.slot === 0) ui.slot = 1;      // 选完 P1 自动跳到 P2
          updateSlots();
          $$('#pick-roster .rcard').forEach(e => {
            e.classList.toggle('p1', e.dataset.id === ui.p1);
            e.classList.toggle('p2', e.dataset.id === ui.p2);
          });
          updateAdaptNote();
        };
        rbox.appendChild(b);
      }
      if (!list.length) rbox.innerHTML = '<div class="ws-empty">该分组暂无角色</div>';
    }

    /* --- 战场 --- */
    const sbox = $('#pick-stage');
    if (sbox) {
      sbox.innerHTML = '';
      const mkStage = (id, label) => {
        const b = document.createElement('button');
        b.className = 'schip' + (ui.stage === id ? ' on' : '');
        b.textContent = label;
        b.onclick = () => {
          ui.stage = id;
          applyStage();
          buildCharPickers();
        };
        sbox.appendChild(b);
      };
      mkStage(null, '默认');
      mkStage('__random', '随机');
      for (const s of FE.stages.list()) mkStage(s.id, s.name);
    }

    updateSlots();
  }

  function updateSlots() {
    for (const s of [0, 1]) {
      const id = s === 0 ? ui.p1 : ui.p2;
      const c = FE.characters.get(id);
      const av = $('#slot-p' + (s + 1) + '-av');
      const nm = $('#slot-p' + (s + 1) + '-name');
      const st = $('#slot-p' + (s + 1) + '-style');
      const box = $('#slot-p' + (s + 1));
      if (av) {
        av.textContent = c ? (c.avatar || c.name[0]) : '?';
        av.style.background = c && c.palette ? c.palette.main + '33' : '';
        av.style.color = c && c.palette ? c.palette.light : '';
      }
      if (nm) nm.textContent = c ? c.name : '—';
      if (st) st.textContent = c ? (c.archetype || c.title || '') : '';
      if (box) box.classList.toggle('active', ui.slot === s);
    }
  }

  /** 把 ui.stage 应用到引擎 */
  function applyStage() {
    let id = ui.stage;
    if (id === '__random') {
      const all = FE.stages.list();
      id = all.length ? all[Math.floor(Math.random() * all.length)].id : null;
    }
    FE.config.stage = ui.stage;
    FE.activeStage = id ? (FE.stages.get(id) || null) : null;
  }

  function buildModePicker() {
    const box = $('#pick-mode');
    box.innerHTML = '';
    for (const m of FE.modes.listEnabled()) {
      const b = document.createElement('button');
      b.className = 'modechip' + (m.id === ui.mode ? ' on' : '');
      b.dataset.id = m.id;
      b.textContent = m.name;
      b.title = m.desc || '';
      b.onclick = () => {
        ui.mode = m.id;
        $$('#pick-mode .modechip').forEach(e => e.classList.toggle('on', e.dataset.id === m.id));
      };
      box.appendChild(b);
    }
  }

  /* =========================================================
     开始 / 结束
     ========================================================= */
  function startMatch() {
    if (!FE.characters.has(ui.p1)) ui.p1 = FE.characters.listEnabled()[0].id;
    if (!FE.characters.has(ui.p2)) ui.p2 = FE.characters.listEnabled()[1] ? FE.characters.listEnabled()[1].id : ui.p1;
    if (!FE.modes.has(ui.mode)) ui.mode = 'duel';

    applyStage();
    engine.paused = false;
    $('#btn-pause').textContent = '暂停';
    const match = engine.startMatch({ mode: ui.mode, pick: [ui.p1, ui.p2] });

    // 绑定输入
    for (const side of [0, 1]) {
      const dev = side === 0 ? FE.config.input1 : FE.config.input2;
      for (const f of match.sides[side].fighters) FE.input.bind(f, dev);
    }

    showScreen(null);
    FE.hud.ghost && Object.keys(FE.hud.ghost).forEach(k => delete FE.hud.ghost[k]);
    FE.log(`开战：${match.sides[0].fighters[0].def.name} vs ${match.sides[1].fighters[0].def.name} · ${match.mode.name}`, 'sys');
  }

  function showResult(match) {
    const w = match.winner;
    $('#res-kicker').textContent = 'MATCH END';
    $('#res-title').textContent = (w === 0 ? 'P1' : 'P2') + ' 获胜';
    $('#res-title').style.color = '';
    const p1 = match.sides[0].fighters[0];
    const p2 = match.sides[1].fighters[0];
    $('#res-stats').innerHTML = `
      <div><span>回合比分</span><b>${match.sides[0].wins} : ${match.sides[1].wins}</b></div>
      <div><span>最大连段</span><b>${p1.maxCombo} / ${p2.maxCombo}</b></div>
      <div><span>总伤害</span><b>${Math.round(p1.damageDealt)} / ${Math.round(p2.damageDealt)}</b></div>
      <div><span>用时</span><b>${(match.stats.duration || 0).toFixed(1)}s</b></div>
      <div><span>模式</span><b>${match.mode.name}</b></div>
      <div><span>后端</span><b>${FE.config.renderer}</b></div>`;
    showScreen('screen-result');
  }

  function showScreen(id) {
    ['screen-title', 'screen-result', 'screen-pause'].forEach(s => {
      const el = $('#' + s);
      if (!el) return;
      el.classList.toggle('hidden', s !== id);
    });
  }

  /* =========================================================
     调试选项
     ========================================================= */
  function bindDebugChecks() {
    const map = {
      'chk-hitbox': 'hitbox',
      'chk-hurtbox': 'hurtbox',
      'chk-framedata': 'framedata'
    };
    for (const id in map) {
      const el = $('#' + id);
      el.checked = FE.config.debug[map[id]];
      el.onchange = () => { FE.config.debug[map[id]] = el.checked; };
    }
    $('#chk-slow').onchange = e => { engine.slow = e.target.checked; };
    $('#chk-touch').onchange = e => {
      $('#touchpad').classList.toggle('hidden', !e.target.checked);
    };
    $('#chk-hooklog').onchange = e => {
      FE.config.debug.hooklog = e.target.checked;
      if (e.target.checked) {
        FE.bus.on('combat:hit', ev => {
          FE.log(`HOOK combat:hit dmg=${Math.round(ev.damage)} scale=${ev.scale.toFixed(2)}`, 'hook');
        }, { scope: 'ui-hooklog', priority: -100 });
      } else {
        FE.bus.offScope('ui-hooklog');
      }
    };
  }

  /* =========================================================
     模组面板
     ========================================================= */
  function bindModPanel() {
    $('#btn-loadmod').onclick = () => {
      const src = $('#mod-src').value;
      const r = FE.mods.loadSource(src);
      if (!r.ok) {
        FE.log('载入失败：' + r.err, 'err');
        alert('载入失败：\n' + r.err);
      } else {
        FE.log('已载入模组：' + r.ids.join(', '), 'sys');
        renderModList();
        buildCharPickers();
        buildModePicker();
      }
    };
    $('#btn-clearmod').onclick = () => { $('#mod-src').value = ''; };
  }

  function renderModList() {
    const box = $('#modlist');
    if (!box) return;
    const list = FE.mods.list();
    $('#mod-count').textContent = list.filter(m => m.enabled).length + ' / ' + list.length;
    $('#lbl-mod').textContent = list.filter(m => m.enabled).length + ' 模组';
    $('#dot-mod').className = 'dot ' + (list.some(m => m.errors.length) ? 'warn' : 'on');
    box.innerHTML = '';
    for (const m of list) {
      const el = document.createElement('div');
      el.className = 'mod' + (m.enabled ? '' : ' off') + (m.errors.length ? ' err' : '');
      el.innerHTML = `
        <div class="mod-h">
          <span class="mod-n">${m.name}</span>
          <span class="mod-v">v${m.version}</span>
          <span class="sw ${m.enabled ? 'on' : ''}" data-id="${m.id}"></span>
        </div>
        <div class="mod-d">${m.desc}</div>
        ${m.hooks.length ? `<div class="mod-hooks">${m.hooks.length} hooks · ${m.hooks.slice(0, 4).join(', ')}${m.hooks.length > 4 ? '…' : ''}</div>` : ''}
        ${m.errors.length ? `<div class="mod-err">${m.errors.join('\n')}</div>` : ''}`;
      el.querySelector('.sw').onclick = () => {
        FE.mods.toggle(m.id);
        renderModList();
        buildCharPickers();
        buildModePicker();
      };
      box.appendChild(el);
    }
  }

  /* =========================================================
     预制体面板
     ========================================================= */
  function bindPrefabPanel() {
    $('#btn-dump').onclick = () => {
      const c = FE.characters.get(ui.p1);
      if (!c) return;
      const out = {
        id: c.id, name: c.name, title: c.title, archetype: c.archetype,
        desc: c.desc, palette: c.palette, stats: c.stats,
        moves: c.moves, tag: c.tag
      };
      $('#dump-out').value = JSON.stringify(out, null, 2);
    };
    $('#btn-dumpcopy').onclick = () => {
      const ta = $('#dump-out');
      if (!ta.value) $('#btn-dump').click();
      ta.select();
      try { document.execCommand('copy'); FE.log('角色 JSON 已复制', 'sys'); } catch (_) {}
    };
  }

  function renderPrefabList() {
    const cl = $('#charlist');
    if (cl) {
      cl.innerHTML = '';
      for (const c of FE.characters.list()) {
        const el = document.createElement('div');
        el.className = 'cl';
        el.innerHTML = `
          <div class="av" style="background:${c.palette.main}22;color:${c.palette.light}">${c.avatar || c.name[0]}</div>
          <div class="info">
            <div class="n">${c.name} <span style="color:var(--txt3);font-weight:400">${c.title || ''}</span></div>
            <div class="m">${c.archetype || ''} · ${c.moves.length} 招式</div>
          </div>
          <span class="badge">${c.stats ? 'HP ' + Math.round(FE.balance.maxHealth * c.stats.health) : ''}</span>`;
        cl.appendChild(el);
      }
    }
    const ml = $('#modelist');
    if (ml) {
      ml.innerHTML = '';
      for (const m of FE.modes.list()) {
        const el = document.createElement('div');
        el.className = 'cl';
        el.innerHTML = `
          <div class="av" style="background:#4d8dff22;color:#a8c8ff">${m.short || 'M'}</div>
          <div class="info">
            <div class="n">${m.name}</div>
            <div class="m">${m.desc || ''}</div>
          </div>
          <span class="badge">${m.teamSize}v${m.teamSize}</span>`;
        ml.appendChild(el);
      }
    }
  }

  /* =========================================================
     日志
     ========================================================= */
  function bindLog() {
    FE.bus.on('ui:log', rec => appendLog(rec));
    // 补上启动阶段的日志
    for (const rec of FE.logBuf) appendLog(rec);
    $('#btn-clearlog').onclick = () => {
      $('#loglist').innerHTML = '';
      ui.logRows = 0;
    };
  }

  function appendLog(rec) {
    const box = $('#loglist');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'lg ' + (rec.type || '');
    const f = rec.frame >= 0 ? String(rec.frame).padStart(4, ' ') : '    ';
    el.innerHTML = `<span class="t">${f}</span><span class="m">${escapeHtml(rec.msg)}</span>`;
    box.appendChild(el);
    ui.logRows++;
    while (ui.logRows > 220) { box.removeChild(box.firstChild); ui.logRows--; }
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* =========================================================
     Hyper 渲染管线面板
     ========================================================= */
  function ensureHyperCfg() {
    if (FE.hyperCfg) return FE.hyperCfg;
    const defs = FE.hyperDefs;
    const chain = defs.DEFAULT_CHAIN.map(c => {
      const d = defs.PASS_DEFS[c.id];
      const p = {};
      if (d) for (const pp of d.params) p[pp.k] = pp.v;
      return { id: c.id, on: c.on, p };
    });
    FE.hyperCfg = { base: '25d', chain, script: '', preset: 'clean' };
    return FE.hyperCfg;
  }

  /** 应用预设（面板与 URL 参数共用） */
  function applyHyperPreset(cfg, key) {
    const p = FE.hyperDefs.PRESETS[key];
    if (!p) return false;
    cfg.preset = key;
    cfg.base = p.base;
    for (const c of cfg.chain) if (p.chain[c.id] !== undefined) c.on = !!p.chain[c.id];
    const setP = (id, k, v) => {
      const c = cfg.chain.find(x => x.id === id);
      if (c) c.p[k] = v;
    };
    if (key === 'crt') { setP('pixelate', 'size', 3); setP('scanline', 'alpha', 0.2); setP('grain', 'alpha', 0.05); }
    if (key === 'cyber') { setP('chroma', 'offset', 4); setP('chroma', 'amount', 0.45); setP('grade', 'hue', 25); setP('scanline', 'alpha', 0.1); }
    if (key === 'film') { setP('grade', 'sat', 0.9); setP('grade', 'con', 1.1); setP('grain', 'alpha', 0.09); setP('bloom', 'amount', 0.42); }
    if (key === 'ink') { setP('grade', 'sat', 1.1); setP('grain', 'alpha', 0.07); }
    return true;
  }

  function buildHyperPanel() {
    const cfg = ensureHyperCfg();
    const defs = FE.hyperDefs;

    $('#btn-gohyper').onclick = () => applyRenderer('hyper');

    /* 基础后端 */
    const baseBox = $('#hyper-base');
    const bases = FE.renderers.list().filter(r => r.id !== 'hyper' && r.id !== 'c');
    const renderBase = () => {
      baseBox.innerHTML = '';
      for (const r of bases) {
        const b = document.createElement('button');
        b.className = 'rp' + (r.id === cfg.base ? ' on' : '');
        b.innerHTML = `<div class="rp-t">${r.name}</div><div class="rp-s">${r.short}</div>`;
        b.onclick = () => { cfg.base = r.id; renderBase(); };
        baseBox.appendChild(b);
      }
    };
    renderBase();

    /* 预设 */
    const presetBox = $('#hyper-presets');
    const renderPresets = () => {
      presetBox.innerHTML = '';
      for (const key in defs.PRESETS) {
        const p = defs.PRESETS[key];
        const b = document.createElement('button');
        b.className = 'preset' + (cfg.preset === key ? ' on' : '');
        b.textContent = p.name;
        b.onclick = () => {
          applyHyperPreset(cfg, key);
          renderBase(); renderPresets(); renderChain();
        };
        presetBox.appendChild(b);
      }
    };

    /* 通道链 */
    const chainBox = $('#hyper-chain');
    const renderChain = () => {
      chainBox.innerHTML = '';
      cfg.chain.forEach((c, idx) => {
        const d = defs.PASS_DEFS[c.id];
        if (!d) return;
        const el = document.createElement('div');
        el.className = 'chain-item' + (c.on ? ' on' : '');
        el.innerHTML = `
          <div class="chain-h">
            <span class="chain-i">${idx + 1}</span>
            <span class="chain-n">${d.name}</span>
            <span class="sw ${c.on ? 'on' : ''}"></span>
          </div>
          <div class="chain-d">${d.desc}</div>
          <div class="chain-params"></div>`;
        el.querySelector('.sw').onclick = () => {
          c.on = !c.on;
          el.classList.toggle('on', c.on);
          el.querySelector('.sw').classList.toggle('on', c.on);
        };
        const pb = el.querySelector('.chain-params');
        for (const pd of d.params) {
          const row = document.createElement('div');
          row.className = 'sl';
          row.innerHTML = `<label>${pd.l}</label><output>${c.p[pd.k]}</output>
            <input type="range" min="${pd.min}" max="${pd.max}" step="${pd.step}" value="${c.p[pd.k]}">`;
          const inp = row.querySelector('input');
          const out = row.querySelector('output');
          inp.oninput = () => {
            c.p[pd.k] = parseFloat(inp.value);
            out.textContent = inp.value;
          };
          pb.appendChild(row);
        }
        chainBox.appendChild(el);
      });
    };
    renderPresets();
    renderChain();

    /* 脚本 */
    const ta = $('#hyper-script');
    ta.value = cfg.script || '';
    const err = $('#hyper-err');
    const apply = () => {
      cfg.script = ta.value;
      const r = engine.renderer;
      let ok = true;
      if (r && r.applyScript) ok = r.applyScript(cfg.script);
      else {
        try { if (cfg.script.trim()) new Function('api', cfg.script); ok = true; }
        catch (e) { ok = false; err.textContent = e.message; }
      }
      err.textContent = ok ? '' : (err.textContent || '脚本语法错误');
      if (ok) FE.log('Hyper 脚本已应用', 'sys');
    };
    $('#btn-script').onclick = apply;
    $('#btn-script-clear').onclick = () => { ta.value = ''; apply(); };
    $('#btn-script-example').onclick = () => {
      ta.value = `// 例：一条扫描光带 + 四角取景框
const t = api.time;
const y = (t * 120) % (api.H + 200) - 100;
const g = api.ctx.createLinearGradient(0, y - 50, 0, y + 50);
g.addColorStop(0, 'rgba(120,220,255,0)');
g.addColorStop(0.5, 'rgba(120,220,255,.22)');
g.addColorStop(1, 'rgba(120,220,255,0)');
api.ctx.fillStyle = g;
api.ctx.fillRect(0, y - 50, api.W, 100);

// 取景框
api.ctx.strokeStyle = 'rgba(255,255,255,.35)';
api.ctx.lineWidth = 2;
const m = 26, L = 46;
const corners = [[m,m,1,1],[api.W-m,m,-1,1],[m,api.H-m,1,-1],[api.W-m,api.H-m,-1,-1]];
for (const [x, yy, sx, sy] of corners) {
  api.ctx.beginPath();
  api.ctx.moveTo(x + sx*L, yy);
  api.ctx.lineTo(x, yy);
  api.ctx.lineTo(x, yy + sy*L);
  api.ctx.stroke();
}`;
      apply();
    };
  }

  /* =========================================================
     创意工坊面板
     ========================================================= */
  function buildWorkshopPanel() {
    const drop = $('#ws-drop');
    const file = $('#ws-file');
    const preview = $('#ws-preview');
    const thumb = $('#ws-thumb');
    const nameIn = $('#ws-name');
    const palBox = $('#ws-pal');
    const createBtn = $('#ws-create');
    let pending = null;

    const clearPending = () => {
      pending = null;
      preview.classList.add('hidden');
      createBtn.disabled = true;
      palBox.innerHTML = '';
    };

    const pick = () => file.click();
    drop.onclick = pick;
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    file.onchange = () => { if (file.files[0]) handleFile(file.files[0]); };

    async function handleFile(f) {
      if (!f.type.startsWith('image/')) { FE.log('只支持图片文件', 'err'); return; }
      try {
        const item = await FE.workshop.fromFile(f);
        pending = item;
        thumb.src = item.thumb;
        nameIn.value = item.name;
        palBox.innerHTML = '';
        for (const k of ['main', 'dark', 'light', 'accent', 'skin', 'hair', 'gi', 'belt', 'aura']) {
          const i = document.createElement('i');
          i.style.background = item.palette[k];
          i.title = k;
          palBox.appendChild(i);
        }
        preview.classList.remove('hidden');
        createBtn.disabled = false;
        FE.log('已提取配色：' + item.palette.main + ' / ' + item.palette.accent, 'sys');
      } catch (err) {
        FE.log('图片解析失败：' + err.message, 'err');
      }
    }

    $('#ws-clear').onclick = () => { clearPending(); file.value = ''; };

    createBtn.onclick = () => {
      if (!pending) return;
      const nm = (nameIn.value || '自定义').slice(0, 12);
      pending.name = nm;
      pending.def.name = nm;
      pending.def.avatar = nm[0];
      FE.workshop.add(pending);
      FE.log(`工坊角色已生成：${nm}（未做任何后端适配，将自动替身）`, 'sys');
      clearPending();
      file.value = '';
      buildCharPickers();
      renderWorkshop();
      if (!FE.config.renderer || FE.config.renderer === 'hyper') updateAdaptNote();
    };

    $('#ws-export').onclick = () => {
      const json = FE.workshop.exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nexus-workshop.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      FE.log('工坊已导出', 'sys');
    };

    $('#ws-import').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const n = FE.workshop.importAll(fr.result);
            FE.log(`导入 ${n} 个工坊角色`, 'sys');
            buildCharPickers();
            renderWorkshop();
          } catch (e) {
            FE.log('导入失败：' + e.message, 'err');
          }
        };
        fr.readAsText(f);
      };
      inp.click();
    };

    renderWorkshop();
  }

  function renderWorkshop() {
    const box = $('#ws-list');
    if (!box) return;
    const items = FE.workshop.items;
    $('#ws-count').textContent = items.length;
    const note = $('#ws-note');
    if (note) {
      note.textContent = FE.workshop.storageOk
        ? '存在浏览器本地（localStorage）。导出 JSON 可分享给别人。'
        : '本地存储不可用，内容仅在本次会话有效。';
    }
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="ws-empty">还没有内容，先传一张图试试</div>';
      return;
    }
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'wsitem';
      el.innerHTML = `
        <img src="${it.thumb}" alt="">
        <div class="info">
          <div class="n">${escapeHtml(it.name)}</div>
          <div class="m">${it.def.moves.length} 招式 · 全后端自动替身</div>
        </div>
        <button class="del">删除</button>`;
      el.querySelector('.del').onclick = () => {
        FE.workshop.remove(it.id);
        renderWorkshop();
        buildCharPickers();
        FE.log('已删除工坊角色：' + it.name, 'sys');
      };
      box.appendChild(el);
    }
  }

  /* =========================================================
     适配提示
     ========================================================= */
  function updateAdaptNote() {
    const el = $('#adapt-note');
    if (!el) return;
    const id = FE.config.renderer;
    const c1 = FE.characters.get(ui.p1);
    const c2 = FE.characters.get(ui.p2);
    const a1 = c1 ? FE.adapt.supports(c1, id) : true;
    const a2 = c2 ? FE.adapt.supports(c2, id) : true;
    if (a1 && a2) {
      el.textContent = '两名角色均已适配此后端';
      el.style.color = '';
    } else {
      const names = [];
      if (!a1 && c1) names.push(c1.name);
      if (!a2 && c2) names.push(c2.name);
      el.textContent = `${names.join(' / ')} 未适配 ${id} → 自动生成替身（头顶标 AUTO）`;
      el.style.color = '#ffb02e';
    }
  }

  /* =========================================================
     Tab 切换
     ========================================================= */
  function bindTabs() {
    $$('.tab').forEach(t => {
      t.onclick = () => {
        $$('.tab').forEach(x => x.classList.toggle('active', x === t));
        $$('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
        if (t.dataset.tab === 'hooks') renderHooks();
        if (t.dataset.tab === 'prefabs') renderPrefabList();
        if (t.dataset.tab === 'mods') renderModList();
        if (t.dataset.tab === 'workshop') renderWorkshop();
      };
    });
  }

  function renderHooks() {
    const box = $('#hooklist');
    if (!box) return;
    const inv = FE.bus.inventory();
    const all = Object.keys(FE.HOOKS).map(name => {
      const found = inv.find(i => i.name === name);
      return {
        name,
        handlers: found ? found.handlers : 0,
        calls: found ? found.calls : 0,
        scopes: found ? found.scopes : [],
        desc: FE.HOOKS[name]
      };
    }).sort((a, b) => b.calls - a.calls || b.handlers - a.handlers);
    box.innerHTML = '';
    for (const h of all) {
      const el = document.createElement('div');
      el.className = 'hk' + (h.handlers ? ' on' : '');
      el.title = h.desc + (h.scopes.length ? '\n监听者: ' + h.scopes.join(', ') : '');
      el.innerHTML = `<span class="hk-n">${h.name}</span>
        <span class="hk-c">${h.calls}</span>
        <span class="hk-t">${h.handlers}h</span>`;
      box.appendChild(el);
    }
  }

  /* =========================================================
     触屏
     ========================================================= */
  function bindTouch() {
    const pad = $('#touchpad');
    if (!pad) return;
    pad.querySelectorAll('[data-dir]').forEach(btn => {
      const d = btn.dataset.dir;
      const set = (on) => {
        const t = FE.input.touch.dir;
        if (d === 'left') t.x = on ? -1 : 0;
        if (d === 'right') t.x = on ? 1 : 0;
        if (d === 'up') t.y = on ? -1 : 0;
        if (d === 'down') t.y = on ? 1 : 0;
      };
      btn.addEventListener('pointerdown', e => { e.preventDefault(); set(true); });
      btn.addEventListener('pointerup', () => set(false));
      btn.addEventListener('pointerleave', () => set(false));
      btn.addEventListener('pointercancel', () => set(false));
    });
    pad.querySelectorAll('[data-btn]').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        FE.input.touch.buttons[btn.dataset.btn] = true;
      });
    });
  }

  /* =========================================================
     快捷键
     ========================================================= */
  function bindShortcuts() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Escape') {
        if (!$('#screen-title').classList.contains('hidden')) return;
        togglePause();
      }
      if (e.code === 'KeyR' && engine.match) startMatch();
      if (e.code === 'F1') {
        e.preventDefault();
        const ids = FE.renderers.list().map(r => r.id);
        const next = ids[(ids.indexOf(FE.config.renderer) + 1) % ids.length];
        applyRenderer(next);
      }
      if (e.code === 'Enter') {
        if (!$('#screen-title').classList.contains('hidden')) startMatch();
        else if (!$('#screen-result').classList.contains('hidden')) startMatch();
      }
    });
    $('#btn-start').onclick = startMatch;
    $('#btn-again').onclick = startMatch;
  }

  /* =========================================================
     统计刷新
     ========================================================= */
  function refreshStats() {
    const m = engine.match;
    $('#lbl-fps').textContent = engine.fps + ' fps';
    $('#dot-fps').className = 'dot ' + (engine.fps >= 50 ? 'on' : engine.fps >= 30 ? 'warn' : '');
    $('#st-hooks').textContent = 'hooks ' + FE.bus.totalCalls;

    /* C 内核后端自己接管仿真，状态从它那里取 */
    const r = engine.renderer;
    if (r && r.ownsSimulation) {
      const k = r.kernel;
      if (k) {
        $('#st-state').textContent = 'C kernel · ' + (k.winner >= 0 ? 'ended' : 'running') + ' · Q16.16';
        $('#st-frame').textContent = 'frame ' + k.frame + ' · hash ' +
          (k.hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
      } else {
        $('#st-state').textContent = 'C kernel · init';
        $('#st-frame').textContent = 'hash —';
      }
      return;
    }

    if (!m) {
      $('#st-state').textContent = 'idle';
      $('#st-frame').textContent = 'frame 0';
      return;
    }
    const p1 = m.sides[0].active();
    $('#st-state').textContent = `P1 ${p1 ? p1.state : '-'} · ${m.state} · R${m.round}`;
    $('#st-frame').textContent = 'frame ' + m.frame;
    if ($('.pane[data-pane="hooks"]').classList.contains('active')) renderHooks();
  }

  /* =========================================================
     启动
     ========================================================= */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
