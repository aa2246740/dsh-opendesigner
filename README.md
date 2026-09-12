# dsh-opendesigner

```sh
dsh plugin --profile web add github:aa2246740/dsh-opendesigner
```

PATH 上要有官方 `dsh`（没有就用 `npx @deepseek-ai/dsh`）和 **pnpm**。`dsh plugin add` 会在 `$DSH_HOME/profiles/web` 里跑 pnpm。仓库已提交编译好的 `dist/` 和 `lib/client.js`，git 安装不用 `prepare`，也不用改 profile 的 `allowBuilds`。

然后重启这个 Host，再刷新页面。`dsh plugin add` 只写 profile，不会热挂正在跑的进程。

本机可视化编辑 React + Tailwind 组件。面向 DeepSeek Harness **0.1.5-rc.2**。peer：`@deepseek-ai/dsh-tools` `0.1.2-rc.1`，`@deepseek-ai/cordis` `^4.0.2`。Node 22.14 或更新。

文件工具限制在项目根里。破坏性写入需要受信任的 host/UI 审批通道。模型给的 `approve: true` 不算。`autoApprove` 不会放宽路径 jail。画布在 `npm run preview`，没有 `dsh.client` web-shell。

已交付内容见 [docs/SHIPPED.md](docs/SHIPPED.md)。`docs/01` 到 `docs/07` 是历史笔记。

## 装完之后

Settings → Plugins 里这个插件是 Enabled。工具名是 `opendesigner_*`。`opendesigner_status` 只报告 `requiredDsh` 和 `hasApiKey`，不报 key。

```sh
dsh plugin --profile web remove dsh-opendesigner
```

## 其它装法

本地目录或 tarball：

```sh
dsh plugin --profile web add ./dsh-opendesigner
dsh plugin --profile web add ./dsh-opendesigner-0.2.0.tgz
```

`dsh.bundle` 是开机捕获的。不要再往 profile 的 `cordis.patch.yml` 手写同一条 insert，会重复挂载。

## 预览

```sh
npm install
npm run build
npm test
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your-react-app npm run preview
```

默认项目是 `examples/programmer-page`，打开 `http://127.0.0.1:4173/`。**保存设计稿** 写 `.designer/canvas.json`。**应用到工程** 只在 Agent batch 有文件 diff 时可用。没有 API key 时走 mock。key 不要放进仓库。

路径 jail：`project_*` 和 `local_*` 都走 `resolveProjectPath`。绝对路径、`..`、符号链接逃逸都是 `PATH_JAIL`。

## 开发

改源码后重新 `npm run build`，把更新后的 `dist/` 和 `lib/client.js` 一起提交。对着源码检出可以用 overlay：

```yaml
- insert:
    - id: dsh-opendesigner
      name: /absolute/path/to/dsh-opendesigner/dist/plugin.js
```

```sh
pnpm dsh web --patch /absolute/path/to/overlay.yml
```

## 许可

MIT。见 [LICENSE](LICENSE)。
