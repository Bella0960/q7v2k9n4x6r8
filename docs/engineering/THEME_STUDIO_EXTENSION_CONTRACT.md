# THEME-STUDIO-002 · 手机主题工作台扩展契约

状态：手机编辑器增量扩展。只影响 **chat/chat/chat.html** 聊天主页和 **chat/chat/chat-detail.html** 聊天详情；群管理、聊天数据、世界书、身份核心及其他应用完全不受影响。

## 配置与兼容性

- 唯一原有键：`maomao_theme_studio_v1`。保持 `v:1`、`enabled.list / detail`、`list / detail / presets`，新增字段全部有默认值。关闭对应开关时不施加任何颜色、尺寸或图片 CSS。
- `MAOMAOThemeStudio.SPECS` 是参数注册表，`clean(group,input)` 是白名单+边界检查，`save()` 必须检查 localStorage 写入后回读。禁止通过用户导入执行任意 CSS/JavaScript。
- `MAOMAOThemeStudio.registerField('list'|'detail', {key,label,type,default,min,max,section,unit})` 是后续插件唯一的**字段扩展接口**：限定安全的十六进制颜色和数字，自动参与 normalize/read/save、CSS 变量导出以及工作台表单。`EXTENSION_FIELDS` 告知编辑器如何构建控件。扩展自己的 CSS 应使用严格 opt-in 选择器 `.phone-mockup[data-ts-list="1"]` 或 `[data-ts-detail="1"]`，不能使用全局 CSS 覆盖。
- `MAOMAOThemeStudioAssets.SLOTS` 记录新增图片槽位；`upload(file,slot)`、`resolve(assetId)`、`apply(shell,group,values)` 为稳定的图片接入点。新增图片模块应在该注册表拓展，不复制 IDB 存储逻辑。

## 图片生命周期

- 插入位置：`list.coverImage`（聊天主页封面）、`list.listImage`（聊天卡片底纸）、`detail.chatImage`（聊天对话背景）。每个槽位都有独立的本机图片 ID。
- 文件限 PNG/JPEG/WebP、原文件最大 8MB，画布等比缩小至最长 1600px 并转换 WebP。写入项目已有 `PhoneStorage.MediaRepository`（`maomao-assets` v2，由当前备份方案登记）。配置中**只能**出现 `as_[A-Z2-7]{32}` 资源 ID，不能写 dataURL/Base64。
- 图片必须先写入 IDB 成功再标记为草稿；点击“应用到聊天”后才更新当前生效配置。设置移除图片只清除该槽位的引用，不误删可能仍被其他预设引用的原资产。图片 URL 使用 `URL.createObjectURL`，切换时 revoke，以免内存持续增长。
- JSON 包含参数和本机 `assetId`，**不是跨设备图片包**；跨设备须重新导入本地图片。CSS 导入只读 `--ts-*` 白名单变量，忽略素材 ID。
- 无 IDB、空间不足、图片损坏时明确报错，不假报保存成功。

## 预览一致性与后续扩展

- 预览采用与**实际原生聊天主页**同名的结构：封面、`Chat` 标题、副标题、拱形头像、音乐舱、`.chat-slim-card / .chat-avatar / .chat-title-row / .chat-last-msg`；非真实消息 iframe，避免执行聊天 API、存取角色隐私或触发导航。
- 详情使用对应的 `.chat-header / .chat-stage / .input-dock` 结构，另外提供“微信顶部”预览切换，不改变用户现有已购主题。
- 新增选项需同改：SPECS、字段标签、预览变量、实际聊天页的 opt-in CSS、Node 契约及手机浏览器回归（375/390/430）；必须能停用恢复老样式。
- 历史数据不迁移、不覆盖；图片只在显式导入后写入 IDB。回退只需停用工作台定制；旧主题、头像、封面与聊天数据仍保持原样。
