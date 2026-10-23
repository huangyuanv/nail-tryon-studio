import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try { loadEnvFile(path.join(ROOT, '.env')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const PUBLIC = path.join(ROOT, 'public');
const MAX_BODY = 25 * 1024 * 1024;
export const DEFAULT_NEGATIVE_PROMPT = 'beautified hands, airbrushed skin, smoothed skin, plastic skin, reshaped fingers, elongated fingers, slimmer fingers, changed skin tone, whitened skin, removed skin texture, removed pores, removed wrinkles, removed knuckle lines, redrawn hands, extra fingers, deformed hands, altered background, altered lighting, cartoon, illustration, over-sharpened, 美化手部, 磨皮, 拉长手指, 改变手指形状, 改变肤色, 美白, 去除皮肤纹理, 去除毛孔和皱纹, 重绘手部, 多余手指, 改变背景, 改变光线';
const PRESERVATION_PROMPT = 'Keep the hand photo pixel-faithful — preserve the original skin texture, pores, wrinkles, knuckle lines, finger shape, skin tone, lighting and background exactly as they are. Only apply the nail style (color, pattern, finish and shape) from the reference photo onto the existing nails.';

// Supplemental requests never replace the mandatory preservation instructions.
// Images Edit has no separate negative_prompt parameter: embed it as "Avoid: ...".
export function buildPrompt(prompt = '', negativePrompt = DEFAULT_NEGATIVE_PROMPT) {
  const negative = negativePrompt.trim() || DEFAULT_NEGATIVE_PROMPT;
  return [
    'The first image is the original hand photo to edit. The second image is a nail-style reference only; do not copy its hands or background.',
    prompt.trim() ? `Additional nail-style requests (only when consistent with the preservation rules below): ${prompt.trim()}` : '',
    PRESERVATION_PROMPT,
    'Only modify the existing nail regions. Never beautify, retouch, reshape or redraw the hands. Keep the original framing and image composition. Adapt the nail shape only within the existing nails without changing fingers or surrounding skin.',
  ].filter(Boolean).join('\n') + ' Avoid: ' + negative;
}

function fail(status, message) { return Object.assign(new Error(message), { status }); }
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请使用 JSON 格式提交请求。');
  if (Number(req.headers['content-length']) > MAX_BODY) throw fail(413, '请求过大，请压缩图片后重试（JSON 总大小不得超过 25MB）。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw fail(413, '请求过大，请压缩图片后重试（JSON 总大小不得超过 25MB）。');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail(400, 'JSON 格式不正确，请重新提交。'); }
}
function decodeImage(value, label) {
  if (typeof value !== 'string' || !value) throw fail(400, `请上传${label}。`);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail(400, `${label}必须是 PNG、JPEG 或 WebP 格式的 base64 图片。`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw fail(400, `${label}的图片数据无效。`);
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail(400, `${label}的文件内容与图片格式不符。`);
  return { bytes, type: `image/${match[1]}`, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}
async function generate(req, res) {
  const body = await readJSON(req);
  const hand = decodeImage(body.handImage, '手部照片');
  const nail = decodeImage(body.nailImage, '美甲款式照片');
  for (const key of ['prompt', 'negativePrompt']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') throw fail(400, '补充要求和负面提示词必须是文本。');
    if (body[key]?.length > 10000) throw fail(400, '补充要求和负面提示词各不得超过 10000 字符。');
  }
  const prompt = buildPrompt(body.prompt, body.negativePrompt);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return json(res, 200, { demo: true, image: body.handImage, message: '演示模式：未配置 API Key，未真正生成。当前显示手部原图。' });
  }
  const form = new FormData();
  form.append('model', process.env.IMAGE_MODEL || 'gpt-image-1');
  form.append('prompt', prompt);
  // Order matters: the hand is the editing target, the second image is style only.
  form.append('image[]', new Blob([hand.bytes], { type: hand.type }), `hand.${hand.extension}`);
  form.append('image[]', new Blob([nail.bytes], { type: nail.type }), `nail-reference.${nail.extension}`);
  form.append('output_format', 'png');
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form, signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    throw fail(502, error.name === 'TimeoutError' ? '图像生成超时，请稍后重试。' : '无法连接图像服务，请检查网络后重试。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const message = response.status === 401 ? 'API Key 无效，请检查服务器配置。'
      : response.status === 429 ? '图像服务额度不足或请求过于频繁，请稍后重试。'
        : `图像服务生成失败（${response.status}），请检查模型权限、图片和账户配置。`;
    throw fail(502, message);
  }
  let result;
  try { result = await response.json(); } catch { throw fail(502, '图像服务返回了无效响应，请重试。'); }
  const base64 = result.data?.[0]?.b64_json;
  if (typeof base64 !== 'string' || !base64) throw fail(502, '图像服务未返回效果图，请重试。');
  json(res, 200, { image: `data:image/png;base64,${base64}` });
}

export const server = http.createServer(async (req, res) => {
  try {
    // Decode before resolving; reject traversal and symlinks outside public.
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    if (pathname === '/api/generate') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw fail(405, '此接口仅支持 POST 请求。'); }
      return await generate(req, res);
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, '不支持此请求方法。');
    const target = path.resolve(PUBLIC, '.' + (pathname === '/' ? '/index.html' : pathname));
    const inside = file => file.startsWith(PUBLIC + path.sep);
    if (!inside(target) || pathname.includes('\0') || pathname.includes('\\')) throw fail(403, '禁止访问此路径。');
    let actual;
    try { actual = await realpath(target); } catch { throw fail(404, '页面或文件不存在。'); }
    if (!inside(actual)) throw fail(403, '禁止访问此路径。');
    const content = await readFile(actual);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(actual)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) json(res, error.status || (error instanceof URIError ? 400 : 500), { error: error.status ? error.message : error instanceof URIError ? '请求路径格式无效。' : '服务器发生错误，请稍后重试。' });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(Number(process.env.PORT) || 3000, () => console.log(`美甲试戴台：http://localhost:${server.address().port}`));
}
