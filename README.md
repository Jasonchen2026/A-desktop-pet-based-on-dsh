# 不知道些什么的大标题

由于不会取名，这里直接叫小白了~

小白是一个跑在 Windows 桌面上的猫娘桌宠。她的大脑是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（下面简称 dsh）开的一个会话，模型走 DeepSeek 云端 API，本机只跑一个 Electron 小窗口和四个 dsh 插件，核显轻薄本也带得动。

当然你可以自己定制人设，不一定非要是猫娘，做成猫娘完全是因为我的xp

目前功能还比较少，且应当有一些缺陷，仅作为第一个版本，后续会加上更多功能。

## 她能做什么

- **聊天**：有人设、有口癖，每句话开头带一个情绪标签，桌宠的表情跟着换

- **看屏幕**：隔几秒瞄一眼你在干什么；画面明显变了，她自己判断要不要搭话；你问到屏幕上的东西，她会仔细看

- **记忆**：值得长期记住的事她自己记，想不起来自己翻

- **后台思考**：碰到要查资料、推好几步的问题，她交给一个开着深度思考的后台会话，自己先接着跟你聊，想完再告诉你

  当然这个功能主要是避免出现想半天这种事情，但有的时候她会误判，然后给你随便糊弄一下

- **权限门**：能读哪里、能写哪里、能不能联网、能不能看屏幕，都由一个文件管，右键菜单就能改

- **托盘和打盹**：不占任务栏，只待在托盘里；打盹时不看屏幕、不主动开口、不花钱

## 目录

```
neko/                  dsh 工作区：人设、规矩、记忆
  AGENTS.md            当前用哪个人设
  persona/             人设文件
  rules/               行为规矩（记忆、屏幕动态、后台思考）
  memory/              她的记忆，第一次启动时从 memory-templates 自动生成
  memory-templates/    记忆文件的空模板
  refs/                想让她看的外部目录挂在这里
neko-plugin/           四个 dsh 插件
  neko-guard/          权限门
  neko-persona/        把人设和规矩放进系统提示
  neko-bridge/         桌宠和 dsh 之间的桥，记忆、后台思考这些工具也在这里
  neko-eyes/           look_at_screen 工具
neko-pet/              桌面外壳（Electron）
  assets/              形象图放这里，仓库里只有占位图和托盘图标
  renderers/           自定义渲染器
  start.vbs            双击启动
```

整个文件夹放在哪个盘、哪个目录都行，三个子文件夹保持并排就好。路径里最好别有空格和中文。

## 准备

- Windows 10 或 11
- [Node.js](https://nodejs.org/) 的 LTS 版
- pnpm，dsh 装插件要用它：`npm install -g pnpm`
- 一个 DeepSeek API key，在 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请
- dsh 不用单独安装，下面的命令会用 npx 现拉。作者测试用的版本是 0.1.5-rc.1

## 安装

下面假设仓库放在 `D:\neko-xiaobai`，换成你自己的路径。

**1. 先把 dsh 配好**

在 PowerShell 里运行一次：

```
npx @deepseek-ai/dsh web
```

浏览器会打开 dsh 的页面。按提示配好 DeepSeek 的 API key，**把模式切到创造模式**。配完回到 PowerShell 按 Ctrl+C 关掉，以后由桌宠负责启动它。

**2. 装四个插件**

```
npx @deepseek-ai/dsh plugin --profile web add D:\neko-xiaobai\neko-plugin\neko-guard
npx @deepseek-ai/dsh plugin --profile web add D:\neko-xiaobai\neko-plugin\neko-persona
npx @deepseek-ai/dsh plugin --profile web add D:\neko-xiaobai\neko-plugin\neko-eyes
npx @deepseek-ai/dsh plugin --profile web add D:\neko-xiaobai\neko-plugin\neko-bridge
```

**3. 把插件挂上**

打开 `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`，没有就新建，写入：

```yaml
- insert:
    - id: neko-guard
      name: 'neko-guard'
    - id: neko-persona
      name: 'neko-persona'
    - id: neko-eyes
      name: 'neko-eyes'
    - id: neko-bridge
      name: 'neko-bridge'
```

设置过 `DSH_HOME` 环境变量的话，`.dsh` 就在那个位置。写完运行下面这条确认，打出来的插件树里能看到这四个名字就对了：

```
npx @deepseek-ai/dsh --profile web --dump-config
```

**4. 放看屏幕用的 key**

在 `neko-plugin\neko-eyes\` 里新建 `key.txt`，里面只写你的 DeepSeek API key 一行。桌宠看屏幕时用它调视觉模型。这个文件已经写进 `.gitignore`，不会被传上去。

**5. 装桌宠外壳**

```
cd D:\neko-xiaobai\neko-pet
npm install
```

国内下载 Electron 慢的话，先设镜像再装：

```
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

**6. 放形象图**

见下一节。可以先跳过，没有图时显示一个占位小猫。

**7. 启动**

双击 `neko-pet\start.vbs`。第一次启动要等 npx 下载 dsh，会慢一些。

小白不出现在任务栏，右下角托盘区会多一只小猫头。Windows 11 默认把新图标收在"显示隐藏的图标"那个小箭头里，想让它常驻就把它拖到任务栏上。

## 配置形象

好吧这里有我的私心来着，因为人设已经发出来了，如果形象发出来显得我被ntr了一样~

### 八个核心表情

表情在 `neko-pet/config.json` 的 `expressions` 里配。人设规定她每句话开头带一个情绪标签，核心的八个各对应一张图：

| 情绪标签 | 默认文件 |
|---|---|
| 平静 | `assets/calm.png` |
| 开心 | `assets/happy.png` |
| 得意 | `assets/smug.png` |
| 害羞 | `assets/shy.png` |
| 困 | `assets/sleepy.png` |
| 不满 | `assets/annoyed.png` |
| 担心 | `assets/worried.png` |
| 惊讶 | `assets/surprised.png` |

图放进 `neko-pet/assets`，文件名对上就行。只想用一张图也可以，八个都填同一个文件。

**所有图的画布尺寸必须一样，角色底边对齐，背景透明。** 这样换表情时人物不会跳。把图的宽高填进 `config.json` 的 `canvas`，比如 `{ "width": 397, "height": 481 }`。桌宠在屏幕上显示多宽由 `petSize` 决定，单位是像素。

扩展标签（坏笑、无语、撒娇……）在 `tagMap` 里映射到最接近的核心表情。想给某个扩展标签单独配图，直接在 `expressions` 里加一行就行，比如 `"撒娇": "assets/coquettish.png"`，有专属图的标签优先用专属图。

图片找不到时，桌宠会显示占位图，并在日志里写一行"形象图找不到"。

### 五种写法

**静态图：**

```json
"平静": "assets/calm.png"
```

**动图**，GIF、APNG、动态 WebP 都行，写法和静态图一样：

```json
"开心": "assets/happy.webp"
```

**透明视频**，必须是带透明通道的 WebM（VP9 编码），MP4 不支持透明：

```json
"惊讶": "assets/surprised.webm"
```

**一个文件夹的序列帧**，文件按 1.png、2.png……编号，按数字顺序播：

```json
"得意": { "dir": "assets/smug", "fps": 12 }
```

**一张大图里排好的序列帧**，从左到右、从上到下：

```json
"困": { "type": "sheet", "src": "assets/sleepy_sheet.png", "cols": 4, "rows": 2, "fps": 8 }
```

视频和序列帧默认循环。加 `"loop": false` 只播一遍并停在最后一帧，适合"惊讶跳一下"这种。

### 说话动画

每个表情可以多配一个 `talk`，她说话时放这个，说完回到原来的：

```json
"开心": {
  "src": "assets/happy.png",
  "talk": { "dir": "assets/happy_talk", "fps": 10 }
}
```

没配 `talk` 的表情，说话时人物会轻轻上下点头。

### 自定义渲染器（动态形象接口）

Live2D、骨骼动画这类上面五种写法装不下的东西，自己写一个渲染器脚本：

1. 在 `neko-pet/renderers` 里放一个 js 文件
2. 在 `config.json` 的 `rendererScripts` 里写上它的路径，比如 `["renderers/example-blink.js"]`
3. 在脚本里调用 `NekoPet.registerRenderer('类型名', 工厂函数)`
4. 表情写成 `{ "type": "类型名", ...你需要的参数 }`

工厂函数收到两个参数，一个是要往里放内容的 div，一个是你在 config 里写的参数。它返回一个对象：`ready` 是个 Promise，准备好了就淡入；`destroy` 在这个表情被换掉时调用，定时器、模型都要在这里停掉、释放掉。

```js
window.NekoPet.registerRenderer('blink', (layer, spec) => {
  const img = new Image(); img.src = spec.src
  layer.appendChild(img)
  const timer = setInterval(() => { /* 换帧、播动画 */ }, 3000)
  return { ready: img.decode().catch(() => {}), destroy() { clearInterval(timer) } }
})
```

`renderers/example-blink.js` 是一个能用的样板，做的是随机眨眼。

### 托盘图标

`assets` 里的 `tray-awake.png`（醒着）和 `tray-sleep.png`（打盹）各有 16、24、32 像素三个尺寸，想换就按同样的文件名替换。

## 改人设

### 换人设

`neko/AGENTS.md` 里有一行 `当前人设：xiaobai`，改成 `persona` 文件夹里别的人设文件名（不带 `.md`）就换了。仓库自带两个，`xiaobai` 是猫娘，`assistant` 是正经助手。

### 写一个新人设

在 `neko/persona/` 里新建一个 md 文件，写清楚她是谁、怎么说话、举几个对话示范、哪些事不做。可以照着 `xiaobai.md` 改。

有一段要保留：**每条回复开头带一个方括号情绪标签**，标签只能从固定的表里挑。桌宠靠这个标签换表情，删了表情就不会动。想加新标签，同时在 `neko-pet/config.json` 的 `tagMap` 里把它映射到某个核心表情，或者给它单独配图。

### 规矩文件

`neko/rules/memory-rules.md` 管的是行为：记忆怎么记、消息开头那些标记是什么意思、屏幕动态来了怎么处理、什么时候交给后台思考。它和人设一起放进系统提示。

改的时候注意，下面这几个标记程序里也在用，名字别改：`【系统通知】`、`【屏幕动态】`、`〔安静〕`、`【后台思考任务】`、`【后台思考完成】`。

### 改完要知道的

改了人设、规矩或者 `AGENTS.md`，下次启动时桥会自动开一个新会话，不接着当天的旧会话。这是故意的，旧会话里她可能还按旧设定说话。新会话开场她会拿到核心档案和上次最后聊的几句，不会完全断片。

## 记忆

记忆在 `neko/memory/` 下面分三个文件：`profile.md` 关于你，`relationship.md` 你们之间的称呼、梗和约定，`events.md` 发生过的事。第一次启动时自动从 `memory-templates` 生成。

她用 remember 工具自己决定记什么，用 recall_memory 按关键词翻。每条记忆是以 `- ` 开头的一行，你也可以直接打开文件手改。

新的一天第一次叫醒时，她会拿到 profile 和 relationship 的内容当核心档案；别的时候不往系统提示里塞记忆，要用她自己去翻，这样记忆越攒越多也不会让每句话变贵。

记忆文件写进了 `.gitignore`，不会被传上去。右键菜单"记忆"可以设成她自己决定、每次记之前问你、或者不许写。

## 权限

权限都在 `neko-plugin/neko-guard/policy.json` 里，改完存盘立刻生效，不用重启。

| 字段 | 管什么 | 可选值 |
|---|---|---|
| `readable` | 允许读的位置 | 路径列表，默认只有 `neko` |
| `writable` | 允许写的位置 | 路径列表，默认只有 `neko/memory` |
| `memoryWrite` | 写记忆 | `auto` 她自己决定 / `ask` 每次问你 / `off` 不许写 |
| `network` | 联网 | `off` 不联网 / `search` 只许搜索 / `ask` 打开网页前问你 / `on` 全放开 |
| `screen` | 看屏幕 | `on` 允许 / `ask` 每次问你 / `off` 不许看 |
| `unknown` | 不认识的工具 | `ask` 问你 / `allow` 放行 |
| `debug` | 把每次拦截打进 dsh 日志 | `true` / `false` |

路径可以写相对仓库根目录的（比如 `neko`），也可以写绝对路径，绝对路径里的反斜杠要写两个，比如 `"D:\\资料\\论文"`。

执行命令、删除、改名、移动、安装、git 这些动作一律拒绝，不受开关影响。设成 `ask` 的事情，对话框里会弹一张审批卡片让你点。

右键菜单里的"看屏幕""联网""记忆"三个开关改的就是这个文件。

看屏幕还有几道保险：锁屏时不看；你离开电脑超过 `pauseWhenIdleSeconds` 秒不看；屏幕上开着标题含 `skipWindowKeywords` 里关键词的窗口时不看（默认有银行、支付宝、密码管理器等），这两项在 `neko-pet/config.json` 里改。

想让她看工作区以外的资料，见 `neko/refs/README.md`。

## 日常使用

**托盘图标**：左键显示或藏起小白，右键打开菜单。

**小白本人**：左键打开或收起对话框，按住拖动，右键打开菜单。打盹时点她一下就醒。

**右键菜单**里有这些：

- 把小白藏起来 / 叫出来
- 让她打个盹 / 叫醒她。打盹时她藏进托盘，图标换成闭眼的，不看屏幕、不主动开口、不花钱
- 打开或收起对话框、对话框外观、对话框挪到左边或右边
- 看屏幕：每 1、2、5、20 秒瞄一眼，或者未经允许不截屏
- 联网、记忆：见上面权限一节
- 总在最前、打开 dsh 界面、在浏览器里打开 dsh、看日志
- 让小白下班：她道个别，然后整个关掉
- 主动搭话：不主动开口 / 偶尔（画面明显变了才想想要不要说）/ 积极（画面一变就想想）
- 看屏幕的方式：后台瞄加发消息时细看 / 只后台瞄 / 只在发消息时细看

**后台思考**：问她要好好想的问题，她会说一声"我想想"，把问题交给后台，然后接着聊。小白头边会显示 💭 和正在想的件数，想完对话框里出现一张结果卡片，可以展开看全文，她也会用自己的话讲一遍结论。问她"想好了没"能查进度，说"不用想了"能撤掉。同时最多想 3 件，完整结果另存在 `neko-plugin/neko-bridge/thoughts/`。

你说完一句话，她要是 20 秒还没答完（又不是正在往外说），桥会自动把这个问题转给后台。

## 配置速查

### neko-pet/config.json

| 字段 | 说明 |
|---|---|
| `dshCommand` | 启动 dsh 的命令，默认 `npx @deepseek-ai/dsh web --no-open` |
| `attachUrl` | 想连一个已经在运行的 dsh 时填它的地址，平时留空 |
| `port` | dsh 网页端口，默认 3080 |
| `workspace` `guardPolicy` `bridgeRuntime` | 留空用仓库里的默认位置 |
| `petSize` `canvas` | 显示宽度、形象图画布尺寸 |
| `chatWidth` `chatHeight` `chatSide` | 对话框大小和在哪一边 |
| `alwaysOnTop` | 总在最前 |
| `idleSeconds` | 多少秒没动静表情回到平静 |
| `bubbleSeconds` | 对话框收着时，头边气泡显示几秒 |
| `startTimeoutSeconds` | 等 dsh 启动最多等几秒 |
| `greetOnWake` | 叫醒时让她打招呼 |
| `hideWhenDormant` | 打盹时藏进托盘 |
| `screenWatch` | 看屏幕的频率、画面变化阈值、每分钟上限、离开多久暂停、跳过的窗口关键词、哪些话会触发细看 |
| `vision` | 看屏幕用的模型：`baseUrl`、`model`、`maxTokens`、`keyFile`（留空读 neko-eyes 的 key.txt） |
| `expressions` `tagMap` `rendererScripts` | 见"配置形象" |

### neko-plugin/neko-bridge/config.json

| 字段 | 说明 |
|---|---|
| `workspace` `memoryDir` | 留空用默认（仓库里的 `neko` 和它下面的 `memory`） |
| `preset` `provider` `model` | 留空跟着 dsh 的默认设置 |
| `chatReasoning` | 聊天会话的深度思考，默认 `off`，回话快 |
| `imageMode` | `both` 后台瞄加发消息时细看 / `text` 只后台瞄 / `image` 只在发消息时细看 |
| `proactive` | 主动搭话：`off` / `occasional` / `active` |
| `autoLook` | 她因为屏幕动态自己想细看屏幕时的限制：每小时几次、至少隔几分钟 |
| `thinker` | 后台思考：同时几件、思考强度、模型、几分钟算超时、聊天几秒没答完自动转交（0 关掉） |
| `approvalTimeoutSec` | 审批卡片多久没点算拒绝 |

### neko-plugin/neko-eyes/config.json

`guardPolicy` 留空用仓库里的权限文件，`logFile` 是她每次主动看屏幕的记录文件名。

## 花钱的地方

后台瞄屏幕：画面变了才调一次视觉模型，每分钟有上限，你离开电脑会暂停。发消息时细看：只有你的话里提到屏幕、报错、"这个"之类的词才做。主动搭话：画面变化够大、离上次够久才叫她想一想，大多数时候她选择不说话，开销跟多聊几句差不多。后台思考开着深度思考，一件比一轮闲聊贵不少，所以上限 3 件。

想省钱就让她打盹，或者把主动搭话调成不主动开口、看屏幕的方式调成只后台瞄。

## 出问题看哪里

日志有三份：

- `neko-pet/logs/dsh.log`：dsh 本身的输出和桌宠的事，右键"看日志"打开的就是它
- `neko-plugin/neko-bridge/bridge.log`：会话、每轮用时、她手上有哪些工具、后台思考的开始和结束
- `neko-plugin/neko-eyes/look-at-screen.log`：她每次主动看屏幕的记录

| 现象 | 先查什么 |
|---|---|
| 一直卡在"叫醒中" | `dsh.log` 里有没有报错；3080 端口是不是被占了；第一次启动 npx 下载慢，可以调大 `startTimeoutSeconds` |
| 右下角找不到小猫头 | 点托盘区的小箭头，在"显示隐藏的图标"里 |
| 插件好像没生效 | 运行 `npx @deepseek-ai/dsh --profile web --dump-config`，看四个插件在不在 |
| 她说自己没有某个工具 | `bridge.log` 里找"她这一轮能用的工具"那一行，写着"桥给的工具都在"就是她说错了，直接叫她用；要是缺工具，删掉 `neko-plugin/neko-bridge/state.json` 重启 |
| 看屏幕一直失败 | `neko-eyes/key.txt` 有没有放、key 对不对；`dsh.log` 里"视觉模型返回 4xx"后面写了什么 |
| 形象是占位图 | `config.json` 的 `expressions` 路径和 `assets` 里的文件名对不对得上 |
| 改了 policy.json 没反应 | JSON 格式有没有写错，路径里的反斜杠是不是写了两个 |

## 隐私

你和她的聊天、她瞄屏幕时的截图，会发给 DeepSeek 的 API 处理。记忆、聊天记录、日志都只存在本机。`.gitignore` 已经排除了 key、记忆、聊天记录、日志和你自己的形象图，往自己的仓库提交前还是建议用 `git status` 看一眼。

## 致谢

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
