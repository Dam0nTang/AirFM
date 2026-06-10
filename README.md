# AirFM

![alt text](image-1.png)![alt text](image-2.png)
AirFM 是一个本地运行的个人 AI 音乐电台应用。它可以和你聊音乐、根据你的提示推荐可播放歌曲、使用 Fish Audio 生成 DJ 语音播报，并以 FM 节目模式自动串联 DJ 串场词和歌曲播放。前端是 PWA，可以从浏览器安装成一个小型桌面应用。

创意来源：抖音博主@mmguo https://www.douyin.com/user/MS4wLjABAAAAANSG2ii-j-_lUq-b3INlGbfoADdryUYNCXRcWH0a8uE?from_tab_name=main&modal_id=7631240906314063537&vid=7631240906314063537

这个项目面向本地个人使用。你需要自己准备 Claude CLI、Fish Audio API Key，以及可选的网易云音乐登录 Cookie。

## 功能

- Chat 模式：输入音乐需求，获得推荐歌曲列表并点击播放。
- 歌曲介绍：询问当前歌曲或推荐列表中歌曲的创作者、发行信息、风格和特点。
- FM 模式：启动一个由 AI 主持的电台节目，自动播放 DJ 串场词和歌曲。
- PWA 前端：开发时可在浏览器中访问，也可以安装成桌面应用。
- 本地用户画像：通过文件配置音乐偏好、日常作息、情绪规则和歌单种子。
- 本地缓存：生成过的 TTS 音频会缓存在 `.cache/tts`。

## 环境要求

- Node.js 18 或更高版本
- npm
- 终端中可用的 Claude CLI。默认命令为 `claude -p --output-format json`。
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)，可以本地运行，也可以部署在可访问的服务器上。
- Fish Audio API Key 和 Voice ID。
- 如果你希望播放需要登录或会员权限的歌曲，需要网易云音乐账号 Cookie。

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 在另一个终端中使用 Docker 启动 NeteaseCloudMusicApi：

```bash
docker run -d \
  --name netease-cloud-music-api \
  -p 3001:3000 \
  binaryify/netease_cloud_music_api
```

AirFM 默认会从 `http://localhost:3001` 访问 NeteaseCloudMusicApi。

3. 创建本地环境变量文件：

```bash
cp .env.example .env
```

4. 在 `.env` 中填写必需配置：

```env
FISH_API_KEY=your_fish_audio_api_key
FISH_VOICE_ID=your_fish_audio_voice_id
NETEASE_API_BASE=http://localhost:3001
```

5. 创建本地用户画像文件：

```bash
cp -R user.example user
```

编辑 `user/` 中的文件，写入你自己的音乐偏好、日常习惯和情绪规则。

6. 启动 AirFM 后端：

```bash
npm run dev
```

7. 启动前端开发服务：

```bash
npm run dev:client
```

8. 打开应用：

```text
http://localhost:8080
```

## 安装为 PWA

开发环境下，使用 Chrome 或 Edge 打开 `http://localhost:8080`，然后点击地址栏或浏览器菜单中的安装按钮，即可安装成桌面应用。

如果想用更接近生产环境的方式本地预览：

```bash
npm run build
npx vite preview --host 0.0.0.0 --port 8080
```

然后打开 `http://localhost:8080` 并从浏览器安装 PWA。安装后的应用仍然依赖本地后端和 NeteaseCloudMusicApi，因此使用时需要保持它们运行。

## 配置项


| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | AirFM 后端端口，默认 `3000`。 |
| `PUBLIC_BASE_URL` | 否 | 本地资源使用的后端公开地址，默认 `http://localhost:3000`。 |
| `DATABASE_PATH` | 否 | 本地 SQLite 数据库路径，默认 `data/radio-agent.sqlite`。 |
| `CLAUDE_COMMAND` | 是 | Claude 命令，默认 `claude`。 |
| `CLAUDE_ARGS` | 是 | Claude CLI 参数，默认 `-p,--output-format,json`。 |
| `NETEASE_API_BASE` | 是 | NeteaseCloudMusicApi 地址，默认 `http://localhost:3001`。 |
| `NETEASE_COOKIE` | 否 | 可选的备用 Cookie。更推荐在应用界面中导入 Cookie。 |
| `NETEASE_SESSION_PATH` | 否 | 导入的网易云 Cookie 本地保存路径，默认 `data/netease-session.json`。 |
| `FISH_API_KEY` | 是 | Fish Audio API Key。 |
| `FISH_VOICE_ID` | 是 | Fish Audio Voice / Reference ID。 |
| `FISH_PROXY` | 否 | 如果当前设备无法直连 `api.fish.audio`，可以配置 Fish Audio 请求使用的 HTTP 代理。 |
| `OPENWEATHER_API_KEY` | 否 | 预留给未来天气能力使用。 |

### Fish Audio 代理

如果你的网络无法直连 Fish Audio，可以把 `FISH_PROXY` 设置为当前设备可用的代理：

```env
FISH_PROXY=http://127.0.0.1:7897
```

不要直接照抄别人机器上的 `127.0.0.1` 代理配置。`127.0.0.1` 永远表示当前这台电脑。

## 网易云登录 Cookie

NeteaseCloudMusicApi 需要获取网易云账号登录的cookie才能播放

推荐流程：

1. 在浏览器中打开网易云音乐官网并正常登录。
2. 打开浏览器开发者工具。
3. 进入 Network 面板。
4. 在login请求中找到网易云音乐域名下的 Cookie。
5. 复制包含 `MUSIC_U=...` 的完整 Cookie 字符串。
6. 在 AirFM 中点击 `IMPORT COOKIE`。
7. 粘贴 Cookie 并保存。


## 本地用户画像

AirFM 会读取 `user/` 下的用户画像文件：

```text
user/taste.md
user/routines.md
user/mood-rules.md
user/playlists.json
```

从示例模板开始：

```bash
cp -R user.example user
```

然后编辑复制出来的文件，写入个人的偏好。

## 常见问题

### Fish Audio TTS 失败

- 确认已设置 `FISH_API_KEY` 和 `FISH_VOICE_ID`。
- 测试当前设备是否能访问 `https://api.fish.audio`。
- 如果无法直连，配置当前设备可用的 `FISH_PROXY`。
- 确认 `FISH_PROXY` 前后没有多余空格。

### 推荐了歌曲但无法播放

- 确认 NeteaseCloudMusicApi 正在运行。
- 导入包含 `MUSIC_U` 的网易云 Cookie。
- 由于版权、会员、地区或 API 限制，一些歌曲仍然可能无法返回可播放链接。

### PWA 打开后没有响应

- 保持 AirFM 后端运行。
- 保持 NeteaseCloudMusicApi 运行。
- 确认前端开发服务或预览服务正在提供页面。

## 免责声明

AirFM 仅用于个人学习、实验和本地使用。你需要自行遵守网易云音乐、Fish Audio、Anthropic / Claude 以及其他接入服务的服务条款和版权规则。本项目不提供音乐文件，不绕过版权限制，也不包含任何第三方服务凭据。
