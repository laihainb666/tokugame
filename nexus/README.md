# NEXUS FIGHT — 可扩展格斗引擎

一个**零依赖**的浏览器格斗引擎原型，设计目标是「像死或生 / 火影那样能打，但所有东西都能被换掉」。

双击 `index.html` 即可运行，不需要服务器、不需要构建、不需要联网。

---

## 1. 它到底是什么

不是一个成品游戏，而是一套**分层可替换的格斗内核**：

```
┌──────────────────────────────────────────────────────┐
│  UI 层      app.js     面板 / 选人 / 工坊 / 管线       │  ← 可整体替换
├──────────────────────────────────────────────────────┤
│  渲染层     9 个后端 + Hyper 管线，全部热切换          │  ← 可新增后端
├──────────────────────────────────────────────────────┤
│  适配层     adapt.js   角色↔后端的适配检测与替身       │  ← 没适配也不消失
├──────────────────────────────────────────────────────┤
│  输入层     键盘 / 手柄 / 触屏 / AI / 自定义设备        │  ← 可新增设备
├──────────────────────────────────────────────────────┤
│  编排层     Engine / Match / Side / Round             │  ← 回合与比赛流程
├──────────────────────────────────────────────────────┤
│  规则层     Mode 插件（1v1 / 2v2换人 / 生存 / 乱斗）    │  ← 可新增模式
├──────────────────────────────────────────────────────┤
│  战斗层     Fighter 状态机 / Combat 命中解算            │  ← 手感地基，不建议模组改
│            （JS 浮点内核 与 C 定点内核 两套实现）        │
├──────────────────────────────────────────────────────┤
│  数据层     角色 / 招式帧数据 / 平衡参数                │  ← 纯数据，随便加
├──────────────────────────────────────────────────────┤
│  总线层     HookBus + Registry + ModLoader            │  ← 一切扩展的入口
└──────────────────────────────────────────────────────┘
```

**关键约束**：战斗层不认识"轻拳"、"火球"、"升龙"，它只认识
`起手帧 / 判定帧 / 收招帧 / 判定盒 / 取消窗口 / 指令`。
所以新增招式、新增角色、新增模式，全都是**写数据**，不是写代码。

---

## 2. 九种渲染后端（设置里热切换，或按 F1）

| 后端 | 架构 | 说明 |
|---|---|---|
| **3D 实时** | 自研透视投影 + 面法线 + 深度排序 + 平面着色，跑在 Canvas 2D 上 | 角色是骨骼盒体拼的，3/4 视角，有体积感和影子 |
| **2.5D 侧视** | 矢量描边角色 + 多层视差背景 | 性能最好，动作细节最清楚 |
| **纯内核数据** | 不画任何角色 | 只输出状态机、帧数据条、判定盒坐标、钩子调用次数 |
| **C 内核** | Q16.16 定点、零分配、逐帧哈希 | 见第 11 节，对应 `native/nexus.c` || **像素风** | 320×180 离屏缓冲 → 最近邻放大 | 硬边像素，零模型 |
| **水墨风** | 宣纸底 + 锥形毛笔笔触 + 飞白 + 朱印 | 全实时笔刷，无贴图 |
| **霓虹风** | 暗场 + 加色辉光 + 拖影 + 扫描线 | 线框发光 |
| **赛璐璐** | 平涂 + 粗描边 + 赛璐璐阴影 + 冲击帧 | 动画片质感 |
| **Hyper 管线** | 基础后端 + 可编排通道链 + 自定义脚本 | 见 4.9，能直接改写渲染方式 |

第三种存在的意义：**证明渲染层和战斗内核完全解耦**。同一场比赛，九种呈现方式读的是同一份 `match` 对象。

后六种全部是**零美术资源**的：没有模型、没有贴图、没有骨骼文件，
角色由骨架 + 配色实时生成。所以新增一个角色不需要任何美术工作。

---

## 3. 操作

| 键 | 功能 |
|---|---|
| `A` / `D` | 前后移动（双击 = 冲刺） |
| `W` | 跳跃 |
| `S` | 下蹲（配合后退 = 蹲防） |
| `J` / `K` | 轻击 / 重击 |
| `L` | 特殊技（配合方向搓招） |
| `U` | 超必杀（需 50 能量） |
| `I` / `O` | 换人 / 呼叫协战（仅 2v2 模式） |
| `Esc` / `R` / `F1` | 暂停 / 重开 / 切换渲染后端 |

**搓招**：`236 + L` 气弹 · `214 + L` 突进 · `623 + K` 升龙（起手无敌）· `22 + K` 投技

P2 默认是 AI，可在「设置 → 输入设备」切成键盘双人、手柄或空输入。

---

## 4. 扩展点：六种加东西的方式

### 4.1 加一个角色（纯数据）

```js
FE.registerMod({
  id: 'my-char', name: '角色包：某人',
  setup(api) {
    api.addCharacter('mychar', {
      name: '某', title: 'MINE', archetype: '均衡',
      avatar: '某',
      palette: { main:'#0f0', dark:'#060', light:'#9f9',
                 accent:'#ff0', skin:'#eec', hair:'#111',
                 gi:'#0a0', belt:'#000', aura:'#0f0' },
      stats: { health:1, walk:1, dash:1, jump:1, weight:1, gravity:1, meterGain:1 },
      moves: [ /* 见 4.2 */ ],
      tag: { assist: 'light', switchIn: 'rush', call: '协战' }
    });
  }
});
```

注册完立刻出现在选人界面，不用刷新。

### 4.2 加一个招式

招式从模板派生，只写差异：

```js
const D = FE.moves.derive;

D('heavy', {
  id: 'my_heavy',
  name: '崩山击',
  startup: 14, active: 5, recovery: 22,   // 帧
  hitbox: { x: 56, y: 104, w: 70, h: 40 },
  damage: 110,
  hitstun: 26, blockstun: 15, hitstop: 11,
  kb: { x: 5, y: 2 },
  height: 'mid',                          // mid / low / overhead / unblockable
  onHit: 'knockdown',
  cancel: ['super'], cancelFrom: [14, 22], // 可取消窗口
  anim: 'straight',                        // 动画类型，见 anim.js
  tags: ['heavy', 'normal']
})
```

可用动画类型：`jab / straight / kick_mid / crouch_jab / sweep / uppercut /
air_jab / air_kick / throw / cast / rush / super / dash / taunt`

> 新增 anim 类型只需往 `FE.anim.ATTACKS` 里加一个 `(pose, ext) => {}` 函数。

### 4.3 加一个战斗模式

```js
api.addMode('mymode', {
  name: '我的模式', short: 'MINE',
  teamSize: 1, roundsToWin: 2, simultaneous: false,
  timeLimit: () => 60,
  buildRoster(match) { return [[match.pick[0]], [match.pick[1]]]; },
  onRoundStart(match) { match.sides.forEach(s => s.resetRoster()); },
  onTick(match, dt) {},
  onFighterKO(match, fighter) {},
  checkRoundEnd(match) { /* 返回 0 / 1 / 'draw' / null */ }
});
```

`simultaneous: true` 就是多人同场（内置的「乱斗 2v2」就是这么写的）。

### 4.4 加一个输入设备（多模态）

```js
api.addInput('voice', {
  name: '语音指令', short: 'MIC',
  poll(st, fighter, match) {
    // st.dir / st.pressed 是唯一契约
    if (recognized('前进')) st.setDir(1, 0);
    if (recognized('拳'))   st.press('light');
    return st;
  }
});
```

同一个接口下，键盘、手柄、触屏、AI 都是"设备"。AI 也是走同一套规则出招
（要搓招、会打空、会被确反），不是作弊。

### 4.5 加一个渲染后端

```js
api.addRenderer('ascii', {
  name: '字符画', short: 'ASCII',
  create(engine) {
    return { draw(match) { /* 读 match.fighters 自己画 */ } };
  }
});
```

### 4.6 挂钩子（最细粒度的介入）

```js
api.on('combat:hit', e => {
  e.damage *= 1.5;          // 改伤害
  e.hitstop += 3;           // 改顿帧
  // return false;          // 或直接拦截这次命中
}, { priority: 10 });
```

钩子支持：**优先级**（大的先跑）、**拦截**（`return false` 阻断后续）、
**一次性**（`once`）、**作用域卸载**（模组停用时一次性摘干净）、
**错误隔离**（单个回调抛错不会炸总线）。

### 4.7 角色适配检测（没适配也不消失）

角色定义里声明自己做了哪些后端：

```js
adapters: ['3d', '25d', 'toon']     // 只做了这三个
```

引擎在切换后端时自动检测：

- **支持** → 用角色自己的 `look`（发型 / 体型 / 配件 / 光效）
- **不支持** → 自动生成一个中性替身，配色仍然正确，头顶标 `AUTO`

内置演示：焰做了全部九个；霜没做像素/霓虹；岩没做水墨/赛璐璐；
模组角色「影」只做了 2.5D 和像素 —— 切到其他后端时你会看到它
自动降级成一个能打能动的替身，而不是消失或报错。

规则细节：

- 不写 `adapters` 字段 → 视为**全适配**（向后兼容）
- `adapters: []` → **全都不适配**，全部走替身（创意工坊生成的角色就是这样）
- 设置面板会实时提示「霜 未适配 neon → 自动生成替身」

### 4.8 图片生成角色 + 创意工坊

「工坊」页拖一张图进去：

1. 居中裁切 → 64×64 采样
2. 颜色分桶统计 → 提取主色 / 暗部 / 亮部 / 点缀色
3. 按色相与饱和度分配九个配色槽位（皮肤 / 头发 / 道服 / 腰带 / 气场…）
4. 生成完整可玩角色（招式从模板派生）
5. 存进 localStorage，可启用 / 删除 / 导出 JSON / 导入别人的包

生成的角色 `adapters` 为空 → 所有后端都走自动替身，配色由图片决定。
也就是说：**你不需要建模、不需要画立绘，一张图就能出一个角色**。

### 4.9 Hyper 渲染管线（可以直接改写渲染方式）

它不是一个新画风，而是套在所有后端之上的一层：

```
任意基础后端 → [可编排通道链] → 自定义脚本 → 屏幕
```

- **基础后端**：九种里任选一种作为底
- **通道链**：调色 / 辉光 / 色散 / 像素化 / 扫描线 / 颗粒 / 暗角，
  可以任意开关、调参、按顺序执行（严格 ping-pong 双缓冲）
- **预设**：干净 / 街机 CRT / 赛博 / 胶片 / 宣纸
- **自定义脚本**：最后一步拿到 `api.ctx` 和 `api.src`，直接画

```js
// api = { ctx, src, W, H, frame, time }
const y = (api.time * 120) % (api.H + 200) - 100;
const g = api.ctx.createLinearGradient(0, y - 50, 0, y + 50);
g.addColorStop(0, 'rgba(120,220,255,0)');
g.addColorStop(0.5, 'rgba(120,220,255,.22)');
g.addColorStop(1, 'rgba(120,220,255,0)');
api.ctx.fillStyle = g;
api.ctx.fillRect(0, y - 50, api.W, 100);
```

这段代码就能给画面加一条扫描光带 —— 不改引擎一行源码。
脚本有 try/catch 保护，写错了只会报错停用，不会卡死渲染。

> **性能**：每个通道都是一次全画布合成。全部打开（尤其色散）会明显掉帧，
> 按需关掉即可。辉光已做 1/4 降采样优化；纯软件渲染环境（无 GPU）下
> 建议只开 2～3 个通道。

---

## 5. 钩子清单（`FE.HOOKS`）

| 分类 | 钩子 |
|---|---|
| 引擎 | `engine:init` `engine:frame` `engine:beforeUpdate` `engine:afterUpdate` `engine:beforeRender` `engine:afterRender` `engine:pause` |
| 比赛 | `match:start` `match:end` `round:start` `round:end` `round:countdown` `round:fight` |
| 角色 | `fighter:beforeSpawn` `fighter:spawned` `fighter:preUpdate` `fighter:postUpdate` `fighter:stateChange` `fighter:damaged` `fighter:ko` `fighter:land` `fighter:jump` `fighter:airJump` `fighter:meterChange` |
| 战斗 | `combat:beforeHit` `combat:hit` `combat:block` `combat:comboScale` `combat:pushback` `combat:projectile` `combat:throw` |
| 招式 | `move:select` `move:beforeExecute` `move:afterExecute` `move:cancel` `move:frame` |
| 输入 | `input:raw` `input:mapped` `input:buffer` `input:deviceChange` |
| 渲染 | `render:beforeDraw` `render:afterDraw` `render:world` `render:hud` `render:debug` |
| 系统 | `mod:load` `mod:unload` `mod:error` `ui:log` |

侧栏「钩子」面板会实时显示每个钩子的调用次数和监听者数量。

---

## 6. 内置模组（全部可在面板里热插拔）

| 模组 | 演示的扩展方式 |
|---|---|
| 连段强化特效 | 钩子改顿帧 / 震屏 / 加粒子，连段越长越夸张 |
| 角色包：影 | `addCharacter` 注入第 4 个完整角色 |
| 重击霸体 | `move:beforeExecute` 里给招式加霸体次数 |
| 二段跳 / 空中冲刺 | 钩子实现全新移动能力，不改内核 |
| 低重力实验室 | 直接改写全局平衡参数 |
| 模式包：乱斗 2v2 | `addMode` + `simultaneous` 实现四人同场 |

面板「模组 → 载入自定义模组」可以直接粘一段 JS 现场生效，不用重启。

---

## 7. 目录结构

```
index.html                  入口（按依赖顺序加载，无模块打包）
assets/style.css            UI 样式
native/
  nexus.c                   纯 C 内核（单文件、C99、零依赖）
  Makefile / build.bat      一键编译
  GOLDEN.txt                基准哈希（C 与 JS 必须一致）
  README.md                 编译与对拍说明
src/
  core/
    bus.js                  HookBus 钩子总线（优先级/拦截/作用域/错误隔离）
    registry.js             预制体注册表 + 工具函数
    engine.js               Match / Side / Round / 主循环
    modloader.js            模组加载器 + ModAPI
  data/
    balance.js              全局平衡参数（带 UI 滑块元数据）
    moves.js                招式模板 + 帧数据归一化
    characters.js           三个内置角色（焰 / 霜 / 岩）
    modes.js                1v1 / 2v2换人 / 生存
    toku-pack.js            内容包数据（326 角色 + 13 战场，自动生成）
    packs.js                内容包翻译器：原字段 → 引擎角色
  combat/
    anim.js                 程序化骨架动画（状态 + 帧进度 → 关节坐标）
    fighter.js              角色状态机 / 物理 / 招式选择
    combat.js               命中解算 / 连段递减 / 投射物 / 推挤
  kernel/
    c-kernel.js             native/nexus.c 的逐位同构 JS 镜像
  input/
    input.js                输入抽象 + 指令识别 + 设备注册
    ai.js                   AI 作为输入设备
  render/
    hud.js                  共用 HUD（血条 / 能量 / 连段 / 调试盒）
    adapt.js                角色适配检测 + 自动替身外观
    spritekit.js            2D 风格化后端共用底座（骨架/笔触/相机）
    renderer3d.js           3D 后端（自研投影 + 面排序）
    renderer25d.js          2.5D 后端
    rendererdata.js         纯数据后端
    rendererc.js            C 内核后端（蓝图线框 + 哈希遥测）
    rendererstyled.js       像素 / 水墨 / 霓虹 / 赛璐璐
    rendererhyper.js        Hyper 渲染管线（通道链 + 脚本）
  mods/builtin.js           6 个内置示例模组
  ui/
    workshop.js             图片取色 + 创意工坊（localStorage）
    app.js                  面板装配
test/
  headless.js               无头自测（118 项）
  c-hash.js                 C 内核基准哈希
```

---

## 8. 帧数据速查

60 逻辑帧 / 秒。招式总帧 = `startup + active + recovery`。

- `startup` 起手：按下到出现判定
- `active` 判定：判定盒存在的帧数
- `recovery` 收招：判定消失到能再次行动
- `cancelFrom` 取消窗口：在这段帧内命中/命中被挡可以接下一招
- `hitstun / blockstun` 硬直帧数
- `hitstop` 命中顿帧（打击感的主要来源）
- `juggle` 空中追打递减（`combat.js` 里按 `juggleCount` 衰减击飞高度）

想调手感，先动 `balance.js` 里的 `gravity / hitstopScale / comboScaling`。

---

## 9. 自测

```bash
node test/headless.js
```

在 Node 里用假 Canvas 上下文跑完整内核 + 九个渲染器，覆盖：
对战流程、判定盒几何、招式数据完整性、模组热插拔与卸载、钩子语义
（优先级/拦截/once/作用域）、三种模式、输入→招式→命中/格挡全链路、
参数热改、跳跃与落地、角色适配检测、Hyper 通道链与脚本、
创意工坊注册与配色提取、C 内核确定性与黄金哈希。

当前：**118 / 118 通过**。

```bash
node test/c-hash.js      # 单独跑 C 内核基准哈希
```

---

## 10. C 内核（`native/nexus.c`）

这是**第二个独立内核**，不是 JS 内核的包装：

| | JS 内核 | C 内核 |
|---|---|---|
| 数值 | 浮点 | Q16.16 定点整数 |
| 内存 | 对象 + 动态数组 | 定长结构体 + 静态数组，零分配 |
| 状态机 | 回调 + 字符串状态 | 显式 `switch` + 枚举 |
| 随机 | `Math.random` | xorshift32 |
| 可复现 | 否 | 每帧产出 FNV-1a 状态哈希，逐位可复现 |

浏览器里跑的是 `src/kernel/c-kernel.js` —— 与 `nexus.c` **逐行同构**的镜像
（本机没有 C 编译器，所以先跑镜像）。有编译器时：

```bash
cd native
gcc -O2 -std=c99 nexus.c -o nexus
./nexus 900 12345
# 期望：hash@60=AD80AAA9   FINAL_HASH=280F7260
```

这个哈希必须与浏览器「C 内核」面板上显示的一致。一致 = 两个内核逐位等价，
也就顺带证明了定点数运算、随机数、分支顺序在两侧完全对齐。

> 改了 C 内核里任何一处数值或运算顺序，哈希都会变 —— 这正是它作为
> 回归测试的价值。

---

## 11. 内容包：特摄英雄大乱斗

引擎本身只有 4 个角色。真正的内容来自**内容包** —— 把
[`laihainb666/tokugame`](https://github.com/laihainb666/tokugame) v38 的
**326 名角色 + 13 张战场**整套导入进来。

导入管线（三步，全部在 `tools/` 里）：

```
tokugame-v38-marvis.html
        │  tools/extract-toku.js   括号匹配抽出 CHARS / NEW_CHARS / STAGES
        ▼
   tools/out/toku-raw.json         459KB 原始数据
        │  tools/gen-pack.js       裁剪成引擎需要的字段
        ▼
 src/data/toku-pack.js             166KB 紧凑数据包（一行一个角色）
        │  src/data/packs.js       运行时翻译成引擎角色（20ms / 326 人）
        ▼
      FE.characters              直接出现在选人花名册里
```

字段映射：

| 原项目 | 引擎 |
|---|---|
| `colors.{main,dark,fore,accent,glow}` | `palette.{main,dark,light,accent,aura}` |
| `hp / speed / jumpV` | `stats.health / walk / jump` |
| `power` | 招式伤害系数 |
| `pAtk` | 飞行道具（`236 + 特殊`） |
| `small` | 突进技（`214 + 特殊`） |
| `skill2` | 第二必杀（`623 + 特殊`） |
| `special` | 超必杀（`236 + 超必`） |
| `head` | `look`（发型 / 体型 / 围巾 / 光效） |

**没有为任何一个角色单独写代码**：326 个角色走的是同一套翻译规则，
每个角色 13 个招式，全部由模板派生。

选人界面按原作分组筛选：奥特曼 36 · 假面骑士 9 · 战队 5 · 漫威 20 ·
DC 10 · 动漫 57 · 游戏 42 · 西方 30 · 中国 50 · Ben 10 10 · 其他 57。

战场会驱动渲染层的天空 / 远山 / 地面配色，在 3D、2.5D、像素、赛璐璐四个后端上生效。

> 原项目的联机、道具战、剧情模式等没有移植 —— 那是它单文件版的强项，
> 这个引擎专注的是"内核可替换、渲染可编程"。

---

## 12. 已知边界

- 战斗平面是 2D 的（x 横向 + y 纵向），3D 只提供视角与体积，不做侧移/纵深判定
  （想加 DOA 式侧移，在 `Fighter` 加 `z` 轴并让 `hurtbox()` 带上 z 即可）。
- 没有网络对战、没有录像回放（但输入层已是"设备"抽象，接回放只需再加一个设备）。
- 动画是程序化的，没有骨骼文件导入；要接美术资源，替换 `anim.solve()` 的输出即可。
- 音效未接入（`move.sfx` 字段已预留）。
- **创意工坊是本地存储**（localStorage），没有服务端。跨设备靠导出/导入 JSON。
  同一浏览器下 `file://` 打开时部分环境会禁用 localStorage，此时内容只在本次会话有效
  （面板会提示）。
- **Hyper 脚本不做沙箱**，它是给开发者用的，`new Function` 直接执行。别粘贴来路不明的脚本。
- 图片取色用的是简单的颜色分桶，不是 k-means；对纯色背景的图效果最好，
  复杂照片会偏向平均色。要更准可以替换 `workshop.js` 里的 `extractPalette`。
- 四个风格化后端为了保持零资源，角色是"骨架 + 配色"生成的，没有逐角色定制立绘；
  这正是 `adapters` 机制存在的原因 —— 真做了美术适配的角色可以走专属外观。
