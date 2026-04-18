# Hapigo Clone 翻译工作台增强计划

## 当前状态
- 项目路径：/Users/aqichita/projects/hapigo-clone
- 核心功能已实现：搜索、命令模式、计算模式、剪贴板历史、划词翻译、截图翻译
- 翻译当前支持 MyMemory 和 LibreTranslate 双源

## 目标功能（已完成）

### 1. 多翻译源支持 ✅
- [x] 添加 LibreTranslate 备用翻译源
- [x] 实现翻译源自动切换（主源失败时自动使用备用源）
- [x] 支持用户选择默认翻译源

### 2. 翻译历史记录 ✅
- [x] 创建 TranslationHistoryItem 类型
- [x] 使用 localStorage 存储翻译历史
- [x] 在 TranslatePanel 中添加历史记录面板
- [x] 支持从历史记录重新翻译
- [x] 支持删除单条历史记录
- [x] 支持清空全部历史

### 3. 多翻译源结果对比 ✅
- [x] 修改 TranslateResponse 支持多源结果
- [x] 更新 UI 展示多源翻译结果
- [x] 添加翻译源标识和置信度显示
- [x] 支持显示多个翻译源的结果对比
- [x] 支持收藏特定翻译结果

### 4. 翻译设置 ✅
- [x] 添加翻译相关设置到 AppSettings
- [x] 默认翻译源选择
- [x] 目标语言偏好设置
- [x] 翻译历史保存开关
- [x] 自动切换备用源开关

## 实施记录

1. ✅ 更新 types.ts 添加新类型定义
2. ✅ 重构 translate.rs 实现多翻译源支持
3. ✅ 更新 main.rs 添加新的命令
4. ✅ 重写 TranslatePanel.tsx 实现新 UI
5. ✅ 更新 App.tsx 添加翻译设置
6. ✅ Rust 编译检查和前端类型检查通过

## 2026-04-18 本轮目标

### 5. 主题系统 🚧
- [ ] 支持亮色 / 暗色模式切换
- [ ] 使用 localStorage 保存用户偏好
- [ ] 将主题偏好应用到全局 UI

### 6. OCR 结果进入翻译面板 🚧
- [ ] `/ocr` 截图识别完成后自动切换到翻译面板
- [ ] 将 OCR 识别文本填入翻译输入框

### 7. 验证与提交 🚧
- [ ] cargo build
- [ ] npm run tauri build
- [ ] git commit
