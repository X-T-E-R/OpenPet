<p align="center">
  <img src="public/brand/openpet-logo.png" alt="OpenPet 桌宠 logo" width="180" />
</p>

# OpenPet

[English](README.md)

OpenPet 是一个本地桌宠运行时，用来运行 Codex-compatible 桌宠。它会在桌面上显示透明置顶宠物窗口，支持导入兼容宠物，并提供本机控制 API，让 OpenClaw、Codex 和其他 agent 可以通过动作、气泡和事件表达工作状态。

GitHub：<https://github.com/X-T-E-R/OpenPet>

## 快速开始

Windows 普通用户可以从 [GitHub Releases](https://github.com/X-T-E-R/OpenPet/releases) 下载打包版本后直接启动 OpenPet。桌宠会显示在桌面上，可以拖到你想要的位置，设置页可以从桌宠右键菜单或应用托盘 / 菜单打开。

Release 会为 Windows、macOS 和 Linux 生成构建产物。当前开发与手动验证主要在 Windows 环境完成；macOS 和 Linux 包由 CI 构建，但开发者尚未手动测试。

### 平台状态

- Windows：当前主要手动验证平台。
- macOS：CI 会分别构建 Apple Silicon 和 Intel 产物。macOS 从网络下载的应用要正常打开，需要 Apple Developer ID 签名和 Apple 公证；如果 release 构建时没有这些凭据，Gatekeeper 可能提示 OpenPet 已损坏或无法验证。
- Linux：CI 会在 Ubuntu 上构建 `.deb`、`.rpm` 和 `.AppImage`，但运行行为尚未由开发者手动验证。

从源码运行：

```powershell
pnpm install
pnpm tauri:dev
```

## 功能

- 透明、无边框、置顶的桌宠窗口。
- 点击播放动作、拖动调整位置、右键桌宠菜单和应用托盘 / 菜单控制。
- 支持从兼容的公开 Codex 桌宠页面导入网站宠物，导入后本地保存并由 OpenPet 加载。
- 支持通过运行中的本地 runtime API 导入本地宠物，适合 agent 和 CLI 使用。
- Companion 事件支持 `thinking`、`tool-running`、`reviewing`、`success`、`failure`、`attention`。
- 设置页支持英文 / 简体中文、宠物选择、点击动作模式、随机点击动作池、事件反应、事件气泡、闲置自娱、自主移动、悬停暂停、移动速度、缩放、减少动画，以及可配置的 HTTP API 监听地址 / 端口。

## 导入桌宠

内置宠物位于 `public/pets/<id>/`。导入宠物会保存到应用数据目录，并加入同一个运行时目录。一个 Codex-compatible 宠物包应包含：

```text
pet.json
spritesheet.webp
```

当前内置 `nia` 包使用 `1536x1872` 精灵图，网格为 `8x9`，单格为 `192x208`。

打开设置页即可从支持的网站 URL 导入。当前优先兼容：

- [Petdex](https://petdex.crafter.run/)：`https://petdex.crafter.run/pets/<slug>`
- [Codex Pets](https://codex-pets.net/)：`https://codex-pets.net/share/<id>` 和 `https://codex-pets.net/#/pets/<id>`
- [SpriteYard](https://spriteyard.com/) 与 [Codex Pet Shop](https://www.codexpetshop.com/)：对公开暴露 Codex-compatible `spritesheet.webp` 的页面做通用兼容

导入器只下载你提供 URL 公开暴露的元数据和 WebP 精灵图。它不会执行第三方安装脚本，也不会在运行时热链图库图片。

## Agent Skills 与协议

OpenPet 面向本地 agent 控制。按需要安装对应 skill：

- `openpet-cli`：适合能运行本地命令的 agent，走 CLI 控制路径。
- `openpet-mcp`：适合支持 Model Context Protocol 的 agent 或 MCP client。
- `openpet-asset`：可选的宠物创建 / 校验流程，只有创建或打包宠物时才需要。

日常控制桌宠时，`openpet-cli` 和 `openpet-mcp` 二选一即可。能直接请求 localhost 的 agent 可以使用下方 HTTP API 指引，不需要安装单独的 skill。

### Agent Hook 提示

如果想让 OpenPet 和现有 agent 联动，可以在 `AGENTS.md`、`.cursorrules` 或类似 agent 指令文件里留一条简短规则：让 agent 在长任务中使用已安装的 OpenPet skill，例如 `openpet-cli` 或 `openpet-mcp`，把进度同步给桌宠。

如果安装了多个 OpenPet skill，可以让 agent 自己选择一种集成路径，并把选择后的简短规则浓缩写进本地指令文件。规则只需要引用已安装 skill，不需要重复协议或命令细节。

### CLI

```powershell
python skills\openpet-cli\scripts\openpet_cli.py --help
python skills\openpet-cli\scripts\openpet_cli.py doctor --json
python skills\openpet-cli\scripts\openpet_cli.py status --json
python skills\openpet-cli\scripts\openpet_cli.py event thinking --message "正在阅读仓库..."
python skills\openpet-cli\scripts\openpet_cli.py import-local public\pets\nia --dry-run --json
python skills\openpet-cli\scripts\openpet_cli.py import-website https://petdex.crafter.run/pets/boba
```

给 agent 的规则里可以要求它通过 `openpet-cli` skill 查询状态、发送进度事件或导入宠物。CLI 会调用运行中的本地 runtime；如果 OpenPet 不可访问，实时命令会安全失败并给出明确错误，而不是绕过应用私写 app data。

### MCP

MCP bridge 适合支持 Model Context Protocol 的 IDE 或 agent。打开你的 IDE / agent 的 MCP 配置项，新增一个 `openpet` stdio server，并把命令指向本仓库的 MCP 脚本：

```json
{
  "mcpServers": {
    "openpet": {
      "command": "python",
      "args": ["skills/openpet-mcp/scripts/openpet_mcp_server.py"]
    }
  }
}
```

如果你的 MCP client 不是从仓库根目录启动，请把脚本路径改成绝对路径。client 使用的 Python 环境需要安装官方 MCP SDK：

```powershell
python -m pip install "mcp[cli]"
```

MCP server 提供 status、action、say、companion event、本地导入和网站导入工具。它会调用运行中的 OpenPet HTTP API；如果 OpenPet 使用自定义端点，可以给 server args 追加 `--base-url http://127.0.0.1:<端口>`，或设置 `OPENPET_BASE_URL`。

### 直接 HTTP API

agent 也可以直接调用 HTTP API：

```http
GET /api/status
POST /api/action
POST /api/say
POST /api/event
POST /api/import/local
POST /api/import/website
GET /api/pets/<petId>/spritesheet
```

Companion 事件示例：

```bash
curl -X POST http://127.0.0.1:17321/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"thinking","message":"Reading the repo...","ttlMs":4000}'
```

通过 runtime 导入本地宠物示例：

```bash
curl -X POST http://127.0.0.1:17321/api/import/local \
  -H "Content-Type: application/json" \
  -d '{"source":"public/pets/nia"}'
```

也可以在设置页修改 runtime 监听地址和端口。端点变更会保存，并在重启 OpenPet 后生效。

## 开发检查

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
python skills\openpet-cli\scripts\openpet_cli.py --help
python skills\openpet-mcp\scripts\openpet_mcp_server.py --help
python skills\openpet-cli\scripts\openpet_cli.py doctor --json
python skills\openpet-cli\scripts\openpet_cli.py import-local public\pets\nia --dry-run --json
```

发布检查和打包：

```powershell
pnpm release:check
pnpm release:bundle
```

macOS 正式分发需要 Apple Developer ID 签名和公证。发布面向普通用户的 macOS 产物前，需要在仓库 secrets 配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`KEYCHAIN_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD` 和 `APPLE_TEAM_ID`；否则 workflow 会退回到 ad-hoc signed CI 测试产物，Gatekeeper 仍可能拦截。

## 安全与权利提醒

- 控制 API 默认绑定 `127.0.0.1`，适合由同一台机器上的工具调用。只有受信任的本地网络工作流需要时才使用 `0.0.0.0`。
- 导入宠物可能包含第三方美术、角色、商标或 fan art。请只导入你有权使用的素材。
- 公开发布安装包或素材包前，请确认内置素材的再分发授权；不能确认时应替换为项目自有素材。
- OpenPet 采用 GPL-3.0-or-later 许可证，详见 `LICENSE`。导入宠物和第三方美术可能仍有单独的权利要求。
- OpenPet 与 OpenAI、Petdex、Codex Pets、SpriteYard、Codex Pet Shop 或其他社区网站均无隶属、赞助或背书关系。

## 项目链接

- GitHub：<https://github.com/X-T-E-R/OpenPet>
- 支持：<https://afdian.com/a/xter123>

## 友链

- [linux.do](https://linux.do)
