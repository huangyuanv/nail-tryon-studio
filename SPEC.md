# 美甲试戴台 Nail Try-On Studio — 项目需求

## 产品目标
一个网页应用：用户上传一张自己的手部照片和一张美甲款式参考照片，点击生成后，自动把参考图的美甲款式（颜色、图案、光泽、甲型）应用到手部照片原有的指甲上，输出效果图。

## 最重要的生成原则（必须落实到代码和提示词里）
1. 只修改指甲区域，绝不美化手部。
2. 生成请求必须带负面提示词（negative prompt），默认值为：
   "beautified hands, airbrushed skin, smoothed skin, plastic skin, reshaped fingers, elongated fingers, slimmer fingers, changed skin tone, whitened skin, removed skin texture, removed pores, removed wrinkles, removed knuckle lines, redrawn hands, extra fingers, deformed hands, altered background, altered lighting, cartoon, illustration, over-sharpened, 美化手部, 磨皮, 拉长手指, 改变手指形状, 改变肤色, 美白, 去除皮肤纹理, 去除毛孔和皱纹, 重绘手部, 多余手指, 改变背景, 改变光线"
3. 正向提示词必须明确要求：Keep the hand photo pixel-faithful — preserve the original skin texture, pores, wrinkles, knuckle lines, finger shape, skin tone, lighting and background exactly as they are. Only apply the nail style (color, pattern, finish and shape) from the reference photo onto the existing nails.
4. 负面提示词要在界面上可见、可编辑（高级设置里），并随每次生成请求一起发送到后端，后端再拼进给图像模型的最终提示词中。如果所用图像 API 没有单独的 negative prompt 参数，就把负面提示词以 "Avoid: ..." 的形式明确拼入 prompt 文本，并在代码注释和 README 里说明这一点。

## 技术要求
- 零外部依赖：只用 Node.js（v24）内置模块写后端（node:http），前端用原生 HTML/CSS/JS，不要 npm install 任何包，不要构建步骤。
- 文件结构：
  - package.json（scripts: start = node server.js）
  - server.js
  - public/index.html
  - public/styles.css
  - public/app.js
  - .env.example（写明 OPENAI_API_KEY、IMAGE_MODEL，默认 gpt-image-1）
  - .gitignore（node_modules、.env）
  - README.md（中文：项目介绍、运行方法、如何配置 API key、负面提示词设计说明、无 key 时的演示模式说明）
- 后端接口：
  - GET / 静态文件服务（public 目录，注意防止路径穿越）
  - POST /api/generate：接收 JSON { handImage: dataURL, nailImage: dataURL, prompt?: string, negativePrompt: string }
    - 如果环境变量 OPENAI_API_KEY 存在：把两张图组装成 multipart/form-data 调用 OpenAI Images Edit API（https://api.openai.com/v1/images/edits，model 用 IMAGE_MODEL 环境变量或 gpt-image-1），prompt = 正向提示词 + " Avoid: " + negativePrompt。把返回的 b64_json 转成 data URL 以 JSON { image: dataURL } 返回。
    - 如果没有 OPENAI_API_KEY：进入演示模式，返回 { demo: true, image: handImage 原图, message: 说明文字 }，让前端明确标注"演示模式：未配置 API Key，未真正生成"。
    - 对缺少图片、JSON 过大（限制 25MB）等情况返回明确的中文错误信息。
- 前端功能（界面语言：中文）：
  - 标题区：美甲试戴台 + 一句说明
  - 两个上传区（支持点击选择和拖拽）：① 我的手部照片 ② 美甲款式照片，都要有预览
  - 高级设置：可编辑的负面提示词文本框（预填上面的默认值）和补充要求输入框
  - 生成按钮：两张图都上传后才可用；生成中显示进度状态
  - 结果区：显示效果图；提供原图/效果图对比滑杆（before/after slider）；提供下载效果图按钮
  - 演示模式时在结果图上/下方明确标注演示模式
  - 设计风格：简洁高级的美甲沙龙风，暖色调，圆角卡片，移动端可用
- 代码要有必要的注释，关键是提示词组装逻辑（buildPrompt 函数）要清晰单独成函数。

完成后请运行 `node --check server.js` 和 `node --check public/app.js` 确认语法无误。
