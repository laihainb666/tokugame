/* ==========================================================
   Workshop — 图片生成角色 + 本地创意工坊
   ----------------------------------------------------------
   上传任意一张图：
     1. 居中裁切 → 64×64 采样
     2. 颜色分桶统计 → 提取主色 / 暗部 / 亮部 / 点缀色
     3. 按色相饱和度分配角色配色槽位（皮肤/头发/道服/腰带/气场）
     4. 生成一个完整可玩的角色预制体（招式从模板派生）
     5. 存进本地工坊（localStorage），随时启用 / 删除 / 导出

   生成的角色的 adapters 为空数组 —— 也就是说它没有为任何渲染
   后端做过美术适配，所有后端都会走"自动替身"路径。
   这正是"未适配角色自动识别成角色"的完整演示。
   ========================================================== */
(function () {
  'use strict';
  const FE = (window.FE = window.FE || {});
  const U = FE.util;

  const KEY = 'nexus.workshop.v1';

  /* ---------------- 颜色工具 ---------------- */
  function hex2rgb(h) {
    const n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgb2hex(r, g, b) {
    const f = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (mx === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
  }
  function hsl2hex(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = U.clamp(s, 0, 1); l = U.clamp(l, 0, 1);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return rgb2hex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
  }
  function adjust(hex, dl, ds) {
    const c = hex2rgb(hex);
    const hsl = rgb2hsl(c.r, c.g, c.b);
    return hsl2hex(hsl.h, hsl.s + (ds || 0), hsl.l + (dl || 0));
  }
  function lum(hex) {
    const c = hex2rgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }
  function dist(a, b) {
    const x = hex2rgb(a), y = hex2rgb(b);
    return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
  }

  /* ---------------- 提取配色 ---------------- */
  function extractPalette(img) {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');

    // 居中裁切（cover）
    const ar = img.width / img.height;
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    if (ar > 1) { sw = img.height; sx = (img.width - sw) / 2; }
    else { sh = img.width; sy = (img.height - sh) / 2; }
    g.drawImage(img, sx, sy, sw, sh, 0, 0, S, S);

    const data = g.getImageData(0, 0, S, S).data;
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 128) continue;
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      // 跳过接近纯黑/纯白的像素（背景）
      const l = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
      if (l < 0.04 || l > 0.97) continue;
      const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
      let e = buckets.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
      e.n++; e.r += r; e.g += gg; e.b += b;
    }

    const list = [...buckets.values()]
      .map(e => ({ hex: rgb2hex(e.r / e.n, e.g / e.n, e.b / e.n), n: e.n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 40);

    // 去重
    const picked = [];
    for (const c2 of list) {
      if (picked.every(p => dist(p.hex, c2.hex) > 34)) picked.push(c2);
      if (picked.length >= 8) break;
    }
    while (picked.length < 4) picked.push({ hex: '#888888', n: 1 });

    const hexes = picked.map(p => p.hex);
    const withHsl = hexes.map(h => ({ hex: h, ...rgb2hsl(...Object.values(hex2rgb(h))) }));

    // 主色：饱和度 × 数量权重最高
    let main = withHsl[0];
    let best = -1;
    for (const c3 of withHsl) {
      const score = c3.s * 1.6 + lum(c3.hex) * 0.3;
      if (score > best) { best = score; main = c3; }
    }
    // 点缀色：与主色色相距离最大
    let accent = withHsl[1] || main;
    let bestHue = -1;
    for (const c4 of withHsl) {
      if (c4 === main) continue;
      let dh = Math.abs(c4.h - main.h);
      if (dh > 180) dh = 360 - dh;
      const score = dh * 0.7 + c4.s * 60;
      if (score > bestHue) { bestHue = score; accent = c4; }
    }
    // 最亮 / 最暗
    let lightest = withHsl[0], darkest = withHsl[0];
    for (const c5 of withHsl) {
      if (lum(c5.hex) > lum(lightest.hex)) lightest = c5;
      if (lum(c5.hex) < lum(darkest.hex)) darkest = c5;
    }

    const mainHex = main.hex;
    const palette = {
      main: mainHex,
      dark: adjust(darkest.hex, -0.10, 0),
      light: adjust(lightest.hex, 0.14, -0.05),
      accent: accent.hex,
      skin: hsl2hex(main.h * 0.16 + 22, 0.32, 0.72),
      hair: adjust(darkest.hex, -0.12, 0.05),
      gi: adjust(mainHex, -0.06, 0),
      belt: adjust(darkest.hex, -0.06, 0),
      aura: adjust(accent.hex, 0.12, 0.10)
    };

    // 缩略图
    const tc = document.createElement('canvas');
    tc.width = 96; tc.height = 96;
    const tg = tc.getContext('2d');
    tg.drawImage(img, sx, sy, sw, sh, 0, 0, 96, 96);
    const thumb = tc.toDataURL('image/jpeg', 0.72);

    return { palette, thumb };
  }

  /* ---------------- 招式模板 ---------------- */
  function makeKit() {
    const D = FE.moves.derive;
    return [
      D('light', { id: 'light', name: '快击' }),
      D('heavy', { id: 'heavy', name: '重击' }),
      D('kick', { id: 'kick', name: '回旋踢' }),
      D('crouch_light', { id: 'crouch_light', name: '蹲击' }),
      D('sweep', { id: 'sweep', name: '扫腿' }),
      D('uppercut', { id: 'uppercut', name: '升击' }),
      D('air_light', { id: 'air_light', name: '空击' }),
      D('air_heavy', { id: 'air_heavy', name: '空踢' }),
      D('throw', { id: 'throw', name: '投技' }),
      D('fireball', {
        id: 'ws_shot', name: '气弹', anim: 'cast',
        projectile: {
          speed: 9, damage: 58, hitstun: 19, blockstun: 12, hitstop: 6,
          w: 34, h: 30, life: 120, kb: { x: 3, y: 1.2 }, fx: 'orb', element: 'neutral'
        }
      }),
      D('rush', { id: 'ws_rush', name: '突进', damage: 80 }),
      D('super', { id: 'super', name: '超必杀', damage: 230 })
    ];
  }

  /* ---------------- 工坊 ---------------- */
  const workshop = {
    items: [],
    storageOk: true,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        this.items = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.storageOk = false;
        this.items = [];
      }
      return this.items;
    },

    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.items));
      } catch (e) {
        this.storageOk = false;
        FE.log('本地存储不可用，工坊内容仅存在于本次会话', 'err');
      }
    },

    /** 从图片生成角色定义 */
    async fromFile(file) {
      const url = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = url;
      });
      const { palette, thumb } = extractPalette(img);
      const base = (file.name || '自定义').replace(/\.[^.]+$/, '').slice(0, 12);
      const id = 'ws_' + Date.now().toString(36);
      return {
        id,
        name: base || '自定义',
        title: 'WORKSHOP',
        createdAt: Date.now(),
        thumb,
        palette,
        def: {
          id,
          name: base || '自定义',
          title: 'WORKSHOP',
          archetype: '图片生成',
          avatar: (base || '自')[0],
          desc: '由上传图片自动提取配色生成。未做任何后端美术适配。',
          palette,
          adapters: [],                      // 空 = 所有后端都走自动替身
          stats: {
            health: 1, walk: 1.02, dash: 1, jump: 1,
            weight: 1, gravity: 1, meterGain: 1
          },
          moves: makeKit(),
          tag: { assist: 'ws_rush', switchIn: 'ws_rush', call: '突进' },
          quote: '（来自创意工坊）'
        }
      };
    },

    add(item) {
      this.items.unshift(item);
      if (this.items.length > 24) this.items.pop();
      this.save();
      this.register(item);
      return item;
    },

    remove(id) {
      const i = this.items.findIndex(x => x.id === id);
      if (i < 0) return false;
      this.items.splice(i, 1);
      this.save();
      if (FE.characters.has(id)) FE.characters.remove(id);
      const idx = FE.charOrder.indexOf(id);
      if (idx >= 0) FE.charOrder.splice(idx, 1);
      return true;
    },

    /** 把工坊条目注册成可玩角色 */
    register(item) {
      if (FE.characters.has(item.id)) return;
      FE.characters.register(item.id, U.clone(item.def));
      if (!FE.charOrder.includes(item.id)) FE.charOrder.push(item.id);
    },

    registerAll() {
      for (const it of this.items) this.register(it);
      return this.items.length;
    },

    exportAll() {
      return JSON.stringify({
        format: 'nexus-workshop',
        version: 1,
        exportedAt: new Date().toISOString(),
        items: this.items
      }, null, 2);
    },

    importAll(json) {
      const data = JSON.parse(json);
      const list = data.items || data;
      if (!Array.isArray(list)) throw new Error('格式不正确');
      let n = 0;
      for (const it of list) {
        if (!it || !it.id || !it.def) continue;
        if (this.items.some(x => x.id === it.id)) it.id = it.id + '_' + n;
        this.items.push(it);
        this.register(it);
        n++;
      }
      this.save();
      return n;
    }
  };

  FE.workshop = workshop;
  FE.workshop.extractPalette = extractPalette;
  FE.workshop.color = { hex2rgb, rgb2hex, rgb2hsl, hsl2hex, adjust, lum, dist };
})();
