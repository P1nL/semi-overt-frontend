# VS Code 前端切换启动

本脚本属于微服务演示仓库 `D:\works\semi-overt-frontend`。生产前端在独立的 `D:\works\semi-overt` 中维护；这里的 `monolith` 参数仅用于显式的本地兼容诊断，不代表生产前端验证。

在 VS Code 的 PowerShell 7 终端中运行，无需手动设置环境变量，也无需先进入特定目录。

## 微服务模式（默认）

先单独启动 S5 后端，再运行：

```powershell
pwsh -NoProfile -File "D:\works\semi-overt-frontend\scripts\dev-frontend.ps1" s5
```

前端：`http://localhost:15173`；API 和静态文件代理到微服务网关 `18080`。
省略 `s5` 参数也会使用此模式。

## 单体模式

先确认原单体后端已在 `8080` 运行，再执行：

```powershell
pwsh -NoProfile -File "D:\works\semi-overt-frontend\scripts\dev-frontend.ps1" monolith
```

前端：`http://localhost:5173`；API 和静态文件代理到原单体 `8080`。

## 切换与停止

- 在运行前端的终端按 **Ctrl+C**，然后执行另一种模式的命令。
- 脚本只启动前端，不启动、不关闭后端或 Docker 容器。
- 端口占用时会直接报错，不会跳到其他端口，也不会杀掉已有进程。
- 使用当前仓库已安装的 Node/Vite；缺少依赖时，先在 `D:\works\semi-overt-frontend` 执行 `npm ci`。
- `VITE_DEV_PROXY_TARGET` 和 `VITE_API_BASE_URL` 只在本次运行中设置，退出时恢复原值；不会改写 `.env`、用户/系统环境变量或线上配置。
- 启动期间强制使用相对 API 路径 `/api/v1`，防止原有绝对 API 地址绕过所选代理。
- API 的 `/api` 和静态资源的 `/static` 代理开关位于 `D:\works\semi-overt-frontend\vite.config.ts`；不要移除该开关。
- 该脚本不构建生产产物、不执行测试；启动成功不代表后端功能全部验收通过。
