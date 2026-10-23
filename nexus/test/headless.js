/* 无头自测：在 Node 里跑完整内核 + 渲染器（用假 Canvas 上下文） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 环境桩 ---------- */
const noop = () => {};
global.window = global;
global.addEventListener = noop;
global.removeEventListener = noop;
try { global.navigator = { getGamepads: () => [] }; } catch (_) { /* Node 22 已有只读 navigator */ }
global.requestAnimationFrame = noop;
if (!global.performance) global.performance = { now: () => Date.now() };

function makeGrad() { return { addColorStop: noop }; }
function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => makeGrad();
      if (k === 'measureText') return () => ({ width: 12 });
      if (k === 'canvas') return { width: 1280, height: 720 };
      if (k === 'getImageData') return (x, y, w, h) => {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          d[i * 4] = (i * 7) % 256;
          d[i * 4 + 1] = (i * 13) % 256;
          d[i * 4 + 2] = (i * 29) % 256;
          d[i * 4 + 3] = 255;
        }
        return { data: d, width: w, height: h };
      };
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'putImageData') return noop;
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

/* 极简 document 桩：让离屏 canvas 相关代码能跑 */
global.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      return {
        width: 0, height: 0,
        getContext: () => makeCtx(),
        toDataURL: () => 'data:image/jpeg;base64,AAAA'
      };
    }
    return { style: {}, className: '', innerHTML: '', appendChild: noop, click: noop, addEventListener: noop };
  }
};

const ROOT = path.join(__dirname, '..');
const FILES = [
  'src/core/bus.js',
  'src/core/registry.js',
  'src/kernel/c-kernel.js',
  'src/data/balance.js',
  'src/data/moves.js',
  'src/data/characters.js',
  'src/data/modes.js',
  'src/data/toku-pack.js',
  'src/data/packs.js',
  'src/combat/anim.js',
  'src/combat/fighter.js',
  'src/combat/combat.js',
  'src/core/engine.js',
  'src/input/input.js',
  'src/input/ai.js',
  'src/render/hud.js',
  'src/render/adapt.js',
  'src/render/spritekit.js',
  'src/render/renderer3d.js',
  'src/render/renderer25d.js',
  'src/render/rendererdata.js',
  'src/render/rendererc.js',
  'src/render/rendererstyled.js',
  'src/render/rendererhyper.js',
  'src/core/modloader.js',
  'src/mods/builtin.js',
  'src/ui/workshop.js'
];

for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    vm.runInThisContext(code, { filename: f });
  } catch (e) {
    console.error('加载失败:', f, e.message);
    process.exit(1);
  }
}

const FE = global.FE;
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------- 引擎桩 ---------- */
const canvas = { width: 1280, height: 720, getContext: () => makeCtx() };
const engine = new FE.Engine(canvas);
engine.setRenderer('3d');

function run(match, frames, render) {
  let errs = [];
  for (let i = 0; i < frames; i++) {
    try {
      FE.input.pollAll(match);
      match.update(1);
      if (render && i % 3 === 0) engine.render();
    } catch (e) {
      errs.push(e);
      if (errs.length > 3) break;
    }
  }
  return errs;
}

/* =========================================================
   1. 基础对战
   ========================================================= */
section('1v1 决斗（双 AI）');
FE.config.input1 = 'ai';
FE.config.input2 = 'ai';
let m = engine.startMatch({ mode: 'duel', pick: ['flame', 'frost'] });
for (const s of [0, 1]) for (const f of m.sides[s].fighters) FE.input.bind(f, 'ai');

let errs = run(m, 900, true);
ok(errs.length === 0, '900 帧无异常' + (errs[0] ? ' → ' + errs[0].stack.split('\n').slice(0, 3).join(' | ') : ''));

const p1 = m.sides[0].fighters[0], p2 = m.sides[1].fighters[0];
ok(p1.health < p1.maxHealth || p2.health < p2.maxHealth, '双方产生了伤害');
ok(FE.bus.stats['combat:hit'] && FE.bus.stats['combat:hit'].calls > 0, 'combat:hit 钩子被调用');
ok(FE.bus.stats['fighter:stateChange'].calls > 10, '状态机有切换');
ok(m.frame > 800, '帧计数推进');
const moved = Math.abs(p1.x) + Math.abs(p2.x) > 10;
ok(moved, '角色发生位移');
ok(m.round >= 1, '回合系统运行');

/* 判定盒几何 */
section('几何与判定');
const fresh = new FE.Fighter(0, 'flame', 0, {});
const hu = fresh.hurtbox();
ok(hu.h > 100 && hu.w > 40, '站立受击盒尺寸合理');
const hb0 = fresh.hitbox();
ok(hb0 === null, '未出招时无判定盒');
const testMove = [...fresh.moves.values()].find(x => x.id === 'light');
fresh.startMove(testMove);
for (let i = 0; i < testMove.startup + 1; i++) fresh.update(1, { opponentOf: () => null });
ok(fresh.hitbox() !== null, '出招进入判定帧后有判定盒');
ok(FE.Fighter.overlap({ x: 0, y: 100, w: 50, h: 40 }, { x: 10, y: 90, w: 50, h: 60 }) === true, 'AABB 相交检测正确');
ok(FE.Fighter.overlap({ x: 0, y: 300, w: 50, h: 40 }, { x: 10, y: 90, w: 50, h: 60 }) === false, 'AABB 不相交正确');

/* 帧数据完整性 */
section('招式数据');
let badMoves = 0;
for (const c of FE.characters.list()) {
  for (const mv of c.moves) {
    const norm = FE.moves.normalize(mv, 0);
    if (!(norm.total > 0) || !norm.hitbox || norm.damage === undefined) badMoves++;
  }
}
ok(badMoves === 0, '所有招式帧数据完整');
ok(FE.characters.list().length >= 3, '至少 3 个角色');

/* =========================================================
   2. 三种渲染后端
   ========================================================= */
section('渲染后端');
const ALL_RENDERERS = FE.renderers.list().map(r => r.id);
ok(ALL_RENDERERS.length >= 9, '已注册渲染后端 ' + ALL_RENDERERS.length + ' 个');
for (const id of ALL_RENDERERS) {
  engine.setRenderer(id);
  const e2 = run(m, 60, true);
  ok(e2.length === 0, `后端 ${id} 绘制无异常` + (e2[0] ? ' → ' + e2[0].message : ''));
}
engine.setRenderer('3d');

/* =========================================================
   内容包（特摄英雄大乱斗）
   ========================================================= */
section('内容包');
{
  ok(!!window.TOKU_PACK, '数据包已加载');
  const meta = window.TOKU_PACK.meta;
  ok(meta.count >= 300, '角色数量 ' + meta.count);
  ok(window.TOKU_PACK.stages.length === 13, '战场数量 13');

  const t0 = Date.now();
  FE.packs.load(window.TOKU_PACK);
  const n = FE.packs.enable('toku');
  const ms = Date.now() - t0;
  ok(n >= 300, '注册了 ' + n + ' 名角色（耗时 ' + ms + 'ms）');
  ok(FE.stages.list().length === 13, '战场已注册进引擎');

  const first = FE.characters.list().find(c => c.pack === 'toku');
  ok(!!first, '能找到内容包角色：' + (first && first.name));
  ok(first.moves.length >= 10, '角色招式数 ' + first.moves.length);
  ok(['3d', '25d', 'pixel', 'ink', 'neon', 'toon', 'hyper', 'data', 'c']
    .every(b => FE.adapt.supports(first, b)), '内容包角色适配全部后端');
  ok(first.look && typeof first.look.build === 'number', '角色带有外观定义');

  // 抽三个角色各打一场
  const sample = FE.characters.list().filter(c => c.pack === 'toku').slice(0, 3);
  for (const c of sample) {
    const mm = engine.startMatch({ mode: 'duel', pick: [c.id, 'flame'] });
    for (const s of [0, 1]) for (const f of mm.sides[s].fighters) FE.input.bind(f, 'ai');
    const ee = run(mm, 240, true);
    ok(ee.length === 0, `「${c.name}」可以正常对战` + (ee[0] ? ' → ' + ee[0].message : ''));
  }

  // 战场主题
  FE.activeStage = FE.stages.get('volcano');
  engine.setRenderer('25d');
  const es = [];
  for (let i = 0; i < 10; i++) { try { engine.render(); } catch (err) { es.push(err); } }
  ok(es.length === 0, '战场主题下渲染正常');
  FE.activeStage = null;
  engine.setRenderer('3d');
}

/* =========================================================
   适配检测
   ========================================================= */
section('角色适配检测');
{
  const flame = FE.characters.get('flame');
  const frost = FE.characters.get('frost');
  const rock = FE.characters.get('rock');
  ok(FE.adapt.supports(flame, 'pixel') === true, '焰 适配 pixel');
  ok(FE.adapt.supports(frost, 'pixel') === false, '霜 未适配 pixel（应检测出来）');
  ok(FE.adapt.supports(rock, 'ink') === false, '岩 未适配 ink');

  const r1 = FE.adapt.resolve(frost, 'pixel');
  ok(r1.adapted === false, 'resolve 返回未适配');
  ok(r1.look && r1.look.auto === true, '未适配时使用自动替身外观');
  const r2 = FE.adapt.resolve(flame, 'pixel');
  ok(r2.adapted === true && r2.look.auto !== true, '已适配角色使用专属外观');

  // 未声明 adapters 的角色视为全适配
  const fake = { id: 'x', palette: flame.palette };
  ok(FE.adapt.supports(fake, 'anything') === true, '未声明 adapters = 全适配');
  // 空数组 = 全都不适配
  const fake2 = { id: 'y', palette: flame.palette, adapters: [] };
  ok(FE.adapt.supports(fake2, '3d') === false, '空 adapters = 全部走替身');
}

/* =========================================================
   Hyper 渲染管线
   ========================================================= */
section('Hyper 渲染管线');
{
  ok(FE.renderers.has('hyper'), 'hyper 后端已注册');
  const defs = FE.hyperDefs;
  ok(Object.keys(defs.PASS_DEFS).length >= 7, '通道定义 ' + Object.keys(defs.PASS_DEFS).length + ' 个');
  ok(Object.keys(defs.PRESETS).length >= 5, '预设 ' + Object.keys(defs.PRESETS).length + ' 个');

  // 构造配置并切换
  FE.hyperCfg = {
    base: '25d',
    chain: defs.DEFAULT_CHAIN.map(c => {
      const d = defs.PASS_DEFS[c.id];
      const p = {};
      if (d) for (const pp of d.params) p[pp.k] = pp.v;
      return { id: c.id, on: c.on, p };
    }),
    script: '',
    preset: 'clean'
  };

  engine.setRenderer('hyper');
  const r = engine.renderer;
  ok(!!r, 'hyper 实例创建成功');
  const e3 = [];
  for (let i = 0; i < 20; i++) {
    try { engine.render(); } catch (err) { e3.push(err); }
  }
  ok(e3.length === 0, '通道链绘制无异常' + (e3[0] ? ' → ' + e3[0].message : ''));

  // 换基础后端
  FE.hyperCfg.base = 'pixel';
  const e4 = [];
  for (let i = 0; i < 10; i++) { try { engine.render(); } catch (err) { e4.push(err); } }
  ok(e4.length === 0, '切换基础后端后仍正常');

  // 自定义脚本
  const okScript = r.applyScript('api.ctx.fillStyle="rgba(255,0,0,.2)";api.ctx.fillRect(0,0,10,10);');
  ok(okScript === true, '合法脚本编译通过');
  const badScript = r.applyScript('this is not js (((');
  ok(badScript === false && !!r.scriptErr, '非法脚本被捕获且不抛错');

  // 关掉所有通道也应能画
  for (const c of FE.hyperCfg.chain) c.on = false;
  const e5 = [];
  for (let i = 0; i < 5; i++) { try { engine.render(); } catch (err) { e5.push(err); } }
  ok(e5.length === 0, '全通道关闭时退化为直通');

  engine.setRenderer('3d');
}

/* =========================================================
   创意工坊
   ========================================================= */
section('创意工坊');
{
  ok(!!FE.workshop, '工坊模块已加载');
  ok(Array.isArray(FE.workshop.items), '工坊列表可用');

  const item = {
    id: 'ws_test1',
    name: '测试角色',
    thumb: 'data:image/jpeg;base64,AAAA',
    palette: { main: '#3366ff', dark: '#112244', light: '#88aaff', accent: '#ffcc00', skin: '#eec', hair: '#111', gi: '#3366ff', belt: '#111', aura: '#66aaff' },
    def: {
      id: 'ws_test1', name: '测试角色', title: 'WORKSHOP', archetype: '图片生成',
      avatar: '测', adapters: [], palette: {},
      stats: { health: 1, walk: 1, dash: 1, jump: 1, weight: 1, gravity: 1, meterGain: 1 },
      moves: FE.moves.resolveList([FE.moves.derive('light', { id: 'light' })]).size ? [] : [],
      tag: { assist: 'light', switchIn: 'light', call: '' }
    }
  };
  item.def.palette = item.palette;
  // 用真实招式填充，保证能打
  item.def.moves = [
    FE.moves.derive('light', { id: 'light' }),
    FE.moves.derive('heavy', { id: 'heavy' }),
    FE.moves.derive('sweep', { id: 'sweep' })
  ];

  FE.workshop.add(item);
  ok(FE.characters.has('ws_test1'), '工坊角色已注册进引擎');
  const wc = FE.characters.get('ws_test1');
  ok(FE.adapt.supports(wc, '3d') === false, '工坊角色对所有后端走自动替身');

  // 用这个角色跑一场
  const mw = engine.startMatch({ mode: 'duel', pick: ['ws_test1', 'flame'] });
  for (const s of [0, 1]) for (const f of mw.sides[s].fighters) FE.input.bind(f, 'ai');
  const ew = run(mw, 200, true);
  ok(ew.length === 0, '工坊角色可以正常对战' + (ew[0] ? ' → ' + ew[0].message : ''));

  // 导出 / 删除
  const json = FE.workshop.exportAll();
  ok(json.indexOf('nexus-workshop') >= 0, '导出格式正确');
  FE.workshop.remove('ws_test1');
  ok(!FE.characters.has('ws_test1'), '删除后角色被移除');

  // 配色提取
  const pal = FE.workshop.extractPalette({ width: 64, height: 64 });
  const slots = ['main', 'dark', 'light', 'accent', 'skin', 'hair', 'gi', 'belt', 'aura'];
  ok(slots.every(k => /^#[0-9a-f]{6}$/i.test(pal.palette[k])), '九个配色槽位都是合法颜色');
  ok(pal.palette.main !== pal.palette.accent, '主色与点缀色不同');
  ok(pal.palette.dark !== pal.palette.light, '暗部与亮部不同');
  ok(typeof pal.thumb === 'string' && pal.thumb.indexOf('data:') === 0, '生成了缩略图');
}

/* =========================================================
   C 内核（定点 / 确定性）
   ========================================================= */
section('C 内核');
{
  const CK = FE.CKernel;
  ok(!!CK, 'C 内核镜像已加载');

  // 1) 确定性：同种子两次跑出同一串哈希
  const runK = (seed, n) => {
    const k = new CK(seed);
    const hs = [];
    for (let i = 0; i < n; i++) {
      k.step();
      if (k.frame % 30 === 0) hs.push(k.hash);
      if (k.winner >= 0) break;
    }
    return { k, hs };
  };
  const a1 = runK(12345, 900);
  const a2 = runK(12345, 900);
  ok(a1.hs.join(',') === a2.hs.join(','), '同种子两次仿真哈希序列完全一致');
  ok(a1.k.hash === a2.k.hash, '最终哈希一致 (' + (a1.k.hash >>> 0).toString(16).toUpperCase() + ')');

  // 2) 不同种子应产生不同结果
  const b1 = runK(999, 300);
  ok(b1.k.hash !== a1.k.hash, '不同种子产生不同哈希');

  // 3) 黄金基准（对应 native/GOLDEN.txt，C 版编译后必须相同）
  ok(a1.k.hash === 0x280F7260, 'FINAL_HASH 与 GOLDEN.txt 一致 (280F7260)');
  ok(a1.k.frame === 877, '结束帧与基准一致 (877)');
  ok(a1.k.winner === 0, '胜者与基准一致 (P1)');

  // 4) 定点数语义
  ok(CK.toF(65536) === 1 && CK.toF(-131072) === -2, '定点转浮点正确');
  const k3 = new CK(7);
  for (let i = 0; i < 200; i++) k3.step();
  ok(Number.isInteger(k3.f[0].x) && Number.isInteger(k3.f[0].vx), '内核状态保持整数（无浮点漂移）');

  // 5) 快照只读接口
  const snap = k3.snapshot();
  ok(snap.fighters.length === 2 && typeof snap.hash === 'number', 'snapshot 结构正确');
  ok(Math.abs(snap.fighters[0].x) <= 640 && snap.fighters[0].health >= 0, '快照数值在合法范围');

  // 6) 渲染后端接管仿真
  engine.setRenderer('c');
  const r = engine.renderer;
  ok(r.ownsSimulation === true, 'C 后端声明接管仿真');
  const before = r.kernel ? r.kernel.frame : 0;
  for (let i = 0; i < 30; i++) engine.step();
  ok(r.kernel && r.kernel.frame > before, 'engine.step() 推进的是 C 内核');
  const e4 = [];
  for (let i = 0; i < 20; i++) {
    try { engine.render(); } catch (err) { e4.push(err); }
  }
  ok(e4.length === 0, 'C 后端绘制无异常' + (e4[0] ? ' → ' + e4[0].message : ''));
  engine.setRenderer('3d');
}

/* =========================================================
   3. 模组系统
   ========================================================= */
section('模组系统');
const mods = FE.mods.list();
ok(mods.length >= 6, '内置模组已注册 (' + mods.length + ')');

// 启用全部模组后跑一场
for (const md of mods) if (!md.enabled) FE.mods.enable(md.id);
engine.setRenderer('3d');
let m2 = engine.startMatch({ mode: 'duel', pick: ['shadow', 'rock'] });
for (const s of [0, 1]) for (const f of m2.sides[s].fighters) FE.input.bind(f, 'ai');
let e3 = run(m2, 600, true);
ok(e3.length === 0, '全模组启用下运行无异常' + (e3[0] ? ' → ' + e3[0].message : ''));
ok(FE.characters.has('shadow'), '模组注册的新角色「影」可用');
ok(FE.modes.has('chaos'), '模组注册的新模式「乱斗」可用');

// 霸体模组
const armorMod = FE.mods.list().find(x => x.id === 'super-armor');
ok(armorMod.enabled, '霸体模组已启用');
ok(armorMod.hooks.includes('move:beforeExecute'), '霸体模组挂载了 move:beforeExecute');

// 关闭模组 → 钩子应被摘除
const before = FE.bus.totalCalls;
FE.mods.disable('super-armor');
const after = FE.mods.list().find(x => x.id === 'super-armor');
ok(!after.enabled && after.hooks.length === 0, '停用模组后钩子被完全摘除');

// 角色移除验证
FE.mods.disable('shadow-fighter');
ok(!FE.characters.has('shadow'), '停用角色包后角色被移除');
FE.mods.enable('shadow-fighter');

// 动态载入源码
const r = FE.mods.loadSource(`
FE.registerMod({
  id: 'test-dyn', name: '动态测试',
  setup(api){
    api.state.n = 0;
    api.on('combat:hit', e => { api.state.n++; e.damage *= 1.01; });
  }
});
`);
ok(r.ok, '动态模组源码载入成功');
let m3 = engine.startMatch({ mode: 'duel', pick: ['flame', 'flame'] });
for (const s of [0, 1]) for (const f of m3.sides[s].fighters) FE.input.bind(f, 'ai');
run(m3, 400, false);
const dyn = FE.mods.list().find(x => x.id === 'test-dyn');
ok(dyn && dyn.enabled, '动态模组已启用');

// 错误模组不应炸掉总线
const r2 = FE.mods.loadSource(`
FE.registerMod({ id:'bad', name:'坏模组', setup(){ throw new Error('boom'); } });
`);
ok(r2.ok === true, '坏模组不会让载入器崩溃');
const bad = FE.mods.list().find(x => x.id === 'bad');
ok(bad && !bad.enabled && bad.errors.length > 0, '坏模组被标记错误且未启用');

/* =========================================================
   4. 钩子语义
   ========================================================= */
section('钩子语义');
const order = [];
FE.bus.on('test:order', () => order.push('low'), { priority: 1, scope: 'test' });
FE.bus.on('test:order', () => order.push('high'), { priority: 10, scope: 'test' });
FE.bus.on('test:order', () => order.push('mid'), { priority: 5, scope: 'test' });
FE.bus.emit('test:order', {});
ok(order.join(',') === 'high,mid,low', '优先级排序正确：' + order.join(','));

let called = false;
FE.bus.on('test:cancel', () => false, { priority: 100, scope: 'test' });
FE.bus.on('test:cancel', () => { called = true; }, { priority: 1, scope: 'test' });
const res = FE.bus.emit('test:cancel', {});
ok(res.cancelled === true && called === false, '返回 false 可阻断后续钩子');

const payload = { v: 1 };
FE.bus.on('test:mut', p => { p.v = 42; }, { scope: 'test' });
FE.bus.emit('test:mut', payload);
ok(payload.v === 42, 'payload 可被就地修改');

let onceCount = 0;
FE.bus.on('test:once', () => onceCount++, { once: true, scope: 'test' });
FE.bus.emit('test:once', {});
FE.bus.emit('test:once', {});
ok(onceCount === 1, 'once 只触发一次');

let chainV = FE.bus.chain('test:chain', 10, {});
ok(chainV === 10, 'chain 无监听时原样返回');

FE.bus.offScope('test');
ok(!FE.bus.map.has('test:order'), 'offScope 清空指定作用域');

/* =========================================================
   5. 其他模式
   ========================================================= */
section('战斗模式');
FE.mods.enable('chaos-mode');
for (const modeId of ['tag', 'survival', 'chaos']) {
  let mm;
  try {
    mm = engine.startMatch({ mode: modeId, pick: ['flame', 'frost'] });
    for (const s of [0, 1]) for (const f of mm.sides[s].fighters) FE.input.bind(f, s === 0 ? 'ai' : 'ai_hard');
    const ee = run(mm, 420, true);
    ok(ee.length === 0, `模式 ${modeId} 运行无异常` + (ee[0] ? ' → ' + ee[0].message : ''));
    const expect = modeId === 'chaos' ? 4 : 2;
    ok(mm.fighters.length === expect, `模式 ${modeId} 在场角色 ${mm.fighters.length}/${expect}`);
  } catch (e) {
    ok(false, `模式 ${modeId} 抛错: ${e.message}`);
  }
}

/* =========================================================
   6. 输入 → 招式 → 命中 / 格挡
   ========================================================= */
section('输入到判定全链路');
function setupDuel() {
  const mm = engine.startMatch({ mode: 'duel', pick: ['flame', 'frost'] });
  mm.state = 'fight';
  mm.stateTime = 0;
  const a = mm.sides[0].fighters[0], b = mm.sides[1].fighters[0];
  a.x = -40; b.x = 40; a.facing = 1; b.facing = -1;
  const blank = () => ({ dir: { x: 0, y: 0 }, pressed: {}, buffer: [] });
  a.input = blank(); b.input = blank();
  return { mm, a, b, blank };
}

{
  const { mm, a, b, blank } = setupDuel();
  a.input = { dir: { x: 0, y: 0 }, pressed: { light: true }, buffer: [] };
  mm.update(1);
  ok(a.state === 'attack' && a.move && a.move.id === 'light', '按轻拳 → 进入 attack 状态且招式正确');
  for (let i = 0; i < 8; i++) { a.input = blank(); b.input = blank(); mm.update(1); }
  ok(b.health < b.maxHealth, '轻拳命中造成伤害 (' + Math.round(b.maxHealth - b.health) + ')');
  ok(b.state === 'hitstun' || b.state === 'knockdown' || b.state === 'idle' || b.state === 'air', '受击方进入硬直/恢复');
}

{
  const { mm, a, b, blank } = setupDuel();
  // 防御方按住后
  const holdBack = { dir: { x: 1, y: 0 }, pressed: {}, buffer: [] };
  b.input = holdBack;
  a.input = { dir: { x: 0, y: 0 }, pressed: { light: true }, buffer: [] };
  mm.update(1);
  for (let i = 0; i < 8; i++) { a.input = blank(); b.input = holdBack; mm.update(1); }
  const took = b.maxHealth - b.health;
  ok(took > 0 && took < 20, '格挡只吃少量削血 (' + Math.round(took) + ')');
  ok(b.state === 'blockstun' || b.state === 'idle' || b.state === 'crouch', '格挡后进入 blockstun');
}

{
  const { mm, a, b, blank } = setupDuel();
  b.x = 340;                      // 拉远，让气弹飞一段
  // 搓 236 + special 出气弹
  a.input = {
    dir: { x: 1, y: 0 }, pressed: { special: true },
    buffer: [
      { k: 'd', frame: FE.input.frame - 6 },
      { k: 'df', frame: FE.input.frame - 3 },
      { k: 'f', frame: FE.input.frame }
    ]
  };
  mm.update(1);
  ok(a.state === 'attack' && a.move && a.move.tags.includes('projectile'), '236+特殊 → 识别为气弹');
  for (let i = 0; i < 13; i++) { a.input = blank(); b.input = blank(); mm.update(1); }
  ok(mm.combat.projectiles.length > 0, '气弹已生成 (' + mm.combat.projectiles.length + ')');
  const pj = mm.combat.projectiles[0];
  ok(pj && pj.vx > 0, '气弹朝面向方向飞行');
}

{
  const { mm, a, b, blank } = setupDuel();
  // 能量不足时不应放超必杀
  a.meter = 0;
  a.input = {
    dir: { x: 1, y: 0 }, pressed: { super: true },
    buffer: [{ k: 'd', frame: FE.input.frame - 6 }, { k: 'df', frame: FE.input.frame - 3 }, { k: 'f', frame: FE.input.frame }]
  };
  mm.update(1);
  ok(!a.move || !a.move.tags.includes('super'), '能量不足时无法发动超必杀');
  a.meter = 100;
  a.state = 'idle'; a.move = null;
  a.input = {
    dir: { x: 1, y: 0 }, pressed: { super: true },
    buffer: [{ k: 'd', frame: FE.input.frame - 6 }, { k: 'df', frame: FE.input.frame - 3 }, { k: 'f', frame: FE.input.frame }]
  };
  mm.update(1);
  ok(a.move && a.move.tags.includes('super'), '能量充足时可发动超必杀');
}

{
  const { mm, a, b, blank } = setupDuel();
  // 跳跃
  a.input = { dir: { x: 0, y: -1 }, pressed: { jump: true }, buffer: [] };
  mm.update(1);
  ok(a.airborne, '跳跃指令生效，角色进入空中状态');
  a.input = blank(); b.input = blank();
  mm.update(1); mm.update(1);
  ok(a.y > 0, '角色离地 (y=' + Math.round(a.y) + ')');
  let n = 0;
  while (a.y > 0 && n < 200) { a.input = blank(); b.input = blank(); mm.update(1); n++; }
  ok(a.y === 0 && !a.airborne, '落地判定正常 (' + (n + 2) + ' 帧)');
}

/* =========================================================
   7. 参数热改
   ========================================================= */
section('参数热改');
const oldG = FE.balance.gravity;
FE.balance.gravity = 0.2;
const jf = new FE.Fighter(0, 'flame', 0, {});
jf.jump(0);
let peak = 0;
for (let i = 0; i < 40; i++) { jf.update(1, { opponentOf: () => null }); peak = Math.max(peak, jf.y); }
ok(peak > 120, '低重力下跳跃高度显著（峰值 ' + Math.round(peak) + '）');
FE.balance.gravity = 3.5;
const jf2 = new FE.Fighter(0, 'flame', 0, {});
jf2.jump(0);
let frames = 0;
while (jf2.y > 0 || frames === 0) { jf2.update(1, { opponentOf: () => null }); frames++; if (frames > 200) break; }
ok(frames < 45, '高重力下快速落地（' + frames + ' 帧）');
FE.balance.gravity = oldG;

/* =========================================================
   结果
   ========================================================= */
console.log('\n────────────────────────────');
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail) { console.log('有失败项'); process.exit(1); }
else console.log('全部通过 ✓');
