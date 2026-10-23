# NEXUS FIGHT — C 内核
#
#   make            编译本地 CLI
#   make run        跑 900 帧并打印哈希
#   make wasm       编译成 WebAssembly（需要 clang 或 emscripten）
#   make verify     跑 C 版并与 GOLDEN.txt 对比
#   make clean

CC      ?= cc
CFLAGS  ?= -O2 -std=c99 -Wall -Wextra -pedantic
BIN     ?= nexus

ifeq ($(OS),Windows_NT)
  BIN := nexus.exe
endif

all: $(BIN)

$(BIN): nexus.c
	$(CC) $(CFLAGS) nexus.c -o $(BIN)

run: $(BIN)
	./$(BIN) 900 12345

verify: $(BIN)
	@echo "期望: hash@60=AD80AAA9  FINAL_HASH=280F7260"
	@./$(BIN) 900 12345 --quiet | grep -E "hash@60|FINAL_HASH"

# --- WebAssembly（二选一） -------------------------------------------------
# 1) clang 自带 wasm 后端（无需 emscripten）
wasm: nexus.c
	clang --target=wasm32 -nostdlib -O2 -DNK_NO_MAIN \
	      -Wl,--no-entry -Wl,--export-all \
	      -o nexus.wasm nexus.c

# 2) emscripten
wasm-emcc: nexus.c
	emcc -O2 -DNK_NO_MAIN \
	     -s EXPORTED_FUNCTIONS='["_nk_init","_nk_step","_nk_hash","_malloc","_free"]' \
	     -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAP32"]' \
	     nexus.c -o nexus.js

clean:
	rm -f nexus nexus.exe nexus.wasm nexus.js nexus.wasm.js

.PHONY: all run verify wasm wasm-emcc clean
