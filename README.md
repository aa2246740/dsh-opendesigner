# dsh-opendesigner

DeepSeek Harness 插件，在本机可视化编辑 React + Tailwind 组件。面向已发布的 DeepSeek Harness **0.1.2-rc.1**。Node 22.14 或更新。peer：`@deepseek-ai/dsh-tools` `0.1.2-rc.1`，`@deepseek-ai/cordis` `^4.0.2`。

文件工具限制在项目根里。破坏性写入需要受信任的 host/UI 审批通道。模型给的 `approve: true` 不算。`autoApprove` 不会放宽路径 jail。画布在 `npm run preview`，没有 `dsh.client` web-shell。

已交付内容见 [docs/SHIPPED.md](docs/SHIPPED.md)。`docs/01` 到 `docs/07` 是历史笔记。

## 安装

启动的 DSH 必须打印 `0.1.2-rc.1`。

```sh
npx @deepseek-ai/dsh@0.1.2-rc.1 --version
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
npx @deepseek-ai/dsh@0.1.2-rc.1 plugin --profile web add "$(pwd)"
npx @deepseek-ai/dsh@0.1.2-rc.1 --profile web --dump-config
npx @deepseek-ai/dsh@0.1.2-rc.1 web --no-open
```

`dump-config` 里要有 `# == dsh-opendesigner`。Settings → Plugins 里这个插件是 Enabled。工具名是 `opendesigner_*`。`opendesigner_status` 只报告 `requiredDsh` 和 `hasApiKey`，不报 key。

开发时对着源码检出可以用 overlay：

```yaml
- insert:
    - id: dsh-opendesigner
      name: /absolute/path/to/dsh-opendesigner/dist/plugin.js
```

```sh
pnpm dsh web --patch /absolute/path/to/overlay.yml
```

## 预览

```sh
npm install
npm run build
npm test
OPENDESIGNER_PROJECT_ROOT=/absolute/path/to/your-react-app npm run preview
```

默认项目是 `examples/programmer-page`，打开 `http://127.0.0.1:4173/`。**保存设计稿** 写 `.designer/canvas.json`。**应用到工程** 只在 Agent batch 有文件 diff 时可用。没有 API key 时走 mock。key 不要放进仓库。

路径 jail：`project_*` 和 `local_*` 都走 `resolveProjectPath`。绝对路径、`..`、符号链接逃逸都是 `PATH_JAIL`。

## 许可

MIT。见 [LICENSE](LICENSE)。
