'use strict';

// Keep this default identical to the server fallback in server.js.
const DEFAULT_NEGATIVE_PROMPT = 'beautified hands, airbrushed skin, smoothed skin, plastic skin, reshaped fingers, elongated fingers, slimmer fingers, changed skin tone, whitened skin, removed skin texture, removed pores, removed wrinkles, removed knuckle lines, redrawn hands, extra fingers, deformed hands, altered background, altered lighting, cartoon, illustration, over-sharpened, 美化手部, 磨皮, 拉长手指, 改变手指形状, 改变肤色, 美白, 去除皮肤纹理, 去除毛孔和皱纹, 重绘手部, 多余手指, 改变背景, 改变光线';
const $ = id => document.getElementById(id);
const images = { hand: null, nail: null };
const versions = { hand: 0, nail: 0 };
const reading = { hand: false, nail: false };
let busy = false;
$('negative-prompt').value = DEFAULT_NEGATIVE_PROMPT;
function updateButton() {
  $('generate').disabled = busy || reading.hand || reading.nail || !images.hand || !images.nail;
}
function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
async function loadFile(kind, file) {
  if (!file || busy) return;
  const version = ++versions[kind];
  reading[kind] = true;
  updateButton();
  showError('');
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
    if (!file.size || file.size > 18 * 1024 * 1024) throw new Error('单张图片需大于 0 且不超过 18MB；两张图片的请求总大小不得超过 25MB。');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
      reader.readAsDataURL(file);
    });
    const decoded = new Image();
    decoded.src = data;
    try { await decoded.decode(); } catch { throw new Error('无法打开这张图片，请选择有效的图片文件。'); }
    // A slower earlier upload must not overwrite a newer selection.
    if (version !== versions[kind]) return;
    images[kind] = data;
    $(`${kind}-preview`).src = data;
    $(`${kind}-preview`).hidden = false;
    $(`${kind}-zone`).querySelector('.upload-empty').hidden = true;
    $(`${kind}-zone`).querySelector('.replace-label').hidden = false;
    $(`${kind}-caption`).textContent = file.name;
    $('result').hidden = true;
    $('status').textContent = images.hand && images.nail ? '照片已就绪，开始生成你的美甲效果' : '再上传一张照片，即可开始试戴';
  } catch (error) {
    if (version === versions[kind]) showError(error.message);
  } finally {
    if (version === versions[kind]) reading[kind] = false;
    updateButton();
  }
}
for (const kind of ['hand', 'nail']) {
  const zone = $(`${kind}-zone`);
  const input = $(`${kind}-file`);
  input.addEventListener('change', () => { loadFile(kind, input.files[0]); input.value = ''; });
  for (const event of ['dragenter', 'dragover']) zone.addEventListener(event, e => {
    e.preventDefault();
    if (!busy) zone.classList.add('drag-over');
  });
  for (const event of ['dragleave', 'drop']) zone.addEventListener(event, e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', e => loadFile(kind, e.dataTransfer.files[0]));
}
// Avoid navigating away if a photo is dropped just outside an upload target.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('compare-slider').addEventListener('input', event => {
  $('comparison').style.setProperty('--split', `${event.target.value}%`);
});
$('tryon-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || $('generate').disabled) return;
  const originalHand = images.hand;
  // Send the editable negative prompt on every request, including its fallback.
  const negativePrompt = $('negative-prompt').value.trim() || DEFAULT_NEGATIVE_PROMPT;
  $('negative-prompt').value = negativePrompt;
  const body = JSON.stringify({ handImage: originalHand, nailImage: images.nail, prompt: $('extra-prompt').value.trim(), negativePrompt });
  if (new Blob([body]).size > 25 * 1024 * 1024) { showError('请求总大小超过 25MB，请压缩图片后重试。'); return; }
  busy = true;
  updateButton();
  showError('');
  $('result').hidden = true;
  $('progress').hidden = false;
  $('button-label').textContent = '正在生成，请稍候…';
  $('status').textContent = '正在应用美甲款式，请保持页面打开，通常需要几分钟…';
  $('tryon-form').setAttribute('aria-busy', 'true');
  document.querySelectorAll('input[type="file"], textarea').forEach(input => { input.disabled = true; });
  try {
    const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(200000) });
    let data;
    try { data = await response.json(); } catch { throw new Error('服务器返回了无效响应，请稍后重试。'); }
    if (!response.ok) throw new Error(data.error || '生成失败，请稍后重试。');
    if (typeof data.image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(data.image)) throw new Error('服务器未返回有效的效果图。');
    const output = new Image();
    output.src = data.image;
    await output.decode();
    $('after-image').src = data.image;
    $('before-image').src = originalHand;
    $('comparison').style.aspectRatio = `${output.naturalWidth} / ${output.naturalHeight}`;
    $('compare-slider').value = 50;
    $('comparison').style.setProperty('--split', '50%');
    $('download').href = data.image;
    const extension = data.image.startsWith('data:image/jpeg') ? 'jpg' : data.image.startsWith('data:image/webp') ? 'webp' : 'png';
    $('download').download = `nail-tryon${data.demo ? '-demo' : ''}.${extension}`;
    $('demo-notice').hidden = !data.demo;
    $('demo-notice').textContent = data.demo ? '演示模式：未配置 API Key，未真正生成。当前显示手部原图。' : '';
    $('after-image').alt = data.demo ? '演示模式：手部原图，未真正生成美甲效果' : '美甲试戴效果图';
    $('result-title').textContent = data.demo ? '试戴预览 · 演示模式' : '你的指尖新造型';
    $('status').textContent = data.demo ? '演示模式：未配置 API Key，未真正生成' : '试戴效果已生成，可以对比并下载';
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  } catch (error) {
    showError(error.name === 'TimeoutError' ? '生成等待超时，请稍后重试。' : error instanceof TypeError ? '网络连接失败，请检查网络后重试。' : error.message);
    $('status').textContent = '未能生成，可调整照片或要求后重试';
  } finally {
    busy = false;
    $('progress').hidden = true;
    $('button-label').textContent = '生成我的美甲效果';
    $('tryon-form').removeAttribute('aria-busy');
    document.querySelectorAll('input[type="file"], textarea').forEach(input => { input.disabled = false; });
    updateButton();
  }
});
