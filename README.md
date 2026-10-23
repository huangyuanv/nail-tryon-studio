# 美甲试戴台 Nail Try-On Studio

上传手部照片与美甲款式参考图，将参考图中的颜色、图案、光泽、甲型应用到原有指甲。中文界面采用暖色调沙龙风格，支持移动端、点击或拖拽上传、图片预览、高级设置、原图/效果图对比滑杆和下载。

## 运行方法

需要 Node.js v24，无外部依赖，无需 npm install，无构建步骤。

```sh
cp .env.example .env
npm start
```

打开 http://localhost:3000。默认端口为 3000，可通过 `.env` 的 `PORT` 修改。后端使用 Node.js 内置 `node:http`、`fetch`、`FormData`、`Blob` 等功能，自动从项目目录加载 `.env`，已有环境变量优先。

## 配置 API Key

在 `.env` 中填写：

```dotenv
OPENAI_API_KEY=你的API密钥
IMAGE_MODEL=gpt-image-1
PORT=3000
```

保存并重启服务器。密钥仅在后端使用，不会发到浏览器；`.env` 已在 `.gitignore` 中忽略。真实生成需要可使用该模型的 OpenAI API 账户和额度。

后端调用 [OpenAI Images Edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)（`https://api.openai.com/v1/images/edits`），以 multipart/form-data 的两个 `image[]` 字段依次提交手部照片和参考图，默认模型严格使用 `gpt-image-1`。请求 PNG 输出，读取 `data[0].b64_json` 并返回 data URL。不将照片保存到服务器磁盘；真实生成会将两张照片发送到 OpenAI。

## 负面提示词与 buildPrompt 设计

`server.js` 中独立导出的 `buildPrompt(prompt, negativePrompt)` 是唯一的最终提示词组装入口：

1. 明确第一张图为编辑目标，第二张图仅提供美甲风格，不复制参考图的手部或背景。
2. 加入用户的补充要求，并明确这些要求仅在符合保真规则时适用，不能替换核心提示词。
3. 始终加入以下固定正向提示词：

   > Keep the hand photo pixel-faithful — preserve the original skin texture, pores, wrinkles, knuckle lines, finger shape, skin tone, lighting and background exactly as they are. Only apply the nail style (color, pattern, finish and shape) from the reference photo onto the existing nails.

4. 再次要求仅编辑原有指甲区域，不美化、磨皮、重塑或重绘双手，不改变构图，甲型变化不影响周围皮肤和手指。
5. 最后拼接 `" Avoid: " + negativePrompt`。Images Edit API 没有独立的 negative prompt 参数，所以明确将负面提示词放进最终 prompt 文本，而不是发送一个无效的 `negative_prompt` 字段。代码中也有对应注释。

高级设置中的负面提示词可见、可编辑，并预填 SPEC.md 指定的完整中英文默认值：

```text
beautified hands, airbrushed skin, smoothed skin, plastic skin, reshaped fingers, elongated fingers, slimmer fingers, changed skin tone, whitened skin, removed skin texture, removed pores, removed wrinkles, removed knuckle lines, redrawn hands, extra fingers, deformed hands, altered background, altered lighting, cartoon, illustration, over-sharpened, 美化手部, 磨皮, 拉长手指, 改变手指形状, 改变肤色, 美白, 去除皮肤纹理, 去除毛孔和皱纹, 重绘手部, 多余手指, 改变背景, 改变光线
```

前端每次请求都提交 `negativePrompt`，后端将其加入最终提示词；缺省或只含空白时恢复默认值。非字符串会返回中文错误，不会静默丢弃。前后端默认值保持一致。提示词表达严格保真要求，但生成模型仍可能改变非指甲区域；当前实现未使用像素遮罩或硬性合成，不能保证模型输出在指甲外逐像素不变。

## 演示模式（无 Key）

`OPENAI_API_KEY` 留空或未配置时，不调用图像 API，直接返回手部原图：

```json
{ "demo": true, "image": "原始手部照片的data URL", "message": "演示模式：未配置 API Key，未真正生成。当前显示手部原图。" }
```

前端在结果区和状态中明确标注“演示模式：未配置 API Key，未真正生成”，对比滑杆两侧实际均为手部原图。下载文件名带 `-demo`，避免与真实结果混淆。

## 接口与限制

- `GET /`：提供 `public` 中的静态页面，限制路径范围并检查真实路径，阻止路径穿越及通过符号链接访问目录外文件。
- `POST /api/generate`：接收 JSON `{ handImage, nailImage, prompt?, negativePrompt }`。图片使用 PNG、JPEG、WebP base64 data URL；参考图和手部图均必填。
- 整个 JSON 请求体最多 25MB（包括 base64 编码开销）；流式累计检查，即使没有 Content-Length 也会限制。浏览器同时提前检查总大小，单图限制为 18MB。
- 无效 JSON、缺图、错误格式、请求过大、上游鉴权/额度错误、网络错误及超时均返回中文错误信息。前端显示错误并允许重试。
- 生成时禁用重复提交和更换图片，显示等待状态与动态进度条；进度条仅表示处理中，不伪造生成百分比。
- 该项目是本地运行工具，未提供用户登录、调用配额或公网服务管理。

## 语法检查

```sh
node --check server.js
node --check public/app.js
```
