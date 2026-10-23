# native — 纯 C 内核

单文件、C99、零依赖。不引任何库，不 malloc，不含平台相关代码。

## 编译

任选一种：

```bash
gcc   -O2 -std=c99 nexus.c -o nexus          # Linux / macOS / MSYS2
clang -O2 nexus.c -o nexus
tcc   nexus.c -o nexus.exe
cl    nexus.c /O2 /Fe:nexus.exe              # MSVC
```

或者直接：

```bash
make            # 自动选 cc
make run        # 跑 900 帧
make verify     # 与 GOLDEN.txt 对拍
```

Windows 上双击 `build.bat`，它会依次尝试 cl / gcc / clang。

## 运行

```bash
./nexus                   # 默认 900 帧, seed 12345
./nexus 1800 777          # 1800 帧, seed 777
./nexus 900 12345 --quiet # 只打印最终哈希
```

输出示例：

```
f00060  P1 attack    hp= 742 m=  3 x=  -42.31 | P2 hitstun   hp= 690 m=  9 x=   31.02  hash=AD80AAA9
...
FINAL_HASH=280F7260
```

## 与浏览器对拍

浏览器里跑的是 `src/kernel/c-kernel.js`，它是 `nexus.c` 的逐行同构镜像
（本机没有 C 编译器，所以先跑镜像）。

打开 `index.html` → 右侧「渲染后端」选 **C 内核 (C99)**，
面板上显示的 `STATE HASH` 必须与 C 版一致：

```
seed = 12345, 900 帧
hash@60    = AD80AAA9
FINAL_HASH = 280F7260
```

一致即证明两侧的定点运算、xorshift、分支顺序完全等价。
详见 `GOLDEN.txt`。

## 编译成 WebAssembly

```bash
# 1) clang 自带 wasm 后端
clang --target=wasm32 -nostdlib -O2 -DNK_NO_MAIN \
      -Wl,--no-entry -Wl,--export-all \
      -o nexus.wasm nexus.c

# 2) emscripten
emcc -O2 -DNK_NO_MAIN \
     -s EXPORTED_FUNCTIONS='["_nk_init","_nk_step","_nk_hash","_malloc","_free"]' \
     nexus.c -o nexus.js
```

`-DNK_NO_MAIN` 会去掉 CLI 的 `main()`，只留内核。

## 结构

| 段 | 内容 |
|---|---|
| 定点 | `fx` = int32 Q16.16，`fx_mul` / `fx_div` 用 int64 中间量 |
| 常量 | 重力 / 跳跃 / 摩擦全部预先算成整数，避免浮点常量差异 |
| 数据 | `NK_MOVES[]` 招式表（帧数据 + 判定盒 + 击退，全整数） |
| 状态 | `NkState` 定长结构体，两个角色 + 8 个投射物 + 回放缓冲 |
| 逻辑 | `nk_step_fighter` / `nk_resolve` / `nk_update_proj` / `nk_ai` |
| 校验 | `nk_hash` 逐字段 FNV-1a（不含结构体 padding，跨平台稳定） |

## 为什么值得单独做一份 C 内核

1. **确定性**：定点 + xorshift，同 seed 同输入 → 逐位相同的哈希。
   这是回放、断线重连、帧同步联机的先决条件，浮点内核做不到。
2. **零分配**：热路径里没有 malloc，没有 GC 抖动。
3. **可移植**：整个内核不依赖平台，编到 WASM 就能在浏览器里跑同一份逻辑。
4. **可验证**：哈希就是回归测试。改完内核跑一遍，哈希变了就说明行为变了。
