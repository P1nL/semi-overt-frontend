# semi-overt-frontend

微服务成果汇报专用前端，仅用于本地演示，与单体生产前端独立维护。

## 仓库边界

- 演示前端：`D:\works\semi-overt-frontend`，远端 `P1nL/semi-overt-frontend`。
- 演示后端：`D:\works\semi-overt-backend`，本地网关 `http://127.0.0.1:18080`。
- 生产前端仍为 `D:\works\semi-overt`，远端仍为 `P1nL/semi-overt`；不要从本仓库发布或推送到生产仓库。
- 本仓库基于生产提交 `33d3e21` 分离，保留了分离时尚未提交的微服务适配改动。
- 不得配置生产 SSH 密钥或触发生产发布。通用修复应单独审查后选择性同步。

## 本地启动与验证

先启动微服务后端，再在本仓库运行 `npm ci` 和 `npm run dev`。
前端默认监听 `http://127.0.0.1:15173`，`/api` 和 `/static` 默认代理到本地网关 `18080`；端口占用时直接报错。

也可以使用 PowerShell 7 脚本，显式固定相对 API 地址：

```powershell
pwsh -NoProfile -File "D:\works\semi-overt-frontend\scripts\dev-frontend.ps1" s5
```

```sh
npm run test:auth-session
npm run test:s3-frontend
npm run build
```

前端测试和构建通过不代表真实微服务全流程验收通过，也不代表生产已部署。

## 原项目开发说明

This project is built with Vue 3 and Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

## Notes

Check `git remote -v` before pushing: the demo remote must be `P1nL/semi-overt-frontend`, not the production repository.

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Local Demonstration

```sh
npm run build
```
