@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   NEXUS FIGHT / C kernel  -  build
echo ============================================
echo.

where cl >nul 2>nul
if %errorlevel%==0 (
  echo [MSVC] cl /O2 nexus.c /Fe:nexus.exe
  cl /nologo /O2 nexus.c /Fe:nexus.exe
  if %errorlevel%==0 goto :ok
)

where gcc >nul 2>nul
if %errorlevel%==0 (
  echo [GCC] gcc -O2 -std=c99 nexus.c -o nexus.exe
  gcc -O2 -std=c99 nexus.c -o nexus.exe
  if %errorlevel%==0 goto :ok
)

where clang >nul 2>nul
if %errorlevel%==0 (
  echo [Clang] clang -O2 nexus.c -o nexus.exe
  clang -O2 nexus.c -o nexus.exe
  if %errorlevel%==0 goto :ok
)

echo.
echo 没找到 C 编译器。
echo 任选其一安装后重试：
echo   - Visual Studio Build Tools  ^(含 MSVC^)
echo   - MinGW-w64 / MSYS2          ^(gcc^)
echo   - LLVM                       ^(clang^)
echo.
echo 也可以直接用在线编译器验证：把 nexus.c 粘到 godbolt.org 选 C 语言。
exit /b 1

:ok
echo.
echo 编译成功。运行：
echo    nexus.exe 900 12345
echo.
echo 期望输出：
echo    hash@60=AD80AAA9
echo    FINAL_HASH=280F7260
endlocal
