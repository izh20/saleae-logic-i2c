请将应用图标放在本目录，用于 electron 打包：

- macOS: `icon.icns`
- Windows: `icon.ico`
- Linux: `icon.png`

文件名基础为 `icon`（electron-forge 会根据平台使用对应扩展名）。

推荐尺寸：
- macOS .icns: 包含 16x16, 32x32, 128x128, 256x256, 512x512, 1024x1024
- Windows .ico: 包含 256x256, 48x48, 32x32, 16x16
- Linux .png: 512x512 或更大

将图片放入后，重新运行 `npm run make` 即可在构建产物中看到新的应用图标。