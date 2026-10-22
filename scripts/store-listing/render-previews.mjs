import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '../..');
const stagingDirectory = join(root, '.tmp', 'store-listing', 'rendered');
const outputDirectory = join(root, 'deliverables', 'store-listing');
const safeLibraryViewBox = '0 280 1462 744';

async function pngDataURL(path) {
  const contents = await readFile(path);
  return `data:image/png;base64,${contents.toString('base64')}`;
}

function escapeXML(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[character]));
}

function chips(labels) {
  let x = 78;
  return labels.map((label) => {
    const width = 38 + [...label].length * 18;
    const item = `
      <rect x="${x}" y="674" width="${width}" height="46" rx="23" fill="#0a120c" stroke="#3e9a50" stroke-opacity="0.7"/>
      <text x="${x + 19}" y="704" fill="#d9e5db" font-size="17" font-weight="600">${escapeXML(label)}</text>`;
    x += width + 14;
    return item;
  }).join('');
}

function deviceVisual(source) {
  return `
    <g filter="url(#shadow)">
      <image href="${source}" x="1012" y="164" width="376" height="668" preserveAspectRatio="xMidYMid slice"/>
    </g>`;
}

function webVisual(source) {
  return `
    <g filter="url(#shadow)">
      <svg x="756" y="266" width="700" height="490" viewBox="${safeLibraryViewBox}" preserveAspectRatio="xMidYMid slice">
        <image href="${source}" x="0" y="0" width="1462" height="1024"/>
      </svg>
    </g>`;
}

function slideSVG({ eyebrow, lineOne, lineTwo, subtitleOne, subtitleTwo, labels, meta, page, visual }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
  <defs>
    <radialGradient id="glow" cx="88%" cy="14%" r="72%">
      <stop offset="0%" stop-color="#174423" stop-opacity="0.38"/>
      <stop offset="42%" stop-color="#07110a" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#030604" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
    <clipPath id="icon-clip"><rect x="78" y="58" width="60" height="60" rx="16"/></clipPath>
  </defs>
  <rect width="1536" height="1024" fill="#030604"/>
  <rect width="1536" height="1024" fill="url(#glow)"/>
  <g opacity="0.13" stroke="#67dd7b" stroke-width="1">
    <path d="M0 72H1536 M0 136H1536 M0 200H1536 M0 264H1536 M0 328H1536 M0 392H1536 M0 456H1536 M0 520H1536 M0 584H1536 M0 648H1536"/>
    <path d="M64 0V768 M128 0V768 M192 0V768 M256 0V768 M320 0V768 M384 0V768 M448 0V768 M512 0V768 M576 0V768 M640 0V768 M704 0V768 M768 0V768 M832 0V768 M896 0V768 M960 0V768 M1024 0V768 M1088 0V768 M1152 0V768 M1216 0V768 M1280 0V768 M1344 0V768 M1408 0V768 M1472 0V768"/>
  </g>
  <g font-family="PingFang SC, -apple-system, sans-serif">
    <image href="${visual.icon}" x="78" y="58" width="60" height="60" clip-path="url(#icon-clip)"/>
    <text x="156" y="84" fill="#f3f8f3" font-size="26" font-weight="700" letter-spacing="2">不卡壳助手</text>
    <text x="1458" y="88" fill="#83f99a" font-size="14" font-weight="700" text-anchor="end" letter-spacing="2">${escapeXML(meta)}</text>
    <line x1="78" y1="136" x2="1458" y2="136" stroke="#80ff97" stroke-opacity="0.28"/>

    <text x="78" y="324" fill="#70ff8e" font-size="16" font-weight="700" letter-spacing="3">${escapeXML(eyebrow)}</text>
    <text x="78" y="410" fill="#f3f8f3" font-size="66" font-weight="700">${escapeXML(lineOne)}</text>
    <text x="78" y="486" fill="#75ff91" font-size="66" font-weight="700">${escapeXML(lineTwo)}</text>
    <text x="78" y="560" fill="#b5c0b7" font-size="23">${escapeXML(subtitleOne)}</text>
    <text x="78" y="596" fill="#b5c0b7" font-size="23">${escapeXML(subtitleTwo)}</text>
    ${chips(labels)}
    ${visual.content}

    <line x1="78" y1="894" x2="1458" y2="894" stroke="#80ff97" stroke-opacity="0.22"/>
    <text x="78" y="940" fill="#75ff91" font-size="16" font-weight="700">为每一次开口，留一组眼前能用的词</text>
    <text x="1458" y="940" fill="#9aa79d" font-size="16" text-anchor="end">${escapeXML(page)} / 03</text>
  </g>
</svg>`;
}

const assets = {
  icon: await pngDataURL(join(outputDirectory, 'app-icon.png')),
  hud: await pngDataURL(join(root, '.tmp', 'store-listing', '2026-10-12-hud.png')),
  menu: await pngDataURL(join(root, '.tmp', 'store-listing', '2026-10-12-menu.png')),
  library: await pngDataURL(join(root, '.tmp', 'store-listing', 'web-library.png')),
};

const slides = [
  {
    output: 'preview-01-nod.png',
    eyebrow: 'LOOK UP · NOD · SPEAK',
    lineOne: '抬眼看词，',
    lineTwo: '点头听发音',
    subtitleOne: '词条信息留在下方视野，不遮住真实世界。',
    subtitleTwo: '点头即可使用设备原生 TTS 朗读。',
    labels: ['点头朗读', '原生 TTS', '多语言词条'],
    meta: 'PERSONAL WORD CARDS',
    page: '01',
    visual: { icon: assets.icon, content: deviceVisual(assets.hud) },
  },
  {
    output: 'preview-02-library.png',
    eyebrow: 'CREATE · REFRESH · PRACTISE',
    lineOne: '词库由你定义，',
    lineTwo: '眼镜菜单主动刷新',
    subtitleOne: '网页创建个人词库，设置多语言词条和倒计时。',
    subtitleTwo: '准备好后，从眼镜菜单刷新使用。',
    labels: ['个人默认词库', '网页工作台', '主动刷新'],
    meta: 'YOUR LIBRARY · YOUR WORDS',
    page: '02',
    visual: { icon: assets.icon, content: webVisual(assets.library) },
  },
  {
    output: 'preview-03-menu.png',
    eyebrow: 'WORDS · MENU · COUNTDOWN',
    lineOne: '镜腿点击打开菜单，',
    lineTwo: '方向键选择确认',
    subtitleOne: '朗读、切词、刷新与网页登录集中在右下角。',
    subtitleTwo: '不打断视野，也能随时完成操作。',
    labels: ['镜腿点击', '方向键选择', '倒计时'],
    meta: 'FOCUS · CHOOSE · CONFIRM',
    page: '03',
    visual: { icon: assets.icon, content: deviceVisual(assets.menu) },
  },
];

await mkdir(stagingDirectory, { recursive: true });
for (const slide of slides) {
  const svgPath = join(stagingDirectory, slide.output.replace(/\.png$/, '.svg'));
  const outputPath = join(outputDirectory, slide.output);
  await writeFile(svgPath, slideSVG(slide));
  const result = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', outputPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`sips failed for ${slide.output}: ${result.stderr || result.stdout}`);
  }
}
