# HitFlare 光引：白底渐变字标提示词

以下英文原文与本轮实际提交的 4 个任务一致。中文说明便于比较设计方向。

## 本轮 API 参数

- 工具：imagegen skill 的 API fallback CLI，generate-batch。
- 模型：gpt-image-2。
- 质量：high。
- 尺寸：1024×1024；输出：PNG；每个任务 1 张。
- 背景：纯白。
- 排版：每张仅一个横向 Logo，图形在左，中英文品牌名在右。
- 字色：Hit 为紫色至洋红渐变，Flare 与「光引」为深蓝纯色。
- 图片参考：按用户附图的字色分段方式写入文字提示，本轮未上传参考图片。
- 图片生成具有随机性，使用相同提示词仍可能得到不同图形。

## 中文通用提示词

为品牌「HitFlare 光引」设计一个极简、现代的网站 Logo。使用纯白色 1:1 正方形画布，中央仅呈现一个横向组合：左侧是由一到两条上升光流与小四角星构成的简洁几何标志，图形采用橙红至金色渐变；右侧为精确文字「HitFlare 光引」，现代几何无衬线字体。仅 Hit 三个字母使用紫色至洋红渐变，Flare 与「光引」统一为深午夜蓝纯色。H 和 F 大写，中文字形准确清晰。保持充足留白与干净轮廓。无口号、无副标题、无额外文字、无复杂纹理、无三维效果、无阴影、无水印，每张只呈现一个 Logo。

## 方案 1

极简上升光带与小四角星，图形采用橙红至亮金渐变，轮廓锐利、细节克制。

### 实际提交的英文提示词

```text
Use case: logo-brand. Create one finished 1:1 square canvas containing a single clean horizontal website logo lockup for the brand HitFlare 光引. White background only. On the left, a minimal geometric rising light ribbon with a tiny four-point star, orange-red to golden yellow gradient, crisp vector-like silhouette, no complex details. On the right, one exact wordmark: HitFlare 光引. Typography must be modern geometric sans-serif and perfectly legible. Apply a vivid purple-to-magenta gradient only to the word Hit, similar to the color treatment of a modern tech wordmark; keep Flare in a single deep navy color; keep 光引 in the same deep navy color. The wordmark must have no extra colors, no metallic effect, no glow, no shadow, no slogan, no subtitle, no other text. H and F uppercase, exact spelling HitFlare, Chinese exact 光引. Centered horizontal composition with generous whitespace, no watermark, no mockup.
```

## 方案 2

两条流畅的上升光流汇聚到小四角星，橙色至金色渐变，平面几何风格，字重偏粗。

### 实际提交的英文提示词

```text
Use case: logo-brand. Create one finished 1:1 square canvas containing a single clean horizontal website logo lockup for the brand HitFlare 光引. Pure white background. Minimal icon on the left: two smooth upward light streaks converging into a small four-point star, orange to gold gradient, flat vector branding, very simple. On the right, exact text HitFlare 光引 in a bold modern sans-serif. Color treatment: Hit uses a smooth purple into hot pink gradient like a contemporary startup wordmark; Flare is solid charcoal-navy; 光引 is solid charcoal-navy. No gradient on Flare or Chinese text. No other text, no slogan, no subtitle, no decorative icons, no 3D, no shadow, no watermark. Precise spelling and clear Chinese glyphs. One logo only, centered with whitespace.
```

## 方案 3

单条弯曲能量笔画，橙红至金色渐变，以四角星收尾，强调最少的图形构成。

### 实际提交的英文提示词

```text
Use case: logo-brand. Design one premium minimal horizontal logo for HitFlare 光引 on a white 1:1 square artboard. Left icon is a concise rising flare mark: a single curved orange-red-to-gold energy stroke ending in a four-point star, clean vector outline, no flame illustration. Right wordmark reads exactly HitFlare 光引. Use modern geometric sans-serif. Make only the letters Hit carry a purple-to-magenta gradient; Flare must be one uniform deep midnight-blue; 光引 must be one uniform deep midnight-blue. Match the visual idea of a colored first word followed by dark text, while remaining highly legible. No slogan or secondary copy. No extra symbols, no background graphics, no bevels, no drop shadows, no watermark, no alternate layouts.
```

## 方案 4

简洁的橙金上升光迹与小星芒，保留必要轮廓，图形与文字保持水平对齐。

### 实际提交的英文提示词

```text
Use case: logo-brand. Generate one simple professional website logo lockup for HitFlare 光引 on an uncluttered white background in a 1:1 square canvas. Icon at left: minimal orange/gold ascending light trail with a small starburst, crisp and scalable, only essential shapes. Text at right exactly HitFlare 光引, horizontal baseline. Typography is clean geometric sans-serif. Hit should have a controlled purple-to-fuchsia gradient inspired by a modern colored wordmark; Flare and 光引 should remain solid dark navy, with no color shift. Exact English capitalization H and F, exact Chinese 光引. Only this logo appears. No slogan, no descriptor, no extra text, no texture, no scene, no mockup, no watermark.
```
