# Hapigo Clone Product Plan

## Goal

将当前仅有基础搜索和翻译功能的 Tauri 原型，升级为一个具有统一视觉语言、主界面、设置能力、模块导航和后续扩展空间的桌面效率工具。

目标不是继续堆单页，而是构建一个接近 HapiGo 产品结构的桌面产品壳层。

## Current State

当前已实现：
- 基础 Spotlight 搜索
- 结果列表与键盘上下选择
- 打开文件/应用
- 基础翻译页
- 截图 OCR 后翻译
- 划词翻译（当前仍偏剪贴板方案）

当前明显缺失：
- 主界面
- 设置/配置页
- 统一导航结构
- 统一视觉系统
- 右侧详情/预览区
- 底部动作坞
- 剪贴板历史页面
- 命令/计算模式
- 集成能力管理

## Official HapiGo Capability Map

根据官网公开介绍，HapiGo 的能力可归纳为：

### Core Experience
- 即时搜索
- 快速预览
- 直接启动
- 底部动作栏
- 全键盘操作
- 拖拽操作
- 窗口置顶
- 多彩主题

### Productivity Tools
- 剪贴板历史
- 翻译
- 系统命令
- 运行终端命令
- 常用短语填充
- 计算与换算
- 使用统计/图表

### Integrations
- Shortcuts
- Apple Notes
- Bear
- Dash
- Craft
- FileMaker
- DevonThink
- Zotero
- 1Password
- 以及更多创建文档类集成

## Product Information Architecture

### 1. Home
主界面，承担产品入口与状态总览。

包含：
- 核心模块入口卡片
  - 搜索
  - 翻译
  - 剪贴板
  - 命令/计算
  - 设置
- 最近使用
- 常用动作
- 快捷键提示
- 系统状态
  - 是否置顶
  - 翻译引擎状态
  - 默认搜索范围
  - 集成连接状态

### 2. Search
核心搜索工作台。

包含：
- 顶部搜索输入栏
- 左侧结果列表
- 右侧详情/预览区
- 顶部工具按钮
  - 菜单
  - 暂停/恢复
  - 置顶
  - 设置
- 底部动作栏
  - 打开
  - 复制
  - 在 Finder 中显示
  - 复制路径
  - 更多动作
- 底部状态栏
  - 已选项目数
  - 结果总数
  - 快捷键提示

### 3. Translate
统一视觉下的翻译工作台。

包含：
- 顶部标题栏
- 输入区
- 字数统计
- 源语言 / 目标语言选择
- 翻译结果卡片
- 多结果容器（后续支持多个翻译源）
- 操作区
  - 朗读
  - 复制
  - 截图翻译
  - 划词翻译
  - 固定窗口
  - 设置

### 4. Clipboard
后续剪贴板页面。

包含：
- 历史条目列表
- 搜索框
- 预览区
- Pin / 删除 / 复制 / 粘贴动作
- 分组与筛选

### 5. Command / Calc
后续命令与计算入口。

包含：
- 命令输入
- 公式与结果
- 单位/汇率换算
- 命令执行历史

### 6. Settings
集中配置页。

包含：
- 快捷键设置
- 外观主题
- 开机启动
- 置顶行为
- 搜索范围
- 翻译引擎配置
- 集成管理
- 实验功能

## Design System Direction

统一采用接近官方截图的深色桌面工具风格：

- 深灰背景层级
- 大圆角容器
- 蓝色高亮选中态
- 左右分栏
- 顶部轻量工具栏
- 底部动作坞/状态栏
- 图标 + 双行文本列表项
- 半透明/磨砂质感
- 强调键盘驱动与高密度信息展示

### Core Visual Tokens
- Primary background: charcoal / graphite
- Secondary panel: elevated dark gray
- Accent color: vivid blue
- Text primary: near white
- Text secondary: muted gray
- Radius: 14-18px
- Selection: blue filled card
- Action dock: dark floating segmented bar

## Recommended Delivery Phases

### Phase 1: Shell + IA
- 统一 App Shell
- 新增 Home 页面
- 新增 Settings 页面骨架
- Search / Translate 纳入统一导航结构

### Phase 2: Search & Translate Redesign
- 搜索页左右分栏
- 搜索结果详情区
- 底部动作栏
- 翻译页统一视觉
- 顶部控制区和操作按钮

### Phase 3: Core Utility Expansion
- Clipboard 页面
- 命令/计算模式
- 多主题
- 置顶控制
- 使用统计

### Phase 4: Integrations
建议优先顺序：
1. Apple Notes
2. Shortcuts
3. 1Password
4. Dash
5. Zotero / DevonThink
6. 更多文档类 app

## Immediate Build Plan

本轮先完成：
1. 产品壳层和导航结构
2. 主界面
3. 搜索页重做为双栏布局
4. 翻译页重做为统一风格
5. 为后续 Clipboard / Settings 预留路由和组件结构

## Success Criteria For This Iteration

本轮完成后，产品应达到：
- 看起来不再是实验性质单页
- 已具备完整桌面产品壳层
- 搜索 / 翻译 / 首页属于同一设计体系
- 后续扩展 Clipboard / 集成 / 设置时不用推翻现有结构
